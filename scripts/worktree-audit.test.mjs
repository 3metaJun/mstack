import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { classify, parseWorktreePorcelain } from "../tools/meta-mode/worktree-audit.mjs";

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
  assert.equal(classify({ dirty: "wip:1", pr: "-", recent: false, merged: true }), "hold-wip");
  assert.equal(classify({ dirty: "clean", pr: "#4/OPEN", recent: false, merged: true }), "hold-open-pr");
  assert.equal(classify({ dirty: "clean", pr: "-", recent: true, merged: false }), "verify-recent-chat");
  assert.equal(classify({ dirty: "clean", pr: "-", recent: false, merged: true }), "safe");
  assert.equal(classify({ dirty: "clean", pr: "-", recent: false, merged: false }), "review");
});

test("transcript fixtures can contain Unicode and spaces", () => {
  const root = mkdtempSync(join(tmpdir(), "mstack-audit-"));
  const path = join(root, "session file.jsonl");
  writeFileSync(path, JSON.stringify({ cwd: "C:/Users/Test User/工作 tree/" }));
  assert.match(path, /session file/);
});
