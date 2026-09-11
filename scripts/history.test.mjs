import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { history } from "../skills/recall/scripts/history.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "mstack-history-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const workspace = join(root, "project with spaces");
  mkdirSync(workspace);
  return { root, workspace };
}

function jsonl(path, rows) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, rows.map((row) => typeof row === "string" ? row : JSON.stringify(row)).join("\n") + "\n");
}

test("Codex lists metadata only, honors CODEX_HOME and excludes unrelated/current/child sessions", async (t) => {
  const { root, workspace } = fixture(t);
  const store = join(root, "codex");
  const meta = (id, cwd = workspace, source = "cli") => ({ type: "session_meta", payload: { id, cwd, source } });
  jsonl(join(store, "sessions", "wanted.jsonl"), [meta("wanted"), { type: "response_item", payload: { type: "message", role: "user", content: [{ type: "input_text", text: "Fix parser" }] } }]);
  jsonl(join(store, "archived_sessions", "other.jsonl"), [meta("other", join(root, "unrelated")), "PRIVATE INVALID BODY"]);
  jsonl(join(store, "sessions", "current.jsonl"), [meta("current")]);
  jsonl(join(store, "sessions", "child.jsonl"), [meta("child", workspace, { subagent: { thread_spawn: {} } })]);
  const options = { harness: "codex", workspace, env: { CODEX_HOME: store, CODEX_THREAD_ID: "current" } };
  const listing = await history({ ...options, command: "list" });
  assert.deepEqual(listing.sessions.map((session) => session.id), ["wanted"]);
  assert.doesNotMatch(JSON.stringify(listing), /Fix parser|PRIVATE/);
  assert.deepEqual(listing.warnings, []);
  const reading = await history({ ...options, command: "read", session: "wanted" });
  assert.deepEqual(reading.messages.map(({ role, text }) => ({ role, text })), [{ role: "user", text: "Fix parser" }]);
  await assert.rejects(history({ ...options, command: "read", session: "other" }), /not found in the requested workspace/);
});

test("Claude scopes its project directory and follows the selected conversation branch", async (t) => {
  const { root, workspace } = fixture(t);
  const store = join(root, "claude");
  const slug = workspace.replace(/[^a-zA-Z0-9]/g, "-");
  const row = (uuid, parentUuid, text) => ({ type: "user", sessionId: "claude-session", cwd: workspace, uuid, parentUuid, message: { role: "user", content: text } });
  jsonl(join(store, "projects", slug, "claude-session.jsonl"), [
    { type: "file-history-snapshot" }, row("a", null, "Start"), row("discarded", "a", "Old approach"), row("chosen", "a", "New approach"),
  ]);
  jsonl(join(store, "projects", "unrelated", "private.jsonl"), ["PRIVATE INVALID RECORD"]);
  const options = { harness: "claude", workspace, env: { CLAUDE_CONFIG_DIR: store }, command: "read", session: "claude-session" };
  const reading = await history(options);
  assert.deepEqual(reading.messages.map((message) => message.text), ["Start", "New approach"]);
  assert.deepEqual((await history({ ...options, leaf: "discarded" })).messages.map((message) => message.text), ["Start", "Old approach"]);
});

test("discovery sorts by modification time, deduplicates newest records and honors the time window", async (t) => {
  const { root, workspace } = fixture(t);
  const meta = { type: "session_meta", payload: { id: "same", cwd: workspace } };
  const old = join(root, "archived_sessions", "same.jsonl");
  const newest = join(root, "sessions", "same.jsonl");
  const message = (text) => ({ type: "event_msg", payload: { type: "agent_message", message: text } });
  jsonl(old, [meta, message("Archived response")]);
  jsonl(newest, [meta, message("Current response")]);
  utimesSync(old, new Date("2026-01-01"), new Date("2026-01-01"));
  const options = { harness: "codex", workspace, root, env: {}, since: "2025-01-01" };
  assert.equal((await history({ ...options, command: "list" })).sessions.length, 1);
  assert.equal((await history({ ...options, command: "read", session: "same" })).messages[0].text, "Current response");
  assert.deepEqual((await history({ ...options, command: "list", since: "2100-01-01" })).sessions, []);
});

test("pi reads version 3 parent trees, excludes tool results and bounds matching output", async (t) => {
  const { root, workspace } = fixture(t);
  const store = join(root, "pi");
  const message = (id, parentId, role, text) => ({ type: "message", id, parentId, message: { role, content: [{ type: "text", text }] } });
  jsonl(join(store, "branch.jsonl"), [
    { type: "session", version: 3, id: "pi-session", cwd: workspace },
    message("a", null, "user", "Parser question"), message("b", "a", "assistant", "Discarded answer"),
    message("c", "a", "assistant", "Parser fix"), message("d", "c", "toolResult", "PRIVATE TOOL OUTPUT"),
  ]);
  const options = { harness: "pi", workspace, env: { PI_CODING_AGENT_SESSION_DIR: store }, command: "read", session: "pi-session" };
  assert.deepEqual((await history(options)).messages.map((message) => message.text), ["Parser question", "Parser fix"]);
  const bounded = await history({ ...options, query: "parser", limit: 1, maxChars: 6 });
  assert.deepEqual(bounded.messages.map((message) => message.text), ["Parser"]);
  assert.equal(bounded.truncated, true);
  const newest = await history({ ...options, maxChars: 12 });
  assert.deepEqual(newest.messages.map((message) => message.text), ["Pa", "Parser fix"]);
  assert.equal(newest.truncated, true);
  await assert.rejects(history({ ...options, leaf: "missing" }), /Unknown leaf/);
});

