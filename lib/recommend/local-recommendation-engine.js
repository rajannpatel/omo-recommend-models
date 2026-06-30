const DEFAULT_MIN_CONTEXT = 32000;
const LOCAL_PROVIDER = "local";
const ROLE_MATCH_BONUS = 50;

const REASONING_ENTRIES = new Set([
  "sisyphus",
  "oracle",
  "ultrabrain",
  "unspecified-high",
]);
const CODING_ENTRIES = new Set([
  "hephaestus",
  "prometheus",
  "visual-engineering",
]);
const VISION_ENTRIES = new Set(["multimodal-looker"]);
const FAST_ENTRIES = new Set(["explore", "scout", "quick"]);

function normalizedText(value) {
  return String(value || "").trim().toLowerCase();
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const numberValue = Number(value);
  return Number.isFinite(numberValue) ? numberValue : null;
}

function contextLengthFromMetadata(metadata) {
  const rawContext =
    metadata?.context_length ??
    metadata?.context_window ??
    metadata?.context ??
    metadata?.max_context_tokens ??
    metadata?.max_input_tokens ??
    null;
  return finiteNumber(rawContext);
}

function metadataForRef(metadataByRef, ref) {
  if (!metadataByRef) return null;
  if (metadataByRef instanceof Map) {
    return metadataByRef.get(ref) || metadataByRef.get(normalizedText(ref)) || null;
  }
  return metadataByRef[ref] || metadataByRef[normalizedText(ref)] || null;
}

function candidateSpecialty(candidate) {
  return candidate?.specialty || classifyCandidateSpecialty(candidate);
}

function localModelName(candidate) {
  const rawRef = String(candidate?.ref || "").trim();
  if (rawRef.startsWith(`${LOCAL_PROVIDER}/`)) {
    return rawRef.slice(`${LOCAL_PROVIDER}/`.length);
  }
  const rawName = String(candidate?.name || "").trim();
  return rawName.startsWith(`${LOCAL_PROVIDER}/`)
    ? rawName.slice(`${LOCAL_PROVIDER}/`.length)
    : rawName;
}

function supportsRequirement(candidate, requirement) {
  const parametersB = finiteNumber(candidate?.parametersB);
  const contextLength = finiteNumber(candidate?.contextLength);
  const minContext = finiteNumber(requirement?.minContext) ?? DEFAULT_MIN_CONTEXT;
  const specialty = candidateSpecialty(candidate);
  const requiredSpecialty = requirement?.specialty || "general";
  const compatibleSpecialty =
    specialty !== "embedding" &&
    (specialty === requiredSpecialty || specialty === "general" || requiredSpecialty === "general");

  return Boolean(
    parametersB !== null &&
    contextLength !== null &&
    contextLength >= minContext &&
    compatibleSpecialty,
  );
}

export function specialtyForEntry(entryName, entryType) {
  void entryType;
  const name = normalizedText(entryName);
  if (REASONING_ENTRIES.has(name)) return "reasoning";
  if (CODING_ENTRIES.has(name)) return "coding";
  if (VISION_ENTRIES.has(name)) return "vision";
  if (FAST_ENTRIES.has(name)) return "fast";
  return "general";
}

export function inferEntryRequirement({
  entryName,
  entryType,
  chainRefs = [],
  metadataByRef = null,
}) {
  const refs = Array.isArray(chainRefs) ? [...chainRefs] : [];
  const contextLengths = refs
    .map((ref) => contextLengthFromMetadata(metadataForRef(metadataByRef, ref)))
    .filter((contextLength) => contextLength !== null);
  const minContext =
    contextLengths.length > 0 ? Math.max(...contextLengths) : DEFAULT_MIN_CONTEXT;

  return {
    entryName,
    entryType,
    specialty: specialtyForEntry(entryName, entryType),
    minContext,
    chainRefs: refs,
  };
}

export function parseParameterCountB(name) {
  const text = normalizedText(name);
  const mixtureMatch = text.match(/(\d+(?:\.\d+)?)x(\d+(?:\.\d+)?)b\b/);
  if (mixtureMatch) {
    return Number.parseFloat(mixtureMatch[1]) * Number.parseFloat(mixtureMatch[2]);
  }
  const parameterMatch = text.match(/(\d+(?:\.\d+)?)b\b/);
  return parameterMatch ? Number.parseFloat(parameterMatch[1]) : null;
}

