import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const cli = resolve(dirname(fileURLToPath(import.meta.url)), "skill-baseline.mjs");

function write(root, path, value) {
  const file = join(root, path);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, value);
}

function json(root, path, value) {
  write(root, path, `${JSON.stringify(value, null, 2)}\n`);
}

function commit(root) {
  const git = (args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git(["init", "--quiet"]);
  git(["add", "."]);
  git(["-c", "user.name=Skill Test", "-c", "user.email=skill-test@example.invalid", "commit", "--quiet", "-m", "fixture"]);
  return git(["rev-parse", "HEAD"]);
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "mstack-skill-baseline-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const target = join(root, "target");
  const pstack = join(root, "pstack");
  const matt = join(root, "matt");
  write(pstack, "skills/poteto-mode/SKILL.md", "# Original workflow\n\nRead the full reference before acting.\n");
  write(pstack, "skills/poteto-mode/references/recipe.md", "# Recipe\n\nPrepare a fixture.\nRun the command.\nInspect the saved result.\n");
  write(matt, "skills/engineering/diagnosis/SKILL.md", "# Diagnosis\n\nReproduce the exact user symptom.\n");
  write(matt, "skills/engineering/diagnosis/DETAILS.md", "# Details\n\nA complete diagnostic recipe.\n");
  write(matt, "skills/engineering/diagnosis/agents/openai.yaml", "display_name: Diagnosis\n");
  const pins = {
    pstack: { commit: commit(pstack), renames: { "poteto-mode": "meta-mode" } },
    "mattpocock/skills": { commit: commit(matt) },
  };
  json(target, "profiles/upstreams.json", pins);
  json(target, "profiles/skills.json", { skills: ["diagnosis", "meta-mode"] });
  const mappings = {
    pstack: { root: "skills" },
    "mattpocock/skills": {
      skills: { "skills/engineering/diagnosis": "diagnosis" },
      moves: { "skills/engineering/diagnosis/DETAILS.md": { target: "skills/diagnosis/references/details.md", reason: "Reference organization" } },
      omit: { "skills/engineering/diagnosis/agents/openai.yaml": "Harness-specific display metadata" },
    },
  };
  json(target, "profiles/skill-sources.json", mappings);
  write(target, "skills/meta-mode/SKILL.md", "# Portable workflow\n\nRead the full reference before acting.\n");
  write(target, "skills/meta-mode/references/recipe.md", "# Recipe\n\nPrepare a fixture.\nRun the command.\nInspect the saved result.\n");
  write(target, "skills/diagnosis/SKILL.md", "# Diagnosis\n\nReproduce the exact user symptom.\n");
  write(target, "skills/diagnosis/references/details.md", "# Details\n\nA complete diagnostic recipe.\n");
  write(target, "skills/meta-mode/references/harness.md", "# Local adapter\n\nDiscover the active Harness.\n");
  const run = (...args) => spawnSync(process.execPath, [cli, "--target", target, ...args], {
    encoding: "utf8",
    env: { ...process.env, MSTACK_PSTACK_SOURCE: "", MSTACK_MATT_SOURCE: "" },
  });
  const sources = ["--source", pstack, "--matt-source", matt];
  const record = () => {
    const result = run(...sources, "--write");
    assert.equal(result.status, 0, result.stderr);
    return readFileSync(join(target, "profiles/skill-manifest.json"), "utf8");
  };
  return { root, target, pstack, matt, pins, mappings, run, sources, record };
}

test("review previews adaptation patches and omissions without writing; explicit refresh is repeatable", (t) => {
  const f = fixture(t);
  const preview = f.run(...f.sources, "--diff");
  assert.equal(preview.status, 0, preview.stderr);
  assert.match(preview.stdout, /-# Original workflow/);
  assert.match(preview.stdout, /\+# Portable workflow/);
  assert.match(preview.stdout, /Local addition: skills\/meta-mode\/references\/harness.md/);
  assert.match(preview.stdout, /Omitted: mattpocock\/skills:skills\/engineering\/diagnosis\/agents\/openai.yaml/);
  assert.equal(existsSync(join(f.target, "profiles/skill-manifest.json")), false);
  const first = f.record();
  assert.equal(f.record(), first);
  const checked = f.run(...f.sources, "--check");
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /5 tracked files, 1 explicit omissions, 0 baseline changes/);
});

test("local checks detect truncated references, deleted moved files, and untracked additions", (t) => {
  const f = fixture(t);
  f.record();
  write(f.target, "skills/meta-mode/references/recipe.md", "# Recipe\n");
  rmSync(join(f.target, "skills/diagnosis/references/details.md"));
  write(f.target, "skills/diagnosis/new.md", "# Unreviewed instruction\n");
  const result = f.run("--check");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /skills\/meta-mode\/references\/recipe.md: target content changed/);
  assert.match(result.stderr, /skills\/diagnosis\/references\/details.md: target file missing/);
  assert.match(result.stderr, /skills\/diagnosis\/new.md: untracked skill file/);
});

test("refresh refuses to bless a deleted source-mapped file and preserves the previous manifest", (t) => {
  const f = fixture(t);
  const before = f.record();
  rmSync(join(f.target, "skills/meta-mode/references/recipe.md"));
  const result = f.run(...f.sources, "--write");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing target skills\/meta-mode\/references\/recipe.md/);
  assert.equal(readFileSync(join(f.target, "profiles/skill-manifest.json"), "utf8"), before);
});

