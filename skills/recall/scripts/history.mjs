#!/usr/bin/env node

import { createReadStream, existsSync, realpathSync } from "node:fs";
import { readdir, readFile, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { createInterface } from "node:readline";
import { spawnSync } from "node:child_process";

const HARNESSES = ["codex", "claude", "opencode", "pi"];
const MAX_FILE_BYTES = 16 * 1024 * 1024;

function pathKey(path) {
  const normalized = resolve(path);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
}

function sameWorkspace(left, right) {
  return typeof left === "string" && pathKey(left) === pathKey(right);
}

function expandHome(path) {
  if (path === "~") return homedir();
  return /^[~][/\\]/.test(path) ? join(homedir(), path.slice(2)) : resolve(path);
}

function storeRoot(options) {
  if (options.root) return expandHome(options.root);
  const { env, harness } = options;
  if (harness === "codex") return expandHome(env.CODEX_HOME || join(homedir(), ".codex"));
  if (harness === "claude") return expandHome(env.CLAUDE_CONFIG_DIR || join(homedir(), ".claude"));
  if (env.PI_CODING_AGENT_SESSION_DIR) return expandHome(env.PI_CODING_AGENT_SESSION_DIR);
  const slug = `--${options.workspace.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  return join(expandHome(env.PI_CODING_AGENT_DIR || join(homedir(), ".pi", "agent")), "sessions", slug);
}

async function filesUnder(directory, warnings) {
  let entries;
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error.code !== "ENOENT") warnings.push(`A history directory could not be listed (${error.code ?? "I/O error"}).`);
    return [];
  }
  const files = [];
  for (const entry of entries) {
    if (entry.name === "subagents") continue;
    const path = join(directory, entry.name);
    if (entry.isDirectory()) files.push(...await filesUnder(path, warnings));
    else if (entry.isFile() && entry.name.endsWith(".jsonl")) files.push(path);
  }
  return files;
}

async function metadata(path, harness) {
  const stream = createReadStream(path, { encoding: "utf8", highWaterMark: 4096, end: 1024 * 1024 - 1 });
  const closed = new Promise((resolveClosed) => stream.once("close", resolveClosed));
  const lines = createInterface({ input: stream, crlfDelay: Infinity });
  let count = 0;
  try {
    for await (const line of lines) {
      if (++count > 20 || line.length > 1024 * 1024) break;
      if (!line.trim()) continue;
      const row = JSON.parse(line);
      if (harness === "codex") {
        if (row.type !== "session_meta") break;
        return { id: row.payload?.id, workspace: row.payload?.cwd, child: Boolean(row.payload?.source?.subagent) };
      }
      if (harness === "pi") {
        if (row.type !== "session" || row.version !== 3) break;
        return { id: row.id, workspace: row.cwd };
      }
      if (typeof row.cwd === "string" && typeof row.sessionId === "string") {
        return { id: row.sessionId, workspace: row.cwd, child: row.isSidechain === true };
      }
    }
    throw new Error("Unsupported session metadata");
  } catch {
    throw new Error("Session metadata is unreadable or unsupported.");
  } finally {
    lines.close();
    stream.destroy();
    // On Windows, destroy() returns before its file descriptor is closed.
    await closed;
  }
}

function openCode(args, cwd, env) {
  let command = "opencode";
  let commandArgs = args;
  if (process.platform === "win32") {
    const quoted = args.map((arg) => `'${arg.replaceAll("'", "''")}'`).join(", ");
    const script = `$ErrorActionPreference = 'Stop'\n$recallArgs = @(${quoted})\n& opencode @recallArgs\nif ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }`;
    command = "powershell.exe";
    commandArgs = ["-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")];
  }
  const result = spawnSync(command, commandArgs, { cwd, env, encoding: "utf8", maxBuffer: MAX_FILE_BYTES, timeout: 30_000, windowsHide: true });
  if (result.error || result.status !== 0) throw new Error("OpenCode history command failed; check CLI availability and its configured data directory.");
  try {
    return JSON.parse(result.stdout);
  } catch {
    throw new Error("OpenCode returned unsupported JSON output.");
  }
}

async function discover(options, warnings) {
  const { harness, workspace } = options;
  if (harness === "opencode") {
    const rows = await options.runOpenCode(["session", "list", "--format", "json", "--pure"], workspace, options.env);
    if (!Array.isArray(rows)) throw new Error("OpenCode session list must return a JSON array.");
    return rows.filter((row) => row && sameWorkspace(row.directory, workspace)).map((row) => ({
      id: row.id, workspace: row.directory, updated: row.updated ?? row.time?.updated, child: Boolean(row.parentID),
    }));
  }
  const root = storeRoot(options);
  const roots = harness === "codex" ? [join(root, "sessions"), join(root, "archived_sessions")]
    : harness === "claude" ? [join(root, "projects", workspace.replace(/[^a-zA-Z0-9]/g, "-"))] : [root];
  const sessions = [];
  for (const directory of roots) {
    for (const path of await filesUnder(directory, warnings)) {
      try {
        const file = await stat(path);
        if (file.mtimeMs < options.since) continue;
        const info = await metadata(path, harness);
        if (sameWorkspace(info.workspace, workspace)) sessions.push({ ...info, path, updated: file.mtimeMs });
      } catch {
        warnings.push("Skipped a session with unreadable or unsupported metadata.");
      }
    }
  }
  return sessions;
}

