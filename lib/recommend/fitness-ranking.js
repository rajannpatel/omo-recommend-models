import { execFileSync } from "node:child_process";

import { discoverFreeModels } from "../shared/provider-cache.js";
import { createProgress } from "../display/progress.js";

function resolveFreeModels() {
  try {
    return discoverFreeModels();
  } catch {
    return [];
  }
}

const FREE_MODELS = resolveFreeModels();
let nextModelIndex = 0;

function getNextModel() {
  if (FREE_MODELS.length === 0) return "opencode/mimo-v2.5-free";
  const model = FREE_MODELS[nextModelIndex % FREE_MODELS.length];
  nextModelIndex++;
  return model;
}

const AGENT_DESCRIPTIONS = {
  sisyphus: "Orchestrator agent coordinating sub-agents. Needs strong reasoning, instruction following, and delegation logic.",
  hephaestus: "Builder agent implementing code changes. Needs precision, code quality understanding, and tool execution reliability.",
  oracle: "High-IQ consultant for architecture and debugging. Needs deep reasoning and multi-system tradeoff analysis.",
  librarian: "Documentation agent reading and summarizing markdown. Needs fast comprehension and accurate extraction.",
  explore: "Codebase explorer for pattern matching and search. Needs efficient context gathering and pattern recognition.",
  prometheus: "Planning agent for work breakdown and strategy. Needs structured thinking and dependency analysis.",
  metis: "Pre-planning consultant for ambiguity resolution. Needs requirements analysis and scope clarification.",
  momus: "Quality assurance agent reviewing plans and implementations. Needs critical thinking and thorough verification.",
  atlas: "Codebase analysis agent for structural understanding. Needs architectural pattern recognition.",
  "sisyphus-junior": "Focused task executor under orchestration. Needs reliable general reasoning and instruction adherence.",
  scout: "Quick information gathering agent. Needs speed and accurate extraction.",
  sysadmin: "System administration and shell execution. Needs practical knowledge of OS operations.",
};

const CATEGORY_DESCRIPTIONS = {
  "visual-engineering": "Frontend UI/UX design, styling, animations, layout. Needs strong visual design reasoning and taste.",
  ultrabrain: "Hard logic, architecture decisions, algorithms. Needs top reasoning capability and analytical rigor.",
  deep: "Autonomous problem-solving and end-to-end implementation. Needs strong general capability and tool proficiency.",
  artistry: "Creative problem-solving approaches. Needs diverse reasoning styles and lateral thinking.",
  quick: "Simple single-file changes and typo fixes. Needs minimal but reliable capability with fast response.",
  "unspecified-low": "Low-effort simple tasks. Needs basic reliable capability.",
  "unspecified-high": "High-effort complex tasks. Needs strong general capability and thoroughness.",
  writing: "Documentation and prose. Needs good language understanding and clear communication.",
};

function descriptionFor(name, type) {
  const pool = type === "category" ? CATEGORY_DESCRIPTIONS : AGENT_DESCRIPTIONS;
  return pool[name] || `${name} ${type || "agent"}`;
}

function buildRankingPrompt(entries) {
  const sections = entries
    .map(
      ({ name, type, allModels }) =>
        `## ${name} (${type || "agent"})
Role: ${descriptionFor(name, type)}
Available models: ${allModels.map((f) => `${f.provider}/${f.model}`).join(", ")}`,
    )
    .join("\n\n");

  return `You are ranking AI model fitness for OpenCode agent roles.

For each agent/category, rank ALL available models from MOST suitable (1) to LEAST suitable (N) for that specific role. The #1 model will serve as the primary model; the rest as fallbacks. Consider:
- Model quality tier (reasoning models > fast models for reasoning-heavy roles)
- Provider reputation and reliability
- Specific model strengths matching the role requirements

${sections}

Output ONLY a valid JSON object where keys are agent/category names and values are arrays of ALL model ref strings in rank order (most suitable first):
{"agent-name": ["provider1/model1", "provider2/model2", ...]}

No explanation, no markdown. Just the JSON object.`;
}

function findOpencode() {
  const candidates = [
    "opencode",
    "/usr/local/bin/opencode",
    process.env.HOME ? `${process.env.HOME}/.local/bin/opencode` : null,
    process.env.HOME ? `${process.env.HOME}/.opencode/opencode` : null,
  ].filter(Boolean);

  for (const bin of candidates) {
    try {
      execFileSync(bin, ["--version"], { encoding: "utf-8", timeout: 5000, stdio: "pipe" });
      return bin;
    } catch {
      continue;
    }
  }
  return null;
}

