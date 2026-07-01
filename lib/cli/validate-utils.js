export function isPlainObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

export function addError(errors, location, message) {
  errors.push(`${location}: ${message}`);
}

export function refFromParts(provider, model) {
  return `${provider}/${model}`;
}

export function splitModelRef(ref) {
  if (typeof ref !== "string") return null;
  const slash = ref.indexOf("/");
  if (slash <= 0 || slash === ref.length - 1) return null;
  const provider = ref.slice(0, slash).trim();
  const model = ref.slice(slash + 1).trim();
  if (!provider || !model || /\s/.test(provider)) return null;
  return { provider, model };
}

export function canonicalizeModelRef(ref) {
  const parts = splitModelRef(ref);
  if (!parts) return ref;
  return parts.provider === "ollama" ? refFromParts("local", parts.model) : ref;
}
