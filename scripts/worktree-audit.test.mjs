import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { audit, classify, defaultTranscriptRoots, lastChats, parseCliArgs, parseWorktreePorcelain, pathSpellings } from "../tools/meta-mode/worktree-audit.mjs";

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
    "worktree \\\\server\\share\\space path", "HEAD def", "detached", "locked active agent", "",
    "worktree /gone/path", "HEAD 123", "prunable gitdir file points to non-existent location", "",
  ].join("\0"));
  assert.deepEqual(result, [
    { path: "C:/Users/Test User/工作 tree", head: "abc", branch: 'feature/quoted "name"', detached: false, locked: null, prunable: false },
    { path: "\\\\server\\share\\space path", head: "def", branch: null, detached: true, locked: "active agent", prunable: false },
    { path: "/gone/path", head: "123", branch: null, detached: false, locked: null, prunable: true },
  ]);
});

test("classification preserves safety gates", () => {
  assert.equal(classify({ dirty: "unknown", pr: "-", recent: false, merged: true }), "hold-unknown");
  assert.equal(classify({ dirty: "unknown", pr: "#4/MERGED", recent: false, merged: true }), "hold-unknown");
  assert.equal(classify({ dirty: "clean", pr: "-", recent: false, merged: true, locked: "busy" }), "hold-locked");
  assert.equal(classify({ dirty: "wip:1", pr: "-", recent: false, merged: true }), "hold-wip");
  assert.equal(classify({ dirty: "scratch:2", pr: "-", recent: false, merged: true }), "hold-scratch");
  assert.equal(classify({ dirty: "reflog:1", pr: "-", recent: false, merged: true }), "hold-reflog");
  assert.equal(classify({ dirty: "ignored:1", pr: "-", recent: false, merged: true }), "hold-ignored");
  assert.equal(classify({ dirty: "clean", pr: "#4/OPEN", recent: false, merged: true }), "hold-open-pr");
  assert.equal(classify({ dirty: "clean", pr: "#4/DRAFT", recent: false, merged: true }), "hold-open-pr");
  assert.equal(classify({ dirty: "clean", pr: "-", recent: true, merged: false }), "verify-recent-chat");
  assert.equal(classify({ dirty: "clean", pr: "-", recent: false, merged: true, unknownFact: true }), "review");
  assert.equal(classify({ dirty: "clean", pr: "-", recent: false, merged: true }), "safe");
  assert.equal(classify({ dirty: "clean", pr: "-", recent: false, merged: false }), "review");
  assert.equal(classify({ dirty: "-", pr: "-", recent: false, merged: false, prunable: true }), "prunable");
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
    // Whitespace ends a path in shell text, but not inside a quoted value that begins with the path.
    ["/work/wt", '{"cwd":"/work/wt long"}', false],
    ["/work/wt", '{"cwd":"/work/wt 2/src"}', false],
    ["/work/wt", "cwd: '/work/wt long'\n", false],
    ["C:/Users/dev/wt", '{"cwd":"C:\\\\Users\\\\dev\\\\wt long"}', false],
    ["/work/wt", '{"cmd":"cd /work/wt && ls"}', true],
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
  const noTranscripts = join(root, "no-transcripts");
  mkdirSync(noTranscripts, { recursive: true });
  const bucketFor = (pr) => {
    const listPrs = () => (pr ? [{ headRefName: "audit-worktree", baseRefName: "main", ...pr }] : []);
    const env = { MSTACK_TRANSCRIPTS_DIR: noTranscripts };
    return audit(repo, env, { listPrs })[0].bucket;
  };
  assert.equal(bucketFor(null), "review");
  assert.equal(bucketFor({ number: 7, state: "MERGED", headRefOid: head }), "safe");
  assert.equal(bucketFor({ number: 7, state: "MERGED", headRefOid: "0".repeat(40) }), "review");
  // Merged into a feature branch that has not reached origin/main, so the work has not landed.
  assert.equal(bucketFor({ number: 7, state: "MERGED", headRefOid: head, baseRefName: "parent-feature" }), "review");
  assert.equal(bucketFor({ number: 7, state: "CLOSED", headRefOid: head }), "review");
  assert.equal(bucketFor({ number: 7, state: "OPEN", headRefOid: head }), "hold-open-pr");
});