function callOpencode(prompt, modelRef) {
  const bin = findOpencode();
  if (!bin) throw new Error("opencode binary not found");

  const raw = execFileSync(
    bin,
    ["run", "--format", "json", "--model", modelRef],
    {
      input: prompt,
      encoding: "utf-8",
      timeout: 120_000,
      maxBuffer: 10 * 1024 * 1024,
    },
  );

  for (const line of raw.trim().split("\n")) {
    try {
      const event = JSON.parse(line);
      if (event.type === "text" && event.part?.text) {
        return event.part.text;
      }
    } catch {
      continue;
    }
  }

  throw new Error("No text response from opencode run");
}

function parseRanking(text) {
  const cleaned = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();
  try {
    return JSON.parse(cleaned);
  } catch {
    const match = text.match(/\{[\s\S]*"[\w-]+"\s*:\s*\[[\s\S]*\]\s*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch {}
    }
  }
  return null;
}

const MODEL_REF_RE = /^([a-zA-Z0-9_-]+)\/([a-zA-Z0-9._-]+)$/;

function matchModelRef(rankedRef, allRefs) {
  if (allRefs.includes(rankedRef)) return rankedRef;

  const rankedLower = rankedRef.toLowerCase();
  for (const ref of allRefs) {
    if (ref.toLowerCase() === rankedLower) return ref;
  }

  const [rp, rm] = MODEL_REF_RE.test(rankedRef) ? rankedRef.match(MODEL_REF_RE).slice(1) : [];
  if (rp && rm) {
    const rpLower = rp.toLowerCase();
    const rmLower = rm.toLowerCase();

    for (const ref of allRefs) {
      const m = ref.match(MODEL_REF_RE);
      if (m && m[1].toLowerCase() === rpLower && m[2].toLowerCase() === rmLower) return ref;
    }

    for (const ref of allRefs) {
      const m = ref.match(MODEL_REF_RE);
      if (m && m[2].toLowerCase() === rmLower) return ref;
    }
  }

  return null;
}

export function rankFallbacksByFitness(cloudRecommendations) {
  const entries = cloudRecommendations
    .filter((rec) => rec.fallback_models?.length > 1)
    .map((rec) => ({
      name: rec.name,
      type: rec.type,
      allModels: [rec.model, ...rec.fallback_models],
    }));

  if (entries.length === 0) return false;

  const models = FREE_MODELS.length > 0 ? FREE_MODELS : ["opencode/mimo-v2.5-free"];
  const prompt = buildRankingPrompt(entries);

  const progress = createProgress("Ranking models by AI fitness", { total: 1 });
  process.stdout.write(`◇  AI ranking ${entries.length} agent(s)/category(ies) by model fitness — this may take ~60s...\n`);

  let aiWasApplied = false;
  let usedModel = null;

  for (const modelRef of models) {
    try {
      const responseText = callOpencode(prompt, modelRef);
      const ranking = parseRanking(responseText);

      if (ranking) {
        for (const rec of cloudRecommendations) {
          const ranked = ranking[rec.name];
          if (!Array.isArray(ranked) || ranked.length === 0) continue;

          const allModels = [rec.model, ...rec.fallback_models];
          const refToModel = {};
          for (const m of allModels) {
            refToModel[`${m.provider}/${m.model}`] = m;
          }
          const allRefs = Object.keys(refToModel);

          const rankIndex = {};
          ranked.forEach((ref, i) => {
            const matched = matchModelRef(ref, allRefs);
            if (matched) rankIndex[matched] = i;
          });

          allRefs.sort((a, b) => {
            const iA = rankIndex[a] ?? Infinity;
            const iB = rankIndex[b] ?? Infinity;
            return iA - iB;
          });

          const [bestModel, ...orderedFallbacks] = allRefs.map((ref) => refToModel[ref]);
          rec.model = bestModel;
          rec.fallback_models = orderedFallbacks;
          rec.aiUsedModel = modelRef;
        }
        aiWasApplied = true;
        usedModel = modelRef;
        break;
      }
    } catch {
      continue;
    }
  }

  progress.done(aiWasApplied ? `ranked by ${usedModel}` : "AI unavailable — using heuristic order");
  return aiWasApplied;
}