test("both sources must be present, clean and pinned before refreshing", (t) => {
  const f = fixture(t);
  const before = f.record();
  const missing = f.run("--source", f.pstack, "--write");
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Missing source checkout for mattpocock\/skills/);
  write(f.matt, "skills/engineering/diagnosis/DETAILS.md", "# Changed source\n");
  const dirty = f.run(...f.sources, "--write");
  assert.notEqual(dirty.status, 0);
  assert.match(dirty.stderr, /mattpocock\/skills: source checkout has tracked or untracked changes/);
  commit(f.matt);
  const wrongPin = f.run(...f.sources, "--write");
  assert.notEqual(wrongPin.status, 0);
  assert.match(wrongPin.stderr, /source checkout does not match pinned commit/);
  assert.equal(readFileSync(join(f.target, "profiles/skill-manifest.json"), "utf8"), before);
});

test("an upstream addition needs a restored target or an explicit reviewed omission", (t) => {
  const f = fixture(t);
  f.record();
  const added = "skills/engineering/diagnosis/NEW.md";
  write(f.matt, added, "# New upstream workflow\n");
  f.pins["mattpocock/skills"].commit = commit(f.matt);
  json(f.target, "profiles/upstreams.json", f.pins);
  const result = f.run(...f.sources, "--write");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /missing target skills\/diagnosis\/NEW.md/);
  f.mappings["mattpocock/skills"].omit[added] = "Replaced by the existing local diagnosis workflow";
  json(f.target, "profiles/skill-sources.json", f.mappings);
  f.record();
  const checked = f.run(...f.sources, "--check");
  assert.equal(checked.status, 0, checked.stderr);
  assert.match(checked.stdout, /2 explicit omissions/);
});

test("checks require a valid manifest and reject path escapes before reading outside the checkout", (t) => {
  const f = fixture(t);
  const missing = f.run("--check");
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /Missing skill baseline/);
  const manifest = JSON.parse(f.record());
  manifest.files["../outside.md"] = manifest.files["skills/diagnosis/SKILL.md"];
  json(f.target, "profiles/skill-manifest.json", manifest);
  const result = f.run("--check");
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Invalid checkout-relative path: \.\.\/outside.md/);
  const badArgument = f.run("--source", "--write");
  assert.notEqual(badArgument.status, 0);
  assert.match(badArgument.stderr, /--source requires a value/);
});
