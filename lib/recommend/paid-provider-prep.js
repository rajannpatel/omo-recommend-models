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
      ensureProbesAwaited: async () => {},
    };
  }

  const initialCache = loadProviderModels();
  const initialAliases = buildProviderAliases(config);
  const initialCloudLookup = buildRichModelLookup(initialCache);
  const sortedPaid = sortPanelModelRefs(
    paidModelRefsFromLookup(initialCloudLookup),
    config,
  );

  let paidProbesEnabled = false;
  let paidProbesPromise;
  if (shouldProbeProviderAvailability(ctx)) {
    paidProbesEnabled = true;
    const probePromises = providerProbeCandidates(sortedPaid).map(async (modelRef) => {
      if (ctx.signal.aborted) {
        return {
          modelRef,
          ok: false,
          reason: "aborted",
          errorOutput: "Aborted by user",
        };
      }
      const result = await probeModel(ctx, modelRef, ctx.signal);
      return {
        modelRef,
        ok: result.ok,
        reason: result.reason,
        errorOutput: result.errorOutput,
      };
    });
    paidProbesPromise = Promise.all(probePromises).then(() =>
      sortedPaid.filter((modelRef) => {
        const provider = modelRef.split("/")[0];
        return (
          isProviderAvailable(ctx, provider) &&
          hasEnoughContextForPanel(modelRef, initialCloudLookup)
        );
      }),
    );
  } else {
    paidProbesPromise = Promise.resolve(
      filterUsablePanelModels(sortedPaid, initialCloudLookup),
    );
  }

  let probesAwaited = false;
  async function ensureProbesAwaited() {
    if (probesAwaited) return;
    probesAwaited = true;
    if (paidProbesEnabled) {
      const progress = createProgress("Verifying paid models availability");
      await paidProbesPromise;
      progress.done();
      return;
    }
    await paidProbesPromise;
  }

  return {
    initialCache,
    initialAliases,
    initialCloudLookup,
    paidProbesPromise,
    ensureProbesAwaited,
  };
}
