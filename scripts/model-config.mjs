import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { HOST_KEYS, readModelConfig, resolveModels, t3CatalogWarnings, validateModelConfig, validateT3Catalog } from "./model-config-lib.mjs";
import { decodeText } from "./text-decode.mjs";
import { parseCliArgs } from "./cli-args.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const harnesses = Object.keys(JSON.parse(readFileSync(join(repoRoot, "profiles", "harnesses.json"), "utf8")));
const options = parseCliArgs(process.argv.slice(2), ["--file", "--harness", "--role", "--format", "--catalog"]);
const requestedHarness = options["--harness"];
if (requestedHarness && ![...harnesses, ...HOST_KEYS].includes(requestedHarness)) {
  throw new Error(`Unsupported harness: ${requestedHarness}`);
}
if (options["--catalog"] && requestedHarness && requestedHarness !== "t3code") {
  throw new Error("--catalog validation is currently supported only for --harness t3code");
}
const requestedRole = options["--role"];
const format = options["--format"] ?? "text";
if (!["text", "json"].includes(format)) throw new Error(`Unsupported format: ${format}`);

function expandHome(path) {
  if (path === "~") return homedir();
  return path?.startsWith("~/") || path?.startsWith("~\\") ? join(homedir(), path.slice(2)) : path;
}

const defaultPath = join(homedir(), ".config", "mstack", "models.json");
const requestedPath = expandHome(options["--file"] ?? defaultPath);
const configPath = resolve(requestedPath);
if (!existsSync(configPath)) {
  console.log(`No model configuration found at ${configPath}`);
  console.log("Copy profiles/models.example.json to that path before selecting models.");
  process.exit(0);
}

const config = readModelConfig(configPath);
const errors = validateModelConfig(config, harnesses);
let warnings = [];
if (options["--catalog"]) {
  const catalogPath = resolve(expandHome(options["--catalog"]));
  const catalog = JSON.parse(decodeText(readFileSync(catalogPath)));
  errors.push(...validateT3Catalog(config, catalog));
  warnings = t3CatalogWarnings(config);
}
if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}
for (const warning of warnings) {
  console.error(`Warning: ${warning}`);
}

if (requestedRole && !Object.hasOwn(config.roles, requestedRole)) {
  throw new Error(`Unknown model role: ${requestedRole}`);
}
// A host layer is listed only when the file configures it.
const selectedHarnesses = requestedHarness
  ? [requestedHarness]
  : [...harnesses, ...HOST_KEYS.filter((host) => config.overrides?.[host])];
for (const harness of selectedHarnesses) {
  const values = requestedRole ? { [requestedRole]: resolveModels(config, harness)[requestedRole] } : resolveModels(config, harness);
  if (format === "json") console.log(JSON.stringify({ harness, models: values }));
  else console.log(`${harness}: ${JSON.stringify(values)}`);
}
