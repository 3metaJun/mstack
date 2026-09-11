#!/usr/bin/env node

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { processInvocation } from "./runtime-lib.mjs";
import { parseCliArgs } from "./cli-args.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const registry = JSON.parse(readFileSync(join(repoRoot, "profiles", "harnesses.json"), "utf8"));
const options = parseCliArgs(process.argv.slice(2), [
  "--harness", "--skill", "--file", "--model", "--parent-model",
], ["--execute", "--require-installed", "--json"]);

function expandHome(path) {
  if (path === "~") return homedir();
  return path?.startsWith("~/") || path?.startsWith("~\\") ? join(homedir(), path.slice(2)) : path;
}

function targetFor(harness) {
  const config = registry[harness];
  const override = process.env[config.directoryVariable];
  if (override) return resolve(expandHome(override));
  if (config.fallback) return config.fallback.reduce((path, part) => join(path, part), homedir());
  const configuredRoot = process.env[config.configVariable];
  const configRoot = configuredRoot
    ? resolve(expandHome(configuredRoot))
    : join(homedir(), config.configFallback);
  return join(configRoot, ...(config.prefix ?? []), ...(config.suffix ?? []));
}

function run(command, commandArgs) {
  const invocation = processInvocation(command, commandArgs);
  const result = spawnSync(invocation.command, invocation.args, {
    encoding: "utf8",
    shell: false,
    windowsHide: true,
  });
  return {
    ok: result.error ? false : result.status === 0,
    output: `${result.stdout ?? ""}${result.stderr ?? ""}`.trim(),
    error: result.error?.message,
  };
}

function cleanLines(value) {
  return value
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

const requested = options["--harness"] ?? "all";
const harnesses = requested === "all" ? Object.keys(registry) : requested.split(",");
const unknown = harnesses.filter((harness) => !Object.hasOwn(registry, harness));
if (!harnesses.length || unknown.length) throw new Error(`Unsupported harness: ${unknown.join(", ") || requested}`);
if (new Set(harnesses).size !== harnesses.length) throw new Error(`Duplicate harness in --harness: ${requested}`);

const skill = options["--skill"] ?? "meta-mode";
if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(skill)) throw new Error(`Invalid skill name: ${skill}`);
const execute = options["--execute"];
const requireInstalled = options["--require-installed"];
const results = [];

for (const harness of harnesses) {
  const config = registry[harness];
  const target = targetFor(harness);
  const skillPath = join(target, skill, "SKILL.md");
  const version = run(config.runtime.command, ["--version"]);
  const entry = {
    harness,
    command: config.runtime.command,
    target,
    skill,
    installed: existsSync(skillPath),
    cli: version.ok ? "available" : "unavailable",
    version: version.output.split(/\r?\n/)[0] ?? "",
  };
  if (execute && version.ok) {
    const modelConfig = options["--file"];
    const roleArgs = [
      join(repoRoot, "scripts", "run-role.mjs"),
      "--harness",
      harness,
      "--role",
      "explorer",
      "--prompt",
      `mstack smoke test for ${skill}. Reply with exactly mstack-smoke-ok and do not edit files.`,
      "--execute",
      "--read-only",
    ];
    if (modelConfig) roleArgs.push("--file", modelConfig);
    if (options["--parent-model"]) roleArgs.push("--parent-model", options["--parent-model"]);
    if (options["--model"]) roleArgs.push("--model", options["--model"]);
    else if (!modelConfig && !options["--parent-model"]) roleArgs.push("--model", "auto");
    const live = spawnSync(process.execPath, roleArgs, { encoding: "utf8", stdio: "pipe" });
    const lines = cleanLines(`${live.stdout ?? ""}${live.stderr ?? ""}`);
    entry.live = live.status === 0 && lines.includes("mstack-smoke-ok") ? "passed" : "failed";
    entry.liveOutput = lines.at(-1) ?? "";
  }
  results.push(entry);
}

const output = options["--json"] ? JSON.stringify(results, null, 2) : results.map((entry) => {
  const live = entry.live ? `, live ${entry.live}` : "";
  return `${entry.harness}: CLI ${entry.cli}, ${entry.skill} ${entry.installed ? "installed" : "missing"}${live} (${entry.target})`;
}).join("\n");
console.log(output);

const failed = results.filter((entry) => entry.cli !== "available" || (requireInstalled && !entry.installed) || (execute && entry.live !== "passed"));
process.exit(failed.length ? 1 : 0);
