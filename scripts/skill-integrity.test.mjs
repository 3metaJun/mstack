import assert from "node:assert/strict";
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = join(repoRoot, "skills");

function readSkill(name) {
  return readFileSync(join(skillsRoot, name, "SKILL.md"), "utf8");
}

function walkMarkdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walkMarkdownFiles(path);
    return entry.isFile() && path.endsWith(".md") ? [path] : [];
  });
}

test("meta-mode retains the workflow contract after portability adaptation", () => {
  const content = readSkill("meta-mode");
  for (const heading of [
    "## Non-negotiables",
    "## Principles",
    "## Autonomy",
    "## Subagents",
    "## Writing the reply",
    "## Comments",
    "## Playbooks",
  ]) {
    assert.match(content, new RegExp(`^${heading}$`, "m"));
  }
  assert.doesNotMatch(content, /(?:poteto|Cursor|AskQuestion|subagent_type|run_in_background|disable-model-invocation|prethe current)/i);
});

test("meta-agent points to an existing complete entry skill", () => {
  const agent = readFileSync(join(repoRoot, "agents", "meta-agent.md"), "utf8");
  assert.match(agent, /`meta-mode` skill's `SKILL\.md`/);
  assert.match(readSkill("meta-mode"), /^## Principles$/m);
});

test("portable skill files contain no broken replacement artifacts", () => {
  const forbidden = [
    /prethe current harness/i,
    /(?:poteto-mode|setup-pstack|poteto-agent)/i,
    /worker type:\s*generalPurpose/i,
    /cursor/i,
    /application support\/the current harness/i,
  ];
  const skillDirectories = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(skillsRoot, entry.name));
  const skillFiles = skillDirectories.map((directory) => join(directory, "SKILL.md"));
  assert.equal(
    skillFiles.filter((path) => existsSync(path)).length,
    skillDirectories.length,
    "every skill directory must contain SKILL.md",
  );
  const files = skillDirectories.flatMap(walkMarkdownFiles);
  assert.ok(files.length >= skillFiles.length, "integrity scan must include every skill markdown file");
  for (const path of files) {
    const content = readFileSync(path, "utf8");
    const normalized = content.replaceAll("`", "").replace(/\s+/g, " ");
    for (const pattern of forbidden) {
      assert.doesNotMatch(normalized, pattern, `${path} contains ${pattern}`);
    }
  }
});
