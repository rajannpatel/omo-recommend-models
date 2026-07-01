import {
  buildFittingModels,
  usableLocalVramGb,
} from "../../display-utils.js";
import { installedLocalNameSet } from "../../apply-local.js";
import { isProviderAvailable } from "../../probe-providers.js";
import {
  detectFamilyFromMeta,
  scoreModel,
} from "../../scoring.js";
import {
  hasEnoughContextForPanel,
} from "../panel-candidates.js";
import {
  localVramBudgetGb,
} from "../local-recommendation-engine.js";

function isModelFree(ref, meta) {
  const lowerRef = ref.toLowerCase();
  if (
    lowerRef.includes("-free") ||
    lowerRef.endsWith(":free") ||
    lowerRef.includes("/free-") ||
    lowerRef.includes("-free-") ||
    lowerRef.endsWith("/free")
  ) {
    return true;
  }
  const cost = meta?.cost !== undefined
    ? meta.cost
    : meta?.input_price !== undefined
      ? meta.input_price
      : null;
  return cost !== null && cost !== undefined && cost !== "" && Number(cost) === 0;
}

function detectFamilyFromCandidate(candidate, cloudLookup) {
  const meta = cloudLookup.byId?.[candidate.provider]?.get(candidate.modelId);
  const detected = detectFamilyFromMeta(meta, candidate.modelId);
  if (detected.family && detected.family !== "unknown") return detected.family;
  const lower = candidate.ref.toLowerCase();
  if (lower.includes("opus") || lower.includes("pro-max") || lower.includes("ultra")) return "flagship";
  if (lower.includes("sonnet") || lower.includes("pro") || lower.includes("plus")) return "advanced";
  if (lower.includes("haiku") || lower.includes("mini") || lower.includes("nano") || lower.includes("lite") || lower.includes("small")) return "compact";
  if (lower.includes("flash") || lower.includes("speed") || lower.includes("fast")) return "speed";
  if (lower.includes("reasoning") || lower.includes("think") || lower.includes("r1")) return "reasoning";
  if (lower.includes("codex") || lower.includes("coder") || lower.includes("code")) return "code";
  if (lower.includes("vision") || lower.includes("vl") || lower.includes("multimodal")) return "vision";
  if (lower.includes("embedding") || lower.includes("embed")) return "embedding";
  const sizeMatch = lower.match(/(\d+)b/);
  if (!sizeMatch) return "unknown";
  const size = Number.parseInt(sizeMatch[1], 10);
  if (size >= 70) return "xxlarge";
  if (size >= 30) return "xlarge";
  if (size >= 13) return "large";
  if (size >= 7) return "medium";
  return "small";
}

function candidateCloudModels(cloudLookup, ctx) {
  const candidateModels = [];
  const availableProviders = Object.keys(cloudLookup.byId || {}).filter(
    (provider) => provider !== "local" && isProviderAvailable(ctx, provider),
  );
  for (const provider of availableProviders) {
    const scored = [];
    for (const [id, meta] of (cloudLookup.byId[provider] || new Map()).entries()) {
      const ref = `${provider}/${id}`;
      if (!hasEnoughContextForPanel(ref, cloudLookup)) continue;
      scored.push({
        ref,
        provider,
        modelId: id,
        score: Math.round(scoreModel(ref, null, meta)),
        free: isModelFree(ref, meta),
      });
    }
    scored.sort((a, b) => b.score - a.score);
    const top10 = scored.slice(0, 10);
    const top10Refs = new Set(top10.map((model) => model.ref));
    candidateModels.push(
      ...top10,
      ...scored.filter((model) => model.free && !top10Refs.has(model.ref)),
    );
  }
  return candidateModels.sort((a, b) => b.score - a.score);
}

function diverseCloudTable(cloudLookup, ctx) {
  const seenModelIds = new Set();
  const counts = {};
  const deduped = [];
  for (const candidate of candidateCloudModels(cloudLookup, ctx)) {
    const family = detectFamilyFromCandidate(candidate, cloudLookup);
    if (!family || family === "unknown") continue;
    const normModelId = candidate.modelId.toLowerCase();
    if (seenModelIds.has(normModelId)) continue;
    const count = counts[family] || 0;
    if (count < 1) {
      counts[family] = count + 1;
      seenModelIds.add(normModelId);
      deduped.push(candidate);
    }
  }
  return {
    count: deduped.length,
    table: deduped.map((model) => `${model.ref} ${model.score}`).join("\n"),
  };
}

function localModelsForPrompt(entry, allLocalModels, gpu, ollama, localRecommendationContext) {
  const installedNames = installedLocalNameSet(ollama);
  const hasContextRanking = localRecommendationContext?.rankedCandidatesByEntry instanceof Map &&
    localRecommendationContext.rankedCandidatesByEntry.has(entry.name);
  const fitting = hasContextRanking
    ? localRecommendationContext.rankedCandidatesByEntry.get(entry.name) || []
    : buildFittingModels(allLocalModels, gpu);
  return fitting.map((model) => {
    const totalVramGb = model.totalVramGb ?? model.vram;
    const weightGb = model.weightGb ?? "?";
    const kvCacheGb = model.kvCacheGb ?? "?";
    const installed = typeof model.installed === "boolean"
      ? model.installed
      : installedNames.has(model.name);
    return `${model.name}  total=${totalVramGb ?? "?"}GB weight=${weightGb}GB kv=${kvCacheGb}GB score=${model.score ?? 0} ${installed ? "inst" : "missing"}`;
  });
}

