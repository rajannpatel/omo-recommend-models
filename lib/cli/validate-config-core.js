import { buildFacts } from "./validate-facts.js";
import { validateSection } from "./validate-rules.js";
import { addError, isPlainObject } from "./validate-utils.js";

export async function validateConfig(config) {
  const errors = [];
  if (!isPlainObject(config)) {
    addError(errors, "$", "top-level config must be an object");
    return errors;
  }

  const facts = buildFacts(config);
  validateTopLevelConfig(config, facts, errors);
  return errors;
}

function validateTopLevelConfig(config, facts, errors) {
  if (typeof config.$schema !== "string" || config.$schema.trim() === "") {
    addError(errors, "$schema", "must be a non-empty string");
  }
  validateSectionGroup(config.agents, "agents", facts, errors);
  validateSectionGroup(config.categories, "categories", facts, errors);
}

function validateSectionGroup(sectionGroup, name, facts, errors) {
  if (sectionGroup === undefined) return;
  if (!isPlainObject(sectionGroup)) {
    addError(errors, name, "must be an object");
    return;
  }
  for (const [sectionName, section] of Object.entries(sectionGroup)) {
    validateSection(section, `${name}.${sectionName}`, facts, errors);
  }
}
