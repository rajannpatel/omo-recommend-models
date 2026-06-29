/**
 * panel-core.js — Core AI Panel execution: prompt building, model calls,
 * consensus, concurrency pool, and the per-agent panel orchestration.
 *
 * Extracted from bin/omo-recommend-models (L356-1101). Functions that need
 * runtime dependencies (ctx, subprocess) take them as explicit parameters.
 */

import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import {
  parseAiJson,
  discoverFreeModels as discoverFreeModelsFromShared,
  splitModelRef,
} from "../omo-shared.js";
import {
  usableLocalVramGb,
  buildFittingModels,
  normalizeAgentRec,
  normalizeRecommendation,
  printNumberedPanelModelGroups,
  printSelectablePanelModelGroups,
  createProgress,
} from "../display-utils.js";
import {
  detectFamilyFromMeta,
  scoreModel,
  sortPanelModelRefs,
} from "../scoring.js";
import {
  LOCAL_PROVIDER,
} from "../constants.js";
import {
  isProviderAvailable,
  markProviderCreditExhausted,
  markProviderRateLimited,
  probeModel,
  parseRetryAfterSeconds,
  compactErrorText,
} from "../probe-providers.js";
import {
  installedLocalNameSet,
} from "../apply-local.js";
import {
  allConfigEntries,
  computeConsensus,
} from "../consensus.js";
import {
  isCliProvider,
  hasEnoughContextForPanel,
  filterPanelModelsForContext,
} from "./panel-candidates.js";
import {
  discoverCliModels as discoverCliModelsFromAgents,
} from "./cli-agents.js";


// ---------------------------------------------------------------------------
// Timeout constants
// ---------------------------------------------------------------------------
const PANEL_MODEL_TIMEOUT_SECONDS = Math.max(
  120,
  Number.parseInt(process.env.OMO_PANEL_MODEL_TIMEOUT_SECONDS || "180", 10) ||
    180,
);

const PANEL_FIRST_BYTE_TIMEOUT_SECONDS = Math.max(
  60,
  Number.parseInt(
    process.env.OMO_PANEL_FIRST_BYTE_TIMEOUT_SECONDS ||
      String(PANEL_MODEL_TIMEOUT_SECONDS),
    10,
  ) || PANEL_MODEL_TIMEOUT_SECONDS,
);

// ---------------------------------------------------------------------------
// 1. Extract text from opencode JSON-stream output
// ---------------------------------------------------------------------------

export function extractOpencodeText(stdout) {
  const texts = [];
  for (const line of stdout.trim().split("\n")) {
    try {
      const evt = JSON.parse(line);
      if (evt.type === "text" && evt.part && evt.part.text) {
        texts.push(evt.part.text);
      }
    } catch (_) {}
  }
  return texts.join("") || null;
}

// ---------------------------------------------------------------------------
// 2. Call a single panel model via `opencode run`
// ---------------------------------------------------------------------------

export async function callPanelModelAsync(
  model,
  prompt,
  signal,
  statusRef,
  subprocess,
) {
  const tempDir = os.tmpdir();
  const stdout = await subprocess.execAsync("opencode", [
    "run", "--pure", "--agent", "summary",
    "--dir", tempDir, "--format", "json",
    "--model", model,
    "--dangerously-skip-permissions",
    prompt,
  ], {
    cwd: tempDir,
    env: { PWD: tempDir, INIT_CWD: tempDir },
    firstByteTimeoutMs: PANEL_FIRST_BYTE_TIMEOUT_SECONDS * 1000,
    totalTimeoutMs: PANEL_MODEL_TIMEOUT_SECONDS * 1000,
    signal,
    statusRef,
  });

  if (!stdout) return null;

  // Detect quota / billing errors from stderr captured in statusRef
  if (statusRef && statusRef.stderr) {
    const rawError = (statusRef.stderr || "") + "\n" + stdout;
    const lower = rawError.toLowerCase();
    if (
      lower.includes("402") ||
      lower.includes("payment required") ||
      lower.includes("payment_required") ||
      lower.includes("quota exceeded") ||
      lower.includes("quota_exceeded") ||
      lower.includes("billing limit") ||
      lower.includes("billing_limit") ||
      lower.includes("credit limit") ||
      lower.includes("credit_limit") ||
      lower.includes("insufficient funds") ||
      lower.includes("insufficient_funds") ||
      lower.includes("usage limit") ||
      lower.includes("budget exceeded")
    ) {
      statusRef.quotaExceeded = true;
      statusRef.creditExhausted = true;
      if (!statusRef.failReason) statusRef.failReason = "quota-exceeded";
      statusRef.stderr = compactErrorText(statusRef.stderr || stdout);
    }

    // Detect rate limiting
    const rateLower = rawError.toLowerCase();
    if (
      rateLower.includes("429") ||
      rateLower.includes("rate limit") ||
      rateLower.includes("too many requests")
    ) {
      statusRef.rateLimited = true;
      statusRef.retryAfter =
        parseRetryAfterSeconds(rawError) || statusRef.retryAfter || 15;
      if (!statusRef.failReason) statusRef.failReason = "rate-limited";
      statusRef.stderr = compactErrorText(statusRef.stderr || stdout);
    }
  }

  const text = extractOpencodeText(stdout);
  if (!text && statusRef) {
    statusRef.failReason = "empty-text";
  }
  return text;
}

