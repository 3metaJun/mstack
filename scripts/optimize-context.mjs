import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const args = process.argv.slice(2);
const apply = args.includes("--apply");
if (args.includes("--help")) {
  console.log(`Usage: node scripts/optimize-context.mjs [--apply] [--profile PATH]

Applies a declarative Codex context profile to user-level skills. Dry-run is the default.
The profile can make skills explicit-only and replace frontmatter descriptions.`);
  process.exit(0);
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

const skillsRoot = resolve(process.env.HARNESS_SKILLS_AGENT_DIR ?? join(homedir(), ".agents", "skills"));
const profilePath = resolve(valueAfter("--profile") ?? join(repoRoot, "profiles", "codex-context.json"));
const profile = JSON.parse(readFileSync(profilePath, "utf8"));
const changes = [];
const missing = [];

function skillRoot(name) {
  const root = resolve(skillsRoot, name);
  if (!root.startsWith(`${skillsRoot}${sep}`) && root !== skillsRoot) throw new Error(`Skill escaped root: ${name}`);
  if (!existsSync(join(root, "SKILL.md"))) {
    missing.push(name);
    return undefined;
  }
  return root;
}

function withExplicitOnly(content) {
  if (/^\s*allow_implicit_invocation:\s*false\s*$/m.test(content)) return content;
  if (/^\s*allow_implicit_invocation:\s*true\s*$/m.test(content)) {
    return content.replace(/^(\s*allow_implicit_invocation:)\s*true\s*$/m, "$1 false");
  }
  if (/^policy:\s*$/m.test(content)) {
    return content.replace(/^policy:\s*$/m, "policy:\n  allow_implicit_invocation: false");
  }
  return `${content.replace(/\s*$/, "")}\n\npolicy:\n  allow_implicit_invocation: false\n`;
}

function withDescription(content, description, path) {
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!frontmatter) throw new Error(`${path} has no YAML frontmatter`);
  const lines = frontmatter[1].split(/\r?\n/);
  const start = lines.findIndex((line) => /^description:/.test(line));
  if (start === -1) throw new Error(`${path} has no description`);
  let end = start + 1;
  while (end < lines.length && !/^[A-Za-z][A-Za-z0-9_-]*:/.test(lines[end])) end += 1;
  const replacement = [`description: ${JSON.stringify(description)}`];
  lines.splice(start, end - start, ...replacement);
  return content.replace(frontmatter[0], `---\n${lines.join("\n")}\n---\n`);
}

for (const name of profile.explicitOnly ?? []) {
  const root = skillRoot(name);
  if (!root) continue;
  const path = join(root, "agents", "openai.yaml");
  const before = existsSync(path) ? readFileSync(path, "utf8") : "";
  const after = withExplicitOnly(before);
  if (after === before) continue;
  changes.push({ kind: "explicit-only", name, path, before, after });
}

for (const [name, description] of Object.entries(profile.descriptionOverrides ?? {})) {
  const root = skillRoot(name);
  if (!root) continue;
  const path = join(root, "SKILL.md");
  const before = readFileSync(path, "utf8");
  const after = withDescription(before, description, path);
  if (after === before) continue;
  changes.push({ kind: "description", name, path, before, after });
}

if (missing.length) console.log(`Missing skills: ${[...new Set(missing)].sort().join(", ")}`);
if (!changes.length) {
  console.log("Context profile is already applied.");
  process.exit(0);
}

console.log(`${apply ? "Applying" : "Would apply"} ${changes.length} change(s):`);
for (const change of changes) console.log(`  ${change.kind}: ${change.name}`);
if (!apply) {
  console.log("Dry run complete. Re-run with --apply to write these changes.");
  process.exit(0);
}

for (const change of changes) {
  mkdirSync(dirname(change.path), { recursive: true });
  writeFileSync(change.path, change.after, "utf8");
}
console.log(`Applied ${changes.length} context optimization(s).`);
