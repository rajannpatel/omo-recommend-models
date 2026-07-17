import {
  isProviderAvailable,
  probeModel,
  markProviderCreditExhausted,
} from "../../probe-providers.js";
import { writeTopLevelLine } from "../../display/progress.js";
import { LOCAL_PROVIDER } from "../../constants.js";
import { buildFreeModelRefPredicate } from "../../shared/provider-cache.js";

const DEFAULT_PROBE_CONCURRENCY = Object.freeze({
  global: 4,
  perProvider: 1,
  freeOrLocal: 1,
});

function splitExactModelRef(modelRef) {
  if (typeof modelRef !== "string") {
    throw new TypeError("eligible model refs must be strings");
  }
  const trimmed = modelRef.trim();
  const slash = trimmed.indexOf("/");
  if (slash <= 0 || slash === trimmed.length - 1 || /\s/.test(trimmed)) {
    throw new TypeError(`invalid eligible model ref: ${JSON.stringify(modelRef)}`);
  }
  return {
    modelRef: trimmed,
    provider: trimmed.slice(0, slash),
    model: trimmed.slice(slash + 1),
  };
}

function stableEligibleRefs(refs) {
  const seen = new Set();
  const out = [];
  for (const rawRef of refs || []) {
    const parsed = splitExactModelRef(rawRef);
    if (seen.has(parsed.modelRef)) continue;
    seen.add(parsed.modelRef);
    out.push(parsed);
  }
  return out;
}

function cachedPolicyRecord(parsed) {
  return {
    ...parsed,
    outcome: "cached-policy",
    reason: "guardrail-policy-exclusion",
    source: "cache",
    spawned: false,
  };
}

function liveProbeRecord(parsed, result) {
  if (result?.ok) {
    return {
      ...parsed,
      outcome: "available",
      reason: null,
      source: "probe",
      spawned: true,
    };
  }
  return {
    ...parsed,
    outcome: "failed",
    reason: result?.reason || "probe-failed",
    source: "probe",
    spawned: true,
    ...(result?.errorOutput ? { errorOutput: result.errorOutput } : {}),
  };
}

function skippedRecord(parsed, outcome, reason) {
  return {
    ...parsed,
    outcome,
    reason,
    source: "orchestrator",
    spawned: false,
  };
}

function invalidateProviderSuccesses(records, provider) {
  for (const record of records) {
    if (!record) continue;
    if (record.provider !== provider || record.outcome !== "available") continue;
    record.outcome = "failed";
    record.reason = "provider-quota-exhausted";
    record.source = "orchestrator";
  }
}

function displayReason(reason) {
  return reason === "rate-limited" ? "rate limited" : reason;
}

function writeRecord(record) {
  if (record.outcome === "available") {
    writeTopLevelLine(
      `✓  model: ${record.modelRef} on provider: ${record.provider} is available`,
    );
    return;
  }
  let suffix = "";
  if (record.outcome === "cached-policy") suffix = " (cached)";
  if (record.outcome === "skipped-provider-exhausted") {
    suffix = " (not probed after provider exhaustion)";
  }
  if (record.outcome === "skipped-aborted") {
    suffix = " (not probed after interruption)";
  }
  writeTopLevelLine(
    `✗  model: ${record.modelRef} on provider: ${record.provider} is ${displayReason(record.reason)}${suffix}`,
  );
}

function writeRecordsAndSummary(records) {
  for (const record of records) writeRecord(record);
  const probed = records.filter((record) => record.spawned).length;
  const available = records.filter((record) => record.outcome === "available").length;
  const failed = probed - available;
  const cached = records.filter((record) => record.outcome === "cached-policy").length;
  const skipped = records.filter((record) => record.outcome.startsWith("skipped-")).length;
  writeTopLevelLine(
    `◇  Cloud model verification complete: ${records.length} eligible; ${probed} probed, ${available} available, ${failed} failed, ${cached} cached, ${skipped} skipped`,
  );
}

