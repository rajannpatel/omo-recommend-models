import process from "node:process";
import { execFileSync, spawn } from "node:child_process";

import { discoverFreeModels } from "../shared/provider-cache.js";
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

let _opencodeBin = null;
let _opencodeBinSearched = false;
let _opencodeProbing = null;

const OPENCODE_CANDIDATES = [
  "opencode",
  "/usr/local/bin/opencode",
  process.env.HOME ? `${process.env.HOME}/.local/bin/opencode` : null,
  process.env.HOME ? `${process.env.HOME}/.opencode/opencode` : null,
].filter(Boolean);

function probeOpencode(bin) {
  return new Promise((resolve) => {
    const child = spawn(bin, ["--version"], {
      stdio: ["ignore", "pipe", "pipe"],
      timeout: 5000,
    });
    let resolved = false;
    const done = (ok) => { if (!resolved) { resolved = true; resolve(ok); } };
    child.on("error", () => done(false));
    child.on("close", (code) => done(code === 0));
    child.stdout.on("data", () => done(true));
    setTimeout(() => done(false), 5000);
  });
}

async function findOpencode() {
  if (_opencodeBinSearched) return _opencodeBin;
  if (_opencodeProbing) return _opencodeProbing;

  _opencodeProbing = (async () => {
    for (const bin of OPENCODE_CANDIDATES) {
      if (await probeOpencode(bin)) {
        _opencodeBin = bin;
        return bin;
      }
    }
    return null;
  })();

  const result = await _opencodeProbing;
  _opencodeBinSearched = true;
  _opencodeProbing = null;
  return result;
}

async function callOpencode(prompt, modelRef) {
  const bin = await findOpencode();
  if (!bin) throw new Error("opencode binary not found");

  return new Promise((resolve, reject) => {
    const child = spawn(bin, ["run", "--format", "json", "--model", modelRef], {
      stdio: ["pipe", "pipe", "pipe"],
      timeout: 120_000,
    });

    let stdout = "";
    let stderr = "";

    child.stdout.on("data", (data) => { stdout += data.toString(); });
    child.stderr.on("data", (data) => { stderr += data.toString(); });

    child.on("error", (err) => reject(err));

    child.on("close", (code) => {
      if (code !== 0 && !stdout) {
        const detail = stderr.trim() ? `: ${stderr.trim().slice(0, 200)}` : "";
        reject(new Error(`opencode exited with code ${code}${detail}`));
        return;
      }

      for (const line of stdout.trim().split("\n")) {
        try {
          const event = JSON.parse(line);
          if (event.type === "text" && event.part?.text) {
            resolve(event.part.text);
            return;
          }
        } catch {
          continue;
        }
      }

      const preview = stdout.trim().slice(0, 120).replace(/\n/g, "\\n");
      const stderrInfo = stderr.trim() ? `; stderr: "${stderr.trim().slice(0, 200)}"` : "";
      reject(
        new Error(
          `opencode returned no text response (exit ${code}${stderrInfo}; stdout: "${preview}")`,
        ),
      );
    });

    child.stdin.write(prompt);
    child.stdin.end();
  });
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

export async function rankFallbacksByFitness(cloudRecommendations) {
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
  const total = entries.length;

  let rankedCount = 0;
  const usedModels = new Set();
  let completedCount = 0;

  process.stdout.write(`◇  AI ranking ${total} agent(s)/category(ies) by model fitness — processed 0/${total}`);

  async function tryModel(entry, modelRef) {
    const debugLabel = `${entry.type || "agent"}.${entry.name}@${modelRef}`;
    try {
      const text = await callOpencode(buildRankingPrompt([entry]), modelRef);
      const result = parseRanking(text);
      if (result && Array.isArray(result[entry.name]) && result[entry.name].length > 0) {
        return { modelRef, ranked: result[entry.name] };
      }
      process.stderr.write(`  ✗ ${debugLabel} — invalid ranking\n`);
    } catch (err) {
      process.stderr.write(`  ✗ ${debugLabel} — ${err.message}\n`);
    }
    return null;
  }

  function applyRanking(rec, modelRef, ranked) {
    const allModels_ = [rec.model, ...rec.fallback_models];
    const refToModel = {};
    const allRefs = allModels_.map((m) => {
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
  }

  // Round-robin: each entry starts with models[i % len], retries with next on failure.
  // All entries fire concurrently so at most ~(entries + modelCount) concurrent processes.
  const modelCount = models.length;
  await Promise.all(entries.map(async (entry, i) => {
    let modelStart = i % modelCount;
    for (let m = 0; m < modelCount; m++) {
      const modelRef = models[(modelStart + m) % modelCount];
      const r = await tryModel(entry, modelRef);
      if (r) {
        const rec = cloudRecommendations.find((rec_) => rec_.name === entry.name);
        if (rec) {
          applyRanking(rec, r.modelRef, r.ranked);
          usedModels.add(r.modelRef);
          rankedCount++;
        }
        break;
      }
    }
    completedCount++;
    process.stdout.write(`\r◇  AI ranking ${total} agent(s)/category(ies) by model fitness — processed ${completedCount}/${total}`);
  }));

  process.stdout.write("\n");
  process.stdout.write(
    rankedCount > 0
      ? `✓  AI ranking ${total}: ${rankedCount}/${total} ranked (used: ${[...usedModels].join(", ")})`
      : `◇  AI ranking ${total}: AI unavailable — using heuristic order`,
  );
  process.stdout.write("\n");
  return rankedCount > 0;
}
