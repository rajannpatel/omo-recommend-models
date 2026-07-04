import { execFileSync } from "node:child_process";

import { discoverFreeModels } from "../shared/provider-cache.js";
import { createProgress } from "../display/progress.js";
import {
  AGENT_MODEL_REQUIREMENTS,
  CATEGORY_MODEL_REQUIREMENTS,
} from "./model-requirements.js";

function resolveFreeModels() {
  try {
    return discoverFreeModels();
  } catch {
    return [];
  }
}

const FREE_MODELS = resolveFreeModels();

const FALLBACK_DESCRIPTIONS = {
  scout: "Quick information gathering agent. Needs speed and accurate extraction.",
  sysadmin: "System administration and shell execution. Needs practical knowledge of OS operations.",
};

export function upstreamContext({ name, type, allModels }) {
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

function buildRankingPrompt(entries) {
  const sections = entries
    .map(
      ({ name, type, allModels }) => {
        const ctx = upstreamContext({ name, type, allModels });
        const roleLine = ctx
          ? `Upstream requirements:\n${ctx}`
          : `Role: ${name} (${type || "agent"}) — no upstream requirements defined`;
        return `## ${name} (${type || "agent"})
${roleLine}
Available models: ${allModels.map((f) => `${f.provider}/${f.model}`).join(", ")}`;
      },
    )
    .join("\n\n");

  return `You are ranking AI model fitness for agents and categories defined in the oh-my-openagent plugin for OpenCode. These are not OpenCode's built-in agents — they are plugin-level roles with their own model requirements.

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
  const ruleMatched = cloudRecommendations.filter((rec) => rec.ruleChainMatched);
  const ruleMatchedNames = ruleMatched.map((rec) => `   • ${rec.type ? `${rec.type}.${rec.name}` : rec.name}`);

  const entries = cloudRecommendations
    .filter((rec) => !rec.ruleChainMatched && rec.fallback_models?.length > 1)
    .map((rec) => ({
      name: rec.name,
      type: rec.type,
      allModels: [rec.model, ...rec.fallback_models],
    }));

  if (entries.length === 0) {
    if (ruleMatchedNames.length > 0) {
      process.stdout.write(`◇  Rule-chain matched — AI analysis skipped:\n${ruleMatchedNames.join("\n")}\n`);
    }
    return false;
  }

  if (ruleMatchedNames.length > 0) {
    process.stdout.write(`◇  Rule-chain matched — AI analysis skipped:\n${ruleMatchedNames.join("\n")}\n\n`);
  }

  const models = FREE_MODELS.length > 0 ? FREE_MODELS : ["opencode/mimo-v2.5-free"];
  const progress = createProgress("Ranking models by AI fitness", { total: entries.length });

  const total = entries.length;
  process.stdout.write(`\r◇  AI ranking ${total} agent(s)/category(ies) individually by model fitness — processed 0/${total}`);

  let rankedCount = 0;
  const usedModels = new Set();

  for (let idx = 0; idx < total; idx++) {
    const entry = entries[idx];
    const prompt = buildRankingPrompt([entry]);
    const startIndex = Math.floor(Math.random() * models.length);
    let entryRanked = false;

    for (let i = 0; i < models.length; i++) {
      const modelRef = models[(startIndex + i) % models.length];
      try {
        const responseText = callOpencode(prompt, modelRef);
        const result = parseRanking(responseText);

        if (result && Array.isArray(result[entry.name]) && result[entry.name].length > 0) {
          const ranked = result[entry.name];
          const rec = cloudRecommendations.find((r) => r.name === entry.name);
          if (!rec) break;

          const allModels = [rec.model, ...rec.fallback_models];
          const refToModel = {};
          const allRefs = allModels.map((m) => {
            const ref = `${m.provider}/${m.model}`;
            refToModel[ref] = m;
            return ref;
          });

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
          usedModels.add(modelRef);
          entryRanked = true;
          rankedCount++;
          break;
        }
      } catch {
        continue;
      }
    }

    process.stdout.write(`\r◇  AI ranking ${total} agent(s)/category(ies) individually by model fitness — processed ${idx + 1}/${total}`);
    progress.advance(1, entryRanked ? `ranked by ${models[0]}` : "no AI available");
  }

  process.stdout.write("\n");
  progress.done(
    rankedCount > 0
      ? `${rankedCount}/${total} ranked (used: ${[...usedModels].join(", ")})`
      : "AI unavailable — using heuristic order",
  );
  return rankedCount > 0;
}
