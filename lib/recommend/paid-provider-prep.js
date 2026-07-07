import {
  buildProviderAliases,
  buildRichModelLookup,
  loadProviderModels,
} from "../omo-shared.js";
import { sortPanelModelRefs } from "../scoring.js";
import { shouldProbeProviderAvailability } from "../probe-providers.js";
import {
  paidModelRefsFromLookup,
  probeModelRefsFromLookup,
  providerProbeCandidates,
} from "./providers/ref-extraction.js";
import { runProviderProbes } from "./providers/probe-orchestration.js";

export async function preparePaidProviderModels({
  config,
  ctx,
  localOnlyFlag,
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

  const initialCache = await loadProviderModels();
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
  let ensureProbesAwaited = async () => {};
  if (shouldProbeProviderAvailability(ctx)) {
    paidProbesEnabled = true;
    const probeCandidates = providerProbeCandidates(sortedPaid);
    const probeResults = await runProviderProbes({
      ctx,
      sortedPaid,
      probeCandidates,
    });
    paidProbesPromise = probeResults.paidProbesPromise;
    rejectedPaidModelsPromise = probeResults.rejectedPaidModelsPromise;
    rejectedPaidModelDetailsPromise = probeResults.rejectedPaidModelDetailsPromise;
    ensureProbesAwaited = probeResults.ensureProbesAwaited;
  } else {
    paidProbesPromise = Promise.resolve(sortedPaid);
  }

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