test("holds untracked scratch even when status.showUntrackedFiles=no, and reports wip+scratch together", (t) => {
  const { repo, worktree } = fixture(t);
  git(worktree, "config", "status.showUntrackedFiles", "no");
  writeFileSync(join(worktree, "notes.txt"), "scratch\n");
  let row = runAudit(repo);
  assert.equal(row.dirty, "scratch:1");
  assert.equal(row.bucket, "hold-scratch");

  writeFileSync(join(worktree, "tracked.txt"), "edited\n");
  row = runAudit(repo);
  assert.equal(row.dirty, "wip:1,scratch:1");
  assert.equal(row.bucket, "hold-wip");
});

test("holds non-disposable ignored files like .env while allowing disposable cache directories", (t) => {
  const { repo, worktree } = fixture(t);
  writeFileSync(join(worktree, ".gitignore"), ".env\nnode_modules/\ndist/\n");
  git(worktree, "add", ".gitignore");
  git(worktree, "commit", "-q", "-m", "ignore rules");
  git(repo, "push", "-q", "origin", "HEAD:main");
  git(worktree, "merge", "-q", "origin/main");
  // Fast-forward origin/main so worktree is merged.
  git(repo, "checkout", "-q", "main");
  git(repo, "merge", "-q", "--ff-only", "audit-worktree");
  git(repo, "push", "-q", "origin", "main");

  mkdirSync(join(worktree, "node_modules"), { recursive: true });
  writeFileSync(join(worktree, "node_modules", "pkg.js"), "cache\n");
  assert.equal(runAudit(repo).bucket, "safe");

  writeFileSync(join(worktree, ".env"), "SECRET=1\n");
  const row = runAudit(repo);
  assert.equal(row.dirty, "ignored:1");
  assert.equal(row.bucket, "hold-ignored");
});

test("holds worktree-only detached HEAD reflog commits and locked worktrees", (t) => {
  const { repo, worktree } = fixture(t);
  git(worktree, "checkout", "-q", "--detach", "HEAD");
  writeFileSync(join(worktree, "tracked.txt"), "detached work\n");
  git(worktree, "add", "tracked.txt");
  git(worktree, "commit", "-q", "-m", "detached");
  git(worktree, "checkout", "-q", "audit-worktree");
  let row = runAudit(repo);
  assert.match(row.dirty, /reflog:1/);
  assert.equal(row.bucket, "hold-reflog");

  git(repo, "worktree", "lock", "--reason", "pinned by agent", worktree);
  row = runAudit(repo);
  assert.equal(row.bucket, "hold-locked");
  assert.equal(row.locked, "pinned by agent");
});

test("uses refs/remotes/ for remote bases and fails closed when gh pr list fails", (t) => {
  const { root, repo, worktree } = fixture(t);
  writeFileSync(join(worktree, "only-here.txt"), "unmerged\n");
  git(worktree, "add", "only-here.txt");
  git(worktree, "commit", "-q", "-m", "unmerged");
  // A local branch named origin/main pointing at worktree HEAD must not fool the merge check.
  git(repo, "branch", "origin/main", git(worktree, "rev-parse", "HEAD").trim());
  const row = runAudit(repo);
  assert.equal(row.merged, "no");
  assert.equal(row.bucket, "review");

  // When gh pr list fails (null), even a merged clean worktree stays in review, never safe.
  const home = join(root, "empty-home");
  const noTranscripts = join(root, "no-transcripts");
  mkdirSync(noTranscripts, { recursive: true });
  const env = { MSTACK_TRANSCRIPTS_DIR: noTranscripts };
  const cleanWt = join(root, "clean-wt");
  git(repo, "worktree", "add", "-q", "-b", "clean-wt", cleanWt, "refs/remotes/origin/main");
  const rows = audit(repo, env, { listPrs: () => null, home });
  const cleanRow = rows.find((item) => resolve(item.worktree) === resolve(cleanWt));
  assert.equal(cleanRow?.merged, "YES");
  assert.equal(cleanRow?.bucket, "review");
});

