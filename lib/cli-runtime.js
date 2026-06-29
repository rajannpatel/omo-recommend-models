import pc from "picocolors";
import {
  confirm as plainConfirm,
  promptUser as plainPromptUser,
} from "./omo-shared.js";
import { RuntimeContext } from "./runtime-context.js";
import { SubprocessRunner } from "./subprocess.js";
import { setProgressClackState } from "./display-utils.js";

export function createCliRuntime() {
  const ctx = new RuntimeContext();
  const subprocess = new SubprocessRunner(ctx);

  return {
    ctx,
    subprocess,

    installSignalHandlers() {
      ctx.installSignalHandlers();
    },

    terminateActiveChildren() {
      ctx.terminateActiveChildren();
    },

    async configureTerminalUi(enabled) {
      ctx.useClackPrompts = Boolean(enabled);
      if (ctx.useClackPrompts) {
        try {
          ctx.clack = await import("@clack/prompts");
        } catch {
          ctx.clack = null;
        }
      }
      setProgressClackState(ctx.useClackPrompts, ctx.clack);
    },

    async confirm(question) {
      if (ctx.useClackPrompts && ctx.clack?.confirm) {
        const answer = await ctx.clack.confirm({
          message: question.replace(/\s*\([^)]+\)\s*$/, "").trim(),
          initialValue: false,
        });
        return answer === true;
      }
      return plainConfirm(question);
    },

    async promptUser(question) {
      if (ctx.useClackPrompts && ctx.clack?.text) {
        const answer = await ctx.clack.text({ message: question.trim() });
        return typeof answer === "string" ? answer.trim() : "";
      }
      return plainPromptUser(question);
    },

    handleFatalError(error) {
      console.error(`\n${pc.red("\u2716 " + (error.message || String(error)))}`);
      if (ctx.debugMode && error.stack) {
        console.error(error.stack);
      }
      if (error.stderr) {
        const stderrText =
          typeof error.stderr === "string" ? error.stderr : error.stderr.toString();
        for (const line of stderrText.trim().split("\n")) {
          console.error(`  ${line}`);
        }
      }
      process.exitCode = 1;
    },
  };
}
