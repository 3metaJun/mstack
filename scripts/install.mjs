#!/usr/bin/env node

import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  lstatSync,
  openSync,
  readFileSync,
  realpathSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { readEnvironment } from "./environment-lib.mjs";
import {
  artifactPathParts,
  localPathKey,
  pathIsWithin,
  stagingPath,
  targetPathsOverlap,
} from "./install-paths.mjs";

if (Number.parseInt(process.versions.node, 10) < 18) {
  console.error("mstack requires Node.js 18 or newer");
  process.exit(1);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(repoRoot, "skills");
const args = process.argv.slice(2);
const harnessRegistry = JSON.parse(readFileSync(join(repoRoot, "profiles", "harnesses.json"), "utf8"));
const artifactProfile = JSON.parse(readFileSync(join(repoRoot, "profiles", "artifacts.json"), "utf8"));
const artifactRegistry = artifactProfile.artifacts ?? {};
const validHarnesses = Object.keys(harnessRegistry);
const validArtifacts = Object.keys(artifactRegistry);

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

if (args.includes("--help") || !args.includes("--harness")) {
  console.log(`Usage: node scripts/install.mjs --harness <codex|claude|opencode|pi|all> [--environment <name>] [--skill <name[,name...]>] [--artifact <name[,name...]>] [--no-skills] [--dry-run] [--replace]

Installs canonical skills and optional artifacts into user-level harness directories.
Artifacts: ${validArtifacts.join(", ")} (use --artifact all for installable artifacts).
Existing directories are preserved unless --replace is supplied.`);
  process.exit(args.includes("--help") ? 0 : 1);
}

const requested = valueAfter("--harness");
const requestedHarnesses = requested === "all" ? validHarnesses : requested?.split(",");
if (!requestedHarnesses?.length || requestedHarnesses.some((name) => !validHarnesses.includes(name))) {
  throw new Error(`Invalid --harness value: ${requested ?? "<missing>"}`);
}
if (new Set(requestedHarnesses).size !== requestedHarnesses.length) {
  throw new Error(`Duplicate harness in --harness: ${requested}`);
}

const harnesses = [...requestedHarnesses];
const dryRun = args.includes("--dry-run");
const replace = args.includes("--replace");
const userHome = homedir();
const hasEnvironment = args.includes("--environment");
const environmentName = valueAfter("--environment");
if (hasEnvironment && (!environmentName || environmentName.startsWith("--"))) {
  throw new Error("--environment requires a name");
}

function expandHome(path) {
  if (path === "~") return userHome;
  if (/^~[\\/]/.test(path)) return join(userHome, path.slice(2));
  return path;
}

function configuredPath(value, fallback, label) {
  const expanded = expandHome(value ?? fallback);
  if (value && !isAbsolute(expanded)) {
    throw new Error(`${label} must be an absolute path or start with ~/`);
  }
  return resolve(expanded);
}

function pathFromParts(parts) {
  return parts.reduce((current, part) => join(current, part), userHome);
}

const environment = readEnvironment(environmentName, harnesses);
if (environment.transport === "ssh") {
  const remote = spawnSync(process.execPath, [join(repoRoot, "scripts", "remote-install.mjs"), ...args], {
    cwd: repoRoot,
    env: process.env,
    encoding: "utf8",
    stdio: "inherit",
  });
  process.exit(remote.error ? 1 : remote.status ?? 1);
}
const environmentTargets = environment.targets;
const environmentArtifacts = environment.artifacts;
function harnessTarget(harness) {
  const config = harnessRegistry[harness];
  if (environmentTargets[harness]) {
    return configuredPath(environmentTargets[harness], "", `${environmentName}.${harness}`);
  }
  const directory = process.env[config.directoryVariable];
  if (directory) return configuredPath(directory, "", config.directoryVariable);

  if (config.fallback) return pathFromParts(config.fallback);

  const configRoot = process.env[config.configVariable]
    ? configuredPath(process.env[config.configVariable], "", config.configVariable)
    : pathFromParts([config.configFallback]);
  return join(configRoot, ...(config.prefix ?? []), ...(config.suffix ?? []));
}

const targets = Object.fromEntries(validHarnesses.map((harness) => [harness, harnessTarget(harness)]));

function artifactEnvironmentPath(name, harness) {
  const byArtifact = environmentArtifacts[name];
  if (byArtifact && typeof byArtifact === "object" && !Array.isArray(byArtifact)) {
    const value = byArtifact[harness];
    if (value !== undefined && typeof value !== "string") {
      throw new Error(`Environment ${environmentName} artifact ${name}.${harness} must be a path`);
    }
    if (value) return value;
  }

  const byHarness = environmentArtifacts[harness];
  if (byHarness && typeof byHarness === "object" && !Array.isArray(byHarness)) {
    const value = byHarness[name];
    if (value !== undefined && typeof value !== "string") {
      throw new Error(`Environment ${environmentName} artifact ${harness}.${name} must be a path`);
    }
    if (value) return value;
  }

  return undefined;
}

function artifactVariable(name, harness) {
  const normalized = name.replaceAll(/[^A-Za-z0-9]+/g, "_").toUpperCase();
  return `MSTACK_ARTIFACT_${normalized}_${harness.toUpperCase()}_DIR`;
}

function artifactTarget(name, harness) {
  const definition = artifactRegistry[name];
  const environmentPath = artifactEnvironmentPath(name, harness);
  const variable = artifactVariable(name, harness);
  const override = environmentPath ?? process.env[variable];
  if (override) return configuredPath(override, "", environmentPath ? `${environmentName}.artifacts.${name}.${harness}` : variable);
  const root = dirname(targets[harness]);
  const target = resolve(root, ...artifactPathParts(name, definition));
  if (!pathIsWithin(root, target)) {
    throw new Error(`Artifact ${name} target must stay within the harness configuration directory`);
  }
  return target;
}

const targetKeys = harnesses.map((harness) => localPathKey(targets[harness]));

const adapters = Object.fromEntries(
  validHarnesses.map((harness) => [
    harness,
    JSON.parse(readFileSync(join(repoRoot, "adapters", `${harness}.json`), "utf8")),
  ]),
);

function renderFrontmatter(fields) {
  return Object.entries(fields).flatMap(([key, value]) => {
    if (typeof value === "string") return [`${key}: ${JSON.stringify(value)}`];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return [
        `${key}:`,
        ...Object.entries(value).map(([childKey, childValue]) =>
          `  ${childKey}: ${JSON.stringify(childValue)}`,
        ),
      ];
    }
    throw new Error(`Unsupported adapter value for ${key}`);
  });
}

