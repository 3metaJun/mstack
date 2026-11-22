// Verifies prose skill references, principle references, slash commands, and
// meta-mode's Principles index against the actual skill directories on disk.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = join(repoRoot, "skills");

const skillNames = new Set(
  readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name),
);
const principles = [...skillNames].filter((name) => name.startsWith("principle-")).sort();

// Harness built-ins, CLI flags, POSIX path literals, or external/template slash commands in backticks.
const BUILT_IN_SLASH = new Set([
  "loop", "run", "verify", "command", "goal", "name", "compact", "clear", "hooks",
  "fleet", "add-dir", "resume", "help", "model", "status", "deslop", "in-cloud",
  "add-plugin", "plugin", "skills", "reload", "export", "tmp", "file-pr",
]);

function walkMarkdown(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name === "node_modules") return [];
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walkMarkdown(path);
    return entry.isFile() && path.endsWith(".md") ? [path] : [];
  });
}

function extractReferences(text) {
  const found = [];
  for (const m of text.matchAll(/\bthe \*\*([a-z0-9-]+)\*\* skill\b/g)) {
    found.push({ kind: "skill", name: m[1] });
  }
  for (const m of text.matchAll(/\*\*([a-z0-9-]+)\*\* principle skill\b/g)) {
    found.push({ kind: "principle", name: m[1].startsWith("principle-") ? m[1] : `principle-${m[1]}` });
  }
  for (const m of text.matchAll(/\(\*\*(principle-[a-z0-9-]+)\*\*\)/g)) {
    found.push({ kind: "principle", name: m[1] });
  }
  for (const m of text.matchAll(/`\/([a-z][a-z0-9-]*)`/g)) {
    const name = m[1];
    if (!BUILT_IN_SLASH.has(name) && !name.startsWith("verify-")) {
      found.push({ kind: "slash", name });
    }
  }
  return found;
}

test("every prose skill reference, principle reference, and slash command resolves to a skill directory", () => {
  const dangling = [];
  for (const file of walkMarkdown(skillsRoot)) {
    const content = readFileSync(file, "utf8");
    for (const ref of extractReferences(content)) {
      if (!skillNames.has(ref.name)) {
        dangling.push(`${relative(skillsRoot, file).replaceAll("\\", "/")}: ${ref.kind} ${ref.name}`);
      }
    }
  }
  assert.deepEqual(dangling, []);
});

test("meta-mode's Principles index lists exactly the principle-* skill directories", () => {
  const content = readFileSync(join(skillsRoot, "meta-mode", "SKILL.md"), "utf8").replaceAll("\r\n", "\n");
  const start = content.indexOf("\n## Principles\n");
  assert.ok(start !== -1, "meta-mode must contain a ## Principles section");
  const end = content.indexOf("\n## ", start + 1);
  const section = content.slice(start, end === -1 ? content.length : end);
  const listed = [...section.matchAll(/\(\*\*(principle-[a-z0-9-]+)\*\*\)/g)].map((m) => m[1]).sort();
  assert.deepEqual(listed, principles);
});