export function estimateKvCacheGb({
  minContext,
  parametersB,
  gqaFactor = 1,
  quantizationFactor = 1,
}) {
  const context = finiteNumber(minContext);
  const parameters = finiteNumber(parametersB);
  const gqa = finiteNumber(gqaFactor) ?? 1;
  const quantization = finiteNumber(quantizationFactor) ?? 1;
  if (context === null || parameters === null) return null;
  return 0.08 * (context / 1000) * (parameters / 8) * gqa * quantization;
}

export function localVramBudgetGb(gpu) {
  const vramGb = finiteNumber(gpu?.vramGb);
  return vramGb === null ? 0 : Math.max(0, vramGb * 0.9);
}

export function fitsGpu(candidate, gpu) {
  const weightGb = finiteNumber(candidate?.weightGb);
  const kvCacheGb = finiteNumber(candidate?.kvCacheGb);
  if (weightGb === null || kvCacheGb === null) return false;
  return weightGb + kvCacheGb < localVramBudgetGb(gpu);
}

export function classifyCandidateSpecialty(candidate) {
  const name = normalizedText(
    `${candidate?.name || ""} ${candidate?.normalizedName || ""} ${candidate?.baseModel || ""}`,
  );
  const capabilities = (candidate?.capabilities || []).map(normalizedText);
  const hasCapability = (value) => capabilities.some((capability) => capability.includes(value));

  if (hasCapability("vision") || /\b(llava|bakllava|vision)\b/.test(name)) return "vision";
  if (hasCapability("reasoning") || /\b(deepseek-r1|qwq|reasoning)\b/.test(name)) return "reasoning";
  if (hasCapability("embedding") || /\b(embed|embedding)\b/.test(name)) return "embedding";
  if (hasCapability("code") || hasCapability("tool") || /\b(coder|code|codellama|starcoder)\b/.test(name)) return "coding";
  return "general";
}

export function scoreLocalCandidate(candidate, requirement) {
  const parametersB = finiteNumber(candidate?.parametersB) ?? 0;
  const popularity = finiteNumber(candidate?.openRouterPopularityIndex) ?? 0;
  const roleMatch = candidateSpecialty(candidate) === requirement?.specialty ? ROLE_MATCH_BONUS : 0;
  return parametersB * 10 + popularity + roleMatch;
}

export function rankLocalCandidates({ candidates = [], requirement, gpu }) {
  const ranked = (Array.isArray(candidates) ? candidates : [])
    .filter((candidate) => supportsRequirement(candidate, requirement))
    .filter((candidate) => fitsGpu(candidate, gpu))
    .map((candidate) => ({
      ...candidate,
      fits: true,
      score: scoreLocalCandidate(candidate, requirement),
    }));

  ranked.sort((left, right) => {
    const scoreDiff = right.score - left.score;
    if (scoreDiff !== 0) return scoreDiff;
    const installedDiff = Number(Boolean(right.installed)) - Number(Boolean(left.installed));
    if (installedDiff !== 0) return installedDiff;
    return String(left.name || "").localeCompare(String(right.name || ""));
  });
  return ranked;
}

export function chooseLocalFallbackForEntry({
  recommendation,
  requirement,
  candidates = [],
  gpu,
}) {
  void recommendation;
  const [bestCandidate] = rankLocalCandidates({ candidates, requirement, gpu });
  if (!bestCandidate) return null;
  return {
    provider: LOCAL_PROVIDER,
    model: localModelName(bestCandidate),
    reason: `Best fitting local ${requirement.specialty} fallback for ${requirement.entryName}`,
  };
}

export function buildHardwareDeficitWarning({
  requirement,
  candidates = [],
  gpu,
  cloudOnly = false,
}) {
  if (cloudOnly) return null;
  const sameSpecialty = (Array.isArray(candidates) ? candidates : []).filter(
    (candidate) => candidateSpecialty(candidate) === requirement?.specialty,
  );
  if (sameSpecialty.length === 0) return null;
  if (rankLocalCandidates({ candidates: sameSpecialty, requirement, gpu }).length > 0) return null;

  const budgetGb = Math.round(localVramBudgetGb(gpu) * 10) / 10;
  const gpuName = gpu?.name || "detected GPU";
  return `No fitting local ${requirement.specialty} model for ${requirement.entryName} on ${gpuName} within ${budgetGb}GB budget; lower target context, install a smaller model, use --cloud-only, or upgrade VRAM.`;
}