test("keeps ignored secrets inside tracked disposable-named dirs like build/.env", (t) => {
  const { repo, worktree } = fixture(t);
  writeFileSync(join(worktree, ".gitignore"), ".env\n");
  mkdirSync(join(worktree, "build"), { recursive: true });
  writeFileSync(join(worktree, "build", "keep.txt"), "tracked\n");
  git(worktree, "add", ".gitignore", "build/keep.txt");
  git(worktree, "commit", "-q", "-m", "track build dir");
  git(worktree, "push", "-q", "origin", "HEAD:main");
  writeFileSync(join(worktree, "build", ".env"), "SECRET=1\n");

  const row = runAudit(repo);
  assert.equal(row.dirty, "ignored:1");
  assert.equal(row.bucket, "hold-ignored");
});

test("reports behind and diverged remote state instead of ahead0, and supports --base/--fetch/GIT_OPTIONAL_LOCKS", (t) => {
  const { root, repo, worktree } = fixture(t);
  // Push branch, then advance origin/audit-worktree from a separate clone so worktree is behind.
  git(worktree, "push", "-q", "origin", "audit-worktree");
  const other = join(root, "other");
  execFileSync("git", ["clone", "-q", join(root, "remote.git"), other]);
  git(other, "config", "user.name", "Test User");
  git(other, "config", "user.email", "test@example.test");
  git(other, "checkout", "-q", "audit-worktree");
  writeFileSync(join(other, "remote-only.txt"), "r\n");
  git(other, "add", "remote-only.txt");
  git(other, "commit", "-q", "-m", "remote commit");
  git(other, "push", "-q", "origin", "audit-worktree");
  git(repo, "fetch", "-q", "origin", "audit-worktree");

  let row = runAudit(repo);
  assert.equal(row.remote, "behind1");

  writeFileSync(join(worktree, "local-only.txt"), "l\n");
  git(worktree, "add", "local-only.txt");
  git(worktree, "commit", "-q", "-m", "local commit");
  row = runAudit(repo);
  assert.equal(row.remote, "ahead1,behind1");

  // Also test read-only default (no fetch + index untouched) vs --fetch and -b/--base.
  git(other, "checkout", "-q", "main");
  writeFileSync(join(other, "main-advance.txt"), "advance\n");
  git(other, "add", "main-advance.txt");
  git(other, "commit", "-q", "-m", "advance main");
  git(other, "push", "-q", "origin", "main");

  const home = join(root, "empty-home");
  const env = { MSTACK_TRANSCRIPTS_DIR: join(root, "empty-transcripts") };
  mkdirSync(env.MSTACK_TRANSCRIPTS_DIR, { recursive: true });
  const beforeOriginMain = git(repo, "rev-parse", "refs/remotes/origin/main").trim();
  const indexPath = join(repo, ".git", "worktrees", "audit-worktree", "index");
  const indexBefore = readFileSync(indexPath);

  audit(repo, env, { listPrs: () => [], home });
  assert.equal(git(repo, "rev-parse", "refs/remotes/origin/main").trim(), beforeOriginMain);
  assert.equal(readFileSync(indexPath).equals(indexBefore), true);

  audit(repo, env, { listPrs: () => [], home, fetch: true, base: "origin/main" });
  assert.equal(git(repo, "rev-parse", "refs/remotes/origin/main").trim(), git(other, "rev-parse", "HEAD").trim());
});

test("parseCliArgs accepts -b, --base, --base=<ref>, --fetch, and -- separator", () => {
  assert.deepEqual(parseCliArgs(["-b", "origin/dev", "--fetch", "/repo"]), {
    base: "origin/dev",
    fetch: true,
    help: false,
    repo: "/repo",
  });
  assert.deepEqual(parseCliArgs(["--base=origin/release", "--", "-weird-repo"]), {
    base: "origin/release",
    fetch: false,
    help: false,
    repo: "-weird-repo",
  });
  assert.throws(() => parseCliArgs(["--base="]), /requires a ref/);
  assert.throws(() => parseCliArgs(["--bogus"]), /unknown option/);
});

