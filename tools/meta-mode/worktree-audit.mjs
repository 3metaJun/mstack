#!/usr/bin/env node
/** Read-only, cross-platform Git worktree audit. */
import { spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync } from "node:fs";
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
function latestTranscript(transcripts, worktree, now) {
  if (!transcripts || !existsSync(transcripts)) return { date: "-", recent: false };
  let newest = 0;
  // Transcripts are JSONL, so a Windows path appears with doubled backslashes. Collapse every run to one slash on both sides.
  const normalize = (text) => text.replace(/\\+/g, "/");
  const needle = normalize(worktree);
  const scan = (dir) => {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) scan(path);
      else {
        try {
          const text = normalize(readFileSync(path, "utf8"));
          if (text.includes(`${needle}/`) || text.includes(`${needle}\"`) || text.includes(`${needle}'`)) newest = Math.max(newest, lstatSync(path).mtimeMs);
        } catch { /* transcript may disappear during a scan */ }
      }
    }
  };
  scan(transcripts);
  if (!newest) return { date: "-", recent: false };
  const date = new Date(newest).toISOString().slice(0, 10);
  return { date, recent: (now - newest) / 86400000 <= 4 };
}

export function classify({ dirty, pr, recent, merged }) {
  if (dirty === "unknown") return "hold-unknown";
  if (dirty.startsWith("wip:")) return "hold-wip";
  if (pr.includes("OPEN")) return "hold-open-pr";
  if (recent) return "verify-recent-chat";
  if (merged || pr !== "-") return "safe";
  return "review";
}

function listAuthoredPrs(repo) {
  const gh = spawnSync("gh", ["pr", "list", "--author", "@me", "--state", "all", "--limit", "1000", "--json", "number,state,headRefName"], { cwd: repo, encoding: "utf8" });
  if (gh.status !== 0) return [];
  try { return JSON.parse(gh.stdout); } catch { return []; }
}

export function audit(repo = runGit(["rev-parse", "--show-toplevel"], process.cwd()).trim(), env = process.env, { listPrs = listAuthoredPrs } = {}) {
  if (!repo) throw new Error("not in a git repo; pass a repo path");
  repo = resolve(repo);
  const worktrees = parseWorktreePorcelain(runGit(["worktree", "list", "--porcelain", "-z"], repo));
  if (!worktrees.length) throw new Error("could not read git worktrees");
  runGit(["fetch", "origin", "main", "--quiet"], repo); // best effort; stale refs remain useful
  const prs = listPrs(repo);
  const now = Date.now();
  const main = worktrees[0]?.path;
  return worktrees.slice(1).map((wt) => {
    const timestamp = Number(runGit(["log", "-1", "--format=%ct", wt.path], wt.path).trim()) * 1000 || 0;
    const pr = prs.find((item) => item.headRefName === wt.branch);
    const prText = pr ? `#${pr.number}/${pr.state}` : "-";
    const merged = gitOk(["merge-base", "--is-ancestor", wt.head, "origin/main"], repo);
    const transcript = latestTranscript(env.MSTACK_TRANSCRIPTS_DIR, wt.path, now);
    const dirty = gitStatus(wt.path);
    const bytes = directorySize(wt.path);
    return { size: humanSize(bytes), bytes, age: age(timestamp, now), merged: merged ? "YES" : "no", dirty, remote: remoteState(wt.path, wt.branch, wt.head), pr: prText, lastChat: transcript.date, bucket: classify({ dirty, pr: prText, recent: transcript.recent, merged }), worktree: wt.path, main };
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
