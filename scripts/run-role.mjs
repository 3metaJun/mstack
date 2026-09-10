#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildSshInvocation, environmentCwd, readEnvironment } from "./environment-lib.mjs";
import { readModelConfig, resolveRoleModel, validateModelConfig } from "./model-config-lib.mjs";
import { processInvocation } from "./runtime-lib.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const harnessRegistry = JSON.parse(readFileSync(join(repoRoot, "profiles", "harnesses.json"), "utf8"));
const args = process.argv.slice(2);

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function requireValue(flag) {
  const value = valueAfter(flag);
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

function expandHome(path) {
  if (path === "~") return homedir();
  return path.startsWith("~/") ? join(homedir(), path.slice(2)) : path;
}

const harness = requireValue("--harness");
const role = requireValue("--role");
const prompt = requireValue("--prompt");
const environmentName = valueAfter("--environment");
const configPath = valueAfter("--file") ?? join(homedir(), ".config", "mstack", "models.json");
const config = readModelConfig(resolve(expandHome(configPath)));
const errors = validateModelConfig(config, Object.keys(harnessRegistry));
if (errors.length) throw new Error(errors.join("; "));
if (!Object.hasOwn(harnessRegistry, harness)) throw new Error(`Unsupported harness: ${harness}`);

const model = valueAfter("--model") ?? resolveRoleModel(config, harness, role);
const definition = harnessRegistry[harness].runtime;
if (!definition?.command || !Array.isArray(definition.headlessArgs) || !Array.isArray(definition.modelArgs)) {
  throw new Error(`Harness ${harness} has no runtime command definition`);
}

const command = definition.command;
const commandArgs = [...definition.headlessArgs];
if (model !== "inherit-parent" && model !== "auto") {
  commandArgs.push(...definition.modelArgs.map((part) => part.replace("{model}", model)));
}
commandArgs.push(prompt);
if (args.includes("--read-only")) commandArgs.push(...(definition.readOnlyArgs ?? []));

const environment = readEnvironment(environmentName, [harness]);
const cwd = environmentCwd(environment, harness, valueAfter("--cwd"));
const invocation = environment.transport === "ssh"
  ? buildSshInvocation(environment, command, commandArgs, cwd)
  : { command, args: commandArgs };

if (!args.includes("--execute")) {
  console.log(JSON.stringify({
    harness,
    role,
    model,
    environment: environment.name,
    transport: environment.transport,
    command: invocation.command,
    args: invocation.args,
  }));
  process.exit(0);
}

const executable = environment.transport === "ssh"
  ? invocation
  : processInvocation(invocation.command, invocation.args);
const result = spawnSync(executable.command, executable.args, {
  cwd: environment.transport === "ssh" ? process.cwd() : cwd ?? process.cwd(),
  encoding: "utf8",
  stdio: "inherit",
  shell: false,
});
if (result.error) throw result.error;
process.exit(result.status ?? 1);
