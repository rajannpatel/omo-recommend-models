import assert from "node:assert/strict";
import test from "node:test";
import { discoverCliModels } from "../../lib/recommend/cli-agents.js";

const config = {
  omo: {
    panel_cli_agents: {
      test: {
        command: ["test-agent", "{prompt}"],
      },
    },
  },
};

const commandExists = () => "/tmp/test-agent";

test("CLI agents preserve the configured timeout for first-byte and total limits", async () => {
  let execOptions = null;
  const subprocess = {
    execAsync: async (_command, _args, options) => {
      execOptions = options;
      return JSON.stringify({
        name: "probe",
        type: "agent",
        profile: "probe",
        model: { provider: "opencode", model: "probe-free", reason: "probe" },
        routing: [],
        fallback_models: [],
      });
    },
  };

  const [agent] = discoverCliModels(config, {}, {}, commandExists, subprocess);
  const result = await agent.probe();

  assert.equal(result.ok, true);
  assert.equal(execOptions.firstByteTimeoutMs, 120000);
  assert.equal(execOptions.totalTimeoutMs, 120000);
});

test("CLI agents reject timed-out partial JSON output", async () => {
  const subprocess = {
    execAsync: async (_command, _args, options) => {
      options.statusRef.failReason = "total-timeout";
      options.statusRef.exitCode = null;
      options.statusRef.signalCode = "SIGTERM";
      return JSON.stringify({
        name: "sisyphus",
        type: "agent",
        profile: "partial",
        model: { provider: "opencode", model: "partial-free", reason: "partial" },
        routing: [],
        fallback_models: [],
      });
    },
  };

  const [agent] = discoverCliModels(config, {}, {}, commandExists, subprocess);
  const result = await agent.call("prompt");

  assert.equal(result, null);
});
