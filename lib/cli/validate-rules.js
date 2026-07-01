import { resolveProvider } from "../omo-shared.js";
import {
  FALLBACK_OPTION_KEYS,
  REASONING_EFFORTS,
} from "./validate-constants.js";
import {
  addError,
  isPlainObject,
  splitModelRef,
} from "./validate-utils.js";

export function validateModelRef(value, location, facts, errors) {
  if (typeof value !== "string") {
    addError(errors, location, "must be a provider/model string");
    return;
  }

  const ref = splitModelRef(value);
  if (!ref) {
    addError(errors, location, "must use provider/model syntax");
    return;
  }
  if (ref.provider === "ollama") {
    addError(errors, location, "use local/<model> for local model references");
    return;
  }
  if (ref.provider === "local") {
    if (facts.local.available && !facts.local.names.has(ref.model)) {
      addError(errors, location, `unknown local model ${ref.model}`);
    }
    return;
  }
  validateCloudModelRef(ref, location, facts, errors);
}

function validateCloudModelRef(ref, location, facts, errors) {
  if (!facts.hasProviderCache) return;
  const provider = resolveProvider(ref.provider, facts.aliases);
  const providerSet = facts.modelLookup.sets[provider] || facts.modelLookup.sets[ref.provider];
  if (!providerSet) {
    addError(errors, location, `unknown provider ${ref.provider}`);
    return;
  }
  if (
    !providerSet.has(ref.model) &&
    !providerSet.has(`${ref.provider}/${ref.model}`) &&
    !providerSet.has(`${provider}/${ref.model}`)
  ) {
    addError(errors, location, `unknown model ${ref.provider}/${ref.model}`);
  }
}

function validateNumberRange(value, location, min, max, errors) {
  if (typeof value !== "number" || !Number.isFinite(value)) {
    addError(errors, location, "must be a finite number");
    return;
  }
  if (value < min || value > max) {
    addError(errors, location, `must be between ${min} and ${max}`);
  }
}

function validateThinking(value, location, errors) {
  if (!isPlainObject(value)) {
    addError(errors, location, "must be an object");
    return;
  }
  for (const key of Object.keys(value)) {
    if (key !== "type" && key !== "budgetTokens") {
      addError(errors, `${location}.${key}`, "unknown thinking option");
    }
  }
  if (value.type !== "enabled" && value.type !== "disabled") {
    addError(errors, `${location}.type`, "must be enabled or disabled");
  }
  if ("budgetTokens" in value && !Number.isFinite(value.budgetTokens)) {
    addError(errors, `${location}.budgetTokens`, "must be a finite number");
  }
}

function validatePlacementObject(value, location, facts, errors) {
  if (!isPlainObject(value)) {
    addError(errors, location, "must be a model reference string or object");
    return;
  }
  for (const key of Object.keys(value)) {
    if (!FALLBACK_OPTION_KEYS.has(key)) {
      addError(errors, `${location}.${key}`, "unknown model placement option");
    }
  }
  if (!("model" in value)) {
    addError(errors, `${location}.model`, "is required");
  } else {
    validateModelRef(value.model, `${location}.model`, facts, errors);
  }
  if ("variant" in value && typeof value.variant !== "string") {
    addError(errors, `${location}.variant`, "must be a string");
  }
  if ("reasoningEffort" in value && !REASONING_EFFORTS.has(value.reasoningEffort)) {
    addError(errors, `${location}.reasoningEffort`, "must be a known reasoning effort");
  }
  if ("temperature" in value) validateNumberRange(value.temperature, `${location}.temperature`, 0, 2, errors);
  if ("top_p" in value) validateNumberRange(value.top_p, `${location}.top_p`, 0, 1, errors);
  if ("maxTokens" in value && !Number.isFinite(value.maxTokens)) {
    addError(errors, `${location}.maxTokens`, "must be a finite number");
  }
  if ("thinking" in value) validateThinking(value.thinking, `${location}.thinking`, errors);
}

function validateFallbacks(value, location, facts, errors) {
  if (typeof value === "string") {
    validateModelRef(value, location, facts, errors);
    return;
  }
  if (!Array.isArray(value)) {
    addError(errors, location, "must be an array");
    return;
  }
  value.forEach((item, index) => {
    const itemPath = `${location}.${index}`;
    if (typeof item === "string") validateModelRef(item, itemPath, facts, errors);
    else validatePlacementObject(item, itemPath, facts, errors);
  });
}

export function validateSection(section, location, facts, errors) {
  if (!isPlainObject(section)) {
    addError(errors, location, "must be an object");
    return;
  }
  if ("model" in section) validateModelRef(section.model, `${location}.model`, facts, errors);
  if ("variant" in section && typeof section.variant !== "string") {
    addError(errors, `${location}.variant`, "must be a string");
  }
  if ("variant" in section && !("model" in section)) {
    addError(errors, `${location}.variant`, "requires model");
  }
  if ("fallback_models" in section) {
    validateFallbacks(section.fallback_models, `${location}.fallback_models`, facts, errors);
  }
}