function removeFrontmatterFields(frontmatter, fields) {
  const removed = new Set(fields);
  const output = [];
  let skipping = false;
  for (const line of frontmatter.split(/\r?\n/)) {
    const topLevel = line.match(/^([A-Za-z][A-Za-z0-9_-]*):/);
    if (topLevel) skipping = removed.has(topLevel[1]);
    if (!skipping) output.push(line);
  }
  return output.join("\n").replace(/\n+$/, "");
}

function parseFrontmatter(content, path) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) throw new Error(`${path} has no frontmatter`);
  return match;
}

function applyAdapter(skillPath, harness, skill) {
  const removedFields = adapters[harness].removeFrontmatter?.[skill] ?? [];
  const fields = adapters[harness].frontmatter?.[skill];
  if (!fields && !removedFields.length) return;

  const path = join(skillPath, "SKILL.md");
  const content = readFileSync(path, "utf8");
  const match = parseFrontmatter(content, path);
  const base = removeFrontmatterFields(match[1], removedFields);
  const additions = fields ? renderFrontmatter(fields).join("\n") : "";
  const adaptedFrontmatter = [base, additions].filter(Boolean).join("\n");
  writeFileSync(path, content.replace(match[0], `---\n${adaptedFrontmatter}\n---\n`), "utf8");
}

