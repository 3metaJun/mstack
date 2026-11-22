// Pins counts stated in README.md to the live repository tree so docs cannot silently drift.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readme = readFileSync(join(repoRoot, "README.md"), "utf8");
const skills = readdirSync(join(repoRoot, "skills"), { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name);
const principles = skills.filter((name) => name.startsWith("principle-"));
const playbooks = readdirSync(join(repoRoot, "skills", "meta-mode", "playbooks"), { withFileTypes: true })
  .filter((entry) => entry.isFile() && entry.name.endsWith(".md"));

test("README.md total skill count matches skills/", () => {
  const matches = [...readme.matchAll(/\b(\d+) skills\b/g)].map((m) => Number(m[1]));
  assert.ok(matches.length > 0, "expected README.md to state the skill count");
  for (const count of matches) assert.equal(count, skills.length);
});

test("README.md principle count matches principle-* skill directories", () => {
  const matches = [...readme.matchAll(/\b(\d+) engineering principles\b/g)].map((m) => Number(m[1]));
  assert.ok(matches.length > 0, "expected README.md to state the principle count");
  for (const count of matches) assert.equal(count, principles.length);
});

test("README.md playbook count matches skills/meta-mode/playbooks/", () => {
  const matches = [...readme.matchAll(/\b(\d+) playbooks\b/g)].map((m) => Number(m[1]));
  assert.ok(matches.length > 0, "expected README.md to state the playbook count");
  for (const count of matches) assert.equal(count, playbooks.length);
});
