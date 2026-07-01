import fs from "node:fs";
import Ajv from "ajv";

import { CACHE_DIR } from "../omo-shared.js";
import { DEFAULT_SCHEMA, SCHEMA_CACHE_PATH } from "./validate-constants.js";

async function loadStrictSchema() {
  let timeout;
  try {
    const controller = new AbortController();
    timeout = setTimeout(() => controller.abort(), 5000);
    const response = await fetch(DEFAULT_SCHEMA, { signal: controller.signal });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    const schema = await response.json();
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(SCHEMA_CACHE_PATH, `${JSON.stringify(schema, null, 2)}\n`, "utf8");
    return schema;
  } catch (error) {
    if (fs.existsSync(SCHEMA_CACHE_PATH)) {
      return JSON.parse(fs.readFileSync(SCHEMA_CACHE_PATH, "utf8"));
    }
    throw new Error(`Unable to load schema ${DEFAULT_SCHEMA}: ${error.message}`);
  } finally {
    if (timeout) clearTimeout(timeout);
  }
}

function pointerToLocation(pointer) {
  if (!pointer) return "$";
  return pointer
    .split("/")
    .slice(1)
    .map((part) => part.replace(/~1/g, "/").replace(/~0/g, "~"))
    .join(".");
}

function formatSchemaError(error) {
  const base = pointerToLocation(error.instancePath);
  if (error.keyword === "additionalProperties") {
    const property = error.params?.additionalProperty;
    return `${base === "$" ? "$" : base}.${property}: unknown schema property`;
  }
  if (error.keyword === "required") {
    const property = error.params?.missingProperty;
    return `${base === "$" ? property : `${base}.${property}`}: is required by schema`;
  }
  return `${base}: ${error.message || "schema validation failed"}`;
}

export async function validateSchema(config) {
  const schema = await loadStrictSchema();
  const ajv = new Ajv({
    allErrors: true,
    strict: false,
    validateFormats: false,
    logger: false,
  });
  const validate = ajv.compile(schema);
  return validate(config) ? [] : (validate.errors || []).map(formatSchemaError);
}
