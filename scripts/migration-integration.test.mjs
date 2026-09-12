import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const installer = resolve("scripts", "install.mjs");
const canonical = readFileSync(resolve("skills", "meta-mode", "SKILL.md"), "utf8");

function snapshot(root) {
  const result = {};
  function visit(path) {
    for (const entry of readdirSync(path, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
      const child = join(path, entry.name);
      result[relative(root, child)] = entry.isDirectory() ? null : readFileSync(child, "utf8");
      if (entry.isDirectory()) visit(child);
    }
  }
  visit(root);
  return result;
}

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "mstack-migration-integration-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
    !/^(HARNESS_SKILLS_|MSTACK_|CLAUDE_|CODEX_|PI_CODING_AGENT_DIR$|XDG_|NODE_OPTIONS$)/i.test(key)));
  Object.assign(env, { HOME: root, USERPROFILE: root, APPDATA: join(root, "appdata"), LOCALAPPDATA: join(root, "localappdata") });
  const roots = {
    shared: join(root, ".agents", "skills"),
    claude: join(root, ".claude", "skills"),
    opencode: join(root, ".config", "opencode", "skills"),
    pi: join(root, ".pi", "agent", "skills"),
  };
  function write(path, content) {
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(path, content);
  }
  function installOld(harness, { content = canonical, receipt = false, name = "meta-mode" } = {}) {
    const path = join(roots[harness], name);
    write(join(path, "SKILL.md"), content);
    write(join(path, "local-support.txt"), `${harness} supporting content`);
    if (receipt) write(join(path, ".mstack-install.json"), JSON.stringify({ package: "@3metajun/mstack", schemaVersion: 1 }));
    return path;
  }
  function run(flags = []) {
    return spawnSync(process.execPath, [installer, "--harness", "codex", "--skill", "meta-mode", "--replace", ...flags], { cwd: root, env, encoding: "utf8" });
  }
  return { root, roots, write, installOld, run };
}

