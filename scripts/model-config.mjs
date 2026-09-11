import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readModelConfig, resolveModels, validateModelConfig } from "./model-config-lib.mjs";
import { parseCliArgs } from "./cli-args.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const harnesses = Object.keys(JSON.parse(readFileSync(join(repoRoot, "profiles", "harnesses.json"), "utf8")));
const options = parseCliArgs(process.argv.slice(2), ["--file", "--harness", "--role", "--format"]);
const requestedHarness = options["--harness"];
if (requestedHarness && !harnesses.includes(requestedHarness)) {
  throw new Error(`Unsupported harness: ${requestedHarness}`);
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
if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

if (requestedRole && !Object.hasOwn(config.roles, requestedRole)) {
  throw new Error(`Unknown model role: ${requestedRole}`);
}
const selectedHarnesses = requestedHarness ? [requestedHarness] : harnesses;
for (const harness of selectedHarnesses) {
  const values = requestedRole ? { [requestedRole]: resolveModels(config, harness)[requestedRole] } : resolveModels(config, harness);
  if (format === "json") console.log(JSON.stringify({ harness, models: values }));
  else console.log(`${harness}: ${JSON.stringify(values)}`);
}