function validateAdaptedSkill(skillPath, expectedName) {
  const path = join(skillPath, "SKILL.md");
  const frontmatter = parseFrontmatter(readFileSync(path, "utf8"), path)[1];
  const keys = [...frontmatter.matchAll(/^([A-Za-z][A-Za-z0-9_-]*):/gm)].map((match) => match[1]);
  if (new Set(keys).size !== keys.length) throw new Error(`${path} has duplicate frontmatter keys`);
  if (!frontmatter.includes(`name: ${expectedName}`)) throw new Error(`${path} lost its name`);
  if (!/^description:\s*.+$/m.test(frontmatter)) throw new Error(`${path} lost its description`);
}

function copyDirectoryContents(source, target) {
  mkdirSync(target, { recursive: false });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    cpSync(join(source, entry.name), join(target, entry.name), {
      recursive: entry.isDirectory(),
      errorOnExist: true,
      force: false,
    });
  }
}

function validateSourceTree(source) {
  const pending = [source];
  while (pending.length) {
    const current = pending.pop();
    const status = lstatSync(current);
    if (status.isSymbolicLink()) {
      throw new Error(`Installer rejects symbolic links in source trees: ${current}`);
    }
    if (!status.isDirectory()) {
      throw new Error(`Installer source must be a directory: ${current}`);
    }
    for (const entry of readdirSync(current, { withFileTypes: true })) {
      const path = join(current, entry.name);
      if (entry.isSymbolicLink()) {
        throw new Error(`Installer rejects symbolic links in source trees: ${path}`);
      }
      if (entry.isDirectory()) pending.push(path);
      else if (!entry.isFile()) throw new Error(`Installer source contains an unsupported entry: ${path}`);
    }
  }
}

function resolveArtifactSource(name) {
  const configured = artifactRegistry[name].source;
  if (typeof configured !== "string" || configured.trim().length === 0 || isAbsolute(configured)) {
    throw new Error(`Artifact ${name} source must stay within the repository`);
  }
  const source = resolve(repoRoot, configured);
  if (!pathIsWithin(repoRoot, source)) {
    throw new Error(`Artifact ${name} source must stay within the repository`);
  }
  if (!existsSync(source)) throw new Error(`Artifact ${name} source is missing: ${source}`);
  if (!pathIsWithin(realpathSync(repoRoot), realpathSync(source))) {
    throw new Error(`Artifact ${name} source must stay within the repository`);
  }
  return source;
}

const availableSkills = await (await import("node:fs/promises"))
  .readdir(sourceRoot, { withFileTypes: true })
  .then((entries) => entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort());
const hasSkillFilter = args.includes("--skill");
const skillFilter = valueAfter("--skill");
if (hasSkillFilter && (!skillFilter || skillFilter.startsWith("--"))) {
  throw new Error("--skill requires one or more comma-separated skill names");
}
const requestedSkills = hasSkillFilter ? skillFilter.split(",").filter(Boolean) : undefined;
if (requestedSkills?.length === 0) throw new Error("--skill requires at least one skill name");
if (requestedSkills && new Set(requestedSkills).size !== requestedSkills.length) {
  throw new Error(`Duplicate skill in --skill: ${requestedSkills.join(",")}`);
}
const unknownSkills = requestedSkills?.filter((skill) => !availableSkills.includes(skill)) ?? [];
if (unknownSkills.length) throw new Error(`Unknown skill: ${unknownSkills.join(", ")}`);
if (args.includes("--no-skills") && hasSkillFilter) {
  throw new Error("--no-skills cannot be combined with --skill");
}
const skills = args.includes("--no-skills") ? [] : requestedSkills ?? availableSkills;

const hasArtifactFilter = args.includes("--artifact");
const artifactFilter = valueAfter("--artifact");
if (hasArtifactFilter && (!artifactFilter || artifactFilter.startsWith("--"))) {
  throw new Error("--artifact requires one or more comma-separated artifact names");
}
const requestedArtifacts = hasArtifactFilter
  ? artifactFilter === "all"
    ? validArtifacts.filter((name) => artifactRegistry[name].installable !== false)
    : artifactFilter.split(",").filter(Boolean)
  : [];
