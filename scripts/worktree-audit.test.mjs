import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { audit, classify, defaultTranscriptRoots, lastChats, parseWorktreePorcelain } from "../tools/meta-mode/worktree-audit.mjs";

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

// Every Harness store points at an empty directory, so a run never reads the developer's real session history.
function runAudit(repo, transcripts, extraEnv = {}) {
  const home = join(dirname(repo), "empty-home");
  const env = {
    CLAUDE_CONFIG_DIR: join(home, "claude"),
    CODEX_HOME: join(home, "codex"),
    PI_CODING_AGENT_DIR: join(home, "pi"),
    ...(transcripts ? { MSTACK_TRANSCRIPTS_DIR: transcripts } : {}),
    ...extraEnv,
  };
  const rows = audit(repo, env, { listPrs: () => [], home });
  assert.equal(rows.length, 1);
  return rows[0];
}

function writeSession(path, record) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(record)}\n`);
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
  // JSON.stringify spells the path the way a Harness records it on this host: `H:\\x\\wt` on Windows, unchanged elsewhere.
  writeFileSync(join(transcripts, "windows.jsonl"), `${JSON.stringify({ cwd: worktree })}\n`);
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

// Each Harness keeps its own sessions. Without MSTACK_TRANSCRIPTS_DIR the audit reads all of them.
for (const [name, env, file] of [
  ["Codex sessions", (home) => ({ CODEX_HOME: home }), "sessions/2026/10/06/rollout-a.jsonl"],
  ["Codex archived sessions", (home) => ({ CODEX_HOME: home }), "archived_sessions/rollout-b.jsonl"],
  ["Claude Code projects under CLAUDE_CONFIG_DIR", (home) => ({ CLAUDE_CONFIG_DIR: home }), "projects/workspace/session.jsonl"],
  ["pi sessions under PI_CODING_AGENT_DIR", (home) => ({ PI_CODING_AGENT_DIR: home }), "sessions/workspace/session.jsonl"],
  ["pi sessions under PI_CODING_AGENT_SESSION_DIR", (home) => ({ PI_CODING_AGENT_SESSION_DIR: home }), "session.jsonl"],
]) {
  test(`a recent chat in ${name} holds the worktree`, (t) => {
    const { root, repo, worktree } = fixture(t);
    assert.equal(runAudit(repo).bucket, "safe");
    const store = join(root, "harness-store");
    writeSession(join(store, file), { cwd: worktree });
    const row = runAudit(repo, undefined, env(store));
    assert.equal(row.bucket, "verify-recent-chat");
    assert.equal(row.lastChat, new Date().toISOString().slice(0, 10));
  });
}

test("MSTACK_TRANSCRIPTS_DIR replaces the Harness stores instead of adding to them", (t) => {
  const { root, repo, worktree } = fixture(t);
  const codex = join(root, "codex-store");
  writeSession(join(codex, "sessions", "rollout.jsonl"), { cwd: worktree });
  const scoped = join(root, "scoped");
  mkdirSync(scoped);
  assert.equal(runAudit(repo, scoped, { CODEX_HOME: codex }).bucket, "safe");
});

test("a chat in a sibling that shares the worktree's path prefix does not hold it", (t) => {
  const { root, repo, worktree } = fixture(t);
  const store = join(root, "codex-store");
  writeSession(join(store, "sessions", "long.jsonl"), { cwd: `${worktree}-long` });
  writeSession(join(store, "sessions", "numbered.jsonl"), { cwd: `${worktree}2/src` });
  assert.equal(runAudit(repo, undefined, { CODEX_HOME: store }).bucket, "safe");
  writeSession(join(store, "sessions", "inside.jsonl"), { cwd: join(worktree, "src") });
  assert.equal(runAudit(repo, undefined, { CODEX_HOME: store }).bucket, "verify-recent-chat");
});

test("default transcript roots are only the Harness stores that exist", (t) => {
  const { root } = fixture(t);
  const home = join(root, "home");
  const codex = join(root, "codex");
  mkdirSync(join(codex, "sessions"), { recursive: true });
  mkdirSync(join(codex, "archived_sessions"), { recursive: true });
  const roots = defaultTranscriptRoots({ env: { CODEX_HOME: codex, CLAUDE_CONFIG_DIR: join(root, "no-claude") }, home });
  assert.deepEqual(roots, [join(codex, "sessions"), join(codex, "archived_sessions")]);
  assert.deepEqual(defaultTranscriptRoots({ env: { MSTACK_TRANSCRIPTS_DIR: join(root, "scoped"), CODEX_HOME: codex }, home }), [join(root, "scoped")]);
  // An unset CODEX_HOME falls back to ~/.codex.
  mkdirSync(join(home, ".codex", "sessions"), { recursive: true });
  assert.deepEqual(defaultTranscriptRoots({ env: {}, home }), [join(home, ".codex", "sessions")]);
});

// A transcript spells a path the way the Harness wrote it, which is not always the way Git prints it.
test("lastChats matches a path as a transcript spells it, and nothing that merely shares its prefix", (t) => {
  const { root } = fixture(t);
  const store = join(root, "store");
  mkdirSync(store);
  // Written the way a JSON string spells them: a backslash is `\\`, a quote is `\"`.
  const cases = [
    // [path Git prints, transcript text, whether it names that path]
    ["C:/Users/dev/wt", '{"cwd":"C:\\\\Users\\\\dev\\\\wt"}', true],
    ["C:/Users/dev/wt", '{"cwd":"C:\\\\Users\\\\dev\\\\wt\\\\src"}', true],
    ["C:/Users/dev/wt", '{"cwd":"C:/Users/dev/wt"}', true],
    ["C:\\Users\\dev\\wt", '{"cwd":"C:/Users/dev/wt/src"}', true],
    ["C:/Users/dev/wt", '{"cwd":"c:\\\\Users\\\\dev\\\\wt"}', true],
    ["//server/share/wt", '{"cwd":"\\\\\\\\server\\\\share\\\\wt"}', true],
    ["C:/Users/dev/wt", '{"cwd":"\\\\\\\\?\\\\C:\\\\Users\\\\dev\\\\wt"}', true],
    ["C:/Users/dev/wt", '{"cwd":"C:\\\\Users\\\\dev\\\\wt-long"}', false],
    ["C:/Users/dev/wt", '{"cwd":"C:\\\\Users\\\\dev\\\\wt2\\\\src"}', false],
    ["//server/share/wt", '{"cwd":"\\\\\\\\server\\\\share\\\\wt.old"}', false],
    ["/work/wt", '{"cwd":"/work/wt"}', true],
    ["/work/wt", '{"cmd":"cd /work/wt && ls"}', true],
    ["/work/wt", '{"cmd":"cd /work/wt\\nls"}', true],
    ["/work/wt", "cwd: /work/wt\n", true],
    ["/work/wt", '{"cwd":"/work/wt-long"}', false],
    ["/work/wt", '{"cwd":"/work/wt.old/src"}', false],
    // A longer path that merely ends with the worktree path is another directory.
    ["/work/wt", '{"cwd":"/other/work/wt"}', false],
    ["/work/wt", '{"cwd":"/other/work/wt/src"}', false],
    ["/work/wt", '{"cwd":"X:/work/wt"}', false],
    ["C:/Users/dev/wt", '{"cwd":"XC:/Users/dev/wt"}', false],
    ["C:/Users/dev/wt", '{"cwd":"X:\\\\C:\\\\Users\\\\dev\\\\wt"}', false],
    ["//server/share/wt", '{"cwd":"\\\\\\\\other\\\\server\\\\share\\\\wt"}', false],
    ["/work/wt", '{"cmd":"ls\\n/work/wt"}', true],
    ["/work/wt", '{"cmd":"ls ./a /work/wt"}', true],
    ["/work/wt", "cwd=/work/wt\n", true],
    ["/work/wt", "(/work/wt/src)", true],
    ["/work/wt", "/work/wt", true],
    ["/work/a\"b", '{"cwd":"/work/a\\"b"}', true],
    ["/work/工作 tree", '{"cwd":"/work/工作 tree"}', true],
  ];
  cases.forEach(([path, text, expected], index) => {
    // One transcript per directory, so no other case can answer for this one.
    const directory = join(store, String(index));
    mkdirSync(directory);
    writeFileSync(join(directory, "session.jsonl"), `${text}\n`);
    assert.equal(lastChats([directory], [path]).has(path), expected, `${path} in ${text}`);
  });
});