test("pi default storage uses only the requested workspace slug and keeps branch summaries", async (t) => {
  const { root, workspace } = fixture(t);
  const slug = `--${workspace.replace(/^[/\\]/, "").replace(/[/\\:]/g, "-")}--`;
  jsonl(join(root, "sessions", slug, "session.jsonl"), [
    { type: "session", version: 3, id: "summary", cwd: workspace },
    { type: "branch_summary", id: "s", parentId: null, summary: "The first attempt was reverted." },
  ]);
  jsonl(join(root, "sessions", "unrelated", "private.jsonl"), ["PRIVATE INVALID HEADER"]);
  const result = await history({ harness: "pi", workspace, env: { PI_CODING_AGENT_DIR: root }, command: "read", session: "summary" });
  assert.deepEqual(result.messages, [{ role: "summary", text: "The first attempt was reverted." }]);
  assert.deepEqual(result.warnings, []);
});

test("OpenCode filters list metadata before exporting one sanitized session", async (t) => {
  const { root, workspace } = fixture(t);
  const calls = [];
  const runOpenCode = (args, cwd) => {
    calls.push({ args, cwd });
    if (args[0] === "session") return [
      { id: "other", directory: join(root, "other"), updated: Date.now() },
      { id: "wanted", directory: workspace, updated: Date.now() },
      { id: "child", directory: workspace, parentID: "wanted", updated: Date.now() },
    ];
    return { info: { id: "wanted", directory: "[redacted:session-directory:wanted]" }, messages: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "Sanitized answer" }, { type: "tool", text: "Do not emit" }] }] };
  };
  const options = { harness: "opencode", workspace, runOpenCode, env: {} };
  const listing = await history({ ...options, command: "list" });
  assert.deepEqual(listing.sessions.map((session) => session.id), ["wanted"]);
  assert.equal(calls.length, 1);
  const reading = await history({ ...options, command: "read", session: "wanted" });
  assert.deepEqual(calls.at(-1), { args: ["export", "wanted", "--sanitize", "--pure"], cwd: workspace });
  assert.equal(reading.messages[0].text, "Sanitized answer");
  await assert.rejects(history({ ...options, command: "read", session: "other" }), /not found/);
  assert.equal(calls.filter((call) => call.args[0] === "export").length, 1);
  for (const directory of [join(root, "other"), "[redacted:session-directory:other]"]) {
    const wrongExport = (args, cwd) => args[0] === "session" ? runOpenCode(args, cwd)
      : { info: { id: "wanted", directory }, messages: [] };
    await assert.rejects(history({ ...options, runOpenCode: wrongExport, command: "read", session: "wanted" }), /does not match/);
  }
});

test("missing stores and malformed records produce controlled diagnostics without raw content", async (t) => {
  const { root, workspace } = fixture(t);
  const options = { harness: "codex", workspace, root: join(root, "missing"), command: "list", env: {} };
  assert.deepEqual((await history(options)).sessions, []);
  jsonl(join(options.root, "sessions", "broken.jsonl"), ["PRIVATE INVALID HEADER"]);
  const broken = await history(options);
  assert.equal(broken.warnings.length, 1);
  assert.doesNotMatch(JSON.stringify(broken), /PRIVATE/);
  jsonl(join(options.root, "sessions", "good.jsonl"), [{ type: "session_meta", payload: { id: "good", cwd: workspace } }, "PRIVATE INVALID BODY"]);
  const reading = await history({ ...options, command: "read", session: "good" });
  assert.deepEqual(reading.messages, []);
  assert.ok(reading.warnings.some((warning) => /malformed record/.test(warning)));
  assert.doesNotMatch(JSON.stringify(reading), /PRIVATE/);
});

test("OpenCode warns when sanitizer removes text and requires an explicit local-text read to recover it", async (t) => {
  const { workspace } = fixture(t);
  const runOpenCode = (args) => args[0] === "session" ? [{ id: "session", directory: workspace, updated: Date.now() }]
    : { info: { id: "session", directory: args.includes("--sanitize") ? "[redacted:session-directory:session]" : workspace },
      messages: [{ info: { role: "user" }, parts: [{ type: "text", text: args.includes("--sanitize") ? "[redacted:text:part]" : "Local fixture prompt" }] }] };
  const options = { harness: "opencode", workspace, runOpenCode, command: "read", session: "session" };
  const sanitized = await history(options);
  assert.equal(sanitized.sanitized, true);
  assert.match(sanitized.warnings[0], /redacted message text/);
  const local = await history({ ...options, localText: true });
  assert.equal(local.sanitized, false);
  assert.equal(local.messages[0].text, "Local fixture prompt");
  assert.deepEqual(local.warnings, []);
  await assert.rejects(history({ ...options, command: "list", localText: true }), /only for OpenCode read/);
  await assert.rejects(history({ ...options, harness: "codex", localText: true }), /only for OpenCode read/);
});

test("the copied recall skill runs without repository scripts and validates CLI arguments", (t) => {
  const { root, workspace } = fixture(t);
  const installed = join(root, "installed-recall");
  cpSync(resolve("skills/recall"), installed, { recursive: true });
  const script = join(installed, "scripts", "history.mjs");
  const args = [script, "list", "--harness", "codex", "--workspace", workspace, "--root", join(root, "empty")];
  const result = spawnSync(process.execPath, args, { encoding: "utf8", cwd: root });
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).sessions, []);
  for (const suffix of [["--root"], ["--limit", "0"], ["--since", "invalid"], ["--unknown", "value"], ["--local-text"]]) {
    const failed = spawnSync(process.execPath, [...args, ...suffix], { encoding: "utf8", cwd: root });
    assert.notEqual(failed.status, 0);
    assert.doesNotMatch(failed.stderr, /at file:/);
  }
});
