import { LOCAL_PROVIDER } from "../constants.js";
import {
  buildProviderAliases,
  buildRichModelLookup,
  loadProviderModels,
} from "../omo-shared.js";
import { sortPanelModelRefs } from "../scoring.js";
import {
  isProviderAvailable,
  probeModel,
  shouldProbeProviderAvailability,
  markProviderCreditExhausted,
} from "../probe-providers.js";
import { createProgress } from "../display-utils.js";

export function paidModelRefsFromLookup(cloudLookup) {
  const refs = [];
  for (const [provider, modelMap] of Object.entries(cloudLookup.byId || {})) {
    if (provider === LOCAL_PROVIDER || provider === "opencode") continue;
    for (const modelId of modelMap.keys()) refs.push(`${provider}/${modelId}`);
  }
  return refs;
}

export function probeModelRefsFromLookup(cloudLookup) {
  const refs = [];
  for (const [provider, modelMap] of Object.entries(cloudLookup.byId || {})) {
    if (provider === LOCAL_PROVIDER || provider === "cli") continue;
    for (const modelId of modelMap.keys()) refs.push(`${provider}/${modelId}`);
  }
  return refs;
}

export function providerProbeCandidates(sortedPaidRefs) {
  const byProvider = {};
  for (const ref of sortedPaidRefs) {
    const provider = ref.split("/")[0];
    if (!byProvider[provider]) byProvider[provider] = [];
    byProvider[provider].push(ref);
  }
  return Object.keys(byProvider)
    .map((provider) => byProvider[provider]?.[0])
    .filter(Boolean);
}

export function paidModelRejection(modelRef, result) {
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

export function createProbeAwaiter({ paidProbeProgress, paidProbesEnabled, paidProbesPromise }) {
  let probesAwaitedPromise = null;
  return async function ensureProbesAwaited() {
    if (!probesAwaitedPromise) {
      probesAwaitedPromise = paidProbesPromise.then(() => {
        if (paidProbesEnabled) paidProbeProgress?.done();
      });
    }
    await probesAwaitedPromise;
  };
}

function recordRejectedModel(rejectedRefs, rejectedDetails, modelRef, result) {
  rejectedRefs.add(modelRef);
  rejectedDetails.set(modelRef, paidModelRejection(modelRef, result));
}

export function preparePaidProviderModels({
  config,
  ctx,
  localOnlyFlag,
  hasEnoughContextForPanel,
  filterUsablePanelModels,
}) {
  if (localOnlyFlag) {
    return {
      initialCache: null,
      initialAliases: {},
      initialCloudLookup: { byId: {}, sets: {} },
      paidProbesPromise: Promise.resolve([]),
      rejectedPaidModelsPromise: Promise.resolve([]),
      rejectedPaidModelDetailsPromise: Promise.resolve(new Map()),
      ensureProbesAwaited: async () => {},
    };
  }

  const initialCache = loadProviderModels();
  const initialAliases = buildProviderAliases(config);
  const initialCloudLookup = buildRichModelLookup(initialCache);
  const sortedPaid = sortPanelModelRefs(
    probeModelRefsFromLookup(initialCloudLookup),
    config,
  );

  let paidProbesEnabled = false;
  let paidProbesPromise;
  let rejectedPaidModelsPromise = Promise.resolve([]);
  let rejectedPaidModelDetailsPromise = Promise.resolve(new Map());
  let paidProbeProgress = null;
  if (shouldProbeProviderAvailability(ctx)) {
    paidProbesEnabled = true;
    const rejectedRefs = new Set();
    const rejectedDetails = new Map();
    const probeCandidates = providerProbeCandidates(sortedPaid);
    const byProvider = {};
    for (const ref of probeCandidates) {
      const provider = ref.split("/")[0];
      if (!byProvider[provider]) byProvider[provider] = [];
      byProvider[provider].push(ref);
    }
    const providers = Object.keys(byProvider);
    if (providers.length > 0) {
      paidProbeProgress = createProgress("Verifying paid models availability", {
        total: providers.length,
      });
    }
    const activeProbes = new Map();
    const updateProgressMessage = () => {
      if (!process.stdout.isTTY) return;
      if (activeProbes.size === 0) {
        paidProbeProgress?.update("");
        return;
      }
      const activeSnapshot = [...activeProbes.entries()];
      const activeList = activeSnapshot
        .map(([prov, info]) => {
          const modelName = info.modelRef.split("/")[1];
          return `${prov} (checking ${modelName})`;
        })
        .join(", ");
      paidProbeProgress?.update(`checking ${activeList}`);
    };

    const probePromises = providers.map(async (provider) => {
      try {
        const models = byProvider[provider];
        if (models.length === 0) {
          return { provider, ok: false, reason: "no-models" };
        }
        // Probe the single representative model for this provider
        const modelRef = models[0];
        if (ctx.signal.aborted) {
          return {
            provider,
            ok: false,
            reason: "aborted",
            errorOutput: "Aborted by user",
          };
        }
        activeProbes.set(provider, { modelRef, index: 1, total: 1 });
        updateProgressMessage();

        const result = await probeModel(ctx, modelRef, ctx.signal);
        if (result.ok) {
          activeProbes.delete(provider);
          updateProgressMessage();
          paidProbeProgress?.advance(1, `${provider} checked`);
          return {
            provider,
            ok: true,
            modelRef,
          };
        }
        recordRejectedModel(rejectedRefs, rejectedDetails, modelRef, result);
        if (result.reason === "quota-exceeded") {
          markProviderCreditExhausted(ctx, provider, "quota-exceeded");
        }
        activeProbes.delete(provider);
        updateProgressMessage();
        paidProbeProgress?.advance(1, `${provider} checked`);
        return {
          provider,
          ok: false,
          reason: result.reason || "probe-failed",
          errorOutput: result.errorOutput,
        };
      } finally {
        // Ensure progress bar advances even on unexpected errors
        if (activeProbes.has(provider)) {
          activeProbes.delete(provider);
          updateProgressMessage();
        }
      }
    });
    const probeCompletionPromise = Promise.all(probePromises);
    rejectedPaidModelsPromise = probeCompletionPromise.then(() => [...rejectedRefs]);
    rejectedPaidModelDetailsPromise = probeCompletionPromise.then(() =>
      new Map(rejectedDetails),
    );
    paidProbesPromise = probeCompletionPromise.then(() =>
      sortedPaid.filter((modelRef) => {
        const provider = modelRef.split("/")[0];
        return (
          isProviderAvailable(ctx, provider) &&
          !rejectedRefs.has(modelRef) &&
          hasEnoughContextForPanel(modelRef, initialCloudLookup)
        );
      }),
    );
  } else {
    paidProbesPromise = Promise.resolve(
      filterUsablePanelModels(sortedPaid, initialCloudLookup),
    );
  }

  const ensureProbesAwaited = createProbeAwaiter({
    paidProbeProgress,
    paidProbesEnabled,
    paidProbesPromise,
  });

  return {
    initialCache,
    initialAliases,
    initialCloudLookup,
    paidProbesPromise,
    rejectedPaidModelsPromise,
    rejectedPaidModelDetailsPromise,
    ensureProbesAwaited,
  };
}
