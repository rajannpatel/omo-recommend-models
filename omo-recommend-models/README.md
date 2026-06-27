# Agent Model Schema and Guidelines

This directory contains Node CLI tooling for recommending OpenCode OMO agent model placements in `oh-my-openagent.jsonc`.

## Schema Definition

```json
{
  "name": "agent-name",
  "type": "agent|category",
  "profile": "Agent description",
  "model": {"provider": "string", "model": "string", "reason": "string"},
  "routing": [{"provider": "string", "model": "string", "reason": "string"}],
  "fallback_models": [{"provider": "string", "model": "string", "reason": "string"}]
}
```

## Agent Types

- **agent**: Reasoning or functional agents requiring specific model capabilities
- **category**: Specialized agents for domains (visual-engineering, etc.)

## FIELD Definitions

- **model=primary**: The primary model for the agent (one entry, highest-scored matching model)
- **routing=delegation_pool**: Additional cloud models for delegation (sorted by score descending)
- **fallback_models=retry_pool**: Fallback models for retry scenarios (sorted by score descending)

## Provider Types

### Cloud (11 models)
All cloud models are free except GitHub Copilot which is paid.

1. opencode/nemotron-3-ultra-free 1231
2. opencode/north-mini-code-free 1231
3. google/gemini-3.5-flash 1196
4. opencode/deepseek-v4-flash-free 1147
5. opencode/mimo-v2.5-free 1142
6. google/gemma-4-31b-it 1090
7. google/gemini-3.1-pro-preview-customtools 1031
8. groq/openai/gpt-oss-safeguard-20b 802
9. opencode/big-pickle 761
10. groq/qwen/qwen3-32b 500
11. groq/meta-llama/llama-prompt-guard-2-86m 474

### Local (18 VRAM-fitting models)
24 models that fit within 6.5GB usable VRAM.

## Placement Rules

1. **Primary Model Rules**:
   - Use highest-scored cloud model for primary unless GPU requirements force local
   - For utility agents (explore/librarian/quick), use highest-scored FREE cloud as primary
   - Paid/cloud as primary for reasoning/code agents

2. **Routing Pool Rules**:
   - Fill with next highest-scored cloud models (paid > free)
   - Must contain at least 1 entry with highest-scored cloud (or local if only fit)
   - No local models in routing arrays
   - Sort by score descending

3. **Fallback Pool Rules**:
   - Fill with remaining free cloud models (descending score)
   - Local models allowed for local fallback
   - Sort by score descending

4. **Validation**:
   - No duplicate entries across model, routing, and fallback_models
   - Provider validation: 'opencode' for free agents

## Example Configurations

### Case 1 - Reasoning Agent (Paid Cloud Primary)
```json
{
  "name": "metis",
  "type": "agent",
  "profile": "Pre-planning consultant for ambiguous requirements",
  "model": {"provider": "github-copilot", "model": "claude-opus-4.8", "reason": "Paid cloud model as primary for reasoning/code agent per placement rules"},
  "routing": [{"provider": "opencode", "model": "nemotron-3-ultra-free", "reason": "Highest-scored cloud free model for delegation pool"},
           {"provider": "opencode", "model": "north-mini-code-free", "reason": "Second highest-scored cloud free model for delegation pool"}],
  "fallback_models": [{"provider": "opencode", "model": "deepseek-v4-flash-free", "reason": "Free model as retry fallback"}]
}
```

### Case 2 - Utility Agent (Free Cloud Primary)
```json
{
  "name": "explore",
  "type": "agent",
  "profile": "Fast codebase exploration and pattern matching - very lightweight utility work",
  "model": {"provider": "opencode", "model": "mimo-v2.5-free", "reason": "Free model suitable for lightweight exploration"},
  "routing": [],
  "fallback_models": []
}
```

### Case 3 - Category Agent (Free Cloud Primary)
```json
{
  "name": "visual-engineering",
  "type": "category",
  "profile": "Frontend, UI/UX, design, styling, animation",
  "model": {"provider": "opencode", "model": "nemotron-3-ultra-free", "reason": "Balanced performance for design and visual tasks"},
  "routing": [],
  "fallback_models": []
}
```

## Usage

Run the CLI to generate recommendations:

```bash
node ./omo-recommend-models --dry-run --cloud-only
node ./omo-recommend-models --rebalance --dry-run
```