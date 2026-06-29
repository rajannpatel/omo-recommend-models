import { execFileSync, spawn } from "node:child_process";
import { AbortError } from "./errors.js";

/**
 * Unified subprocess runner consolidating 4 duplicate implementations:
 *   execCurl, callOpencodeChat, callOpencodeChatAsync, callPanelModelAsync
 *
 * Uses RuntimeContext for child tracking, abort signal, and kill helper.
 */
export class SubprocessRunner {
  /**
   * @param {import("./runtime-context.js").RuntimeContext} ctx
   */
  constructor(ctx) {
    this.ctx = ctx;
  }

  /**
   * Sync execution — wraps execFileSync with consistent options.
   * Used by: callOpencodeChat replacement.
   */
  execSync(command, args, options = {}) {
    const { timeout = 60000, maxBuffer = 1024 * 1024, stdio, ...rest } = options;
    return execFileSync(command, args, {
      encoding: "utf-8",
      timeout,
      maxBuffer,
      stdio: stdio || ["ignore", "pipe", "pipe"],
      env: { ...process.env, TERM: "dumb" },
      signal: this.ctx.signal,
      ...rest,
    });
  }

  /**
   * Async subprocess with first-byte + total timeout, abort handling,
   * and consistent kill semantics (SIGTERM → 5s → SIGKILL).
   *
   * Used by: callOpencodeChatAsync, callPanelModelAsync replacements.
   *
   * @param {object} options
   * @param {number} [options.firstByteTimeoutMs=45000]  — max wait for first stdout byte
   * @param {number} [options.totalTimeoutMs=120000]     — max total wall-clock time
   * @param {object} [options.statusRef]                  — optional status object updated in-progress
   * @param {AbortSignal} [options.signal]                — external abort signal
   * @returns {Promise<string|null>} stdout text or null on failure/abort
   */
  execAsync(command, args, options = {}) {
    const {
      firstByteTimeoutMs = 45000,
      totalTimeoutMs = 120000,
      statusRef = {},
      signal,
      stdio,
      env,
      cwd,
    } = options;

    return new Promise((resolve) => {
      const child = this.ctx.registerChild(
        spawn(command, args, {
          stdio: stdio || ["ignore", "pipe", "pipe"],
          env: { ...env, ...process.env, TERM: "dumb" },
          cwd,
        }),
      );

      let stdout = "";
      let timersCleaned = false;

      const cleanupTimers = () => {
        if (timersCleaned) return;
        timersCleaned = true;
        clearTimeout(firstByteTimer);
        clearTimeout(totalTimer);
      };

      const firstByteTimer = setTimeout(() => {
        if (statusRef) statusRef.failReason = "first-byte-timeout";
        this.ctx.killChild(child);
      }, firstByteTimeoutMs);

      const totalTimer = setTimeout(() => {
        if (statusRef) statusRef.failReason = "total-timeout";
        this.ctx.killChild(child);
      }, totalTimeoutMs);

      let firstByteReceived = false;
      child.stdout.on("data", (data) => {
        if (!firstByteReceived) {
          firstByteReceived = true;
          clearTimeout(firstByteTimer);
        }
        stdout += data.toString();
        if (statusRef) {
          statusRef.phase = "receiving";
          statusRef.bytes = stdout.length;
        }
      });

      if (child.stderr) {
        child.stderr.on("data", (data) => {
          if (statusRef) {
            const text = data.toString();
            statusRef.stderr = (statusRef.stderr || "") + text;
          }
        });
      }

      child.on("error", () => {
        cleanupTimers();
        resolve(null);
      });

      child.on("close", () => {
        cleanupTimers();
        if (signal && signal.aborted) {
          if (statusRef) statusRef.failReason = "aborted";
          return resolve(null);
        }
        if (this.ctx.signal.aborted) {
          if (statusRef) statusRef.failReason = "aborted";
          return resolve(null);
        }
        resolve(stdout || null);
      });

      // Hook external abort signal
      const abortSignal = signal || this.ctx.signal;
      if (abortSignal) {
        abortSignal.addEventListener(
          "abort",
          () => {
            cleanupTimers();
            if (statusRef) statusRef.failReason = "aborted";
            this.ctx.killChild(child);
          },
          { once: true },
        );
      }
    });
  }

  /**
   * HTTP fetch via curl (sync). Returns body text or "" on failure.
   * Used by: execCurl replacement.
   */
  fetchUrl(url, accept) {
    try {
      const args = ["-s", "--max-time", "8"];
      if (accept) args.push("-H", accept);
      args.push(url);
      return this.execSync("curl", args, { timeout: 15000 });
    } catch {
      return "";
    }
  }
}
