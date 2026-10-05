import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const script = resolve("tools/meta-mode/resume.mjs");
function repo(t) {
  const root = mkdtempSync(join(tmpdir(), "mstack-resume-"));
  execFileSync("git", ["-C", root, "init", "-q"]);
  execFileSync("git", ["-C", root, "config", "user.name", "Test User"]);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.test"]);
  writeFileSync(join(root, "note.md"), "next: verify the release\n");
  writeFileSync(join(root, "artifact.txt"), "evidence\n");
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}
function run(root, ...args) {
  return spawnSync(process.execPath, [script, ...args, "--project", root], { encoding: "utf8" });
}

test("begin, publish, and read persist a useful checkpoint in Git storage", (t) => {
  const root = repo(t);
  const begun = run(root, "begin", "--id", "handoff", "--note", "note.md", "--artifact", "artifact.txt");
  assert.equal(begun.status, 0, begun.stderr);
  const draft = join(root, ".git", "mstack", "resume", "handoff.draft.json");
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
  assert.equal(JSON.parse(read.stdout).artifacts[0], "artifact.txt");
});

test("rejects unsafe paths, missing identity, and unpublishable notes", (t) => {
  const root = repo(t);
  let result = run(root, "begin", "--id", "bad", "--note", "../note.md");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /inside the project worktree/);
  execFileSync("git", ["-C", root, "config", "user.email", ""]);
  result = run(root, "begin", "--id", "bad", "--note", "note.md");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Git identity is incomplete/);
  execFileSync("git", ["-C", root, "config", "user.email", "test@example.test"]);
  assert.equal(run(root, "begin", "--id", "missing", "--note", "note.md").status, 0);
  rmSync(join(root, "note.md"));
  result = run(root, "publish", "--id", "missing");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Note does not exist/);
});

test("does not expose a draft through read", (t) => {
  const root = repo(t);
  assert.equal(run(root, "begin", "--id", "draft-only", "--note", "note.md").status, 0);
  const result = run(root, "read", "--id", "draft-only");
  assert.equal(result.status, 1);
  assert.match(result.stderr, /No published resume/);
});
