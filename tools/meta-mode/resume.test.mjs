import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdtempSync, readFileSync, readdirSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Resolve relative to this file so the test works from any cwd, including `bun test` inside tools/meta-mode.
const script = fileURLToPath(new URL("./resume.mjs", import.meta.url));

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8" }).trim();
}
function repo(t) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "mstack-resume-")));
  git(root, "init", "-q");
  git(root, "config", "user.name", "Test User");
  git(root, "config", "user.email", "test@example.test");
  writeFileSync(join(root, "note.md"), "next: verify the release\n");
  writeFileSync(join(root, "artifact.txt"), "evidence\n");
  git(root, "add", ".");
  git(root, "commit", "-q", "-m", "fixture");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
// Every checkpoint directory under the common Git dir, one per worktree.
function stores(root) {
  const base = join(resolve(root, git(root, "rev-parse", "--git-common-dir")), "mstack", "resume");
  return existsSync(base) ? readdirSync(base).map((key) => join(base, key)) : [];
}
function run(root, ...args) {
  return spawnSync(process.execPath, [script, ...args, "--project", root], { encoding: "utf8" });
}

test("begin, publish, and read persist a useful checkpoint in Git storage", (t) => {
  const root = repo(t);
  const begun = run(root, "begin", "--id", "handoff", "--note", "note.md", "--artifact", "artifact.txt");
  assert.equal(begun.status, 0, begun.stderr);
  const draft = join(stores(root)[0], "handoff.draft.json");
  assert.equal(existsSync(draft), true);
  assert.equal(JSON.parse(readFileSync(draft)).state, "draft");
  const published = run(root, "publish", "--id", "handoff");
  assert.equal(published.status, 0, published.stderr);
  assert.equal(existsSync(draft), false);
  const record = JSON.parse(published.stdout);
  assert.equal(record.state, "published");
  assert.equal(record.note, "note.md");
  const read = run(root, "read", "--id", "handoff");
  assert.equal(read.status, 0, read.stderr);
  const result = JSON.parse(read.stdout);
  assert.equal(result.artifacts[0], "artifact.txt");
  assert.equal(result.filesOk, true);
  assert.deepEqual(result.files.map((file) => [file.path, file.status]), [["note.md", "ok"], ["artifact.txt", "ok"]]);
});

test("rejects unsafe paths, missing identity, and unpublishable notes", (t) => {
  const root = repo(t);
  let result = run(root, "begin", "--id", "bad", "--note", "../note.md");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /inside the project worktree/);
  git(root, "config", "user.email", "");
  result = run(root, "begin", "--id", "bad", "--note", "note.md");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Git identity is incomplete/);
  git(root, "config", "user.email", "test@example.test");
  assert.equal(run(root, "begin", "--id", "missing", "--note", "note.md").status, 0);
  rmSync(join(root, "note.md"));
  result = run(root, "publish", "--id", "missing");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Note does not exist/);
});

test("rejects traversal ids at publish and read boundaries", (t) => {
  const root = repo(t);
  assert.equal(run(root, "begin", "--id", "safe", "--note", "note.md").status, 0);
  let result = run(root, "publish", "--id", "../escape");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Resume id must contain/);
  result = run(root, "read", "--id", "../escape");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Resume id must contain/);
});

test("does not expose a draft through read", (t) => {
  const root = repo(t);
  assert.equal(run(root, "begin", "--id", "draft-only", "--note", "note.md").status, 0);
  const result = run(root, "read", "--id", "draft-only");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No published resume/);
});

test("read and publish work without a Git identity; only begin needs one", (t) => {
  const root = repo(t);
  assert.equal(run(root, "begin", "--id", "anon", "--note", "note.md").status, 0);
  git(root, "config", "user.name", "");
  git(root, "config", "user.email", "");
  // A global or system identity must not mask the missing local one.
  const env = { ...process.env, GIT_CONFIG_GLOBAL: join(root, "no-global"), GIT_CONFIG_SYSTEM: join(root, "no-system"), GIT_CONFIG_NOSYSTEM: "1" };
  const exec = (...args) => spawnSync(process.execPath, [script, ...args, "--project", root], { encoding: "utf8", env });
  assert.equal(exec("begin", "--id", "second", "--note", "note.md").status, 1);
  assert.equal(exec("publish", "--id", "anon").status, 0);
  const read = exec("read");
  assert.equal(read.status, 0, read.stderr);
  assert.equal(JSON.parse(read.stdout).id, "anon");
});

test("read without --id returns the newest published checkpoint, not the last filename", async (t) => {
  const root = repo(t);
  for (const id of ["zzz-first", "aaa-second"]) {
    assert.equal(run(root, "begin", "--id", id, "--note", "note.md").status, 0);
    assert.equal(run(root, "publish", "--id", id).status, 0);
    await new Promise((done) => setTimeout(done, 25));
  }
  const read = run(root, "read");
  assert.equal(read.status, 0, read.stderr);
  assert.equal(JSON.parse(read.stdout).id, "aaa-second");
});

test("checkpoints live in the common Git dir, per worktree, and outlive a removed worktree", (t) => {
  const root = repo(t);
  const linked = `${root}-linked`;
  git(root, "worktree", "add", "-q", "-b", "linked", linked);
  t.after(() => rmSync(linked, { recursive: true, force: true }));
  const worktree = realpathSync.native(linked);

  // The same id in two worktrees must not collide.
  for (const dir of [root, worktree]) {
    assert.equal(run(dir, "begin", "--id", "shared", "--note", "note.md").status, 0);
    assert.equal(run(dir, "publish", "--id", "shared").status, 0);
  }
  const keyed = stores(root);
  assert.equal(keyed.length, 2);
  assert.equal(keyed.every((dir) => existsSync(join(dir, "shared.json"))), true);
  assert.equal(run(root, "read", "--id", "shared").status, 0);

  git(root, "worktree", "remove", "--force", worktree);
  assert.equal(keyed.every((dir) => existsSync(join(dir, "shared.json"))), true);
});

test("read reports files that changed or went missing since publish", (t) => {
  const root = repo(t);
  assert.equal(run(root, "begin", "--id", "drift", "--note", "note.md", "--artifact", "artifact.txt").status, 0);
  assert.equal(run(root, "publish", "--id", "drift").status, 0);
  writeFileSync(join(root, "note.md"), "next: something else\n");
  rmSync(join(root, "artifact.txt"));
  const read = run(root, "read", "--id", "drift");
  assert.equal(read.status, 0, read.stderr);
  const result = JSON.parse(read.stdout);
  assert.equal(result.filesOk, false);
  assert.deepEqual(result.files.map((file) => [file.path, file.status]), [["note.md", "changed"], ["artifact.txt", "missing"]]);
  assert.match(read.stderr, /note\.md is changed/);
  assert.match(read.stderr, /artifact\.txt is missing/);
});
