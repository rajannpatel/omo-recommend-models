import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";

import { POLICY_EXCLUSION_CACHE_FILE } from "../constants.js";

const SCHEMA_VERSION = 1;

function normalizeModelRef(value) {
  if (typeof value !== "string") {
    throw new TypeError("expected a valid exact model ref");
  }
  const normalized = value.trim();
  const segments = normalized.split("/");
  if (
    segments.length < 2 ||
    segments.some((segment) => segment.length === 0) ||
    /\s/.test(normalized)
  ) {
    throw new TypeError("expected a valid exact model ref");
  }
  return normalized;
}

function parseCache(bytes) {
  let data;
  try {
    data = JSON.parse(bytes);
  } catch {
    throw new Error("invalid JSON");
  }
  if (!data || typeof data !== "object" || Array.isArray(data)) {
    throw new Error("expected a schema object");
  }
  if (data.schemaVersion !== SCHEMA_VERSION) {
    throw new Error(`unsupported schemaVersion ${String(data.schemaVersion)}`);
  }
  if (!Array.isArray(data.policyExcludedModelRefs)) {
    throw new Error("policyExcludedModelRefs must be an array");
  }

  const refs = data.policyExcludedModelRefs.map((ref, index) => {
    try {
      return normalizeModelRef(ref);
    } catch {
      throw new Error(`invalid model ref at index ${index}`);
    }
  });
  return [...new Set(refs)].sort();
}

function errorMessage(error) {
  return error instanceof Error ? error.message : String(error);
}

export class PolicyExclusionCache {
  constructor({
    cacheFile = POLICY_EXCLUSION_CACHE_FILE,
    debug = false,
    verbose = false,
    stderr = process.stderr,
    fileSystem = fs,
  } = {}) {
    this.cacheFile = cacheFile;
    this.debug = debug;
    this.verbose = verbose;
    this.stderr = stderr;
    this.fileSystem = fileSystem;
    this.refs = new Set();
    this.reload();
  }

  reload() {
    try {
      const bytes = this.fileSystem.readFileSync(this.cacheFile, "utf8");
      this.refs = new Set(parseCache(bytes));
    } catch (error) {
      this.refs = new Set();
      if (error?.code !== "ENOENT" && (this.debug || this.verbose)) {
        this.stderr.write(
          `[cache] ignoring invalid policy-exclusion cache at ${this.cacheFile}: ${errorMessage(error)}\n`,
        );
      }
    }
    return this.values();
  }

  has(modelRef) {
    try {
      return this.refs.has(normalizeModelRef(modelRef));
    } catch {
      return false;
    }
  }

  values() {
    return [...this.refs].sort();
  }

  add(modelRef) {
    const normalized = normalizeModelRef(modelRef);
    if (this.refs.has(normalized)) return false;
    this.refs.add(normalized);
    this.save();
    return true;
  }

  save() {
    const directory = path.dirname(this.cacheFile);
    const temporaryFile = path.join(
      directory,
      `${path.basename(this.cacheFile)}.tmp-${process.pid}-${randomUUID()}`,
    );
    let temporaryFileExists = false;
    try {
      this.fileSystem.mkdirSync(directory, { recursive: true, mode: 0o700 });
      this.fileSystem.chmodSync(directory, 0o700);
      const bytes = `${JSON.stringify(
        {
          schemaVersion: SCHEMA_VERSION,
          policyExcludedModelRefs: this.values(),
        },
        null,
        2,
      )}\n`;
      temporaryFileExists = true;
      this.fileSystem.writeFileSync(temporaryFile, bytes, {
        encoding: "utf8",
        flag: "wx",
        mode: 0o600,
      });
      this.fileSystem.chmodSync(temporaryFile, 0o600);
      this.fileSystem.renameSync(temporaryFile, this.cacheFile);
      temporaryFileExists = false;
      return true;
    } catch (error) {
      this.stderr.write(
        `[cache] unable to persist policy-exclusion cache at ${this.cacheFile}: ${errorMessage(error)}\n`,
      );
      return false;
    } finally {
      if (temporaryFileExists) {
        try {
          this.fileSystem.unlinkSync(temporaryFile);
        } catch {
          try {
            const removeFile = this.fileSystem.rmSync ?? fs.rmSync;
            removeFile.call(this.fileSystem, temporaryFile, { force: true });
          } catch (cleanupError) {
            this.stderr.write(
              `[cache] unable to remove temporary policy-exclusion cache at ${temporaryFile}: ${errorMessage(cleanupError)}\n`,
            );
          }
        }
      }
    }
  }

  flush() {
    try {
      this.fileSystem.unlinkSync(this.cacheFile);
      this.refs.clear();
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") {
        this.refs.clear();
        return false;
      }
      throw error;
    }
  }
}

export function createPolicyExclusionCache(options) {
  return new PolicyExclusionCache(options);
}
