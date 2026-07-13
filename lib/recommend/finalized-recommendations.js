import { LOCAL_PROVIDER } from "../constants.js";
import { normalizeLocalModelName } from "../omo-shared.js";

export function recommendationRefString(ref) {
  return `${ref.provider}/${ref.model}`;
}

export function recommendationFallbackValue(ref) {
  const hasSettings =
    ref.variant ||
    ref.reasoningEffort ||
    ref.temperature !== undefined ||
    ref.top_p !== undefined ||
    ref.maxTokens !== undefined ||
    ref.thinking;
  if (!hasSettings) return recommendationRefString(ref);
  return {
    model: recommendationRefString(ref),
    ...(ref.variant ? { variant: ref.variant } : {}),
    ...(ref.reasoningEffort ? { reasoningEffort: ref.reasoningEffort } : {}),
    ...(ref.temperature !== undefined ? { temperature: ref.temperature } : {}),
    ...(ref.top_p !== undefined ? { top_p: ref.top_p } : {}),
    ...(ref.maxTokens !== undefined ? { maxTokens: ref.maxTokens } : {}),
    ...(ref.thinking ? { thinking: ref.thinking } : {}),
  };
}

function isLocalRef(ref) {
  return ref.provider === LOCAL_PROVIDER || ref.provider === "ollama";
}

function isConfirmedRef(ref, confirmedModels) {
  return !isLocalRef(ref) ||
    (confirmedModels && confirmedModels.has(normalizeLocalModelName(ref.model)));
}

function isApplicableRef({ confirmedModels, excludeFreeFromConfig, isFreeRef, isProviderAllowed, ref }) {
  return Boolean(
    ref?.provider &&
    ref?.model &&
    isProviderAllowed(ref.provider) &&
    isConfirmedRef(ref, confirmedModels) &&
    (!excludeFreeFromConfig || !isFreeRef(ref)),
  );
}

export function applicableCloudAssignment({
  confirmedModels,
  excludeFreeFromConfig,
  isFreeRef = () => false,
  isProviderAllowed = () => true,
  rec,
  section,
}) {
  const model = isApplicableRef({
    confirmedModels,
    excludeFreeFromConfig,
    isFreeRef,
    isProviderAllowed,
    ref: rec.model,
  })
    ? rec.model
    : null;
  const fallbackModels = (rec.fallback_models || []).filter((ref) =>
    isApplicableRef({
      confirmedModels,
      excludeFreeFromConfig,
      isFreeRef,
      isProviderAllowed,
      ref,
    }),
  );
  const hasChanges = Boolean(model || fallbackModels.length > 0);
  if (!hasChanges && !section?.model) return null;
  return {
    hasChanges,
    model,
    modelString: model ? recommendationRefString(model) : (section?.model || null),
    fallbackModels,
    fallbackValues: fallbackModels.map(recommendationFallbackValue),
    fallbackStrings: fallbackModels.map(recommendationRefString),
  };
}
