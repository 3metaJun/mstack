#!/usr/bin/env node
/** Read-only (unless --fetch), cross-platform Git worktree audit. */
import { execFileSync, spawnSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { homedir } from "node:os";
import { basename, delimiter, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import zlib from "node:zlib";

// An ignored path whose final segment is one of these names is a rebuildable
// build or cache artifact. Any other ignored path (including e.g. `build/.env`
// inside a tracked `build/` directory) may exist nowhere else.
export const DISPOSABLE = new Set([
  ".build", ".cache", ".dart_tool", ".DS_Store", ".gradle", ".lake", ".lycheecache", ".mypy_cache", ".next", ".nuxt",
  ".parcel-cache", ".pytest_cache", ".ruff_cache", ".svelte-kit", ".tox", ".turbo", ".venv", "__pycache__", "build",
  "coverage", "DerivedData", "dist", "node_modules", "target", "venv",
]);

function gitEnv(options = {}) {
  // Prevent `git status` from refreshing worktree indexes and colliding with active agents.
  return { ...process.env, ...options.env, GIT_OPTIONAL_LOCKS: "0" };
}

export function runGit(args, cwd, options = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    ...options,
    env: gitEnv(options),
  });
  return result.status === 0 ? result.stdout : "";
}

/** Like runGit, but a failed command stays distinguishable from empty output. */
function gitResult(args, cwd, options = {}) {
  const result = spawnSync("git", args, {
    cwd,
    encoding: "utf8",
    maxBuffer: 16 * 1024 * 1024,
    windowsHide: true,
    ...options,
    env: gitEnv(options),
  });
  return { ok: result.status === 0, stdout: result.stdout ?? "", stderr: result.stderr ?? "" };
}