function normalizeProbeConcurrency(probeConcurrency = {}) {
  return {
    global: Math.max(1, Number(probeConcurrency.global) || DEFAULT_PROBE_CONCURRENCY.global),
    perProvider: Math.max(1, Number(probeConcurrency.perProvider) || DEFAULT_PROBE_CONCURRENCY.perProvider),
    freeOrLocal: Math.max(1, Number(probeConcurrency.freeOrLocal) || DEFAULT_PROBE_CONCURRENCY.freeOrLocal),
  };
}

function isLocalOrCliProvider(provider) {
  return provider === LOCAL_PROVIDER ||
    provider === "ollama" ||
    provider === "cli" ||
    provider === "cli/codex" ||
    provider === "cli/agy";
}

function providerUnavailableReason(ctx, provider) {
  const state = ctx.providerAvailability.get(provider);
  if (ctx.quotaExceededProviders.has(provider) || state?.creditExhausted) {
    return "quota-exceeded";
  }
  if (state?.rateLimitedUntil && state.rateLimitedUntil > Date.now()) {
    return "rate-limited";
  }
  return "provider-unavailable";
}

function queuedTaskCount(providerQueues) {
  let count = 0;
  for (const queue of providerQueues.values()) count += queue.length;
  return count;
}

async function executeProbeSequence({
  cloudLookup,
  ctx,
  eligibleRefs,
  probeConcurrency,
  probeModelFn,
}) {
  const parsedRefs = stableEligibleRefs(eligibleRefs);
  if (parsedRefs.length > 0) {
    writeTopLevelLine(`◇  Probing ${parsedRefs.length} model(s) across AI providers...`);
  }
  const records = new Array(parsedRefs.length);
  const limits = normalizeProbeConcurrency(probeConcurrency);
  const isFreeRef = buildFreeModelRefPredicate(cloudLookup);
  const providerQueues = new Map();
  const providerOrder = [];
  const closedProviders = new Set();
  const activeByProvider = new Map();
  let activeGlobal = 0;
  let activeCautious = 0;
  let cursor = 0;

  const enqueue = (task) => {
    if (!providerQueues.has(task.parsed.provider)) {
      providerQueues.set(task.parsed.provider, []);
      providerOrder.push(task.parsed.provider);
    }
    providerQueues.get(task.parsed.provider).push(task);
  };

  for (let index = 0; index < parsedRefs.length; index += 1) {
    const parsed = parsedRefs[index];
    if (ctx.signal.aborted) {
      records[index] = skippedRecord(parsed, "skipped-aborted", "aborted");
      continue;
    }
    if (ctx.policyExclusionCache?.has(parsed.modelRef)) {
      records[index] = cachedPolicyRecord(parsed);
      continue;
    }
    enqueue({
      cautious: isLocalOrCliProvider(parsed.provider) || isFreeRef(parsed),
      index,
      parsed,
    });
  }

  const markQueuedProviderClosed = (provider, reason) => {
    closedProviders.add(provider);
    const queue = providerQueues.get(provider) || [];
    for (const task of queue.splice(0)) {
      records[task.index] = skippedRecord(
        task.parsed,
        "skipped-provider-exhausted",
        reason,
      );
    }
  };

  const markUnstartedAborted = () => {
    for (const queue of providerQueues.values()) {
      for (const task of queue.splice(0)) {
        records[task.index] = skippedRecord(task.parsed, "skipped-aborted", "aborted");
      }
    }
  };

  const nextTask = () => {
    for (let attempts = 0; attempts < providerOrder.length; attempts += 1) {
      const provider = providerOrder[cursor % providerOrder.length];
      cursor += 1;
      const queue = providerQueues.get(provider);
      if (!queue?.length) continue;
      if (closedProviders.has(provider) || !isProviderAvailable(ctx, provider)) {
        markQueuedProviderClosed(provider, providerUnavailableReason(ctx, provider));
        continue;
      }
      const task = queue[0];
      if ((activeByProvider.get(provider) || 0) >= limits.perProvider) continue;
      if (task.cautious && activeCautious >= limits.freeOrLocal) continue;
      return queue.shift();
    }
    return null;
  };

  await new Promise((resolve, reject) => {
    let rejected = false;
    const finishIfDone = () => {
      if (activeGlobal === 0 && queuedTaskCount(providerQueues) === 0) resolve();
    };
    const dispatch = () => {
      if (rejected) return;
      if (ctx.signal.aborted) markUnstartedAborted();
      while (!ctx.signal.aborted && activeGlobal < limits.global) {
        const task = nextTask();
        if (!task) break;
        activeGlobal += 1;
        if (task.cautious) activeCautious += 1;
        activeByProvider.set(
          task.parsed.provider,
          (activeByProvider.get(task.parsed.provider) || 0) + 1,
        );
        Promise.resolve(probeModelFn(ctx, task.parsed.modelRef, ctx.signal))
          .then((result) => {
            const record = liveProbeRecord(task.parsed, result);
            records[task.index] = record;
            if (record.reason === "guardrail-policy-exclusion") {
              ctx.policyExclusionCache?.add(task.parsed.modelRef);
            }
            if (result?.scope === "provider" && result.reason === "quota-exceeded") {
              markProviderCreditExhausted(ctx, task.parsed.provider, "quota-exceeded");
              markQueuedProviderClosed(task.parsed.provider, "quota-exceeded");
            }
            if (closedProviders.has(task.parsed.provider)) {
              invalidateProviderSuccesses(records, task.parsed.provider);
            }
            if (record.reason === "aborted" || ctx.signal.aborted) markUnstartedAborted();
          })
          .catch((error) => {
            rejected = true;
            reject(error);
          })
          .finally(() => {
            activeGlobal -= 1;
            if (task.cautious) activeCautious -= 1;
            activeByProvider.set(
              task.parsed.provider,
              activeByProvider.get(task.parsed.provider) - 1,
            );
            if (closedProviders.has(task.parsed.provider)) {
              invalidateProviderSuccesses(records, task.parsed.provider);
            }
            dispatch();
            finishIfDone();
          });
      }
      finishIfDone();
    };
    dispatch();
  });

  const orderedRecords = records.filter(Boolean);
  writeRecordsAndSummary(orderedRecords);
  return orderedRecords;
}