// ---------------------------------------------------------------------------
// 3. Find a CLI agent by model ref
// ---------------------------------------------------------------------------

export function findCliAgent(cliAgents, ref) {
  return (cliAgents || []).find((agent) => agent.ref === ref) || null;
}

// ---------------------------------------------------------------------------
// 4. Clean AI response — ask another model to fix JSON
// ---------------------------------------------------------------------------

export async function cleanAiResponse(raw, signal, subprocess) {
  const models = discoverFreeModelsFromShared();
  if (models.length === 0) return null;
  const model = models[0];
  const prompt = [
    "Extract ONLY the JSON object from the text below.",
    "If there are multiple JSON objects return the LARGEST one.",
    "Return valid JSON and nothing else. No markdown fences. No explanation.",
    "",
    raw,
  ].join("\n");
  try {
    const result = await callPanelModelAsync(model, prompt, signal, {}, subprocess);
    return result || null;
  } catch (_) {
    return null;
  }
}

// ---------------------------------------------------------------------------
// 5. Call one model for a per-agent prompt, with retry
// ---------------------------------------------------------------------------

export async function callModelForAgent(
  model,
  prompt,
  signal,
  statusRef,
  cliModels,
  agentName,
  maxRetries = 3,
  ctx,
  subprocess,
) {
  // CLI agents use a different dispatch path
  if (model.startsWith("cli/")) {
    const cliAgent = (cliModels || []).find((a) => a.ref === model);
    if (cliAgent) {
      const parsed = await cliAgent.call(prompt);
      if (!parsed) return null;
      if (parsed && !parsed.name && agentName) {
        parsed.name = agentName;
      }
      const rec = normalizeAgentRec(parsed);
      if (!rec || !rec.name || (rec.model !== null && (!rec.model.provider || !rec.model.model))) return null;
      return rec;
    }
    return null;
  }

  const provider = model.split("/")[0];
  if (!isProviderAvailable(ctx, provider)) {
    if (statusRef) {
      const state = ctx.providerAvailability.get(provider);
      statusRef.failReason = state?.creditExhausted
        ? "quota-exceeded"
        : "rate-limited";
      statusRef.stderr = `Skipped: provider unavailable (${statusRef.failReason})`;
    }
    return null;
  }

  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    const raw = await callPanelModelAsync(model, prompt, signal, statusRef, subprocess);
    if (raw) {
      // Got a response — parse and return
      let parsed = null;
      try {
        parsed = parseAiJson(raw);
      } catch (_) {}
      if (parsed && !parsed.name && agentName) {
        parsed.name = agentName;
      }
      if (!parsed || !parsed.name || (parsed.model !== null && parsed.model !== undefined && (!parsed.model.provider || !parsed.model.model))) {
        const cleaned = await cleanAiResponse(raw, signal, subprocess);
        if (cleaned) {
          try {
            parsed = parseAiJson(cleaned);
          } catch (_) {}
        }
      }
      if (parsed && !parsed.name && agentName) {
        parsed.name = agentName;
      }
      if (!parsed) return null;
      const rec = normalizeAgentRec(parsed);
      if (!rec || !rec.name || (rec.model !== null && (!rec.model.provider || !rec.model.model))) return null;
      return rec;
    }

    if (statusRef?.quotaExceeded) {
      markProviderCreditExhausted(ctx, provider, statusRef.failReason);
      return null;
    }

    // Non-rate-limit failure — don't retry
    if (!statusRef?.rateLimited) return null;

    // Rate-limited — use Retry-After if the server specified one, else a fixed interval
    const delay = statusRef.retryAfter || 15;
    markProviderRateLimited(ctx, provider, delay, statusRef.failReason);

    if (statusRef) {
      statusRef.failReason = `rate-limited retry ${attempt}/${maxRetries} (${delay}s)`;
    }

    await new Promise((resolve) => setTimeout(resolve, delay * 1000));

    // Reset rate-limit flags for next attempt (each retry is a fresh request)
    if (statusRef) {
      statusRef.rateLimited = false;
      statusRef.retryAfter = null;
      statusRef.failReason = null;
    }
  }
  return null;
}

