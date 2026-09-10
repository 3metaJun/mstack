import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  renameSync,
} from "node:fs";
import { homedir } from "node:os";
import { join, relative, resolve, sep } from "node:path";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
if (args.includes("--help")) {
  console.log(`Usage: node scripts/reconcile-context.mjs [--apply]

Finds same-name, byte-equivalent skill bundles in ~/.agents/skills and ~/.codex/skills.
Dry-run is the default. With --apply, keeps the universal ~/.agents copy and moves the Codex copy
to ~/.codex/.skill-context-backups/<timestamp>/. Different bundles are never changed.`);
  process.exit(0);
}

const userHome = homedir();
const agentsRoot = resolve(process.env.HARNESS_SKILLS_AGENT_DIR ?? join(userHome, ".agents", "skills"));
const codexHome = resolve(process.env.CODEX_HOME ?? join(userHome, ".codex"));
const codexRoot = join(codexHome, "skills");
const textExtensions = new Set([
  ".css",
  ".csv",
  ".html",
  ".js",
  ".json",
  ".jsx",
  ".md",
  ".mjs",
  ".svg",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

function walkFiles(root) {
  const files = [];
  for (const name of readdirSync(root)) {
    const path = join(root, name);
    const stats = lstatSync(path);
    if (stats.isDirectory()) {
      const nestedFiles = walkFiles(path);
      if (nestedFiles === null) return null;
      files.push(...nestedFiles);
    } else if (stats.isFile()) {
      files.push(path);
    } else {
      return null;
    }
  }
  return files;
}

function extension(path) {
  const name = path.slice(path.lastIndexOf(sep) + 1);
  const dot = name.lastIndexOf(".");
  return dot === -1 ? "" : name.slice(dot).toLowerCase();
}

function treeHash(root) {
  if (!lstatSync(root).isDirectory()) return null;
  const hash = createHash("sha256");
  const files = walkFiles(root);
  if (files === null) return null;
  for (const path of files.sort()) {
    hash.update(relative(root, path).replaceAll("\\", "/"));
    hash.update("\0");
    const content = readFileSync(path);
    hash.update(textExtensions.has(extension(path)) ? content.toString("utf8").replaceAll("\r\n", "\n") : content);
    hash.update("\0");
  }
  return hash.digest("hex");
}

function skillDirectories(root) {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "SKILL.md")))
    .map((entry) => ({ name: entry.name, path: join(root, entry.name) }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

const candidates = [];
const different = [];
for (const codexSkill of skillDirectories(codexRoot)) {
  const agentsSkill = join(agentsRoot, codexSkill.name);
  if (!existsSync(join(agentsSkill, "SKILL.md"))) continue;
  const codexHash = treeHash(codexSkill.path);
  const agentsHash = treeHash(agentsSkill);
  if (codexHash !== null && agentsHash !== null && codexHash === agentsHash) candidates.push(codexSkill);
  else different.push(codexSkill.name);
}

if (different.length) console.log(`Skipped different same-name bundles: ${different.join(", ")}`);
if (!candidates.length) {
  console.log("No exact cross-root duplicates found.");
  process.exit(0);
}

console.log(`${apply ? "Moving" : "Would move"} ${candidates.length} exact duplicate(s) from ${codexRoot}:`);
for (const candidate of candidates) console.log(`  ${candidate.name}`);

if (!apply) {
  console.log("Dry run complete. Re-run with --apply to move these copies into a timestamped backup.");
  process.exit(0);
}

const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const backupRoot = join(codexHome, ".skill-context-backups", stamp);
if (!backupRoot.startsWith(`${codexHome}${sep}`)) throw new Error(`Backup path escaped CODEX_HOME: ${backupRoot}`);
mkdirSync(backupRoot, { recursive: true, mode: 0o700 });
for (const candidate of candidates) {
  const target = join(backupRoot, candidate.name);
  if (existsSync(target)) throw new Error(`Backup target already exists: ${target}`);
  renameSync(candidate.path, target);
}

console.log(`Moved ${candidates.length} duplicate(s) to ${backupRoot}`);
