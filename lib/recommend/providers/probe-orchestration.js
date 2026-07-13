import {
  isProviderAvailable,
  probeModel,
  markProviderCreditExhausted,
} from "../../probe-providers.js";
import { writeGroupSeparator, writeTopLevelLine } from "../../display/progress.js";

function paidModelRejection(modelRef, result) {
  const slash = modelRef.indexOf("/");
  const provider = slash === -1 ? "" : modelRef.slice(0, slash);
  const model = slash === -1 ? modelRef : modelRef.slice(slash + 1);
  return {
    provider,
    model,
    modelRef,
    reason: result?.reason || "probe-failed",
    ...(result?.errorOutput ? { errorOutput: result.errorOutput } : {}),
  };
}

function createProbeAwaiter({ paidProbesEnabled, paidProbesPromise, providersCount }) {
  let probesAwaitedPromise = null;
  return async function ensureProbesAwaited() {
    if (!probesAwaitedPromise) {
      probesAwaitedPromise = paidProbesPromise
        .then(() => {
          if (paidProbesEnabled && providersCount > 0) {
            writeGroupSeparator();
            process.stdout.write(
              `◇  Cloud provider verification complete: ${providersCount}/${providersCount}\n`,
            );
            writeGroupSeparator();
          }
        })
        .catch(() => {});
    }
    await probesAwaitedPromise;
  };
}

function recordRejectedModel(rejectedRefs, rejectedDetails, modelRef, result) {
  rejectedRefs.add(modelRef);
  rejectedDetails.set(modelRef, paidModelRejection(modelRef, result));
}

export async function runProviderProbes({
  ctx,
  sortedPaid,
  probeCandidates,
}) {
  const rejectedRefs = new Set();
  const rejectedDetails = new Map();
  const failedProviders = new Set();
  const byProvider = {};
  for (const ref of probeCandidates) {
    const provider = ref.split("/")[0];
    if (!byProvider[provider]) byProvider[provider] = [];
    byProvider[provider].push(ref);
  }
  const providers = Object.keys(byProvider);
  let completedCount = 0;
  if (providers.length > 0) {
    process.stdout.write(
      `◇  Verifying availability for ${providers.length} cloud provider(s) — this may take ~30s...\n│\n`,
    );
    writeGroupSeparator();
  }

  const runSequentially = async () => {
    const results = [];
    let isFirst = true;
    for (const [index, provider] of providers.entries()) {
      if (!isFirst && ctx.verboseMode) {
        process.stdout.write("\n");
      }
      isFirst = false;

      const res = await (async () => {
        const seenModels = new Set();
        const models = [];
        for (const modelRef of [...byProvider[provider], ...sortedPaid]) {
          if (modelRef.split("/")[0] !== provider || seenModels.has(modelRef)) continue;
          seenModels.add(modelRef);
          models.push(modelRef);
        }
        if (models.length === 0) {
          return { provider, ok: false, reason: "no-models" };
        }

        for (const [modelIndex, modelRef] of models.entries()) {
          const isLastModel = modelIndex === models.length - 1;
          if (ctx.signal.aborted) {
            return {
              provider,
              ok: false,
              reason: "aborted",
              errorOutput: "Aborted by user",
            };
          }

          let formatterCalled = false;
          const statusFormatter = (res) => {
            formatterCalled = true;
            const reason = res.reason || "probe-failed";
            const isRetry = !res.ok && reason === "model-unavailable" && !isLastModel;

            if (!isRetry) {
              completedCount++;
            }
            if (res.ok) {
              const state = ctx.providerAvailability.get(provider);
              if (state) {
                state.creditExhausted = false;
                state.reason = null;
              }
              ctx.quotaExceededProviders.delete(provider);
              return `✓  verified  ${completedCount}/${providers.length} ${provider} by ${modelRef}`;
            } else {
              recordRejectedModel(rejectedRefs, rejectedDetails, modelRef, res);
              if (res.reason === "quota-exceeded" && provider !== "opencode") {
                markProviderCreditExhausted(ctx, provider, "quota-exceeded");
              }
              return `✗  ${provider} by ${modelRef} — ${reason}`;
            }
          };

          const result = await probeModel(ctx, modelRef, ctx.signal, statusFormatter);
          const reason = result.reason || "probe-failed";

          if (!formatterCalled) {
            const isRetry = !result.ok && reason === "model-unavailable" && !isLastModel;
            if (!isRetry) {
              completedCount++;
            }
            if (result.ok) {
              const state = ctx.providerAvailability.get(provider);
              if (state) {
                state.creditExhausted = false;
                state.reason = null;
              }
              ctx.quotaExceededProviders.delete(provider);
              writeTopLevelLine(
                `✓  verified  ${completedCount}/${providers.length} ${provider} by ${modelRef}`,
              );
            } else {
              recordRejectedModel(rejectedRefs, rejectedDetails, modelRef, result);
              if (result.reason === "quota-exceeded" && provider !== "opencode") {
                markProviderCreditExhausted(ctx, provider, "quota-exceeded");
              }
              writeTopLevelLine(
                `✗  ${provider} by ${modelRef} — ${reason}`,
              );
            }
          }

          if (result.ok) {
            return {
              provider,
              ok: true,
              modelRef,
            };
          }

          if (reason === "model-unavailable" && !isLastModel) {
            if (ctx.verboseMode) {
              process.stdout.write("\n");
            } else {
              writeGroupSeparator();
            }
            continue;
          }

          if (reason !== "model-unavailable") {
            failedProviders.add(provider);
          }

          return {
            provider,
            ok: false,
            reason,
            errorOutput: result.errorOutput,
          };
        }

        return { provider, ok: false, reason: "no-models" };
      })();
      results.push(res);
      if (index < providers.length - 1 && !ctx.verboseMode) {
        writeGroupSeparator();
      }
    }
    return results;
  };
  const probeCompletionPromise = runSequentially();
  const rejectedPaidModelsPromise = probeCompletionPromise
    .then(() => [...rejectedRefs])
    .catch(() => []);
  const rejectedPaidModelDetailsPromise = probeCompletionPromise
    .then(() => new Map(rejectedDetails))
    .catch(() => new Map());
  const paidProbesPromise = probeCompletionPromise
    .then(() =>
      sortedPaid.filter((modelRef) => {
        const provider = modelRef.split("/")[0];
        return (
          isProviderAvailable(ctx, provider) &&
          !failedProviders.has(provider) &&
          !rejectedRefs.has(modelRef)
        );
      }),
    )
    .catch(() => []);

  const ensureProbesAwaited = createProbeAwaiter({
    paidProbesEnabled: true,
    paidProbesPromise,
    providersCount: providers.length,
  });

  return {
    paidProbesPromise,
    rejectedPaidModelsPromise,
    rejectedPaidModelDetailsPromise,
    ensureProbesAwaited,
  };
}