export async function runProviderProbes({
  cloudLookup,
  ctx,
  eligibleRefs,
  probeConcurrency,
  sortedPaid,
  probeCandidates,
  probeModelFn = probeModel,
}) {
  const advertisedRefs = eligibleRefs ?? probeCandidates ?? sortedPaid ?? [];
  const probeRecordsPromise = executeProbeSequence({
    cloudLookup,
    ctx,
    eligibleRefs: advertisedRefs,
    probeConcurrency,
    probeModelFn,
  });
  const paidProbesPromise = probeRecordsPromise.then((records) =>
    records
      .filter((record) => record.outcome === "available")
      .map((record) => record.modelRef),
  );
  const rejectedPaidModelsPromise = probeRecordsPromise.then((records) =>
    records
      .filter((record) => record.outcome !== "available")
      .map((record) => record.modelRef),
  );
  const rejectedPaidModelDetailsPromise = probeRecordsPromise.then(
    (records) => new Map(
      records
        .filter((record) => record.outcome !== "available")
        .map((record) => [record.modelRef, { ...record }]),
    ),
  );
  const ensureProbesAwaited = async () => {
    await probeRecordsPromise;
  };

  return {
    probeRecordsPromise,
    paidProbesPromise,
    rejectedPaidModelsPromise,
    rejectedPaidModelDetailsPromise,
    ensureProbesAwaited,
  };
}
