import {
  confirmDefaultYes as plainConfirmDefaultYes,
  confirm as plainConfirm,
  promptUser as plainPromptUser,
} from "./omo-shared.js";
import { RuntimeContext } from "./runtime-context.js";
import { SubprocessRunner } from "./subprocess.js";

export function createCliRuntime() {
  const ctx = new RuntimeContext();
  const subprocess = new SubprocessRunner(ctx);

  return {
    ctx,
    subprocess,

    installSignalHandlers() {
      return ctx.installSignalHandlers();
    },

    terminateActiveChildren() {
      ctx.terminateActiveChildren();
    },

    async configureTerminalUi() {
      // Kept as a stable runtime hook; terminal I/O is handled by plain prompts.
    },

    async confirm(question) {
      return plainConfirm(question);
    },

    async confirmDefaultYes(question) {
      return plainConfirmDefaultYes(question);
    },

    async promptUser(question) {
      return plainPromptUser(question);
    },

    handleFatalError(error) {
      console.error(`\nError: ${error.message || String(error)}`);
      if (ctx.debugMode && error.stack) {
        console.error(error.stack);
      }
      if ((ctx.debugMode || ctx.verboseMode) && error.stderr) {
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