test("migration dry-run leaves the isolated home unchanged", (t) => {
  const f = fixture(t);
  f.installOld("opencode");
  f.installOld("pi");
  f.installOld("claude");
  const before = snapshot(f.root);
  const result = f.run(["--migrate", "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /migrate to backup outside skills/);
  assert.deepEqual(snapshot(f.root), before);
});

test("migration retires redundant copies and old backups while preserving partial Claude content", (t) => {
  const f = fixture(t);
  const opencode = f.installOld("opencode");
  const pi = f.installOld("pi");
  const claudeContent = "---\nname: meta-mode\ndescription: Locally configured Claude workflow\n---\nKeep this local body.\n";
  const claude = f.installOld("claude", { content: claudeContent, receipt: true });
  const unselected = f.installOld("pi", { name: "local-only", content: "Preserve this unrelated skill" });
  f.write(join(unselected, "local-support.txt"), "Unselected supporting content");
  const oldBackup = join(f.roots.shared, ".harness-skills-backups");
  f.write(join(oldBackup, "old", "meta-mode", "SKILL.md"), "Historical backup");
  const result = f.run(["--migrate"]);
  assert.equal(result.status, 0, result.stderr);
  for (const path of [opencode, pi, oldBackup]) assert.equal(existsSync(path), false, path);
  assert.equal(readFileSync(join(unselected, "SKILL.md"), "utf8"), "Preserve this unrelated skill");
  assert.equal(readFileSync(join(claude, "SKILL.md"), "utf8"), claudeContent.replace("name: meta-mode\n", ""));
  assert.equal(readFileSync(join(claude, "local-support.txt"), "utf8"), "claude supporting content");
  assert.equal(readFileSync(join(f.roots.shared, "meta-mode", "SKILL.md"), "utf8"), canonical);
  const files = snapshot(f.root);
  for (const content of ["opencode supporting content", "pi supporting content", "Historical backup"]) {
    const matches = Object.entries(files).filter(([, value]) => value === content);
    assert.equal(matches.length, 1, content);
    assert.match(matches[0][0], /\.harness-skills-backups/);
    for (const root of Object.values(f.roots)) {
      assert.equal(join(f.root, matches[0][0]).startsWith(`${root}\\`) || join(f.root, matches[0][0]).startsWith(`${root}/`), false);
    }
  }
  const again = f.run();
  assert.equal(again.status, 0, again.stderr);
  assert.match(again.stdout, /retired 0 legacy entries/);
});

test("unrecognized legacy copy prevents shared installation and all migration writes", (t) => {
  const f = fixture(t);
  f.installOld("opencode");
  const unknown = f.installOld("pi", { content: "---\nname: meta-mode\ndescription: Unrelated workflow\n---\nMine\n" });
  const before = snapshot(f.root);
  const result = f.run(["--migrate"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cannot migrate unrecognized skill/);
  assert.ok(result.stderr.includes(unknown));
  assert.deepEqual(snapshot(f.root), before);
});

test("a later retirement failure restores previously retired copies and Claude content", (t) => {
  const f = fixture(t);
  const opencode = f.installOld("opencode");
  const pi = f.installOld("pi");
  const claude = f.installOld("claude");
  f.write(join(dirname(f.roots.pi), ".harness-skills-backups"), "Block the later pi backup directory");
  const result = f.run(["--migrate"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Rollback results:/);
  assert.ok(result.stdout.includes(`backup: ${opencode} ->`), "OpenCode retirement must have committed before the injected failure");
  for (const [harness, target] of [["opencode", opencode], ["pi", pi], ["claude", claude]]) {
    assert.equal(readFileSync(join(target, "SKILL.md"), "utf8"), canonical);
    assert.equal(readFileSync(join(target, "local-support.txt"), "utf8"), `${harness} supporting content`);
  }
  assert.equal(existsSync(join(f.roots.shared, "meta-mode")), false);
});

test("migration archives authenticated crashed stages and preserves unselected or empty stages", (t) => {
  const f = fixture(t);
  const localStage = join(f.roots.shared, ".harness-skills-stage-old-0");
  const remoteStage = join(f.roots.opencode, ".mstack-stage.old");
  const unselectedStage = join(f.roots.pi, ".mstack-stage.unselected");
  const emptyStage = join(f.roots.shared, ".harness-skills-stage-empty");
  f.write(join(localStage, "SKILL.md"), canonical);
  f.write(join(localStage, "support.txt"), "Preserve crashed local support");
  f.write(join(remoteStage, "SKILL.md"), "---\nname: meta-mode\ndescription: Customized installed copy\n---\nRemote stage body\n");
  f.write(join(remoteStage, ".mstack-install.json"), JSON.stringify({ package: "@3metajun/mstack", schemaVersion: 1 }));
  f.write(join(unselectedStage, "SKILL.md"), "---\nname: local-only\ndescription: Unselected staged skill\n---\nUnselected\n");
  f.write(join(emptyStage, "partial.txt"), "No discoverable skill");
  const result = f.run(["--migrate"]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(existsSync(localStage), false);
  assert.equal(existsSync(remoteStage), false);
  assert.equal(existsSync(join(unselectedStage, "SKILL.md")), true);
  assert.equal(readFileSync(join(emptyStage, "partial.txt"), "utf8"), "No discoverable skill");
  const files = snapshot(f.root);
  const retainedSupport = Object.entries(files).filter(([, content]) => content === "Preserve crashed local support");
  assert.equal(retainedSupport.length, 1);
  assert.match(retainedSupport[0][0], /\.harness-skills-backups/);
  const again = f.run();
  assert.equal(again.status, 0, again.stderr);
});

test("unrecognized selected crashed stage rejects migration before any write", (t) => {
  const f = fixture(t);
  f.installOld("opencode");
  const stage = join(f.roots.shared, ".harness-skills-stage-unknown");
  f.write(join(stage, "SKILL.md"), "---\nname: meta-mode\ndescription: Unrecognized staged copy\n---\nKeep mine\n");
  const before = snapshot(f.root);
  const result = f.run(["--migrate"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cannot migrate unrecognized staged skill/);
  assert.ok(result.stderr.includes(stage));
  assert.deepEqual(snapshot(f.root), before);
});