function textContent(content) {
  if (typeof content === "string") return content;
  if (!Array.isArray(content)) return "";
  return content.filter((part) => ["text", "input_text", "output_text"].includes(part?.type) && typeof part.text === "string")
    .map((part) => part.text).join("\n");
}

function conversationBranch(rows, harness, leaf) {
  const idKey = harness === "pi" ? "id" : "uuid";
  const parentKey = harness === "pi" ? "parentId" : "parentUuid";
  const entries = rows.filter((row) => typeof row[idKey] === "string" && row.type !== "session");
  if (!entries.length) return [];
  const byId = new Map(entries.map((row) => [row[idKey], row]));
  if (byId.size !== entries.length) throw new Error("Session contains duplicate branch entry IDs.");
  let current = leaf ?? entries.at(-1)[idKey];
  if (!byId.has(current)) throw new Error("Unknown leaf in the selected session.");
  const seen = new Set();
  const branch = [];
  while (current !== null && current !== undefined) {
    if (seen.has(current)) throw new Error("Session contains a branch cycle.");
    seen.add(current);
    const row = byId.get(current);
    if (!row) throw new Error("Session branch is incomplete; a parent entry is missing.");
    branch.push(row);
    current = row[parentKey];
  }
  return branch.reverse();
}

async function readMessages(session, options, warnings) {
  if (options.harness === "opencode") {
    const args = ["export", session.id, ...(options.localText ? [] : ["--sanitize"]), "--pure"];
    const data = await options.runOpenCode(args, options.workspace, options.env);
    const directory = data?.info?.directory;
    // Sanitized exports replace the directory after list metadata established the workspace.
    const matchesDirectory = sameWorkspace(directory, options.workspace) || directory === `[redacted:session-directory:${session.id}]`;
    if (data?.info?.id !== session.id || !matchesDirectory || !Array.isArray(data.messages)) {
      throw new Error("OpenCode export does not match the selected workspace and session.");
    }
    const messages = data.messages.map((row) => ({ role: row.info?.role, text: textContent(row.parts) }));
    if (!options.localText && messages.some((message) => /\[redacted:text:/.test(message.text))) {
      warnings.push("OpenCode sanitized export redacted message text. Use --local-text for private local recovery of the selected session.");
    }
    return messages;
  }
  // Recheck metadata when opening the chosen file; discovery is not a permanent authorization token.
  const info = await metadata(session.path, options.harness);
  if (info.id !== session.id || !sameWorkspace(info.workspace, options.workspace) || info.child) {
    throw new Error("Session metadata changed since discovery.");
  }
  if ((await stat(session.path)).size > MAX_FILE_BYTES) throw new Error("Selected session exceeds 16 MiB; use the harness export or a narrower native reader.");
  const rows = [];
  let malformed = 0;
  for (const line of (await readFile(session.path, "utf8")).split(/\r?\n/)) {
    if (!line.trim()) continue;
    try {
      const row = JSON.parse(line);
      if (row && typeof row === "object" && !Array.isArray(row)) rows.push(row);
      else malformed++;
    } catch { malformed++; }
  }
  if (malformed) warnings.push(`Skipped ${malformed} malformed record(s) in the selected session.`);
  if (options.harness === "codex") {
    const messages = rows.filter((row) => row.type === "response_item" && row.payload?.type === "message");
    if (messages.length) return messages.map((row) => ({ role: row.payload.role, text: textContent(row.payload.content) }));
    return rows.filter((row) => row.type === "event_msg" && ["user_message", "agent_message"].includes(row.payload?.type))
      .map((row) => ({ role: row.payload.type === "user_message" ? "user" : "assistant", text: textContent(row.payload.message) }));
  }
  return conversationBranch(rows, options.harness, options.leaf).map((row) =>
    options.harness === "pi" && ["compaction", "branch_summary"].includes(row.type)
      ? { role: "summary", text: textContent(row.summary) }
      : { role: row.message?.role, text: textContent(row.message?.content) });
}

export async function history(input) {
  const options = { env: process.env, runOpenCode: openCode, limit: 20, maxChars: 12_000, ...input };
  if (!["list", "read"].includes(options.command)) throw new Error("Command must be list or read.");
  if (!HARNESSES.includes(options.harness)) throw new Error(`--harness must be one of ${HARNESSES.join(", ")}.`);
  if (typeof options.workspace !== "string" || !options.workspace.trim()) throw new Error("--workspace is required.");
  options.workspace = expandHome(options.workspace);
  for (const name of ["limit", "maxChars"]) {
    if (!Number.isSafeInteger(options[name]) || options[name] < 1 || options[name] > 1_000_000) throw new Error(`${name} must be an integer between 1 and 1000000.`);
  }
  options.since = options.since === undefined ? (options.command === "list" ? Date.now() - 7 * 86400_000 : 0) : Date.parse(options.since);
  if (!Number.isFinite(options.since)) throw new Error("--since must be an ISO date or timestamp.");
  if (options.command === "read" && (typeof options.session !== "string" || !options.session.trim())) throw new Error("read requires --session.");
  if (options.localText && (options.harness !== "opencode" || options.command !== "read")) throw new Error("--local-text is supported only for OpenCode read with an explicit workspace and session.");
  if (options.leaf && !["pi", "claude"].includes(options.harness)) throw new Error("--leaf is supported only for pi and Claude.");
  if (options.root && options.harness === "opencode") throw new Error("OpenCode uses its own configured data directory; --root is not supported.");
  const exclusions = new Set(options.exclude ?? []);
  if (options.harness === "codex" && options.env.CODEX_THREAD_ID) exclusions.add(options.env.CODEX_THREAD_ID);
  const warnings = [];
  const discovered = await discover(options, warnings);
  if (discovered.some((session) => typeof session.id !== "string" || !session.id || !Number.isFinite(session.updated))) {
    warnings.push("Skipped session metadata without a supported ID or update timestamp.");
  }
  const candidates = discovered.filter((session) =>
    typeof session.id === "string" && session.id.length > 0 && !session.child && !exclusions.has(session.id)
    && Number.isFinite(session.updated) && session.updated >= options.since)
    .sort((left, right) => right.updated - left.updated);
  const byId = new Map();
  for (const session of candidates) if (!byId.has(session.id)) byId.set(session.id, session);
  const sessions = [...byId.values()];
  const publicSession = ({ id, workspace, updated }) => ({ id, workspace, updated: new Date(updated).toISOString() });
  if (options.command === "list") return { sessions: sessions.slice(0, options.limit).map(publicSession), truncated: sessions.length > options.limit, warnings };
  const session = sessions.find((candidate) => candidate.id === options.session);
  if (!session) throw new Error("Session not found in the requested workspace, time window, or exclusions.");
  const messages = (await readMessages(session, options, warnings))
    .filter((message) => ["user", "assistant", "summary"].includes(message.role) && message.text)
    .filter((message) => !options.query || message.text.toLowerCase().includes(options.query.toLowerCase()));
  let budget = options.maxChars;
  let truncated = messages.length > options.limit;
  const selected = [];
  for (const message of messages.slice(-options.limit).reverse()) {
    if (budget === 0) { truncated = true; break; }
    const text = message.text.slice(0, budget);
    if (text.length !== message.text.length) truncated = true;
    budget -= text.length;
    selected.push({ role: message.role, text });
  }
  return { session: publicSession(session), messages: selected.reverse(), sanitized: options.harness === "opencode" && !options.localText, truncated, warnings };
}

function argumentsFor(argv) {
  const options = { command: argv[0], exclude: [] };
  const flags = { "--harness": "harness", "--workspace": "workspace", "--root": "root", "--since": "since", "--session": "session", "--leaf": "leaf", "--query": "query", "--limit": "limit", "--max-chars": "maxChars", "--exclude": "exclude" };
  for (let index = 1; index < argv.length; index++) {
    if (argv[index] === "--local-text") { options.localText = true; continue; }
    const key = flags[argv[index]];
    if (!key) throw new Error(`Unknown option: ${argv[index]}`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${argv[index]} requires a value.`);
    if (key === "exclude") options.exclude.push(value);
    else options[key] = ["limit", "maxChars"].includes(key) ? Number(value) : value;
    index++;
  }
  return options;
}

// Node can resolve module symlinks while argv retains the original launch path.
if (process.argv[1] && existsSync(process.argv[1]) && realpathSync(process.argv[1]) === realpathSync(new URL(import.meta.url))) {
  try {
    if (process.argv.includes("--help")) {
      console.log("Usage: node history.mjs <list|read> --harness <codex|claude|opencode|pi> --workspace <path>\nOptions: --root <path> --since <ISO date> --exclude <id> (repeatable) --limit <count>\nRead: --session <id> [--query <text>] [--max-chars <count>] [--leaf <id>]\nOpenCode read: --local-text returns private, unsanitized message text.");
    } else console.log(JSON.stringify(await history(argumentsFor(process.argv.slice(2))), null, 2));
  } catch (error) {
    console.error(`recall: ${error.message}`);
    process.exitCode = 1;
  }
}
