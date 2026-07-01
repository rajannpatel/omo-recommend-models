import { splitModelRef } from "../../omo-shared.js";
import { MAX_PANEL_MODELS } from "../../constants.js";
import {
  hasPanelCandidateShapeAndContext,
  selectDiversePanelModels,
  uniqueModelRefs,
} from "../panel-candidates.js";

export function includeDetectedCliPanelModels(models, config, options = {}, discoverCliModelsFn) {
  const selected = uniqueModelRefs(models);
  if (!selected.some((ref) => splitModelRef(ref).provider === "cli")) {
    return selected;
  }
  const detectedRefs = discoverCliModelsFn(config, options).map((agent) => agent.ref);
  return uniqueModelRefs([...selected, ...detectedRefs]);
}

export function preferDetectedCliPanelModels(
  models,
  config,
  cloudLookup,
  max = MAX_PANEL_MODELS,
  options = {},
  discoverCliModelsFn,
  ctx,
) {
  const cliRefs = discoverCliModelsFn(config, options)
    .map((agent) => agent.ref)
    .filter((ref) => hasPanelCandidateShapeAndContext(ref, cloudLookup));
  const nonCliRefs = uniqueModelRefs(models).filter(
    (ref) => splitModelRef(ref).provider !== "cli",
  );
  const remaining = Math.max(0, max - cliRefs.length);
  const selectedNonCli = remaining > 0
    ? selectDiversePanelModels(nonCliRefs, config, cloudLookup, remaining, ctx)
    : [];
  return uniqueModelRefs([...cliRefs, ...selectedNonCli]).slice(0, max);
}

export function selectPreferredPanelModels(
  models,
  config,
  cloudLookup,
  max = MAX_PANEL_MODELS,
  options = {},
  discoverCliModelsFn,
  ctx,
) {
  return preferDetectedCliPanelModels(
    models,
    config,
    cloudLookup,
    max,
    options,
    discoverCliModelsFn,
    ctx,
  );
}