// ---------------------------------------------------------------------------
// 6. Build a compact per-agent prompt
// ---------------------------------------------------------------------------

export function buildAgentPrompt(entry, cloudLookup, allLocalModels, gpu, ollama, ctx) {
  const vramAvail = usableLocalVramGb(gpu);
  const quality = entry.section.model_quality || "balanced";
  const desc = entry.section.description || "";
  const currentModel = entry.section.model || "";

  // Helper to check if a model is free (by ref string naming or metadata cost === 0)
  const isModelFree = (ref, meta) => {
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
    if (meta) {
      const cost = meta.cost !== undefined ? meta.cost : (meta.input_price !== undefined ? meta.input_price : null);
      if (cost !== null && cost !== undefined && cost !== "" && Number(cost) === 0) {
        return true;
      }
    }
    return false;
  };

  // 1. Get all available providers (not credit exhausted, not rate limited)
  const availableProviders = Object.keys(cloudLookup.byId || {}).filter(
    (provider) => provider !== "local" && isProviderAvailable(ctx, provider)
  );

  // 2. Get the top 10 models for each available provider, plus any free models
  const candidateModels = [];
  for (const provider of availableProviders) {
    const modelMap = cloudLookup.byId[provider] || new Map();
    const scored = [];
    for (const [id, meta] of modelMap.entries()) {
      const ref = `${provider}/${id}`;
      if (!hasEnoughContextForPanel(ref, cloudLookup)) continue;
      const score = Math.round(scoreModel(ref, null, meta));
      const free = isModelFree(ref, meta);
      scored.push({
        ref,
        provider,
        modelId: id,
        score,
        free,
      });
    }
    // Sort by score descending
    scored.sort((a, b) => b.score - a.score);

    // Take top 10
    const top10 = scored.slice(0, 10);
    const top10Refs = new Set(top10.map((m) => m.ref));

    const providerCandidates = [...top10];
    for (const m of scored) {
      if (m.free && !top10Refs.has(m.ref)) {
        providerCandidates.push(m);
      }
    }
    candidateModels.push(...providerCandidates);
  }

  // Sort all candidate models globally by score descending
  candidateModels.sort((a, b) => b.score - a.score);

  // Generic family detection from metadata (replaces hardcoded FAMILY_LIMITS)
  function detectFamilyFromCandidate(m) {
    const meta = cloudLookup.byId?.[m.provider]?.get(m.modelId);
    const detected = detectFamilyFromMeta(meta, m.modelId);
    if (detected.family && detected.family !== "unknown") return detected.family;

    // Fallback to generic name-based detection
    const lower = m.ref.toLowerCase();
    if (lower.includes("opus") || lower.includes("pro-max") || lower.includes("ultra")) return "flagship";
    if (lower.includes("sonnet") || lower.includes("pro") || lower.includes("plus")) return "advanced";
    if (lower.includes("haiku") || lower.includes("mini") || lower.includes("nano") || lower.includes("lite") || lower.includes("small")) return "compact";
    if (lower.includes("flash") || lower.includes("speed") || lower.includes("fast")) return "speed";
    if (lower.includes("reasoning") || lower.includes("think") || lower.includes("r1")) return "reasoning";
    if (lower.includes("codex") || lower.includes("coder") || lower.includes("code")) return "code";
    if (lower.includes("vision") || lower.includes("vl") || lower.includes("multimodal")) return "vision";
    if (lower.includes("embedding") || lower.includes("embed")) return "embedding";

    const sizeMatch = lower.match(/(\d+)b/);
    if (sizeMatch) {
      const size = parseInt(sizeMatch[1]);
      if (size >= 70) return "xxlarge";
      if (size >= 30) return "xlarge";
      if (size >= 13) return "large";
      if (size >= 7) return "medium";
      return "small";
    }
    return "unknown";
  }

  const seenModelIds = new Set();
  const counts = {};
  const deduped = [];
  for (const m of candidateModels) {
    const fam = detectFamilyFromCandidate(m);
    if (!fam || fam === "unknown") continue;

    // Deduplicate same models across multiple providers by model ID (e.g. gemini-2.5-pro)
    const normModelId = m.modelId.toLowerCase();
    if (seenModelIds.has(normModelId)) {
      continue;
    }

    const limit = 1; // One model per family for diversity
    const n = counts[fam] || 0;
    if (n < limit) {
      counts[fam] = n + 1;
      seenModelIds.add(normModelId);
      deduped.push(m);
    }
  }
  const providersTable = deduped.map((m) => `${m.ref} ${m.score}`).join("\n");

  // Local models — fit VRAM, show install status
  const installedNames = installedLocalNameSet(ollama);
  const fitting = buildFittingModels(allLocalModels, gpu);
  const localTable = fitting
    .map(
      (m) =>
        `${m.name}  v=${m.vram}GB s=${m.score} ${installedNames.has(m.name) ? "inst" : ""}`,
    )
    .join("\n");

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
    `CLOUD (${deduped.length}):`,
    providersTable || "-",
    "",
    `LOCAL (${fitting.length} fit VRAM):`,
    localTable || "-",
    "",
    "FIELDS:  model=primary  routing=delegation_pool  fallback_models=retry_pool",
    "RULES:",
    "- Sort routing and fallback_models by score descending.",
    "- Paid/cloud as primary for reasoning/code agents.",
    "- Free model as fallback unless utility agent (explore/librarian/quick).",
    "- Prefer highest-scored cloud model for primary unless GPU requirements force local.",
    "- For utility agents (explore/librarian/quick), use highest-scored FREE cloud as primary.",
    "- For other agents, prioritize highest-scored paid/cloud model.",
    "- Place minimum 1 routing entry with highest-scored cloud (or local if only fit).",
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

// ---------------------------------------------------------------------------
// 7. Run async tasks with concurrency limit
// ---------------------------------------------------------------------------

export async function runPool(tasks, concurrency) {
  const results = new Array(tasks.length);
  let next = 0;
  const worker = async () => {
    while (next < tasks.length) {
      const idx = next++;
      results[idx] = await tasks[idx]();
    }
  };
  const pool = Array.from({ length: Math.min(concurrency, tasks.length) }, () =>
    worker(),
  );
  await Promise.all(pool);
  return results;
}

// ---------------------------------------------------------------------------
// 8. Interactive model picker (currently unused — kept for completeness)
// ---------------------------------------------------------------------------

export async function pickPanelModels(config, availablePaid = [], promptUser) {
  const free = discoverFreeModelsFromShared();
  const combined = [...new Set([...(availablePaid || []), ...free])];
  const all = sortPanelModelRefs(combined, config);
  if (all.length === 0) return null;

  console.log(`\nEvaluate these models for opencode OMO agent roles:`);
  const selectableGroups = printSelectablePanelModelGroups(all, "  ");
  console.log(`  [a] All (default)`);

  const answer = await promptUser(
    "Select model families by number (e.g. 1,3,5) or press Enter for all: ",
  );
  if (!answer || answer.trim().toLowerCase() === "a" || answer.trim() === "")
    return null;

  const indices = answer
    .split(",")
    .map((s) => parseInt(s.trim(), 10))
    .filter((n) => !isNaN(n) && n >= 1 && n <= selectableGroups.length);
  if (indices.length === 0) return null;

  const selected = indices.flatMap((i) => selectableGroups[i - 1].models.map((entry) => entry.ref));
  return selected;
}

// ---------------------------------------------------------------------------
// Local command-exists helper (checks PATH for a binary)
// ---------------------------------------------------------------------------

function commandExists(binary) {
  if (!binary || binary.includes(path.sep)) return "";
  for (const dir of String(process.env.PATH || "").split(path.delimiter)) {
    if (!dir) continue;
    const candidate = path.join(dir, binary);
    try {
      const stat = fs.statSync(candidate);
      if (!stat.isFile()) continue;
      fs.accessSync(candidate, fs.constants.X_OK);
      return candidate;
    } catch {}
  }
  return "";
}

// ---------------------------------------------------------------------------
// 9. Per-agent panel orchestration
// ---------------------------------------------------------------------------

export async function runPanelAndSelect(
  config,
  cloudLookup,
  allLocalModels,
  gpu,
  ollama,
  cloudOnlyFlag,
  panelModels,
  cliOptions = {},
  ctx,
  subprocess,
  defaultPanelModelsFn,
) {
  const cliAgents = discoverCliModelsFromAgents(config, cliOptions, ctx, commandExists);
  let models;
  if (panelModels && panelModels.length > 0) {
    models = filterPanelModelsForContext(panelModels, cloudLookup);
  } else {
    models = defaultPanelModelsFn(config, cloudLookup);
    if (models.length === 0) throw new Error("No free models available");
  }

  if (models.length === 0) {
    models = defaultPanelModelsFn(config, cloudLookup);
  }

  {
    let availableModels = [];
    const progress = createProgress("Verifying panel models availability");
    let probeResults = [];
    try {
      probeResults = await Promise.all(models.map((m) => {
        const cliAgent = findCliAgent(cliAgents, m);
        return cliAgent ? cliAgent.probe() : probeModel(ctx, m);
      }));
      availableModels = models.filter((m, i) => probeResults[i].ok);
      progress.done(`${availableModels.length} of ${models.length} model(s) available`);
    } catch (err) {
      progress.done(`error verifying availability: ${err.message}`);
      availableModels = models;
    }

    if (availableModels.length === 0) {
      console.log("\n\u26A0 No panel models are available (all are quota-restricted or rate-limited). Limiting analysis and recommendations to opencode AI models exclusively.");
      ctx.opencodeOnlyMode = true;

      console.log("\nFailed model details / errors:");
      for (let i = 0; i < models.length; i++) {
        const m = models[i];
        const res = probeResults[i] || { ok: false, reason: "unknown error", errorOutput: "No output" };
        const errSnippet = res.errorOutput ? res.errorOutput.split("\n")[0] : "unknown error";
        console.log(`  • ${m}: ${res.reason} (${errSnippet})`);
      }

      console.log("\nFalling back to free opencode models...");
      const freeModels = defaultPanelModelsFn(config, cloudLookup);
      if (freeModels.length === 0) {
        throw new Error("No free models available");
      }
      const progress2 = createProgress("Verifying free models availability");
      try {
        const probeResults2 = await Promise.all(freeModels.map((m) => {
          const cliAgent = findCliAgent(cliAgents, m);
          return cliAgent ? cliAgent.probe() : probeModel(ctx, m);
        }));
        availableModels = freeModels.filter((m, i) => probeResults2[i].ok);
        progress2.done(`${availableModels.length} of ${freeModels.length} model(s) available`);
      } catch (err) {
        progress2.done(`error verifying availability: ${err.message}`);
        availableModels = freeModels;
      }
      if (availableModels.length === 0) {
        throw new Error("No available free models found");
      }
    }

    // Backfill failed CLI agents with available cloud models
    const failedCliAgents = models
      .map((m, i) => ({ model: m, result: probeResults[i] }))
      .filter(({ model, result }) => {
        const provider = splitModelRef(model).provider;
        return isCliProvider(provider) && !result.ok;
      })
      .map(({ model }) => model);

    if (failedCliAgents.length > 0) {
      // Get all available cloud models that are not already in availableModels
      const availableCloudModels = [];
      for (const [provider, modelMap] of Object.entries(cloudLookup.byId || {})) {
        if (provider === LOCAL_PROVIDER || provider === "opencode") continue;
        if (!isProviderAvailable(ctx, provider)) continue;
        for (const [modelId, meta] of modelMap.entries()) {
          const ref = `${provider}/${modelId}`;
          if (!hasEnoughContextForPanel(ref, cloudLookup)) continue;
          if (!availableModels.includes(ref)) {
            availableCloudModels.push({ ref, score: scoreModel(ref, null, meta) });
          }
        }
      }
      availableCloudModels.sort((a, b) => b.score - a.score);

      // Backfill each failed CLI agent with the best available cloud model
      for (const failedCli of failedCliAgents) {
        if (availableCloudModels.length > 0) {
          const backfill = availableCloudModels.shift();
          availableModels.push(backfill.ref);
          console.log(`  \u2192 Backfilling failed CLI agent ${failedCli} with ${backfill.ref}`);
        }
      }
    }

    models = availableModels;
  }

  // Print what models will be queried (after availability check)
  console.log(`\nThis run would query:`);
  printNumberedPanelModelGroups(models, "  ");
  console.log();

  const agents = allConfigEntries(config);
  if (agents.length === 0) throw new Error("No agents or categories in config");

  // Per-agent state
  const state = agents.map((entry) => ({
    name: entry.name,
    type: entry.type,
    results: [],
    done: false,
    consensus: null,
  }));

  // ── Header (printed once, scrolls naturally) ──
  console.log();
  console.log(
    `== AI Panel: ${agents.length} agents, ${models.length} panel models ==`,
  );
  console.log("   Models:");

  // ── Compact single-line status bar (updates via \r) ──
  const totalTasks = agents.length * models.length;
  let tasksDone = 0;
  let agentsDone = 0;
  let currentAgent = "";
  const modelSuccessCounts = new Map(models.map((model) => [model, 0]));
  const countWidth = String(totalTasks).length;
  const formatCount = (value, total) =>
    `${String(value).padStart(countWidth, " ")}/${total}`;

  const maxLabelWidth = Math.max(
    "tasks".length,
    "agents".length,
    ...models.map((m) => m.length),
  );
  const formatLinePrefix = (label) =>
    `   \u2022 ${(label + ":").padEnd(maxLabelWidth + 1)} `;

  const statusLineCount = 3;
  const updateStatus = () => {
    if (process.stdout.isTTY) {
      process.stdout.write(`\x1b[${models.length + statusLineCount}F`);
      for (const model of models) {
        const count = modelSuccessCounts.get(model) || 0;
        process.stdout.write(
          `\x1b[2K${formatLinePrefix(model)}${formatCount(count, agents.length)} successful responses\n`,
        );
      }
      process.stdout.write(`\x1b[2Kevaluating ${currentAgent || "-"}\n`);
      process.stdout.write(`\x1b[2K${formatLinePrefix("tasks")}${formatCount(tasksDone, totalTasks)}\n`);
      process.stdout.write(`\x1b[2K${formatLinePrefix("agents")}${formatCount(agentsDone, agents.length)}\n`);
      // Ensure output is flushed
      if (typeof process.stdout._handle?.flush === 'function') {
        process.stdout._handle.flush();
      }
    }
  };
  for (const model of models) {
    console.log(
      `${formatLinePrefix(model)}${formatCount(modelSuccessCounts.get(model), agents.length)} successful responses`,
    );
  }
  console.log("evaluating -");
  console.log(`${formatLinePrefix("tasks")}${formatCount(tasksDone, totalTasks)}`);
  console.log(`${formatLinePrefix("agents")}${formatCount(agentsDone, agents.length)}`);
  updateStatus();

  // ── Build task functions ──
  const taskFns = [];
  for (let ai = 0; ai < agents.length; ai++) {
    const entry = agents[ai];
    const st = state[ai];

    for (const m of models) {
      taskFns.push(async () => {
        currentAgent = entry.name;
        const statusRef = {};
        const prompt = buildAgentPrompt(
          entry,
          cloudLookup,
          allLocalModels,
          gpu,
          ollama,
          ctx,
        );
        const rec = await callModelForAgent(m, prompt, ctx.signal, statusRef, cliAgents, entry.name, 3, ctx, subprocess);
        if (rec) modelSuccessCounts.set(m, (modelSuccessCounts.get(m) || 0) + 1);
        st.results.push(rec ? { model: m, recommendation: rec } : null);
        tasksDone++;
        if (st.results.length === models.length) agentsDone++;
        updateStatus();
      });
    }
  }

  // ── Run with concurrency limit ──
  const concurrency = Math.max(1, os.cpus().length);
  await runPool(taskFns, concurrency);

  // ── Mark all agents done ──
  for (const st of state) st.done = true;

  // Final status update
  currentAgent = "";
  updateStatus();
  if (!process.stdout.isTTY) {
    console.log("   Final successful responses:");
    for (const model of models) {
      const count = modelSuccessCounts.get(model) || 0;
      console.log(
        `${formatLinePrefix(model)}${formatCount(count, agents.length)} successful responses`,
      );
    }
  }
  process.stdout.write("\n"); // new line after the status bar

  // ── Tally votes for all agents (delegated to consensus module) ──
  const consensusResult = computeConsensus(state, agents, models, ctx, isProviderAvailable);

  // Build final result (completeAiRecommendations will fill localModels)
  const result = {
    recommender: consensusResult.recommender,
    analysis: consensusResult.analysis,
    cloudRecommendations: consensusResult.cloudRecommendations,
    localModels: { decisions: [], placements: [] },
  };

  return { selected: result, panel: { state, models } };
}
