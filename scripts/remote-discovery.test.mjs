import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const installer = resolve("scripts/remote-install.mjs");

function fixture(t, targets) {
  const root = mkdtempSync(join(tmpdir(), "mstack-remote-discovery-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const config = join(root, "environments.json");
  const helper = join(root, "transport.mjs");
  const log = join(root, "calls.jsonl");
  writeFileSync(helper, [
    'import { appendFileSync } from "node:fs";',
    'const [mode, ...args] = process.argv.slice(2);',
    'appendFileSync(process.env.MSTACK_TEST_REMOTE_LOG, JSON.stringify({ mode, args }) + "\\n");',
    'const script = args.at(-1) ?? "";',
    'if (mode === "ssh" && script.includes("mktemp -d")) {',
    '  const template = script.match(/mktemp -d \'([^\']+)\'/)?.[1];',
    '  if (!template) process.exit(2);',
    '  console.log(template.replace("XXXXXX", "fixture"));',
    '}',
  ].join("\n"));
  writeFileSync(config, JSON.stringify({
    fleet: {
      transport: "ssh",
      host: "dev@example.invalid",
      targets,
      sshCommand: process.execPath,
      sshArgs: [helper, "ssh"],
      rsyncCommand: process.execPath,
      rsyncArgs: [helper, "rsync"],
    },
  }));
  return {
    run(args) {
      return spawnSync(process.execPath, [installer, "--environment", "fleet", ...args], {
        cwd: resolve("."),
        env: { ...process.env, MSTACK_ENVIRONMENTS_FILE: config, MSTACK_TEST_REMOTE_LOG: log },
        encoding: "utf8",
      });
    },
    calls() {
      return existsSync(log) ? readFileSync(log, "utf8").trim().split("\n").map((line) => JSON.parse(line)) : [];
    },
  };
}

test("remote shared canonical skills are planned once without connecting", (t) => {
  const f = fixture(t, {
    codex: "/home/dev/.agents/skills",
    opencode: "/home/dev/.agents/skills",
    pi: "/home/dev/.agents/skills",
  });
  const result = f.run(["--harness", "codex,opencode,pi", "--skill", "meta-mode", "--dry-run"]);
  assert.equal(result.status, 0, result.stderr);
  assert.match(result.stdout, /Planned 1 skill copies and 0 artifact copies/);
  assert.equal(result.stdout.split("skill/meta-mode ->").length - 1, 1);
  assert.deepEqual(f.calls(), []);
});

test("remote Claude and canonical skill outputs cannot share a destination in either order", (t) => {
  const f = fixture(t, { codex: "/home/dev/shared/skills", claude: "/home/dev/shared/skills" });
  for (const harnesses of ["codex,claude", "claude,codex"]) {
    const result = f.run(["--harness", harnesses, "--skill", "meta-mode", "--dry-run"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Remote target collision/);
  }
  assert.deepEqual(f.calls(), []);
});

test("remote migration is rejected before connecting even in dry run", (t) => {
  const f = fixture(t, { pi: "/home/dev/.agents/skills" });
  for (const extra of [[], ["--dry-run"]]) {
    const result = f.run(["--harness", "pi", "--skill", "meta-mode", "--migrate", ...extra]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /--migrate is not supported over SSH/);
    assert.match(result.stderr, /local installer.*remote machine/);
  }
  assert.deepEqual(f.calls(), []);
});

test("remote discovery at filesystem root is rejected before connecting", (t) => {
  const f = fixture(t, { pi: "/", codex: "/home/dev/shared" });
  const result = f.run(["--harness", "codex", "--skill", "meta-mode", "--replace", "--dry-run"]);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Cannot place skill backups outside remote discovery root/);
  assert.deepEqual(f.calls(), []);
});

test("remote backups escape an unselected declared discovery root", (t) => {
  const f = fixture(t, { pi: "/home/dev/custom/nested", codex: "/home/dev/custom" });
  const result = f.run(["--harness", "pi", "--skill", "meta-mode", "--replace"]);
  assert.equal(result.status, 0, result.stderr);
  const commit = f.calls().find(({ mode, args }) => mode === "ssh" && args.at(-1).includes("; stage="));
  assert.ok(commit);
  assert.match(commit.args.at(-1), /backup='\/home\/dev\/\.mstack-backups\//);
});

for (const skillRoot of ["/home/dev/.agents/skills", "/home/dev/.agents/skills/custom"]) {
  test(`remote shared installation preserves backups outside discovery for ${skillRoot}`, (t) => {
    const f = fixture(t, {
      codex: skillRoot,
      pi: skillRoot,
    });
    const result = f.run(["--harness", "codex,pi", "--skill", "meta-mode", "--replace"]);
    assert.equal(result.status, 0, result.stderr);
    const calls = f.calls();
    assert.equal(calls.filter(({ mode }) => mode === "rsync").length, 1);
    const stages = calls.filter(({ mode, args }) => mode === "ssh" && args.at(-1).includes("mktemp -d"));
    assert.equal(stages.length, 1);
    assert.match(stages[0].args.at(-1), /mktemp -d '\/home\/dev\/\.agents\/\.mstack-stage\.XXXXXX'/);
    assert.doesNotMatch(stages[0].args.at(-1), /skills\//);
    const commits = calls.filter(({ mode, args }) => mode === "ssh" && args.at(-1).includes("; stage="));
    assert.equal(commits.length, 1);
    assert.match(commits[0].args.at(-1), /backup='\/home\/dev\/\.agents\/\.mstack-backups\//);
    assert.doesNotMatch(commits[0].args.at(-1), /skills\/\.mstack-backups/);
  });
}
