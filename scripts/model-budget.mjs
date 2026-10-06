import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCliArgs } from "./cli-args.mjs";
import { EFFORT_LADDER, HOST_KEYS, entryKey, isAlias, isValidModel, parseRoleEntry, readModelConfig, validateModelConfig } from "./model-config-lib.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const harnesses = Object.keys(JSON.parse(readFileSync(join(root, "profiles/harnesses.json"), "utf8")));
const options = parseCliArgs(process.argv.slice(2), ["--file", "--harness", "--budget", "--catalog"], ["--apply", "--help"]);
if (options["--help"]) {
  console.log("Usage: node scripts/model-budget.mjs --harness <name> --budget <unlimited|large|medium|small> --catalog <models.json> [--file <models.json>] [--apply]\n\n" +
    "--harness is a supported Harness or a host layer such as t3code.\n" +
    "The catalog is a JSON array reported by the selected Harness or host. An item is a model name string " +
    "(effort is a name suffix) or an object { provider?, model, efforts? } where efforts lists the effort options the model exposes. " +
    "Default: preview. --apply writes only when every role resolves.");
  process.exit(0);
}
const harness = options["--harness"];
if (![...harnesses, ...HOST_KEYS].includes(harness)) throw new Error("--harness must name a supported Harness or host");
const host = HOST_KEYS.includes(harness);
const targets = { unlimited: null, large: "xhigh", medium: "high", small: "medium" };
const budget = options["--budget"];
if (!Object.hasOwn(targets, budget)) throw new Error("--budget must be unlimited, large, medium, or small");
if (!options["--catalog"]) throw new Error("--catalog is required");

function catalogProblem(item) {
  if (typeof item === "string") return isValidModel(item) && !isAlias(item) ? null : "names must be concrete without surrounding whitespace or NUL characters";
  if (!item || typeof item !== "object" || Array.isArray(item)) return "items must be model names or objects";
  const unknown = Object.keys(item).filter((field) => !["provider", "model", "efforts"].includes(field));
  if (unknown.length) return `has unknown field ${unknown.join(", ")}`;
  if (!isValidModel(item.model) || isAlias(item.model)) return "model must be a concrete name";
  if (item.provider !== undefined && (!isValidModel(item.provider) || /[\s/]/.test(item.provider))) return "provider must be a provider id without whitespace or slashes";
  if (item.efforts !== undefined && (!Array.isArray(item.efforts) || item.efforts.some((value) => !isValidModel(value)) || new Set(item.efforts).size !== item.efforts.length)) {
    return "efforts must be a list of unique option ids";
  }
  return null;
}
const catalog = JSON.parse(readFileSync(options["--catalog"], "utf8"));
if (!Array.isArray(catalog) || catalog.some((item) => catalogProblem(item))) {
  const detail = Array.isArray(catalog) ? catalog.map(catalogProblem).find(Boolean) : "it is not an array";
  throw new Error(`catalog must be a JSON array of concrete model names or { provider, model, efforts } objects: ${detail}`);
}
const names = catalog.filter((item) => typeof item === "string");
const exposed = catalog.filter((item) => typeof item === "object");
const file = resolve(options["--file"] ?? join(homedir(), ".config/mstack/models.json"));
const config = readModelConfig(file);
const errors = validateModelConfig(config, harnesses);
if (errors.length) throw new Error(errors.join("\n"));
const next = structuredClone(config);
const effort = targets[budget];
const suffix = /^(.*)-(max|xhigh|high|medium|low)(-fast)?$/;
const unresolved = [];
const changes = [];

// Sets the effort option from the catalog's explicit list: the target, else the
// highest ladder value below it that the model exposes.
const resolveExposed = (entry, parsed, found, role) => {
  const offered = found.efforts ?? [];
  const label = entryKey({ provider: parsed.provider, model: parsed.model });
  if (effort === null) {
    if (parsed.effort === undefined || offered.includes(parsed.effort)) return entry;
    unresolved.push({ role, model: entry, reason: `${label} does not expose effort ${parsed.effort}` });
    return entry;
  }
  const best = EFFORT_LADDER.slice(0, EFFORT_LADDER.indexOf(effort) + 1).findLast((value) => offered.includes(value));
  if (best === undefined) {
    unresolved.push({ role, model: entry, reason: `${label} exposes no effort option at or below ${effort}; select another model or keep the budget unlimited` });
    return entry;
  }
  if (best === parsed.effort) return entry;
  if (typeof entry === "string") return entryKey({ ...parsed, effort: best });
  return { ...(parsed.provider === undefined ? {} : { provider: parsed.provider }), model: parsed.model, effort: best };
};

// Rewrites an effort suffix in a model name, the only effort control a name-only catalog has.
const resolveSuffix = (model, role) => {
  if (effort === null) {
    if (names.includes(model)) return model;
  } else {
    const match = suffix.exec(model);
    if (match) {
      const stem = match[1];
      const fast = match[3] ?? "";
      const exact = `${stem}-${effort}${fast}`;
      if (names.includes(exact)) return exact;
      for (let index = EFFORT_LADDER.indexOf(effort) - 1; index >= 0; index--) {
        const candidate = `${stem}-${EFFORT_LADDER[index]}${fast}`;
        if (names.includes(candidate)) return candidate;
      }
    }
  }
  unresolved.push({ role, model, reason: effort === null ? "model is not in the catalog" : "no detected effort variant at or below the target; select a model or configure reasoning through the Harness" });
  return model;
};

const resolveEntry = (entry, role) => {
  if (isAlias(entry)) return entry;
  const parsed = parseRoleEntry(entry, { host });
  if (parsed.error) {
    unresolved.push({ role, model: entry, reason: `${parsed.error}; set overrides.${harness}.${role} first` });
    return entry;
  }
  const found = exposed.find((item) => item.provider === parsed.provider && item.model === parsed.model);
  if (found) return resolveExposed(entry, parsed, found, role);
  if (host || parsed.provider !== undefined || typeof entry !== "string") {
    unresolved.push({ role, model: entry, reason: "provider and model are not in the catalog" });
    return entry;
  }
  return resolveSuffix(entry, role);
};
for (const [role, defaultModel] of Object.entries(config.roles)) {
  const before = config.overrides?.[harness]?.[role] ?? defaultModel;
  const after = Array.isArray(before) ? before.map((entry) => resolveEntry(entry, role)) : resolveEntry(before, role);
  if (Array.isArray(after) && new Set(after.map((entry) => entryKey(parseRoleEntry(entry, { host })))).size !== after.length) {
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
let applied = false;
if (unresolved.length) {
  process.exitCode = 1;
} else if (options["--apply"] && changed) {
  mkdirSync(dirname(file), { recursive: true });
  const temporary = join(dirname(file), `.model-budget-${randomUUID()}.json`);
  try {
    writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx", mode: 0o600 });
    renameSync(temporary, file);
    applied = true;
  } finally {
    rmSync(temporary, { force: true });
  }
}
console.log(JSON.stringify({ harness, budget, effort, changes, unresolved, config: next, applied }, null, 2));
