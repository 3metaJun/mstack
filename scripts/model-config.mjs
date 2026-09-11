import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { readModelConfig, resolveModels, validateModelConfig } from "./model-config-lib.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const harnesses = Object.keys(JSON.parse(readFileSync(join(repoRoot, "profiles", "harnesses.json"), "utf8")));
const args = process.argv.slice(2);

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function expandHome(path) {
  if (path === "~") return homedir();
  return path?.startsWith("~/") || path?.startsWith("~\\") ? join(homedir(), path.slice(2)) : path;
}

const defaultPath = join(homedir(), ".config", "mstack", "models.json");
const requestedPath = expandHome(valueAfter("--file") ?? defaultPath);
if (!requestedPath) throw new Error("--file requires a path");
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

const requestedHarness = valueAfter("--harness");
if (requestedHarness && !harnesses.includes(requestedHarness)) {
  throw new Error(`Unsupported harness: ${requestedHarness}`);
}
const requestedRole = valueAfter("--role");
if (requestedRole && !Object.hasOwn(config.roles, requestedRole)) {
  throw new Error(`Unknown model role: ${requestedRole}`);
}
const format = valueAfter("--format") ?? "text";
if (!["text", "json"].includes(format)) throw new Error(`Unsupported format: ${format}`);
const selectedHarnesses = requestedHarness ? [requestedHarness] : harnesses;
for (const harness of selectedHarnesses) {
  const values = requestedRole ? { [requestedRole]: resolveModels(config, harness)[requestedRole] } : resolveModels(config, harness);
  if (format === "json") console.log(JSON.stringify({ harness, models: values }));
  else console.log(`${harness}: ${JSON.stringify(values)}`);
}
