import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const installer = resolve("scripts", "install.mjs");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "harness skills 测试-"));
  return {
    root,
    env: {
      ...process.env,
      HARNESS_SKILLS_CODEX_DIR: join(root, "codex skills"),
      HARNESS_SKILLS_CLAUDE_DIR: join(root, "claude skills"),
      HARNESS_SKILLS_OPENCODE_DIR: join(root, "opencode skills"),
    },
  };
}

function run(arguments_, env) {
  return spawnSync(process.execPath, [installer, ...arguments_], {
    cwd: resolve("."),
    env,
    encoding: "utf8",
  });
}

test("dry-run reports a plan without creating target directories", () => {
  const { root, env } = fixture();
  try {
    const result = run(["--harness", "all", "--dry-run"], env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /install: show-me-your-work/);
    assert.equal(existsSync(env.HARNESS_SKILLS_CODEX_DIR), false);
    assert.equal(existsSync(env.HARNESS_SKILLS_CLAUDE_DIR), false);
    assert.equal(existsSync(env.HARNESS_SKILLS_OPENCODE_DIR), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("installs harness-specific frontmatter and preserves conflicts", () => {
  const { root, env } = fixture();
  try {
    const first = run(["--harness", "all"], env);
    assert.equal(first.status, 0, first.stderr);

    const codexPath = join(env.HARNESS_SKILLS_CODEX_DIR, "show-me-your-work", "SKILL.md");
    const claudePath = join(env.HARNESS_SKILLS_CLAUDE_DIR, "show-me-your-work", "SKILL.md");
    const opencodePath = join(env.HARNESS_SKILLS_OPENCODE_DIR, "show-me-your-work", "SKILL.md");
    const codex = readFileSync(codexPath, "utf8");
    const claude = readFileSync(claudePath, "utf8");
    const opencode = readFileSync(opencodePath, "utf8");
    assert.match(codex, /^metadata:/m);
    assert.doesNotMatch(codex, /^compatibility:/m);
    for (const adapted of [claude, opencode]) {
      assert.match(adapted, /^compatibility:/m);
      assert.doesNotMatch(adapted, /^metadata:/m);
      assert.doesNotMatch(adapted, /The included logger requires/i);
    }

    const marker = join(env.HARNESS_SKILLS_CODEX_DIR, "blast-radius", "marker.txt");
    writeFileSync(marker, "keep me", "utf8");
    const conflict = run(["--harness", "codex"], env);
    assert.notEqual(conflict.status, 0);
    assert.equal(readFileSync(marker, "utf8"), "keep me");

    const replaced = run(["--harness", "codex", "--replace"], env);
    assert.equal(replaced.status, 0, replaced.stderr);
    assert.equal(existsSync(marker), false);
    const backupRoot = join(root, ".harness-skills-backups");
    const backupMarker = findFile(backupRoot, "marker.txt");
    assert.equal(readFileSync(backupMarker, "utf8"), "keep me");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects duplicate harnesses and aliased target roots", () => {
  const duplicateFixture = fixture();
  const aliasFixture = fixture();
  try {
    const duplicate = run(["--harness", "codex,codex"], duplicateFixture.env);
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /Duplicate harness/);

    aliasFixture.env.HARNESS_SKILLS_CLAUDE_DIR = aliasFixture.env.HARNESS_SKILLS_CODEX_DIR;
    const alias = run(["--harness", "codex,claude"], aliasFixture.env);
    assert.notEqual(alias.status, 0);
    assert.match(alias.stderr, /same target directory/);
  } finally {
    rmSync(duplicateFixture.root, { recursive: true, force: true });
    rmSync(aliasFixture.root, { recursive: true, force: true });
  }
});

function findFile(root, name) {
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(path, name);
      if (found) return found;
    } else if (entry.name === name) {
      return path;
    }
  }
  return undefined;
}