export function buildAgentPrompt(entry, cloudLookup, allLocalModels, gpu, ollama, ctx) {
  const localRecommendationContext = ctx?.localRecommendationContext || null;
  const vramAvail = localRecommendationContext
    ? localVramBudgetGb(gpu)
    : usableLocalVramGb(gpu);
  const quality = entry.section.model_quality || "balanced";
  const desc = entry.section.description || "";
  const currentModel = entry.section.model || "";
  const cloud = diverseCloudTable(cloudLookup, ctx);
  const localModels = localModelsForPrompt(
    entry,
    allLocalModels,
    gpu,
    ollama,
    localRecommendationContext,
  );
  const localWarning = localRecommendationContext?.warnings?.byEntry instanceof Map
    ? localRecommendationContext.warnings.byEntry.get(entry.name)
    : null;

  return [
    "OUTPUT: valid JSON only. No markdown.",
    "",
    "SCHEMA:",
    "{",
    '  "name": str,',
    '  "type": "agent|category",',
    '  "profile": str,',
    '  "model": {"provider": str, "model": str, "reason": str},',
    '  "routing": [{"provider": str, "model": str, "reason": str}],',
    '  "fallback_models": [{"provider": str, "model": str, "reason": str}]',
    "}",
    "",
    `AGENT: ${entry.name} | ${entry.type} | ${quality} | cur=${currentModel || "-"} | ${desc}`,
    "",
    `HW: GPU=${gpu.label} VRAM=${gpu.vramGb}GB usable=${Math.round(vramAvail * 10) / 10}GB`,
    "",
    `CLOUD (${cloud.count}):`,
    cloud.table || "-",
    "",
    `LOCAL (${localModels.length} fit VRAM):`,
    localModels.join("\n") || "-",
    localWarning ? `LOCAL_WARNING: ${localWarning}` : "",
    "",
    "FIELDS:  model=primary  routing=delegation_pool  fallback_models=retry_pool",
    "RULES:",
    "- Sort routing and fallback_models by score descending.",
    "- Paid/cloud as primary for reasoning/code agents.",
    "- Free model as fallback unless utility agent (explore/librarian/quick).",
    "- Prefer highest-scored cloud model for primary unless GPU requirements force local.",
    "- For utility agents (explore/librarian/quick), use highest-scored FREE cloud as primary.",
    "- For other agents, prioritize highest-scored paid/cloud model.",
    "- Place minimum 1 routing entry with highest-scored cloud model when available.",
    "- Fill routing pool with next highest-scored cloud models (paid > free).",
    "- The fallback_models pool must have 3 agents set, ordered by capability:",
    "  * Slot 1 most closely matches the `model` key, in intelligence and token window.",
    "  * Slot 2 is a highly available, fast mid-tier model.",
    "  * Slot 3 is the cheapest, highest-rate-limit model.",
    "- Remove duplicate entries across model, routing, and fallback_models.",
    "",
    "SPECIFIC EXAMPLES (use generic synthetic names - real model names provided in CLOUD section above):",
    "",
    "Case 1 - Reasoning agent (paid/cloud required as primary):",
    "{",
    '  "name": "metis",',
    '  "type": "agent",',
    '  "profile": "Pre-planning consultant for ambiguous requirements",',
    '  "model": {"provider": "provider-a", "model": "flagship-model", "reason": "Paid cloud model as primary for reasoning/code agent per placement rules"},',
    '  "routing": [{"provider": "opencode", "model": "top-free-model-1", "reason": "Highest-scored cloud free model for delegation pool"},',
    '           {"provider": "opencode", "model": "top-free-model-2", "reason": "Second highest-scored cloud free model for delegation pool"}],',
    '  "fallback_models": [',
    '    {"provider": "opencode", "model": "mid-tier-free-model", "reason": "Slot 1: Closely matches primary model in capability/context"},',
    '    {"provider": "opencode", "model": "fast-free-model", "reason": "Slot 2: Highly available, fast mid-tier model"},',
    '    {"provider": "opencode", "model": "cheapest-free-model", "reason": "Slot 3: Cheapest, highest-rate-limit model"}',
    '  ]',
    "}",
    "",
    "Case 2 - Utility agent (free cloud as primary):",
    "{",
    '  "name": "explore",',
    '  "type": "agent",',
    '  "profile": "Fast codebase exploration and pattern matching - very lightweight utility work",',
    '  "model": {"provider": "opencode", "model": "top-free-model", "reason": "Free model suitable for lightweight exploration"},',
    '  "routing": [],',
    '  "fallback_models": []',
    "}",
    "",
    "Case 3 - Category (free cloud as primary):",
    "{",
    '  "name": "visual-engineering",',
    '  "type": "category",',
    '  "profile": "Frontend, UI/UX, design, styling, animation",',
    '  "model": {"provider": "opencode", "model": "balanced-free-model", "reason": "Balanced performance for design and visual tasks"},',
    '  "routing": [],',
    '  "fallback_models": []',
    "}",
    "",
    "VALIDATION RULES:",
    "- All providers in routing and fallback_models must be 'opencode' (free) for free agents",
    "- No local models in routing arrays (only in fallback_models for local fallback)",
    'Check the "FIELDS" section carefully: model=primary, routing=delegation_pool, fallback_models=retry_pool',
  ].join("\n");
}