function gitOk(args, cwd, options = {}) {
  return spawnSync("git", args, {
    cwd,
    stdio: "ignore",
    windowsHide: true,
    ...options,
    env: gitEnv(options),
  }).status === 0;
}

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
      current = { path: value, head: "", branch: null, detached: false, locked: null, prunable: false };
    } else if (current) {
      if (key === "HEAD") current.head = value;
      else if (key === "branch") current.branch = value.replace(/^refs\/heads\//, "");
      else if (key === "detached") current.detached = true;
      else if (key === "locked") current.locked = value;
      else if (key === "prunable") current.prunable = true;
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

function age(timestamp, now) {
  return timestamp > 0 ? `${Math.max(0, Math.floor((now - timestamp) / 86400000))}d` : "?";
}

// Both `git status --ignored=matching` and `git ls-files --directory --no-empty-directory`
// collapse wholly-ignored directories to entries ending in the directory name itself.
// Checking only the leaf avoids dropping an ignored secret like `build/.env` inside a
// tracked `build/` directory.
function isDisposableIgnored(entryPath) {
  const normalized = entryPath.replaceAll("\\", "/").replace(/\/+$/, "");
  const leaf = normalized.split("/").at(-1);
  return leaf !== undefined && DISPOSABLE.has(leaf);
}

function parsePorcelainStatus(output) {
  const tokens = output.split("\0");
  let wip = 0;
  let scratch = 0;
  let ignored = 0;
  for (let index = 0; index < tokens.length; index++) {
    const token = tokens[index];
    if (!token) continue;
    const status = token.slice(0, 2);
    const entryPath = token.slice(3);
    if (status === "??") {
      scratch += 1;
    } else if (status === "!!") {
      if (!isDisposableIgnored(entryPath)) ignored += 1;
    } else {
      wip += 1;
      // With `-z`, rename and copy entries emit a second NUL-terminated source path.
      if (status.includes("R") || status.includes("C")) index += 1;
    }
  }
  return { wip, scratch, ignored };
}

function countGitdirModules(modulesDir) {
  let count = 0;
  function walk(dir) {
    let entries;
    try { entries = readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      const full = join(dir, entry.name);
      if (existsSync(join(full, "HEAD"))) {
        count += 1;
        if (existsSync(join(full, "modules"))) walk(join(full, "modules"));
      } else {
        walk(full);
      }
    }
  }
  walk(modulesDir);
  return Math.max(count, 1);
}

function submoduleInfo(cwd) {
  // Git's validate_no_submodules refuses `git worktree remove` whenever
  // `<worktree-gitdir>/modules` exists (even after `git submodule deinit`),
  // as well as when initialized submodules are populated in the worktree.
  let cachedModules = 0;
  const gitDirRes = gitResult(["rev-parse", "--git-dir"], cwd);
  if (!gitDirRes.ok) return { ok: false, present: 0, ignored: 0 };
  const gitDir = resolve(cwd, gitDirRes.stdout.trim());
  const modulesDir = join(gitDir, "modules");
  if (existsSync(modulesDir)) {
    cachedModules = countGitdirModules(modulesDir);
  }
  if (!existsSync(join(cwd, ".gitmodules"))) {
    return { ok: true, present: cachedModules, ignored: 0 };
  }
  const status = gitResult(["submodule", "status", "--recursive"], cwd);
  if (!status.ok) return { ok: false, present: cachedModules, ignored: 0 };
  const initialized = status.stdout
    .split(/\r?\n/)
    .filter((line) => line.length > 0 && !line.startsWith("-"))
    .length;
  const nested = gitResult([
    "submodule", "foreach", "--quiet", "--recursive",
    "git ls-files --others --ignored --exclude-standard --directory --no-empty-directory -z",
  ], cwd);
  if (!nested.ok) return { ok: false, present: Math.max(initialized, cachedModules), ignored: 0 };
  const ignored = nested.stdout.split("\0").filter((name) => name && !isDisposableIgnored(name)).length;
  return { ok: true, present: Math.max(initialized, cachedModules), ignored };
}

function gitStatusDetails(cwd) {
  // Explicit --untracked-files=normal beats a status.showUntrackedFiles=no config,
  // which would otherwise hide scratch files and make --ignored fail.
  const { ok, stdout: output } = gitResult([
    "status", "--porcelain=v1", "-z",
    "--untracked-files=normal", "--ignored=matching", "--ignore-submodules=none",
  ], cwd);
  // A failed status says nothing about uncommitted work, so it must never read as clean.
  if (!ok) return null;
  const counts = parsePorcelainStatus(output);
  const sub = submoduleInfo(cwd);
  if (!sub.ok) return null;
  return { ...counts, ignored: counts.ignored + sub.ignored, submodules: sub.present };
}

// Counts commits that only this worktree's HEAD or HEAD reflog reaches, which
// `git worktree remove` deletes. Commits reachable from branches, tags, remotes,
// or shared branch reflogs survive removal.
function reflogOnlyCount(cwd, head, branchLogged) {
  if (!head || branchLogged === null) return null;
  const walked = gitResult(["rev-list", "--walk-reflogs", "HEAD"], cwd);
  if (!walked.ok) return null;
  const visited = new Set([head, ...walked.stdout.split(/\r?\n/).filter(Boolean)]);
  const lines = [...visited, ...branchLogged.map((sha) => `^${sha}`)];
  const counted = gitResult(
    ["rev-list", "--count", "--not", "--branches", "--tags", "--remotes", "--stdin"],
    cwd,
    { input: `${lines.join("\n")}\n` },
  );
  if (!counted.ok) return null;
  const value = Number(counted.stdout.trim());
  return Number.isInteger(value) && value >= 0 ? value : null;
}

function formatDirty(status, reflogCount) {
  if (status === null) return "unknown";
  const parts = [];
  if (status.wip > 0) parts.push(`wip:${status.wip}`);
  if (status.scratch > 0) parts.push(`scratch:${status.scratch}`);
  if (status.ignored > 0) parts.push(`ignored:${status.ignored}`);
  if (status.submodules > 0) parts.push(`submodule:${status.submodules}`);
  if (reflogCount === null) parts.push("reflog:?");
  else if (reflogCount > 0) parts.push(`reflog:${reflogCount}`);
  return parts.length ? parts.join(",") : "clean";
}

function lockedLabel(locked) {
  if (locked === null || locked === undefined) return "-";
  return locked.replace(/\s+/g, " ").trim() || "locked";
}

function remoteState(worktree, branch, head) {
  if (!branch) return "detached";
  const upstreamRef = runGit(["rev-parse", "--verify", "--quiet", "--symbolic-full-name", "@{upstream}"], worktree).trim();
  const remoteRef = upstreamRef || `refs/remotes/origin/${branch}`;
  const remoteHead = runGit(["rev-parse", "--verify", "--quiet", `${remoteRef}^{commit}`], worktree).trim();
  if (!remoteHead) return "no-remote";
  if (remoteHead === head) return "pushed";
  const counts = runGit(["rev-list", "--left-right", "--count", `${remoteRef}...HEAD`], worktree).trim();
  const match = /^(\d+)\s+(\d+)$/.exec(counts);
  if (!match) return "diverged";
  const behind = Number(match[1]);
  const ahead = Number(match[2]);
  if (ahead > 0 && behind > 0) return `ahead${ahead},behind${behind}`;
  if (ahead > 0) return `ahead${ahead}`;
  if (behind > 0) return `behind${behind}`;
  return "pushed";
}

function expandHome(path, home) {
  if (path === "~") return home;
  return /^~[/\\]/.test(path) ? join(home, path.slice(2)) : path;
}

function pathKey(path) {
  let resolved;
  try {
    resolved = existsSync(path) ? realpathSync.native(path) : resolve(path);
  } catch {
    resolved = resolve(path);
  }
  return process.platform === "win32" ? resolved.toLowerCase() : resolved;
}

function t3CustomTranscriptRoots(env, home) {
  const t3Base = typeof env.T3CODE_HOME === "string" && env.T3CODE_HOME.trim()
    ? resolve(expandHome(env.T3CODE_HOME.trim(), home))
    : join(home, ".t3");
  const settingsPath = join(t3Base, "userdata", "settings.json");
  if (!existsSync(settingsPath)) return [];
  let instances;
  try {
    instances = JSON.parse(readFileSync(settingsPath, "utf8"))?.providerInstances ?? {};
  } catch {
    return [];
  }
  const roots = [];
  const shadows = new Set();
  for (const instance of Object.values(instances)) {
    const shadow = typeof instance?.config?.shadowHomePath === "string" ? instance.config.shadowHomePath.trim() : "";
    if (shadow) shadows.add(pathKey(expandHome(shadow, home)));
  }
  for (const instance of Object.values(instances)) {
    const driver = instance?.driver;
    if (driver !== "claudeAgent" && driver !== "codex") continue;
    const envName = driver === "claudeAgent" ? "CLAUDE_CONFIG_DIR" : "CODEX_HOME";
    const configHome = typeof instance?.config?.homePath === "string" ? instance.config.homePath.trim() : "";
    const envEntries = Array.isArray(instance?.environment) ? instance.environment : [];
    const envEntry = [...envEntries].reverse().find((entry) => entry?.name === envName);
    if (!configHome && (envEntry?.secret || envEntry?.valueRedacted === true)) continue;
    const raw = configHome || (typeof envEntry?.value === "string" ? envEntry.value.trim() : "");
    if (!raw) continue;
    const dir = resolve(expandHome(raw, home));
    if (shadows.has(pathKey(dir))) continue;
    if (driver === "claudeAgent") {
      roots.push(join(dir, "projects"));
    } else {
      roots.push(join(dir, "sessions"), join(dir, "archived_sessions"));
    }
  }
  return roots;
}

/**
 * Where each Harness keeps its sessions, so a chat that touched a worktree is found wherever it ran.
 * MSTACK_TRANSCRIPTS_DIR replaces them all with one or more delimiter-separated directories.
 * OpenCode has no raw session files to read, so it is not scanned.
 */
export function defaultTranscriptRoots({ env = process.env, home = homedir() } = {}) {
  if (env.MSTACK_TRANSCRIPTS_DIR) {
    const raw = env.MSTACK_TRANSCRIPTS_DIR;
    const expanded = expandHome(raw, home);
    if (!existsSync(expanded) && raw.includes(delimiter)) {
      const parts = raw.split(delimiter).map((part) => part.trim()).filter(Boolean).map((part) => expandHome(part, home));
      if (parts.length > 0) return parts;
    }
    return [expanded];
  }
  const codex = expandHome(env.CODEX_HOME || join(home, ".codex"), home);
  const claude = expandHome(env.CLAUDE_CONFIG_DIR || join(home, ".claude"), home);
  const piAgent = expandHome(env.PI_CODING_AGENT_DIR || join(home, ".pi", "agent"), home);
  const piRoots = env.PI_CODING_AGENT_SESSION_DIR
    ? [expandHome(env.PI_CODING_AGENT_SESSION_DIR, home)]
    : [join(piAgent, "sessions"), join(piAgent, "pstack"), join(piAgent, "mstack")];
  const copilot = join(expandHome(env.COPILOT_HOME || join(home, ".copilot"), home), "session-state");
  const candidates = [
    join(claude, "projects"),
    join(codex, "sessions"),
    join(codex, "archived_sessions"),
    ...piRoots,
    copilot,
    ...t3CustomTranscriptRoots(env, home),
  ];
  const seen = new Set();
  const existing = [];
  for (const root of candidates) {
    if (!existsSync(root)) continue;
    let key;
    try { key = realpathSync(root); } catch { key = resolve(root); }
    if (seen.has(key)) continue;
    seen.add(key);
    existing.push(root);
  }
  return existing;
}

// APFS inode numbers can exceed 2^53.
function fileId(path, stat) {
  const { dev, ino } = stat(path, { bigint: true });
  return `${dev}:${ino}`;
}

function symlinkTargets(dir, stat = statSync) {
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (error) {
    if (["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(error?.code)) return [];
    throw error;
  }
  return entries.filter((entry) => entry.isSymbolicLink()).flatMap((entry) => {
    const link = join(dir, entry.name);
    try {
      let name;
      if (!(process.platform === "darwin" && process.versions.bun)) {
        try { name = realpathSync(link); } catch { name = undefined; }
      }
      return [[link, { id: fileId(link, stat), name }]];
    } catch (error) {
      if (["ENOENT", "ELOOP", "EACCES", "EPERM"].includes(error?.code)) return [];
      throw error;
    }
  });
}

// Git reports a worktree by its resolved path, while a session may name it
// through an ancestor symlink (such as macOS `/tmp/x` vs `/private/tmp/x`).
export function pathSpellings(path, linksIn = symlinkTargets, stat = statSync) {
  let resolved;
  try {
    resolved = realpathSync(path);
  } catch (error) {
    if (error?.code === "ENOENT") return [path];
    throw error;
  }
  const ancestors = [];
  for (let dir = dirname(resolved); ; dir = dirname(dir)) {
    ancestors.unshift(dir);
    if (dir === dirname(dir)) break;
  }
  const onPath = [...ancestors, resolved];
  const ids = new Map();
  for (const target of onPath) {
    try { ids.set(target, fileId(target, stat)); } catch { /* ignore unreadable ancestor */ }
  }
  const links = ancestors.flatMap((dir) => linksIn(dir, stat).flatMap(([link, { id, name }]) =>
    onPath.filter((target) => target === name || (ids.has(target) && ids.get(target) === id))
      .map((target) => [dir, link, target])));
  const spelled = new Map();
  for (const dir of onPath) {
    const parent = dirname(dir);
    const forms = new Set(parent === dir ? [dir] : (spelled.get(parent) ?? [parent]).map((form) => join(form, basename(dir))));
    for (const [linkHome, link, target] of links) {
      if (target === dir) {
        for (const form of spelled.get(linkHome) ?? [linkHome]) forms.add(join(form, basename(link)));
      }
    }
    spelled.set(dir, [...forms]);
  }
  return [...new Set([path, ...(spelled.get(resolved) ?? [resolved])])];
}

// A transcript names a worktree as a whole path token. It must end at a path boundary (a separator, a quote,
// whitespace, or the end of a JSON string) and begin at one (the start of the text, whitespace, a quote, or
// an opening bracket), so `/x/wt` inherits neither a chat in `/x/wt-long` nor one in `/other/x/wt`.
// Git on Windows prints `C:/x/wt` while a session records `C:\x\wt` (`C:\\x\\wt` once JSON-escaped),
// so a Windows or UNC path is searched in both separator spellings and both drive-letter cases.
const PATH_BOUNDARIES = ["/", "\\", '"', "'", " ", "\t", "\n", "\r"];
function transcriptNeedles(pathsOrPath) {
  const input = Array.isArray(pathsOrPath) ? pathsOrPath : [pathsOrPath];
  const spellings = input.flatMap((path) => (/^(?:[a-z]:[\\/]|\\\\|\/\/)/i.test(path)
    ? [path.replaceAll("\\", "/"), path.replaceAll("/", "\\")].flatMap((spelling) =>
      /^[a-z]:/i.test(spelling) ? [spelling[0].toLowerCase() + spelling.slice(1), spelling[0].toUpperCase() + spelling.slice(1)] : [spelling])
    : [path]));
  return [...new Set(spellings)].flatMap((spelling) => [
    // Plain text, as in an exported transcript.
    ...PATH_BOUNDARIES.map((end) => spelling + end),
    // JSON text: the path and its boundary escaped, or the path closing its string.
    ...PATH_BOUNDARIES.map((end) => JSON.stringify(spelling + end).slice(1, -1)),
    JSON.stringify(spelling).slice(1),
  ]).map((needle) => Buffer.from(needle));
}

const START_BOUNDARIES = new Set([..." \t\n\r\"'`=(,;<>|[{"].map((char) => char.charCodeAt(0)));
// The Windows verbatim prefix may sit in front of a drive path, plain or JSON-escaped.
const VERBATIM_PREFIXES = ["\\\\?\\", "\\\\\\\\?\\\\", "//?/"].map((prefix) => Buffer.from(prefix));
function startsPathToken(text, at) {
  if (at === 0) return true;
  const previous = text[at - 1];
  if (START_BOUNDARIES.has(previous)) return true;
  // A JSON-escaped newline, tab or return: an odd run of backslashes before the letter.
  if ([0x6e, 0x72, 0x74].includes(previous)) {
    let slashes = 0;
    while (at - 2 - slashes >= 0 && text[at - 2 - slashes] === 0x5c) slashes++;
    if (slashes % 2 === 1) return true;
  }
  return VERBATIM_PREFIXES.some((prefix) => at >= prefix.length && text.subarray(at - prefix.length, at).equals(prefix) && startsPathToken(text, at - prefix.length));
}
function namesPath(text, forms) {
  return forms.some((form) => {
    // A space or tab ends a path in shell text (`cd /x/wt && ls`), but a value that opens with a quote
    // directly before the path is one whole path, so `"/x/wt long"` names another directory.
    const endsAtBlank = form.at(-1) === 0x20 || form.at(-1) === 0x09;
    for (let at = text.indexOf(form); at !== -1; at = text.indexOf(form, at + 1)) {
      if (endsAtBlank && at > 0 && (text[at - 1] === 0x22 || text[at - 1] === 0x27)) continue;
      if (startsPathToken(text, at)) return true;
    }
    return false;
  });
}

// Verify native Zstd rejects truncated frames and decodes multi-frame streams before trusting it.
function nativeZstdDecoder() {
  const decode = zlib.zstdDecompressSync;
  if (typeof decode !== "function") return undefined;
  const frame = Buffer.from("28b52ffd200109000061", "hex");
  const joined = Buffer.concat([frame, frame]);
  try {
    if (decode(joined).toString() !== "aa") return undefined;
  } catch {
    return undefined;
  }
  for (const partial of [frame.subarray(0, -1), joined.subarray(0, -1)]) {
    try {
      decode(partial);
      return undefined;
    } catch { /* complete-stream decoder must reject unfinished frames */ }
  }
  return decode;
}

const decodeZstd = nativeZstdDecoder() ?? ((input) => execFileSync("zstd", ["-d", "-c"], {
  input,
  stdio: ["pipe", "pipe", "pipe"],
  maxBuffer: Infinity,
  timeout: 30_000,
  windowsHide: true,
}));

function* transcriptFiles(root, errors, { requireRoot = false } = {}) {
  let entries;
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch (error) {
    if (requireRoot || !["ENOENT", "ENOTDIR"].includes(error?.code)) {
      errors.push(`cannot read transcript directory ${root}: ${error?.message ?? String(error)}`);
    }
    return;
  }
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) yield* transcriptFiles(path, errors);
    else if (entry.isFile()) yield path;
  }
}

export function scanChats(roots, paths, { requireRoots = false } = {}) {
  const errors = [];
  const needles = paths.map((path) => {
    let forms = [path];
    try {
      forms = pathSpellings(path);
    } catch (error) {
      errors.push(`cannot inspect path spellings for ${path}: ${error?.message ?? String(error)}`);
    }
    return [path, transcriptNeedles(forms)];
  });
  const latest = new Map();
  for (const root of roots) {
    for (const file of transcriptFiles(root, errors, { requireRoot: requireRoots })) {
      let mtime;
      let text;
      try {
        mtime = lstatSync(file).mtimeMs;
        // A file older than every path's newest match cannot change an answer, so it is not read.
        if (!needles.some(([path]) => mtime > (latest.get(path) ?? 0))) continue;
        text = readFileSync(file);
        // Re-read mtime after read in case an active session wrote to it mid-scan.
        mtime = lstatSync(file).mtimeMs;
      } catch (error) {
        if (error?.code !== "ENOENT") {
          errors.push(`cannot read transcript ${file}: ${error?.message ?? String(error)}`);
        }
        continue;
      }
      if (file.endsWith(".jsonl.zst")) {
        try {
          text = decodeZstd(text);
        } catch (error) {
          const hint = error?.code === "ENOENT" ? " Install zstd or use a runtime with native Zstd support." : "";
          errors.push(`cannot decode ${file}: ${String(error?.stderr ?? "").trim() || error?.message || String(error)}${hint}`);
          continue;
        }
      }
      for (const [path, forms] of needles) {
        if (mtime > (latest.get(path) ?? 0) && namesPath(text, forms)) latest.set(path, mtime);
      }
    }
  }
  return { chats: latest, known: errors.length === 0, errors };
}

/** Newest transcript mtime (ms) that names each path, for every path a transcript under `roots` mentions. */
export function lastChats(roots, paths) {
  return scanChats(roots, paths).chats;
}

// `prMerged` means a PR merged into the base branch carried exactly this worktree HEAD.
// A closed PR landed nothing, and a merged PR does not cover commits made after it.
// Every hold gate takes precedence; `safe` requires all checks clean and known.
export function classify({ dirty, pr, recent, merged, prMerged = false, locked = null, prunable = false, unknownFact = false }) {
  if (prunable) return "prunable";
  if (locked !== null && locked !== undefined && locked !== false) return "hold-locked";
  if (dirty === "unknown") return "hold-unknown";
  if (/(?:^|,)wip:/.test(dirty)) return "hold-wip";
  if (/(?:^|,)scratch:/.test(dirty)) return "hold-scratch";
  if (/(?:^|,)reflog:/.test(dirty)) return "hold-reflog";
  if (/(?:^|,)ignored:/.test(dirty)) return "hold-ignored";
  if (/(?:^|,)submodule:/.test(dirty)) return "hold-submodule";
  if (/\/(?:OPEN|DRAFT)\b/i.test(pr) || pr.includes("OPEN")) return "hold-open-pr";
  if (recent) return "verify-recent-chat";
  if (unknownFact) return "review";
  if (merged || prMerged) return "safe";
  return "review";
}

function listAuthoredPrs(repo) {
  const gh = spawnSync("gh", ["pr", "list", "--author", "@me", "--state", "all", "--limit", "1000", "--json", "number,state,headRefName,headRefOid,baseRefName"], {
    cwd: repo,
    encoding: "utf8",
    windowsHide: true,
  });
  if (gh.status !== 0) return null;
  try {
    const parsed = JSON.parse(gh.stdout);
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function resolveBase(repo, requestedBase, { fetch = false, warn = () => {} } = {}) {
  let base = requestedBase;
  if (!base) {
    const originHead = runGit(["symbolic-ref", "--quiet", "refs/remotes/origin/HEAD"], repo).trim().replace(/^refs\/remotes\//, "");
    const candidates = [originHead, "origin/main", "origin/master"].filter(Boolean);
    base = candidates.find((candidate) => gitOk(["rev-parse", "--verify", "--quiet", `refs/remotes/${candidate}^{commit}`], repo));
    if (!base) {
      throw new Error("no base ref (origin/HEAD, origin/main, origin/master all missing); pass -b <ref>");
    }
  }
  // A local branch or tag named origin/main wins git's shorthand lookup over
  // refs/remotes/origin/main, so a base under a remote's name is read by its full ref.
  const remotes = runGit(["remote"], repo).split(/\r?\n/).filter(Boolean).sort((a, b) => b.length - a.length);
  const remoteBaseName = base.replace(/^refs\/remotes\//, "");
  const matchedRemote = remotes.find((name) => remoteBaseName.startsWith(`${name}/`));
  const branch = matchedRemote ? remoteBaseName.slice(matchedRemote.length + 1) : base.replace(/^refs\/(?:heads|remotes\/[^/]+)\//, "");
  if (fetch) {
    if (matchedRemote) {
      if (!gitOk(["fetch", matchedRemote, `+refs/heads/${branch}:refs/remotes/${matchedRemote}/${branch}`, "--quiet"], repo)) {
        warn(`warn: could not fetch ${base}; merged column may be stale`);
      }
    } else {
      warn(`warn: --fetch ignored for non-remote base ${base}`);
    }
  }
  const ref = matchedRemote ? `refs/remotes/${remoteBaseName}` : base;
  if (!gitOk(["rev-parse", "--verify", "--quiet", `${ref}^{commit}`], repo)) {
    throw new Error(`base ref not found: ${base}; pass --fetch to fetch a remote base`);
  }
  return { base, ref, branch };
}

export function audit(
  repo = runGit(["rev-parse", "--show-toplevel"], process.cwd()).trim(),
  env = process.env,
  { listPrs = listAuthoredPrs, home = homedir(), base: requestedBase, fetch = false, warn = () => {} } = {},
) {
  if (!repo) throw new Error("not in a git repo; pass a repo path");
  repo = resolve(repo);
  const worktrees = parseWorktreePorcelain(runGit(["worktree", "list", "--porcelain", "-z"], repo));
  if (!worktrees.length) throw new Error("could not read git worktrees");
  if (worktrees.length === 1) return [];
  const baseInfo = resolveBase(repo, requestedBase, { fetch, warn });
  const rawPrs = listPrs(repo);
  const prsKnown = Array.isArray(rawPrs);
  const prs = prsKnown ? rawPrs : [];
  if (!prsKnown) warn("warn: gh pr list failed; PR column will be empty and no worktree will be marked safe");
  const branchLogsResult = gitResult(["rev-list", "--walk-reflogs", "--branches"], repo);
  const branchLogged = branchLogsResult.ok ? [...new Set(branchLogsResult.stdout.split(/\r?\n/).filter(Boolean))] : null;
  const now = Date.now();
  const main = worktrees[0]?.path;
  const livePaths = worktrees.slice(1).filter((wt) => !wt.prunable).map((wt) => wt.path);
  // One pass over the transcripts answers for every live worktree.
  const explicitTranscripts = Boolean(env.MSTACK_TRANSCRIPTS_DIR);
  const chatScan = livePaths.length
    ? scanChats(defaultTranscriptRoots({ env, home }), livePaths, { requireRoots: explicitTranscripts })
    : { chats: new Map(), known: true, errors: [] };
  if (!chatScan.known) {
    for (const error of chatScan.errors) warn(`warn: ${error}`);
    warn("warn: transcript scan was incomplete; no worktree will be marked safe");
  }
  const chats = chatScan.chats;
  return worktrees.slice(1).map((wt) => {
    if (wt.prunable) {
      return {
        size: "-",
        bytes: 0,
        age: "?",
        merged: "-",
        dirty: "-",
        remote: "-",
        pr: "-",
        lastChat: "-",
        bucket: "prunable",
        locked: lockedLabel(wt.locked),
        worktree: wt.path,
        main,
        base: baseInfo.base,
      };
    }
    const timestamp = Number(runGit(["log", "-1", "--format=%ct", "HEAD"], wt.path).trim()) * 1000 || 0;
    const candidates = wt.branch ? prs.filter((item) => item.headRefName === wt.branch) : [];
    // Only a PR merged into the base branch this audit compares against shows the work landed.
    const landed = (item) =>
      String(item.state).toUpperCase() === "MERGED" && item.headRefOid === wt.head && item.baseRefName === baseInfo.branch;
    const isOpen = (item) => ["OPEN", "DRAFT"].includes(String(item.state).toUpperCase());
    const pr = candidates.find(isOpen) ?? candidates.find(landed) ?? candidates[0];
    const prText = pr ? `#${pr.number}/${pr.state}` : "-";
    const merged = wt.head ? gitOk(["merge-base", "--is-ancestor", wt.head, baseInfo.ref], repo) : false;
    const newest = chats.get(wt.path);
    const transcript = newest
      ? { date: new Date(newest).toISOString().slice(0, 10), recent: (now - newest) / 86400000 <= 4 }
      : { date: chatScan.known ? "-" : "?", recent: false };
    const status = gitStatusDetails(wt.path);
    const reflogCount = status === null ? null : reflogOnlyCount(wt.path, wt.head, branchLogged);
    const dirty = formatDirty(status, reflogCount);
    const bytes = directorySize(wt.path);
    const unknownFact = !prsKnown || !chatScan.known || reflogCount === null || !wt.head;
    return {
      size: humanSize(bytes),
      bytes,
      age: age(timestamp, now),
      merged: merged ? "YES" : "no",
      dirty,
      remote: remoteState(wt.path, wt.branch, wt.head),
      pr: prText,
      lastChat: transcript.date,
      bucket: classify({
        dirty,
        pr: prText,
        recent: transcript.recent,
        merged,
        prMerged: pr ? landed(pr) : false,
        locked: wt.locked,
        prunable: wt.prunable,
        unknownFact,
      }),
      locked: lockedLabel(wt.locked),
      worktree: wt.path,
      main,
      base: baseInfo.base,
    };
  }).sort((a, b) => b.bytes - a.bytes);
}

export function format(rows) {
  const lines = [];
  if (rows[0]?.base) lines.push(`# base: ${rows[0].base}`);
  lines.push("SIZE\tAGE\tMERGED\tDIRTY\tREMOTE\tPR\tLAST_CHAT\tBUCKET\tLOCKED\tWORKTREE");
  for (const row of rows) {
    lines.push([row.size, row.age, row.merged, row.dirty, row.remote, row.pr, row.lastChat, row.bucket, row.locked ?? "-", row.worktree].join("\t"));
  }
  return `${lines.join("\n")}\n`;
}

export function parseCliArgs(argv) {
  let base;
  let fetch = false;
  let help = false;
  let endOfOptions = false;
  const positional = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    if (endOfOptions) {
      positional.push(arg);
      continue;
    }
    if (arg === "--") {
      endOfOptions = true;
    } else if (arg === "-h" || arg === "--help") {
      help = true;
    } else if (arg === "--fetch") {
      fetch = true;
    } else if (arg.startsWith("--base=")) {
      const value = arg.slice("--base=".length);
      if (!value) throw new Error("--base requires a ref");
      base = value;
    } else if (arg === "-b" || arg === "--base") {
      const value = argv[++index];
      if (!value || value.startsWith("-")) throw new Error(`${arg} requires a ref`);
      base = value;
    } else if (arg.startsWith("-")) {
      throw new Error(`unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 1) throw new Error(`unexpected extra argument: ${positional[1]}`);
  return { base, fetch, help, repo: positional[0] };
}

const USAGE = `Usage: worktree-audit.mjs [-b|--base <ref>] [--fetch] [--] [repo-path]

Read-only worktree prune audit unless --fetch is passed.
  -b, --base <ref>  Ref the MERGED column checks against (default: origin/HEAD, origin/main, origin/master)
  --fetch           Refresh a remote base (<remote>/<branch>) before checking MERGED
  repo-path         Repository path (default: current git repository)
`;

function isDirectEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

if (isDirectEntry()) {
  try {
    const parsed = parseCliArgs(process.argv.slice(2));
    if (parsed.help) {
      process.stdout.write(USAGE);
    } else {
      process.stdout.write(format(audit(parsed.repo, process.env, {
        base: parsed.base,
        fetch: parsed.fetch,
        warn: (line) => console.error(line),
      })));
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
