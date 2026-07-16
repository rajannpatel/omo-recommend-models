import {
  probeModel,
  markProviderCreditExhausted,
} from "../../probe-providers.js";
import { writeTopLevelLine } from "../../display/progress.js";

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

function fillAbortedRecords(records, parsedRefs, startIndex) {
  for (const parsed of parsedRefs.slice(startIndex)) {
    records.push(skippedRecord(parsed, "skipped-aborted", "aborted"));
  }
}

async function executeProbeSequence({ ctx, eligibleRefs, probeModelFn }) {
  const parsedRefs = stableEligibleRefs(eligibleRefs);
  const records = [];
  const exhaustedProviders = new Set();

  for (let modelIndex = 0; modelIndex < parsedRefs.length; modelIndex++) {
    const parsed = parsedRefs[modelIndex];
    if (ctx.signal.aborted) {
      fillAbortedRecords(records, parsedRefs, modelIndex);
      break;
    }
    if (exhaustedProviders.has(parsed.provider)) {
      records.push(
        skippedRecord(parsed, "skipped-provider-exhausted", "quota-exceeded"),
      );
      continue;
    }
    if (ctx.policyExclusionCache?.has(parsed.modelRef)) {
      records.push(cachedPolicyRecord(parsed));
      continue;
    }

    const result = await probeModelFn(ctx, parsed.modelRef, ctx.signal);
    const record = liveProbeRecord(parsed, result);
    records.push(record);
    if (record.reason === "guardrail-policy-exclusion") {
      ctx.policyExclusionCache?.add(parsed.modelRef);
    }
    if (result?.scope === "provider" && result.reason === "quota-exceeded") {
      exhaustedProviders.add(parsed.provider);
      markProviderCreditExhausted(ctx, parsed.provider, "quota-exceeded");
      invalidateProviderSuccesses(records, parsed.provider);
    }
    if (record.reason === "aborted" || ctx.signal.aborted) {
      fillAbortedRecords(records, parsedRefs, modelIndex + 1);
      break;
    }
  }

  writeRecordsAndSummary(records);
  return records;
}

export async function runProviderProbes({
  ctx,
  eligibleRefs,
  sortedPaid,
  probeCandidates,
  probeModelFn = probeModel,
}) {
  const advertisedRefs = eligibleRefs ?? probeCandidates ?? sortedPaid ?? [];
  const probeRecordsPromise = executeProbeSequence({
    ctx,
    eligibleRefs: advertisedRefs,
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
