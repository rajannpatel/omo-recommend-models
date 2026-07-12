import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
} from "../model-requirements.js";

const FALLBACK_DESCRIPTIONS = {
  scout: "Quick information gathering agent. Needs speed and accurate extraction.",
  sysadmin: "System administration and shell execution. Needs practical knowledge of OS operations.",
};

export function upstreamContext({ name, type, allModels: _allModels }) {
  const pool = type === "category" ? CATEGORY_MODEL_REQUIREMENTS : AGENT_MODEL_REQUIREMENTS;
  const entry = pool[name];
  if (!entry || !Array.isArray(entry.fallbackChain) || entry.fallbackChain.length === 0) {
    return FALLBACK_DESCRIPTIONS[name] || "";
  }

  const ordinal = (i) => {
    const n = i + 1;
    if (n === 1) return "1st";
    if (n === 2) return "2nd";
    if (n === 3) return "3rd";
    return `${n}th`;
  };

  const lines = entry.fallbackChain.map((link, i) => {
    let tier = `${ordinal(i)} choice: ${link.model}`;
    if (link.variant) tier += ` (variant: ${link.variant})`;
    tier += ` from ${link.providers.join(", ")}`;
    return tier;
  });

  if (entry.requiresProvider) {
    lines.push(`requires: model from ${entry.requiresProvider.join(", ")}`);
  }
  if (entry.requiresAnyModel) {
    lines.push("requires: any model from chain");
  }

  return lines.join("\n");
}

function formatModelMeta(ref, modelMetadata) {
  const meta = modelMetadata?.[ref];
  if (!meta) return "";
  const parts = [];
  if (meta.family) parts.push(`family=${meta.family}`);
  if (meta.reasoning) parts.push("reasoning");
  if (meta.context_length) parts.push(`context=${Math.round(meta.context_length / 1000)}K`);
  if (meta.pricing?.input != null || meta.pricing?.output != null) {
    const inp = meta.pricing.input != null ? `in=$${meta.pricing.input}` : "";
    const outp = meta.pricing.output != null ? `out=$${meta.pricing.output}` : "";
    const unit = meta.pricing.unit || "1M";
    parts.push(`cost:${inp}/${outp}/${unit}`);
  }
  if (meta.modalities?.length) {
    parts.push(`modality=${[...new Set(meta.modalities)].join("/")}`);
  }
  return parts.length > 0 ? ` [${parts.join(", ")}]` : "";
}

export function buildRankingPrompt(entries) {
  const sections = entries
    .map(
      ({ name, type, allModels, profile, modelMetadata }) => {
        const ctx = upstreamContext({ name, type, allModels });
        const roleLines = [];
        if (profile) roleLines.push(`Description: ${profile}`);
        if (ctx) {
          roleLines.push(`Upstream requirements:\n${ctx}`);
        } else {
          roleLines.push(`Role: ${name} (${type || "agent"}) — no upstream requirements defined`);
        }
        const modelLines = allModels.map((f) => {
          const ref = `${f.provider}/${f.model}`;
          return `${ref}${formatModelMeta(ref, modelMetadata)}`;
        }).join(", ");
        return `## ${name} (${type || "agent"})
${roleLines.join("\n")}
Available models: ${modelLines}`;
      },
    )
    .join("\n\n");

  return `You are ranking AI model fitness for agents and categories defined in the oh-my-openagent plugin for OpenCode. These are not OpenCode's built-in agents — they are plugin-level roles with their own model requirements.

For each agent/category, rank ALL available models from MOST suitable (1) to LEAST suitable (N) for that specific role. The #1 model will serve as the primary model; the rest as fallbacks. Consider:
- Model family, reasoning tier, context window, and modality support
- Specific model strengths matching the role requirements
- Provider pricing (where shown) as a factor for cost-effective assignments

${sections}

Output ONLY a valid JSON object where keys are agent/category names and values are arrays of ALL model ref strings in rank order (most suitable first):
{"agent-name": ["provider1/model1", "provider2/model2", ...]}

No explanation, no markdown. Just the JSON object.`;
}