if (hasArtifactFilter && requestedArtifacts.length === 0) {
  throw new Error("--artifact requires at least one artifact name");
}
if (new Set(requestedArtifacts).size !== requestedArtifacts.length) {
  throw new Error(`Duplicate artifact in --artifact: ${requestedArtifacts.join(",")}`);
}
const unknownArtifacts = requestedArtifacts.filter((name) => !validArtifacts.includes(name));
if (unknownArtifacts.length) throw new Error(`Unknown artifact: ${unknownArtifacts.join(", ")}`);
const unsupportedArtifacts = requestedArtifacts.filter((name) => artifactRegistry[name].installable === false);
if (unsupportedArtifacts.length) {
  const details = unsupportedArtifacts
    .map((name) => `${name}: ${artifactRegistry[name].reason ?? "not installable by this command"}`)
    .join("\n");
  throw new Error(`Unsupported artifact selection:\n${details}`);
}
for (const name of requestedArtifacts) artifactPathParts(name, artifactRegistry[name]);
const artifactSources = Object.fromEntries(
  requestedArtifacts.map((name) => [name, resolveArtifactSource(name)]),
);

const artifactTargets = Object.fromEntries(
  requestedArtifacts.flatMap((name) =>
    harnesses.map((harness) => [`${harness}:${name}`, artifactTarget(name, harness)]),
  ),
);
const rawArtifactPlan = harnesses.flatMap((harness) =>
  requestedArtifacts.map((name) => ({
    kind: "artifact",
    harness,
    name,
    source: artifactSources[name],
    target: artifactTargets[`${harness}:${name}`],
  })),
);
const artifactPlan = [];
const artifactTargetsByPath = new Map();
for (const item of rawArtifactPlan) {
  const key = localPathKey(item.target);
  const existing = artifactTargetsByPath.get(key);
  if (existing) {
    if (existing.name === item.name && existing.source === item.source) continue;
    throw new Error("Selected skills and artifacts resolve to the same target directory");
  }
  artifactTargetsByPath.set(key, item);
  artifactPlan.push(item);
}
const allTargetKeys = [
  ...targetKeys,
  ...artifactPlan.map(({ target }) => localPathKey(target)),
];
if (new Set(allTargetKeys).size !== allTargetKeys.length) {
  throw new Error("Selected skills and artifacts resolve to the same target directory");
}

const plan = [
  ...harnesses.flatMap((harness) =>
    skills.map((skill) => ({
      kind: "skill",
      harness,
      name: skill,
      skill,
      source: join(sourceRoot, skill),
      target: join(targets[harness], skill),
    })),
  ),
  ...artifactPlan,
];
if (plan.length === 0) throw new Error("Nothing selected: choose skills or --artifact");
for (const item of plan) {
  if (dirname(item.target) === item.target) {
    throw new Error(`Install target cannot be a filesystem root: ${item.target}`);
  }
}
for (let left = 0; left < plan.length; left += 1) {
  for (let right = left + 1; right < plan.length; right += 1) {
    if (targetPathsOverlap(plan[left].target, plan[right].target)) {
      throw new Error(
        `Selected install targets overlap: ${plan[left].target} and ${plan[right].target}`,
      );
    }
  }
}
for (const source of new Set(plan.map((item) => item.source))) validateSourceTree(source);
const conflicts = plan.filter(({ target }) => existsSync(target));

for (const harness of harnesses) console.log(`${harness}: ${targets[harness]}`);
for (const item of plan.filter(({ kind }) => kind === "artifact")) {
  console.log(`  artifact ${item.name}: ${item.target}`);
}
if (dryRun) {
  for (const item of plan) {
    const action = existsSync(item.target) ? (replace ? "replace with backup" : "conflict") : "install";
    console.log(`  ${action}: ${item.kind === "skill" ? item.skill : `artifact/${item.name}`}`);
  }
  if (conflicts.length && !replace) process.exitCode = 2;
  else console.log("Dry run complete.");
  process.exit();
}

if (conflicts.length && !replace) {
  throw new Error(
    `Existing skills would be overwritten:\n${conflicts.map(({ target }) => `  ${target}`).join("\n")}\n` +
      "Re-run with --replace to back them up and replace them.",
  );
}

