import { builtinCliAdapters, configuredCliAdapters } from "./adapters.js";
import {
  buildCliInvoker,
  parseAndValidateCliResponse,
} from "./utils.js";

const PROBE_RESPONSE = [
  "Return only this JSON object and nothing else:",
  '{"name":"probe","type":"agent","profile":"probe","model":null,"routing":[],"fallback_models":[]}',
].join("\n");

function cliAgentFromAdapter(adapter, subprocess) {
  const invoke = buildCliInvoker(adapter, subprocess);
  return {
    ref: adapter.ref,
    panelModel: adapter.panelModel || "",
    probe: async () => {
      const result = await invoke(PROBE_RESPONSE);
      if (!result.ok) return result;
      return parseAndValidateCliResponse(result.output, "probe")
        ? { ok: true, output: result.output }
        : {
            ok: false,
            reason: "invalid-response",
            errorOutput: "CLI probe returned invalid recommendation JSON",
          };
    },
    call: async (prompt) => {
      const result = await invoke(prompt);
      if (!result.ok) return null;
      return parseAndValidateCliResponse(result.output);
    },
  };
}

export function discoverCliModels(config = {}, options = {}, ctx, commandExistsFn, subprocess) {
  const adapters = [
    ...builtinCliAdapters(config, options, ctx),
    ...configuredCliAdapters(config, options),
  ];
  const agents = [];
  for (const adapter of adapters) {
    try {
      if (commandExistsFn(adapter.binary)) {
        agents.push(cliAgentFromAdapter(adapter, subprocess));
      }
    } catch {}
  }
  return agents;
}