test("scans COPILOT_HOME session-state and fails closed when MSTACK_TRANSCRIPTS_DIR is missing", (t) => {
  const { root, repo, worktree } = fixture(t);
  const copilotHome = join(root, "copilot");
  const sessionState = join(copilotHome, "session-state");
  mkdirSync(sessionState, { recursive: true });
  writeFileSync(join(sessionState, "chat.jsonl"), `${JSON.stringify({ cwd: worktree })}\n`);

  const copilotRow = runAudit(repo, undefined, { COPILOT_HOME: copilotHome });
  assert.equal(copilotRow.bucket, "verify-recent-chat");

  const warnings = [];
  const rows = audit(repo, { MSTACK_TRANSCRIPTS_DIR: join(root, "does-not-exist") }, {
    listPrs: () => [],
    home: join(root, "empty-home"),
    warn: (line) => warnings.push(line),
  });
  assert.equal(rows[0].lastChat, "?");
  assert.equal(rows[0].bucket, "review");
  assert.ok(warnings.some((line) => line.includes("transcript scan was incomplete")));
});

test("holds worktrees with non-disposable ignored files inside a git submodule", (t) => {
  const { root, repo, worktree } = fixture(t);
  const subOrigin = join(root, "sub-origin");
  execFileSync("git", ["init", "-q", "-b", "main", subOrigin]);
  git(subOrigin, "config", "user.name", "Test User");
  git(subOrigin, "config", "user.email", "test@example.test");
  writeFileSync(join(subOrigin, ".gitignore"), ".env\n");
  writeFileSync(join(subOrigin, "lib.txt"), "sub\n");
  git(subOrigin, "add", ".gitignore", "lib.txt");
  git(subOrigin, "commit", "-q", "-m", "sub init");

  execFileSync("git", ["-C", worktree, "-c", "protocol.file.allow=always", "submodule", "add", "-q", subOrigin, "deps/sub"], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  git(worktree, "commit", "-q", "-m", "add submodule");
  git(worktree, "push", "-q", "origin", "HEAD:main");

  // Clean initialized submodule is held as hold-submodule because plain `git worktree remove` refuses it.
  let row = runAudit(repo);
  assert.equal(row.dirty, "submodule:1");
  assert.equal(row.bucket, "hold-submodule");

  // Non-disposable ignored file inside the submodule escalates to hold-ignored while preserving submodule count.
  writeFileSync(join(worktree, "deps", "sub", ".env"), "SUB_SECRET=1\n");
  row = runAudit(repo);
  assert.equal(row.dirty, "ignored:1,submodule:1");
  assert.equal(row.bucket, "hold-ignored");

  // Even after `git submodule deinit --all`, `<worktree-gitdir>/modules` remains and
  // plain `git worktree remove` still refuses it, so audit must keep holding as hold-submodule.
  rmSync(join(worktree, "deps", "sub", ".env"), { force: true });
  git(worktree, "submodule", "deinit", "--all", "-q");
  row = runAudit(repo);
  assert.equal(row.dirty, "submodule:1");
  assert.equal(row.bucket, "hold-submodule");
});

test("scans custom T3 provider transcript homes, returns empty on repos with no linked worktrees, and supports non-origin --fetch", (t) => {
  const { root, repo, worktree } = fixture(t);
  const t3Home = join(root, "t3");
  const customClaude = join(root, "claude-t3");
  mkdirSync(join(t3Home, "userdata"), { recursive: true });
  mkdirSync(join(customClaude, "projects"), { recursive: true });
  writeFileSync(join(t3Home, "userdata", "settings.json"), JSON.stringify({
    providerInstances: {
      claudeCustom: { driver: "claudeAgent", enabled: true, config: { homePath: customClaude } },
    },
  }));
  writeFileSync(join(customClaude, "projects", "chat.jsonl"), `${JSON.stringify({ cwd: worktree })}\n`);
  const t3Row = runAudit(repo, undefined, { T3CODE_HOME: t3Home });
  assert.equal(t3Row.bucket, "verify-recent-chat");

  // Repo with no remotes and no linked worktrees returns [] instead of throwing on missing origin/main.
  const soloRepo = join(root, "solo");
  execFileSync("git", ["init", "-q", "-b", "main", soloRepo]);
  git(soloRepo, "config", "user.name", "Test User");
  git(soloRepo, "config", "user.email", "test@example.test");
  writeFileSync(join(soloRepo, "a.txt"), "a\n");
  git(soloRepo, "add", "a.txt");
  git(soloRepo, "commit", "-q", "-m", "init");
  assert.deepEqual(audit(soloRepo, {}, { listPrs: () => [] }), []);

  // --fetch works against non-origin remotes and warns on non-remote bases.
  const upstreamBare = join(root, "upstream.git");
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", upstreamBare]);
  git(repo, "remote", "add", "upstream", upstreamBare);
  git(repo, "push", "-q", "upstream", "main");
  const emptyTranscripts = join(root, "empty-tr");
  mkdirSync(emptyTranscripts, { recursive: true });
  const warnings = [];
  audit(repo, { MSTACK_TRANSCRIPTS_DIR: emptyTranscripts }, {
    listPrs: () => [],
    base: "upstream/main",
    fetch: true,
    warn: (line) => warnings.push(line),
  });
  audit(repo, { MSTACK_TRANSCRIPTS_DIR: emptyTranscripts }, {
    listPrs: () => [],
    base: "refs/remotes/upstream/main",
    fetch: true,
    warn: (line) => warnings.push(line),
  });
  assert.equal(warnings.length, 0);
  audit(repo, { MSTACK_TRANSCRIPTS_DIR: emptyTranscripts }, {
    listPrs: () => [],
    base: "main",
    fetch: true,
    warn: (line) => warnings.push(line),
  });
  assert.ok(warnings.some((line) => line.includes("--fetch ignored for non-remote base")));
});

test("pathSpellings expands ancestor symlinks without requiring OS symlink privileges", (t) => {
  const root = realpathSync.native(mkdtempSync(join(tmpdir(), "mstack-spell-")));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const realChild = join(root, "real-parent", "wt");
  mkdirSync(realChild, { recursive: true });
  const fakeLink = join(root, "link-parent");
  const realParent = join(root, "real-parent");

  const spellings = pathSpellings(realChild, (dir) => (
    dir === root ? [[fakeLink, { id: "fake-id", name: realParent }]] : []
  ));
  assert.ok(spellings.includes(realChild));
  assert.ok(spellings.includes(join(fakeLink, "wt")), `expected symlink spelling in ${JSON.stringify(spellings)}`);
});

test("decodes valid .jsonl.zst transcripts when Zstd is available and fails closed on corrupt .jsonl.zst", async (t) => {
  const { root, repo, worktree } = fixture(t);
  const transcripts = join(root, "zst-transcripts");
  mkdirSync(transcripts, { recursive: true });
  const zlib = await import("node:zlib");

  // Build an RFC 8878 valid single-frame raw-block Zstd payload containing the worktree path.
  const payload = Buffer.from(`${JSON.stringify({ cwd: worktree })}\n`, "utf8");
  const header = Buffer.alloc(9);
  header[0] = 0x28;
  header[1] = 0xb5;
  header[2] = 0x2f;
  header[3] = 0xfd;
  header[4] = 0x00; // Frame_Header_Descriptor: 1-byte Window_Descriptor, no FCS
  header[5] = 0x00; // Window_Descriptor: 1 KiB
  const blockHeader = (payload.length << 3) | 1; // Last_Block=1, Block_Type=0 (Raw_Block)
  header[6] = blockHeader & 0xff;
  header[7] = (blockHeader >> 8) & 0xff;
  header[8] = (blockHeader >> 16) & 0xff;
  const validZst = join(transcripts, "session.jsonl.zst");
  writeFileSync(validZst, Buffer.concat([header, payload]));

  if (typeof zlib.zstdDecompressSync === "function") {
    const row = runAudit(repo, transcripts);
    assert.equal(row.bucket, "verify-recent-chat");
  }

  // Corrupt .jsonl.zst must fail closed: lastChat="?", bucket="review", never "safe".
  writeFileSync(validZst, Buffer.from([0x28, 0xb5, 0x2f, 0xfd, 0xff]));
  const warnings = [];
  const rows = audit(repo, { MSTACK_TRANSCRIPTS_DIR: transcripts }, {
    listPrs: () => [],
    home: join(root, "empty-home"),
    warn: (line) => warnings.push(line),
  });
  assert.equal(rows[0].lastChat, "?");
  assert.equal(rows[0].bucket, "review");
  assert.ok(warnings.some((line) => line.includes("cannot decode")));
});
