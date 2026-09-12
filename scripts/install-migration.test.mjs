import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { planSkillMigration } from "./install-migration.mjs";

const repository = resolve(".");

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "mstack-migration-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const sharedRoot = join(root, ".agents", "skills");
  const claudeRoot = join(root, ".claude", "skills");
  const nativeTargets = { codex: sharedRoot, claude: claudeRoot, opencode: join(root, ".config", "opencode", "skills"), pi: join(root, ".pi", "agent", "skills") };
  const options = { repoRoot: repository, skills: ["meta-mode"], targets: [], nativeTargets, sharedRoot, claudeRoot, migrate: true, replace: true, enabled: true };
  function write(path, content) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  function skill(harness, name = "meta-mode", content = "---\nname: meta-mode\ndescription: Local content\n---\nPreserve this content\n", receipt = true) {
    const path = join(nativeTargets[harness], name);
    write(join(path, "SKILL.md"), content);
    if (receipt) write(join(path, ".mstack-install.json"), JSON.stringify({ package: "@3metajun/mstack", schemaVersion: 1 }));
    return path;
  }
  return { root, options, write, skill, plan: (overrides = {}) => planSkillMigration({ ...options, ...overrides }) };
}

test("recognized receipt copies retire without mutation and partial selection preserves other skills", (t) => {
  const f = fixture(t);
  const pi = f.skill("pi");
  const unrelated = f.skill("pi", "other");
  const opencode = f.skill("opencode");
  const result = f.plan();
  assert.deepEqual(result.retirements.map(({ target }) => target), [opencode, pi]);
  assert.deepEqual(result.adaptations, []);
  for (const path of [pi, opencode, unrelated]) assert.equal(existsSync(join(path, "SKILL.md")), true);
});

test("released content identifies an older copy even with CRLF and no receipt", (t) => {
  const f = fixture(t);
  // https://github.com/3metaJun/mstack/blob/v0.2.0/skills/bro/SKILL.md
  const old = "---\nname: bro\ndescription: Restate the last message in plain human language, with no jargon.\n---\n\nRestate your last message. Stop using jargon and speak coherently. State it more simply and concisely, like one human talking to another.\n";
  const target = f.skill("pi", "bro", old.replaceAll("\n", "\r\n"), false);
  assert.equal(f.plan({ skills: ["bro"] }).retirements[0].target, target);
});

test("unknown local copies reject the whole plan before any mutation", (t) => {
  const f = fixture(t);
  const recognized = f.skill("opencode");
  const unknown = f.skill("pi", "meta-mode", "---\nname: meta-mode\ndescription: My own skill\n---\nLocal\n", false);
  const before = readFileSync(join(unknown, "SKILL.md"), "utf8");
  assert.throws(() => f.plan(), { message: `Cannot migrate unrecognized skill at ${unknown}; preserve or relocate this local copy before retrying` });
  assert.equal(readFileSync(join(unknown, "SKILL.md"), "utf8"), before);
  assert.equal(existsSync(join(recognized, "SKILL.md")), true);
});

test("Claude adaptation uses existing content and skips directly selected destinations", (t) => {
  const f = fixture(t);
  const target = f.skill("claude");
  f.write(join(target, "notes.txt"), "Keep my supporting files");
  assert.deepEqual(f.plan().adaptations, [{ kind: "skill", harness: "claude", name: "meta-mode", skill: "meta-mode", source: target, target }]);
  assert.equal(readFileSync(join(target, "notes.txt"), "utf8"), "Keep my supporting files");
  assert.deepEqual(f.plan({ targets: [{ target }] }).adaptations, []);
});

test("nameless Claude skill does not require migration or a receipt", (t) => {
  const f = fixture(t);
  f.skill("claude", "meta-mode", "---\ndescription: Claude skill\n---\nKeep this\n", false);
  assert.deepEqual(f.plan({ migrate: false, replace: false }), { retirements: [], adaptations: [] });
});

test("migration requires both flags and archives old backup trees outside the selected skill filter", (t) => {
  const f = fixture(t);
  const oldBackup = join(f.options.sharedRoot, ".harness-skills-backups");
  f.write(join(oldBackup, "old-run", "other", "SKILL.md"), "Old content");
  for (const flags of [{ migrate: false }, { replace: false }]) assert.throws(() => f.plan(flags), /--migrate --replace/);
  assert.deepEqual(f.plan().retirements.map(({ target }) => target), [oldBackup]);
  assert.equal(readFileSync(join(oldBackup, "old-run", "other", "SKILL.md"), "utf8"), "Old content");
});

