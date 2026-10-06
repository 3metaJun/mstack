#!/usr/bin/env node
/** Read-only, cross-platform Git worktree audit. */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function runGit(args, cwd, options = {}) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024, ...options });
  return result.status === 0 ? result.stdout : "";
}
/** Like runGit, but a failed command stays distinguishable from empty output. */
function gitResult(args, cwd) {
  const result = spawnSync("git", args, { cwd, encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
  return { ok: result.status === 0, stdout: result.stdout ?? "" };
}
function gitOk(args, cwd) { return spawnSync("git", args, { cwd, stdio: "ignore" }).status === 0; }

/** Parse the NUL-delimited porcelain stream without treating paths as shell text. */
export function parseWorktreePorcelain(input) {
  const records = [];
  let current = null;
  for (const token of input.split("\0")) {
    if (!token) {
      if (current) { records.push(current); current = null; }
      continue;
    }
    const space = token.indexOf(" ");
    const key = space < 0 ? token : token.slice(0, space);
    const value = space < 0 ? "" : token.slice(space + 1);
    if (key === "worktree") {
      if (current) records.push(current);
      current = { path: value, head: "", branch: null, detached: false };
    } else if (current) {
      if (key === "HEAD") current.head = value;
      else if (key === "branch") current.branch = value.replace(/^refs\/heads\//, "");
      else if (key === "detached") current.detached = true;
    }
  }
  if (current) records.push(current);
  return records;
}

function directorySize(path) {
  try {
    const stat = lstatSync(path);
    if (!stat.isDirectory()) return stat.size;
    return readdirSync(path, { withFileTypes: true }).reduce((total, entry) => total + directorySize(join(path, entry.name)), 0);
  } catch { return 0; }
}
function humanSize(bytes) {
  if (bytes < 1024) return `${bytes}B`;
  const units = ["K", "M", "G", "T"];
  let value = bytes;
  let unit = -1;
  do { value /= 1024; unit++; } while (value >= 1024 && unit < units.length - 1);
  return `${value.toFixed(value >= 10 ? 0 : 1)}${units[unit]}`;
}
function age(timestamp, now) { return timestamp > 0 ? `${Math.max(0, Math.floor((now - timestamp) / 86400000))}d` : "?"; }
function gitStatus(cwd) {
  const { ok, stdout: output } = gitResult(["status", "--porcelain=v1", "-z"], cwd);
  // A failed status says nothing about uncommitted work, so it must never read as clean.
  if (!ok) return "unknown";
  if (!output) return "clean";
  const entries = output.split("\0").filter(Boolean);
  const tracked = entries.filter((entry) => !entry.startsWith("?? ")).length;
  return tracked ? `wip:${tracked}` : `scratch:${entries.length}`;
}
function remoteState(worktree, branch, head) {
  if (!branch) return "detached";
  const remoteHead = runGit(["rev-parse", `origin/${branch}`], worktree).trim();
  if (!remoteHead) return "no-remote";
  if (remoteHead === head) return "pushed";
  const count = runGit(["rev-list", "--count", `origin/${branch}..HEAD`], worktree).trim();
  return `ahead${count || "0"}`;
}
function expandHome(path, home) {
  if (path === "~") return home;
  return /^~[/\\]/.test(path) ? join(home, path.slice(2)) : path;
}

/**
 * Where each Harness keeps its sessions, so a chat that touched a worktree is found wherever it ran.
 * MSTACK_TRANSCRIPTS_DIR replaces them all with one directory the caller has scoped to the workspace.
 * OpenCode has no raw session files to read, so it is not scanned.
 */
export function defaultTranscriptRoots({ env = process.env, home = homedir() } = {}) {
  if (env.MSTACK_TRANSCRIPTS_DIR) return [env.MSTACK_TRANSCRIPTS_DIR];
  const codex = expandHome(env.CODEX_HOME || join(home, ".codex"), home);
  const claude = expandHome(env.CLAUDE_CONFIG_DIR || join(home, ".claude"), home);
  const pi = env.PI_CODING_AGENT_SESSION_DIR
    ? expandHome(env.PI_CODING_AGENT_SESSION_DIR, home)
    : join(expandHome(env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent"), home), "sessions");
  return [join(claude, "projects"), join(codex, "sessions"), join(codex, "archived_sessions"), pi]
    .filter((root) => existsSync(root));
}

// A transcript names a worktree up to a path boundary (a separator, a quote, whitespace, or the end of
// a JSON string), never a bare prefix, so `/x/wt` does not inherit a chat that ran in `/x/wt-long`.
// Git on Windows prints `C:/x/wt` while a session records `C:\x\wt` (`C:\\x\\wt` once JSON-escaped),
// so a Windows or UNC path is searched in both separator spellings and both drive-letter cases.
const PATH_BOUNDARIES = ["/", "\\", '"', "'", " ", "\t", "\n", "\r"];
function transcriptNeedles(path) {
  const spellings = /^(?:[a-z]:[\\/]|\\\\|\/\/)/i.test(path)
    ? [path.replaceAll("\\", "/"), path.replaceAll("/", "\\")].flatMap((spelling) =>
      /^[a-z]:/i.test(spelling) ? [spelling[0].toLowerCase() + spelling.slice(1), spelling[0].toUpperCase() + spelling.slice(1)] : [spelling])
    : [path];
  return [...new Set(spellings)].flatMap((spelling) => [
    // Plain text, as in an exported transcript.
    ...PATH_BOUNDARIES.map((end) => spelling + end),
    // JSON text: the path and its boundary escaped, or the path closing its string.
    ...PATH_BOUNDARIES.map((end) => JSON.stringify(spelling + end).slice(1, -1)),
    JSON.stringify(spelling).slice(1),
  ]).map((needle) => Buffer.from(needle));
}

function* transcriptFiles(root) {
  let entries;
  try { entries = readdirSync(root, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) yield* transcriptFiles(path);
    else if (entry.isFile()) yield path;
  }
}

/** Newest transcript mtime (ms) that names each path, for every path a transcript under `roots` mentions. */
export function lastChats(roots, paths) {
  const needles = paths.map((path) => [path, transcriptNeedles(path)]);
  const latest = new Map();
  for (const root of roots) {
    for (const file of transcriptFiles(root)) {
      try {
        const mtime = lstatSync(file).mtimeMs;
        // A file older than every path's newest match cannot change an answer, so it is not read.
        if (!needles.some(([path]) => mtime > (latest.get(path) ?? 0))) continue;
        const text = readFileSync(file);
        for (const [path, forms] of needles) {
          if (mtime > (latest.get(path) ?? 0) && forms.some((form) => text.includes(form))) latest.set(path, mtime);
        }
      } catch { /* a transcript may disappear during a scan */ }
    }
  }
  return latest;
}

// `prMerged` means a merged PR carried exactly this worktree HEAD. A closed PR landed nothing, and a merged PR does not cover commits made after it.
export function classify({ dirty, pr, recent, merged, prMerged = false }) {
  if (dirty === "unknown") return "hold-unknown";
  if (dirty.startsWith("wip:")) return "hold-wip";
  if (pr.includes("OPEN")) return "hold-open-pr";
  if (recent) return "verify-recent-chat";
  if (merged || prMerged) return "safe";
  return "review";
}

function listAuthoredPrs(repo) {
  const gh = spawnSync("gh", ["pr", "list", "--author", "@me", "--state", "all", "--limit", "1000", "--json", "number,state,headRefName,headRefOid"], { cwd: repo, encoding: "utf8" });
  if (gh.status !== 0) return [];
  try { return JSON.parse(gh.stdout); } catch { return []; }
}

export function audit(repo = runGit(["rev-parse", "--show-toplevel"], process.cwd()).trim(), env = process.env, { listPrs = listAuthoredPrs, home = homedir() } = {}) {
  if (!repo) throw new Error("not in a git repo; pass a repo path");
  repo = resolve(repo);
  const worktrees = parseWorktreePorcelain(runGit(["worktree", "list", "--porcelain", "-z"], repo));
  if (!worktrees.length) throw new Error("could not read git worktrees");
  runGit(["fetch", "origin", "main", "--quiet"], repo); // best effort; stale refs remain useful
  const prs = listPrs(repo);
  const now = Date.now();
  const main = worktrees[0]?.path;
  // One pass over the transcripts answers for every worktree.
  const chats = worktrees.length > 1 ? lastChats(defaultTranscriptRoots({ env, home }), worktrees.slice(1).map((wt) => wt.path)) : new Map();
  return worktrees.slice(1).map((wt) => {
    const timestamp = Number(runGit(["log", "-1", "--format=%ct", wt.path], wt.path).trim()) * 1000 || 0;
    const candidates = prs.filter((item) => item.headRefName === wt.branch);
    const pr = candidates.find((item) => item.state === "OPEN") ?? candidates.find((item) => item.state === "MERGED" && item.headRefOid === wt.head) ?? candidates[0];
    const prText = pr ? `#${pr.number}/${pr.state}` : "-";
    const merged = gitOk(["merge-base", "--is-ancestor", wt.head, "origin/main"], repo);
    const newest = chats.get(wt.path);
    const transcript = newest ? { date: new Date(newest).toISOString().slice(0, 10), recent: (now - newest) / 86400000 <= 4 } : { date: "-", recent: false };
    const dirty = gitStatus(wt.path);
    const bytes = directorySize(wt.path);
    return { size: humanSize(bytes), bytes, age: age(timestamp, now), merged: merged ? "YES" : "no", dirty, remote: remoteState(wt.path, wt.branch, wt.head), pr: prText, lastChat: transcript.date, bucket: classify({ dirty, pr: prText, recent: transcript.recent, merged, prMerged: pr?.state === "MERGED" && pr.headRefOid === wt.head }), worktree: wt.path, main };
  }).sort((a, b) => b.bytes - a.bytes);
}

export function format(rows) {
  const lines = ["SIZE\tAGE\tMERGED\tDIRTY\tREMOTE\tPR\tLAST_CHAT\tBUCKET\tWORKTREE"];
  for (const row of rows) lines.push([row.size, row.age, row.merged, row.dirty, row.remote, row.pr, row.lastChat, row.bucket, row.worktree].join("\t"));
  return `${lines.join("\n")}\n`;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { process.stdout.write(format(audit(process.argv[2]))); }
  catch (error) { console.error(error.message); process.exitCode = 1; }
}