const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const transactionId = `${stamp}-${process.pid}`;
const locks = [];
const stagedPaths = [];
const committed = [];

function rollbackCommitted() {
  const results = [];
  for (const item of [...committed].reverse()) {
    let failed;
    try {
      if (existsSync(item.target)) {
        const failedName = item.kind === "skill" ? item.name : `artifact-${item.harness}-${item.name}`;
        failed = join(dirname(item.target), ".harness-skills-failed", stamp, failedName);
        mkdirSync(dirname(failed), { recursive: true, mode: 0o700 });
        renameSync(item.target, failed);
      }
      if (item.backup) {
        renameSync(item.backup, item.target);
        const retained = failed ? `; failed replacement retained at ${failed}` : "";
        results.push(`${item.target}: restored original${retained}`);
      } else if (failed) {
        results.push(`${item.target}: removed new install; failed replacement retained at ${failed}`);
      } else {
        results.push(`${item.target}: no installed target remained`);
      }
    } catch (rollbackError) {
      const retained = [];
      if (item.backup && existsSync(item.backup)) retained.push(`backup retained at ${item.backup}`);
      if (failed && existsSync(failed)) retained.push(`failed replacement retained at ${failed}`);
      const detail = retained.length ? `; ${retained.join("; ")}` : "";
      results.push(`${item.target}: rollback failed: ${rollbackError.message}${detail}`);
    }
  }
  return results;
}

try {
  const lockRootsByPath = new Map();
  for (const item of plan) {
    const lockRoot = dirname(item.target);
    const key = localPathKey(lockRoot);
    if (!lockRootsByPath.has(key)) lockRootsByPath.set(key, lockRoot);
  }
  const lockRoots = [...lockRootsByPath.values()].sort((left, right) => left.localeCompare(right));
  for (const lockRoot of lockRoots) {
    mkdirSync(lockRoot, { recursive: true });
    const lockPath = join(lockRoot, ".harness-skills-install.lock");
    let descriptor;
    try {
      descriptor = openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if (error.code === "EEXIST") {
        throw new Error(`Another install may be active. Inspect and remove stale lock: ${lockPath}`);
      }
      throw error;
    }
    writeFileSync(descriptor, `${process.pid}\n`, "utf8");
    locks.push({ descriptor, lockPath });
  }

  for (const [index, item] of plan.entries()) {
    mkdirSync(dirname(item.target), { recursive: true });
    const staged = stagingPath(item.target, transactionId, index);
    stagedPaths.push(staged);
    copyDirectoryContents(item.source, staged);
    if (item.kind === "skill") {
      applyAdapter(staged, item.harness, item.skill);
      validateAdaptedSkill(staged, item.skill);
    }
    item.staged = staged;
  }

  for (const item of plan) {
    const { harness, target } = item;
    if (existsSync(target) && !replace) {
      throw new Error(`Refusing to replace ${target} without --replace`);
    }

    let backup;
    if (existsSync(target)) {
      const backupName = item.kind === "skill" ? item.name : `artifact-${item.harness}-${item.name}`;
      backup = join(dirname(target), ".harness-skills-backups", stamp, backupName);
      mkdirSync(dirname(backup), { recursive: true, mode: 0o700 });
      renameSync(target, backup);
    }

    const entry = { ...item, harness, target, backup };
    committed.push(entry);
    mkdirSync(dirname(target), { recursive: true });
    renameSync(item.staged, target);
  }
} catch (error) {
  if (!committed.length) throw error;
  const results = rollbackCommitted();
  throw new Error(`${error.message}\nRollback results:\n${results.join("\n")}`, { cause: error });
} finally {
  for (const staged of stagedPaths) rmSync(staged, { recursive: true, force: true });
  for (const { descriptor, lockPath } of locks.reverse()) {
    closeSync(descriptor);
    if (existsSync(lockPath)) unlinkSync(lockPath);
  }
}

const skillCount = plan.filter(({ kind }) => kind === "skill").length;
const artifactCount = plan.length - skillCount;
console.log(`Installed ${skillCount} skill copies and ${artifactCount} artifact copies; replaced ${conflicts.length}.`);