test("disabled discovery migration does not inspect unknown custom copies", (t) => {
  const f = fixture(t);
  f.skill("pi", "meta-mode", "Unrecognized local skill", false);
  assert.deepEqual(f.plan({ enabled: false }), { retirements: [], adaptations: [] });
  assert.deepEqual(f.plan({ skills: [] }), { retirements: [], adaptations: [] });
});

test("digest provenance includes actual released canonical and Claude adapter content", () => {
  const data = JSON.parse(readFileSync(join(repository, "profiles", "legacy-skill-digests.json"), "utf8"));
  assert.deepEqual(data.sources, ["v0.2.0", "v0.2.1", "v0.3.0", "v0.4.0"]);
  for (const name of ["meta-mode", "show-me-your-work"]) {
    const text = readFileSync(join(repository, "skills", name, "SKILL.md"), "utf8").replaceAll("\r\n", "\n");
    const hash = createHash("sha256").update(text).digest("hex");
    assert.equal(data.skills[name].includes(hash), true, name);
  }
  const canonical = readFileSync(join(repository, "skills", "show-me-your-work", "SKILL.md"), "utf8").replaceAll("\r\n", "\n");
  const claude = canonical.replace(
    "metadata:\n  requirements: Node.js 18 or newer for scripts/log.mjs\n",
    'compatibility: "Node.js 18 or newer is required for scripts/log.mjs."\n',
  );
  assert.notEqual(claude, canonical);
  assert.equal(data.skills["show-me-your-work"].includes(createHash("sha256").update(claude).digest("hex")), true);
});

test("native roots physically aliasing shared skills cannot retire canonical copies", (t) => {
  const f = fixture(t);
  const shared = f.skill("codex");
  for (const harness of ["pi", "opencode"]) {
    mkdirSync(dirname(f.options.nativeTargets[harness]), { recursive: true });
    symlinkSync(f.options.sharedRoot, f.options.nativeTargets[harness], process.platform === "win32" ? "junction" : "dir");
  }
  assert.deepEqual(f.plan({ migrate: false, replace: false }), { retirements: [], adaptations: [] });
  assert.equal(existsSync(join(shared, "SKILL.md")), true);
});

test("Claude physical aliases of shared skills require separate directories", (t) => {
  const f = fixture(t);
  f.skill("codex");
  mkdirSync(dirname(f.options.claudeRoot), { recursive: true });
  symlinkSync(f.options.sharedRoot, f.options.claudeRoot, process.platform === "win32" ? "junction" : "dir");
  assert.throws(() => f.plan(), /configure separate directories for Claude and shared skills/);
});

test("physical aliases deduplicate direct targets and Claude discovery roots", (t) => {
  const f = fixture(t);
  const target = f.skill("claude");
  const alias = join(f.root, "claude-alias");
  symlinkSync(f.options.claudeRoot, alias, process.platform === "win32" ? "junction" : "dir");
  assert.equal(f.plan({ externalClaudeRoot: alias }).adaptations.length, 1);
  assert.deepEqual(f.plan({ externalClaudeRoot: alias, targets: [{ target: join(alias, "meta-mode") }] }).adaptations, []);
  assert.equal(existsSync(join(target, "SKILL.md")), true);
});

test("configured Claude root does not hide the external default root from migration", (t) => {
  const f = fixture(t);
  const external = f.skill("claude");
  const configuredRoot = join(f.root, "custom-claude", "skills");
  const configured = join(configuredRoot, "meta-mode");
  f.write(join(configured, "SKILL.md"), "---\nname: meta-mode\ndescription: Configured Claude skill\n---\nKeep configured body\n");
  f.write(join(configured, ".mstack-install.json"), JSON.stringify({ package: "@3metajun/mstack", schemaVersion: 1 }));
  const backup = join(f.options.claudeRoot, ".harness-skills-backups");
  f.write(join(backup, "old", "SKILL.md"), "Preserve external backup");
  const result = f.plan({ claudeRoot: configuredRoot, externalClaudeRoot: f.options.claudeRoot, nativeTargets: { ...f.options.nativeTargets, claude: configuredRoot } });
  assert.deepEqual(result.adaptations.map(({ target }) => target), [configured, external]);
  assert.deepEqual(result.retirements.map(({ target }) => target), [backup]);
});
