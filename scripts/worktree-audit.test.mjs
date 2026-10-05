import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { audit, classify, parseWorktreePorcelain } from "../tools/meta-mode/worktree-audit.mjs";

function git(cwd, ...args) {
  return execFileSync("git", ["-C", cwd, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] });
}

// A repository whose origin/main contains the worktree's HEAD, so an unclaimed clean worktree reads as `safe`.
function fixture(t) {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "mstack-audit-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const remote = join(root, "remote.git");
  const repo = join(root, "repo");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", remote]);
  execFileSync("git", ["init", "-q", "-b", "main", repo]);
  git(repo, "config", "user.name", "Test User");
  git(repo, "config", "user.email", "test@example.test");
  writeFileSync(join(repo, "tracked.txt"), "fixture\n");
  git(repo, "add", "tracked.txt");
  git(repo, "commit", "-q", "-m", "fixture");
  git(repo, "remote", "add", "origin", remote);
  git(repo, "push", "-q", "origin", "main");
  const worktree = join(root, "audit-worktree");
  git(repo, "worktree", "add", "-q", "-b", "audit-worktree", worktree);
  return { root, repo, worktree };
}

function runAudit(repo, transcripts) {
  const env = transcripts ? { MSTACK_TRANSCRIPTS_DIR: transcripts } : {};
  const rows = audit(repo, env, { listPrs: () => [] });
  assert.equal(rows.length, 1);
  return rows[0];
}

test("parses NUL porcelain paths without shell or quote loss", () => {
  const result = parseWorktreePorcelain([
    "worktree C:/Users/Test User/工作 tree", "HEAD abc", "branch refs/heads/feature/quoted \"name\"", "",
    "worktree \\\\server\\share\\space path", "HEAD def", "detached", "",
  ].join("\0"));
  assert.deepEqual(result, [
    { path: "C:/Users/Test User/工作 tree", head: "abc", branch: 'feature/quoted "name"', detached: false },
    { path: "\\\\server\\share\\space path", head: "def", branch: null, detached: true },
  ]);
});

test("classification preserves safety gates", () => {
  assert.equal(classify({ dirty: "unknown", pr: "-", recent: false, merged: true }), "hold-unknown");
  assert.equal(classify({ dirty: "unknown", pr: "#4/MERGED", recent: false, merged: true }), "hold-unknown");
  assert.equal(classify({ dirty: "wip:1", pr: "-", recent: false, merged: true }), "hold-wip");
  assert.equal(classify({ dirty: "clean", pr: "#4/OPEN", recent: false, merged: true }), "hold-open-pr");
  assert.equal(classify({ dirty: "clean", pr: "-", recent: true, merged: false }), "verify-recent-chat");
  assert.equal(classify({ dirty: "clean", pr: "-", recent: false, merged: true }), "safe");
  assert.equal(classify({ dirty: "clean", pr: "-", recent: false, merged: false }), "review");
});

test("audits a real worktree: a clean merged worktree is safe, a recent transcript holds it", (t) => {
  const { root, repo, worktree } = fixture(t);
  assert.equal(runAudit(repo).bucket, "safe");

  const transcripts = join(root, "transcripts");
  mkdirSync(transcripts);
  writeFileSync(join(transcripts, "unrelated.jsonl"), JSON.stringify({ cwd: join(root, "elsewhere") }) + "\n");
  assert.equal(runAudit(repo, transcripts).bucket, "safe");

  writeFileSync(join(transcripts, "session.jsonl"), JSON.stringify({ cwd: `${worktree}/` }) + "\n");
  const row = runAudit(repo, transcripts);
  assert.equal(row.bucket, "verify-recent-chat");
  assert.equal(row.lastChat, new Date().toISOString().slice(0, 10));
});

test("matches a Windows path that a JSONL transcript stores with doubled backslashes", (t) => {
  const { root, repo, worktree } = fixture(t);
  const transcripts = join(root, "transcripts");
  mkdirSync(transcripts);
  // JSON.stringify of `H:\x\wt` writes `H:\\x\\wt`; build that spelling regardless of the host separator.
  const windowsSpelling = worktree.replaceAll("\\", "/").replaceAll("/", "\\\\");
  writeFileSync(join(transcripts, "windows.jsonl"), `{"cwd":"${windowsSpelling}"}\n`);
  assert.equal(runAudit(repo, transcripts).bucket, "verify-recent-chat");
});

test("a failing git status is unknown and never safe", (t) => {
  const { repo, worktree } = fixture(t);
  // Replace the gitfile (hidden on Windows, so it cannot be overwritten in place) with one Git rejects.
  rmSync(join(worktree, ".git"));
  writeFileSync(join(worktree, ".git"), "not a gitfile\n");
  const row = runAudit(repo);
  assert.equal(row.dirty, "unknown");
  assert.equal(row.bucket, "hold-unknown");
});
