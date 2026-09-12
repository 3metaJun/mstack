#!/usr/bin/env node

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, posix, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { isDeepStrictEqual } from "node:util";
import { parseRemoteStage, quotePosix, readEnvironment } from "./environment-lib.mjs";
import { artifactPathParts, validateArtifactOverrides } from "./install-paths.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const profilesRoot = join(repoRoot, "profiles");
const harnessRegistry = JSON.parse(readFileSync(join(profilesRoot, "harnesses.json"), "utf8"));
const skillInventory = JSON.parse(readFileSync(join(profilesRoot, "skills.json"), "utf8")).skills;
const artifactRegistry = JSON.parse(readFileSync(join(profilesRoot, "artifacts.json"), "utf8")).artifacts;
const args = process.argv.slice(2);
if (args.includes("--migrate")) {
  throw new Error("--migrate is not supported over SSH; run the local installer with --migrate on the remote machine to inspect and migrate its discovered skill directories.");
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

function requireValue(flag) {
  const value = valueAfter(flag);
  if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
  return value;
}

const requestedHarnesses = requireValue("--harness");
const harnesses = requestedHarnesses === "all" ? Object.keys(harnessRegistry) : requestedHarnesses.split(",");
if (!harnesses.length || harnesses.some((harness) => !Object.hasOwn(harnessRegistry, harness))) {
  throw new Error(`Invalid --harness value: ${requestedHarnesses}`);
}
if (new Set(harnesses).size !== harnesses.length) throw new Error(`Duplicate harness in --harness: ${requestedHarnesses}`);
const adapters = Object.fromEntries(harnesses.map((harness) => [
  harness,
  JSON.parse(readFileSync(join(repoRoot, "adapters", `${harness}.json`), "utf8")),
]));

const environmentName = requireValue("--environment");
const environment = readEnvironment(environmentName, harnesses);
if (environment.transport !== "ssh") {
  throw new Error(`Environment ${environmentName} is not an ssh environment`);
}
if ((environment.shell ?? "posix") !== "posix") {
  throw new Error("Remote installation currently requires a POSIX remote shell; use a mounted target for Windows remotes");
}

const dryRun = args.includes("--dry-run");
const replace = args.includes("--replace");
const hasSkillFilter = args.includes("--skill");
const skillFilter = valueAfter("--skill");
if (hasSkillFilter && (!skillFilter || skillFilter.startsWith("--"))) {
  throw new Error("--skill requires one or more comma-separated skill names");
}
const skills = args.includes("--no-skills")
  ? []
  : hasSkillFilter
    ? skillFilter.split(",").filter(Boolean)
    : skillInventory;
if (hasSkillFilter && new Set(skills).size !== skills.length) throw new Error(`Duplicate skill in --skill: ${skillFilter}`);
const unknownSkills = skills.filter((skill) => !skillInventory.includes(skill));
if (unknownSkills.length) throw new Error(`Unknown skill: ${unknownSkills.join(", ")}`);
if (args.includes("--no-skills") && hasSkillFilter) throw new Error("--no-skills cannot be combined with --skill");

const hasArtifactFilter = args.includes("--artifact");
const artifactFilter = valueAfter("--artifact");
if (hasArtifactFilter && (!artifactFilter || artifactFilter.startsWith("--"))) {
  throw new Error("--artifact requires one or more comma-separated artifact names");
}
const artifacts = hasArtifactFilter
  ? artifactFilter === "all"
    ? Object.keys(artifactRegistry).filter((name) => artifactRegistry[name].installable !== false)
    : artifactFilter.split(",").filter(Boolean)
  : [];
if (hasArtifactFilter && !artifacts.length) throw new Error("--artifact requires at least one artifact name");
if (new Set(artifacts).size !== artifacts.length) throw new Error(`Duplicate artifact in --artifact: ${artifactFilter}`);
const unknownArtifacts = artifacts.filter((name) => !Object.hasOwn(artifactRegistry, name));
if (unknownArtifacts.length) throw new Error(`Unknown artifact: ${unknownArtifacts.join(", ")}`);
const unsupported = artifacts.filter((name) => artifactRegistry[name].installable === false);
if (unsupported.length) throw new Error(`Unsupported artifact selection: ${unsupported.join(", ")}`);
for (const name of artifacts) {
  validateArtifactOverrides(name, artifactRegistry[name], Object.keys(harnessRegistry));
}
const artifactPaths = Object.fromEntries(
  artifacts.map((name) => [name, Object.fromEntries(
    harnesses.map((harness) => [harness, artifactPathParts(name, artifactRegistry[name], harness)]),
  )]),
);

function artifactEnvironmentPath(name, harness) {
  const byArtifact = environment.artifacts?.[name];
  if (byArtifact && typeof byArtifact === "object" && !Array.isArray(byArtifact) && byArtifact[harness]) return byArtifact[harness];
  const byHarness = environment.artifacts?.[harness];
  if (byHarness && typeof byHarness === "object" && !Array.isArray(byHarness) && byHarness[name]) return byHarness[name];
  return undefined;
}

function remoteArtifactTarget(name, harness) {
  const custom = artifactEnvironmentPath(name, harness);
  if (custom) return custom;
  const skillTarget = posix.normalize(environment.targets[harness]);
  const skillParent = posix.dirname(skillTarget);
  const codexHome = artifactRegistry[name].harnesses?.[harness]?.base === "codex-home";
  if (codexHome) {
    if (posix.basename(skillTarget) !== "skills" || ![".agents", ".codex"].includes(posix.basename(skillParent))) {
      throw new Error(
        `Cannot infer remote Codex home from ${skillTarget}; configure environment artifacts.${name}.${harness} explicitly`,
      );
    }
    return posix.join(posix.dirname(skillParent), ".codex", ...artifactPaths[name][harness]);
  }
  return posix.join(skillParent, ...artifactPaths[name][harness]);
}

const requestedItems = harnesses.flatMap((harness) => [
  ...skills.map((skill) => ({
    harness,
    name: skill,
    kind: "skill",
    source: posix.join("skills", skill),
    target: posix.normalize(posix.join(environment.targets[harness], skill)),
  })),
  ...artifacts.map((name) => ({
    harness,
    name,
    kind: "artifact",
    source: artifactRegistry[name].source,
    format: artifactRegistry[name].harnesses?.[harness]?.format ?? "copy",
    target: posix.normalize(remoteArtifactTarget(name, harness)),
  })),
]);
if (!requestedItems.length) throw new Error("Nothing selected: choose skills or --artifact");

for (const item of requestedItems) {
  if (!item.target.startsWith("/") || item.target === "/" || /[\0\r\n]/.test(item.target)) {
    throw new Error(`Remote target must be an absolute POSIX path: ${item.target}`);
  }
}
const items = [];
const targetItems = new Map();
for (const item of requestedItems) {
  const existing = targetItems.get(item.target);
  if (!existing) {
    const overlapping = items.find((selected) =>
      item.target.startsWith(`${selected.target}/`) || selected.target.startsWith(`${item.target}/`));
    if (overlapping) {
      throw new Error(`Remote targets overlap: ${overlapping.target} and ${item.target}`);
    }
    targetItems.set(item.target, item);
    items.push(item);
    continue;
  }
  const sharedArtifact =
    item.kind === "artifact" &&
    existing.kind === "artifact" &&
    item.name === existing.name &&
    item.source === existing.source &&
    item.format === existing.format;
  const sharedSkill =
    item.kind === "skill" &&
    existing.kind === "skill" &&
    item.name === existing.name &&
    item.source === existing.source &&
    item.harness !== "claude" &&
    existing.harness !== "claude" &&
    isDeepStrictEqual(adapters[item.harness], adapters[existing.harness]);
  if (!sharedArtifact && !sharedSkill) {
    throw new Error(
      `Remote target collision: ${item.target} is selected by ` +
        `${existing.kind}/${existing.name} and ${item.kind}/${item.name}`,
    );
  }
}
const itemCounts = {
  skills: items.filter((item) => item.kind === "skill").length,
  artifacts: items.filter((item) => item.kind === "artifact").length,
};

function backupParent(item) {
  if (item.kind !== "skill") return posix.dirname(item.target);
  let root = posix.dirname(item.target);
  for (let parent = root; parent !== posix.dirname(parent); parent = posix.dirname(parent)) {
    // Custom targets may be nested inside a recursively discovered skill root.
    if (["skill", "skills"].includes(posix.basename(parent))) root = parent;
  }
  for (const value of Object.values(environment.targets)) {
    if (typeof value !== "string" || !value.startsWith("/")) continue;
    const declared = posix.normalize(value).replace(/\/$/, "") || "/";
    if (declared === "/" || root === declared || root.startsWith(`${declared}/`)) root = declared;
  }
  if (root === "/") throw new Error(`Cannot place skill backups outside remote discovery root / for ${item.target}`);
  return posix.dirname(root);
}
const backupParents = new Map(items.map((item) => [item.target, backupParent(item)]));

function remoteScript(script, allowFailure = false) {
  const result = spawnSync(
    environment.sshCommand ?? "ssh",
    [...(environment.sshArgs ?? []), environment.host, "--", script],
    { encoding: "utf8", windowsHide: true },
  );
  if (!allowFailure && (result.error || result.status !== 0)) {
    throw new Error(`${result.error?.message ?? result.stderr ?? "ssh command failed"}`.trim());
  }
  return (result.stdout ?? "").trim();
}

if (dryRun) {
  console.log(`ssh environment ${environmentName}: ${environment.host}`);
  for (const item of items) console.log(`  ${replace ? "replace" : "install"}: ${item.kind}/${item.name} -> ${item.target}`);
  console.log(`Planned ${itemCounts.skills} skill copies and ${itemCounts.artifacts} artifact copies.`);
  console.log("Dry run complete. No remote connection was opened.");
  process.exit(0);
}

const localRoot = mkdtempSync(join(tmpdir(), "mstack-remote-install-"));
const childEnv = { ...process.env };
for (const name of Object.keys(childEnv)) {
  if (/^MSTACK_ARTIFACT_.*_DIR$/i.test(name)) delete childEnv[name];
}
for (const harness of harnesses) childEnv[harnessRegistry[harness].directoryVariable] = join(localRoot, harness, "skills");
for (const harness of harnesses) {
  for (const name of artifacts) {
    const variable = `MSTACK_ARTIFACT_${name.replaceAll(/[^A-Za-z0-9]+/g, "_").toUpperCase()}_${harness.toUpperCase()}_DIR`;
    childEnv[variable] = join(localRoot, harness, ...artifactPaths[name][harness]);
  }
}
const localInstallerArgs = [
  join(repoRoot, "scripts", "install.mjs"),
  "--harness", harnesses.join(","),
  "--replace",
  ...(skills.length ? ["--skill", skills.join(",")] : ["--no-skills"]),
  ...(artifacts.length ? ["--artifact", artifacts.join(",")] : []),
];
const staged = spawnSync(process.execPath, localInstallerArgs, { cwd: repoRoot, env: childEnv, encoding: "utf8" });
if (staged.error || staged.status !== 0) {
  rmSync(localRoot, { recursive: true, force: true });
  throw new Error(`${staged.stderr ?? staged.stdout ?? staged.error?.message ?? "local staging failed"}`.trim());
}

const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const locks = [];
const stages = [];
const committed = [];
try {
  const lockRoots = [...new Set(items.map((item) => posix.dirname(item.target)))].sort();
  for (const lockRoot of lockRoots) {
    const lock = posix.join(lockRoot, ".mstack.install.lock");
    const owner = `${stamp}-${process.pid}`;
    remoteScript([
      "set -eu",
      `lock=${quotePosix(lock)}`,
      `owner=${quotePosix(owner)}`,
      `mkdir -p ${quotePosix(lockRoot)}`,
      "if mkdir \"$lock\"; then printf '%s\\n' \"$owner\" > \"$lock/owner\"; else printf 'Remote install lock exists: %s' \"$lock\" >&2; if [ -f \"$lock/owner\" ]; then read -r lock_owner < \"$lock/owner\" || lock_owner=unknown; printf ' (owner: %s)\\n' \"$lock_owner\" >&2; else printf '\\n' >&2; fi; exit 73; fi",
    ].join("; "));
    locks.push(lock);
  }

  for (const item of items) {
    const localSource = item.kind === "skill"
      ? join(localRoot, item.harness, "skills", item.name)
      : join(localRoot, item.harness, ...artifactPaths[item.name][item.harness]);
    if (!existsSync(localSource)) throw new Error(`Staged source is missing: ${localSource}`);
    const parent = item.kind === "skill" ? backupParents.get(item.target) : posix.dirname(item.target);
    const stageOutput = remoteScript(`set -eu; mkdir -p ${quotePosix(parent)}; mktemp -d ${quotePosix(posix.join(parent, ".mstack-stage.XXXXXX"))}`);
    const remoteStage = parseRemoteStage(stageOutput, parent);
    item.stage = remoteStage;
    stages.push(remoteStage);

    const copied = spawnSync(
      environment.rsyncCommand ?? "rsync",
      [...(environment.rsyncArgs ?? []), "-a", `${localSource}/`, `${environment.host}:${remoteStage}/`],
      { cwd: repoRoot, encoding: "utf8", windowsHide: true },
    );
    if (copied.error || copied.status !== 0) throw new Error(`${copied.stderr ?? copied.error?.message ?? "rsync failed"}`.trim());
  }

  for (const [index, item] of items.entries()) {
    const backup = posix.join(
      backupParents.get(item.target),
      ".mstack-backups",
      stamp,
      `${String(index).padStart(4, "0")}-${item.kind}-${item.name}`,
    );
    const target = quotePosix(item.target);
    const stage = quotePosix(item.stage);
    const backupPath = quotePosix(backup);
    const commit = [
      "set -eu",
      `target=${target}`,
      `stage=${stage}`,
      `backup=${backupPath}`,
      "had_backup=0",
      "mkdir -p \"$(dirname \"$target\")\"",
      `if [ -e "$target" ] || [ -L "$target" ]; then ${replace ? `if [ -e "$backup" ] || [ -L "$backup" ]; then echo "Remote backup exists: $backup" >&2; exit 2; fi; mkdir -p ${quotePosix(posix.dirname(backup))}; mv -- "$target" "$backup"; had_backup=1;` : `echo "Remote target exists: $target" >&2; exit 2;`} fi`,
      "if mv -- \"$stage\" \"$target\"; then :; else status=$?; if [ \"$had_backup\" -eq 1 ]; then rm -rf -- \"$target\"; mv -- \"$backup\" \"$target\"; fi; exit \"$status\"; fi",
    ].join("; ");
    remoteScript(commit);
    committed.push({ ...item, backup });
  }
} catch (error) {
  const rollbackErrors = [];
  for (const item of committed.reverse()) {
    const rollback = [
      "set -eu",
      `target=${quotePosix(item.target)}`,
      `backup=${quotePosix(item.backup)}`,
      "rm -rf -- \"$target\"",
      "if [ -e \"$backup\" ] || [ -L \"$backup\" ]; then mkdir -p \"$(dirname \"$target\")\"; mv -- \"$backup\" \"$target\"; fi",
    ].join("; ");
    try {
      remoteScript(rollback);
    } catch (rollbackError) {
      rollbackErrors.push(`${item.target}: ${rollbackError.message}`);
    }
  }
  if (rollbackErrors.length) {
    throw new Error(`${error.message}\nRemote rollback failed:\n${rollbackErrors.join("\n")}`);
  }
  throw error;
} finally {
  for (const stage of stages) remoteScript(`rm -rf ${quotePosix(stage)}`, true);
  for (const lock of locks) {
    remoteScript(`rm -f ${quotePosix(posix.join(lock, "owner"))}; rmdir ${quotePosix(lock)}`, true);
  }
  rmSync(localRoot, { recursive: true, force: true });
}

console.log(`Installed ${itemCounts.skills} skill copies and ${itemCounts.artifacts} artifact copies on ${environment.host}.`);
