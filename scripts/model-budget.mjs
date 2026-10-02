import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCliArgs } from "./cli-args.mjs";
import { isValidModel, readModelConfig, validateModelConfig } from "./model-config-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const harnesses = Object.keys(JSON.parse(readFileSync(join(root, "profiles/harnesses.json"), "utf8")));
const options = parseCliArgs(process.argv.slice(2), ["--file", "--harness", "--budget", "--catalog"], ["--apply", "--help"]);
if (options["--help"]) {
  console.log("Usage: node scripts/model-budget.mjs --harness <name> --budget <unlimited|large|medium|small> --catalog <models.json> [--file <models.json>] [--apply]\n\n" +
    "The catalog is a JSON array of model names reported by the selected Harness. Default: preview. --apply writes only when every role resolves.");
  process.exit(0);
}
const harness = options["--harness"];
if (!harnesses.includes(harness)) throw new Error("--harness must name a supported Harness");
const targets = { unlimited: null, large: "xhigh", medium: "high", small: "medium" };
const budget = options["--budget"];
if (!Object.hasOwn(targets, budget)) throw new Error("--budget must be unlimited, large, medium, or small");
if (!options["--catalog"]) throw new Error("--catalog is required");
const catalog = JSON.parse(readFileSync(options["--catalog"], "utf8"));
if (!Array.isArray(catalog) || catalog.some((model) => !isValidModel(model) || ["auto", "inherit-parent"].includes(model))) {
  throw new Error("catalog must be a JSON array of concrete model names without surrounding whitespace or NUL characters");
}
const file = resolve(options["--file"] ?? join(homedir(), ".config/mstack/models.json"));
const config = readModelConfig(file);
const errors = validateModelConfig(config, harnesses);
if (errors.length) throw new Error(errors.join("\n"));
const next = structuredClone(config);
const effort = targets[budget];
const ladder = ["low", "medium", "high", "xhigh", "max"];
const suffix = /^(.*)-(max|xhigh|high|medium|low)(-fast)?$/;
const unresolved = [];
const changes = [];
const resolveModel = (model, role) => {
  if (["auto", "inherit-parent"].includes(model)) return model;
  if (effort === null) {
    if (catalog.includes(model)) return model;
  } else {
    const match = suffix.exec(model);
    if (match) {
      const stem = match[1];
      const fast = match[3] ?? "";
      const exact = `${stem}-${effort}${fast}`;
      if (catalog.includes(exact)) return exact;
      for (let index = ladder.indexOf(effort) - 1; index >= 0; index--) {
        const candidate = `${stem}-${ladder[index]}${fast}`;
        if (catalog.includes(candidate)) return candidate;
      }
    }
  }
  unresolved.push({ role, model, reason: effort === null ? "model is not in the catalog" : "no detected effort variant at or below the target; select a model or configure reasoning through the Harness" });
  return model;
};
for (const [role, defaultModel] of Object.entries(config.roles)) {
  const before = config.overrides?.[harness]?.[role] ?? defaultModel;
  const after = Array.isArray(before) ? before.map((model) => resolveModel(model, role)) : resolveModel(before, role);
  if (Array.isArray(after) && new Set(after).size !== after.length) {
    unresolved.push({ role, model: before, reason: "budget mapping collapses reviewer entries; choose a unique panel" });
  }
  if (JSON.stringify(before) !== JSON.stringify(after)) {
    next.overrides ??= {};
    next.overrides[harness] ??= {};
    next.overrides[harness][role] = after;
    changes.push({ role, before, after });
  }
}
next.budgets = { ...config.budgets, [harness]: budget };
const nextErrors = validateModelConfig(next, harnesses);
if (nextErrors.length && !unresolved.length) throw new Error(nextErrors.join("\n"));
const changed = JSON.stringify(config) !== JSON.stringify(next);
console.log(JSON.stringify({ harness, budget, effort, changes, unresolved, config: next, applied: Boolean(options["--apply"] && !unresolved.length && changed) }, null, 2));
if (unresolved.length) {
  process.exitCode = 1;
} else if (options["--apply"] && changed) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = join(dirname(file), `.model-budget-${randomUUID()}.json`);
  try {
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(temporary, file);
  } finally {
    rmSync(temporary, { force: true });
  }
}