// A squash merge leaves the worktree's commits outside origin/main, so the PR is the only evidence they landed.
// That evidence only covers the commit the PR carried: a closed PR landed nothing, and later commits are not in it.
test("a PR vouches for a worktree only when it merged exactly the worktree's HEAD", (t) => {
  const { root, repo, worktree } = fixture(t);
  writeFileSync(join(worktree, "work.txt"), "unmerged work\n");
  git(worktree, "add", "work.txt");
  git(worktree, "commit", "-q", "-m", "work");
  const head = git(worktree, "rev-parse", "HEAD").trim();
  const bucketFor = (pr) => {
    const listPrs = () => (pr ? [{ headRefName: "audit-worktree", ...pr }] : []);
    const env = { MSTACK_TRANSCRIPTS_DIR: join(root, "no-transcripts") };
    return audit(repo, env, { listPrs })[0].bucket;
  };
  assert.equal(bucketFor(null), "review");
  assert.equal(bucketFor({ number: 7, state: "MERGED", headRefOid: head }), "safe");
  assert.equal(bucketFor({ number: 7, state: "MERGED", headRefOid: "0".repeat(40) }), "review");
  assert.equal(bucketFor({ number: 7, state: "CLOSED", headRefOid: head }), "review");
  assert.equal(bucketFor({ number: 7, state: "OPEN", headRefOid: head }), "hold-open-pr");
});
