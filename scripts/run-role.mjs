#!/usr/bin/env node

import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFile, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { buildSshInvocation, environmentCwd, readEnvironment } from "./environment-lib.mjs";
import { readModelConfig, resolveRoleModel, validateModelConfig } from "./model-config-lib.mjs";
import { processInvocation } from "./runtime-lib.mjs";
import { parseCliArgs } from "./cli-args.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const harnessRegistry = JSON.parse(readFileSync(join(repoRoot, "profiles", "harnesses.json"), "utf8"));
const options = parseCliArgs(process.argv.slice(2), [
  "--harness", "--role", "--prompt", "--environment", "--file", "--model",
  "--parent-model", "--model-index", "--cwd",
], ["--execute", "--read-only", "--all-models"]);

function requireValue(flag) {
  const value = options[flag];
  if (!value) throw new Error(`${flag} requires a value`);
  return value;
}

function expandHome(path) {
  if (path === "~") return homedir();
  return path.startsWith("~/") || path.startsWith("~\\") ? join(homedir(), path.slice(2)) : path;
}

const harness = requireValue("--harness");
const role = requireValue("--role");
const prompt = requireValue("--prompt");
const environmentName = options["--environment"];
const configPath = options["--file"] ?? join(homedir(), ".config", "mstack", "models.json");
const config = readModelConfig(resolve(expandHome(configPath)));
const errors = validateModelConfig(config, Object.keys(harnessRegistry));
if (errors.length) throw new Error(errors.join("; "));
if (!Object.hasOwn(harnessRegistry, harness)) throw new Error(`Unsupported harness: ${harness}`);

const configured = resolveRoleModel(config, harness, role);
const allModels = options["--all-models"] === true;
const modelIndex = options["--model-index"];
if ([options["--model"] !== undefined, allModels, modelIndex !== undefined].filter(Boolean).length > 1) {
  throw new Error("Choose only one of --model, --all-models or --model-index");
}
if (allModels && !options["--read-only"]) {
  throw new Error("--all-models requires --read-only; isolate writable workers in separate worktrees and launch them individually");
}
const configuredModels = Array.isArray(configured) ? configured : [configured];
let selectedModels;
if (options["--model"] !== undefined) {
  selectedModels = [options["--model"]];
} else if (modelIndex !== undefined) {
  if (!/^\d+$/.test(modelIndex) || Number(modelIndex) >= configuredModels.length) {
    throw new Error(`--model-index must be between 0 and ${configuredModels.length - 1}`);
  }
  selectedModels = [configuredModels[Number(modelIndex)]];
} else {
  if (Array.isArray(configured) && !allModels) {
    throw new Error("Reviewer lists require --all-models or --model-index");
  }
  selectedModels = configuredModels;
}
const parentModel = options["--parent-model"];
if (parentModel === "inherit-parent" || parentModel === "auto") {
  throw new Error("--parent-model requires a concrete model name reported by the parent Harness");
}
const models = selectedModels.map((model) => {
  if (model !== "inherit-parent") return model;
  if (!parentModel) {
    throw new Error("inherit-parent requires --parent-model <name> in a new CLI process; use --model auto for the CLI default");
  }
  return parentModel;
});
const definition = harnessRegistry[harness].runtime;
if (!definition?.command || !Array.isArray(definition.headlessArgs) || !Array.isArray(definition.modelArgs)) {
  throw new Error(`Harness ${harness} has no runtime command definition`);
}

const environment = readEnvironment(environmentName, [harness]);
const cwd = environmentCwd(environment, harness, options["--cwd"]);
const plans = models.map((model) => {
  const commandArgs = [...definition.headlessArgs];
  if (model !== "auto") commandArgs.push(...definition.modelArgs.map((part) => part.replace("{model}", model)));
  commandArgs.push(prompt);
  if (options["--read-only"]) commandArgs.push(...(definition.readOnlyArgs ?? []));
  const invocation = environment.transport === "ssh"
    ? buildSshInvocation(environment, definition.command, commandArgs, cwd)
    : { command: definition.command, args: commandArgs };
  return {
    harness,
    role,
    model,
    environment: environment.name,
    transport: environment.transport,
    command: invocation.command,
    args: invocation.args,
  };
});

function executableFor(plan) {
  return environment.transport === "ssh" ? plan : processInvocation(plan.command, plan.args);
}
const executionCwd = environment.transport === "ssh" ? process.cwd() : cwd ?? process.cwd();
if (!options["--execute"]) {
  console.log(JSON.stringify(allModels ? plans : plans[0]));
} else if (allModels) {
  const results = await Promise.all(plans.map((plan) => new Promise((done) => {
    const executable = executableFor(plan);
    execFile(executable.command, executable.args, {
      cwd: executionCwd, encoding: "utf8", shell: false, windowsHide: true, maxBuffer: 16 * 1024 * 1024,
    }, (error, stdout, stderr) => done({
      ...plan,
      status: error ? (typeof error.code === "number" ? error.code : 1) : 0,
      ...(error ? { error: error.message } : {}),
      stdout,
      stderr,
    }));
  })));
  console.log(JSON.stringify(results));
  process.exitCode = results.some((result) => result.status !== 0) ? 1 : 0;
} else {
  const executable = executableFor(plans[0]);
  const result = spawnSync(executable.command, executable.args, {
    cwd: executionCwd,
    encoding: "utf8",
    stdio: "inherit",
    shell: false,
    windowsHide: true,
  });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
}
