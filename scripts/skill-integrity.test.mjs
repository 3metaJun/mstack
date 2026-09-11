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
  ];
  const files = readdirSync(skillsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(skillsRoot, entry.name, "SKILL.md"))
    .filter((path) => existsSync(path));
  for (const path of files) {
    const content = readFileSync(path, "utf8");
    for (const pattern of forbidden) {
      assert.doesNotMatch(content, pattern, `${path} contains ${pattern}`);
    }
  }
});
