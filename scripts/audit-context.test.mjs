import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { filesModifiedSince, walkFiles } from "./audit-context-lib.mjs";

function fixture(prefix) {
  return mkdtempSync(join(tmpdir(), `${prefix}-`));
}

test("walkFiles skips a dangling directory link", () => {
  const root = fixture("audit-context-link");
  try {
    const regularFile = join(root, "regular.txt");
    writeFileSync(regularFile, "present\n", "utf8");
    symlinkSync(
      join(root, "missing-target"),
      join(root, "dangling"),
      process.platform === "win32" ? "junction" : "dir",
    );

    assert.deepEqual(walkFiles(root), [regularFile]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("filesModifiedSince skips a file removed after discovery", () => {
  const root = fixture("audit-context-mtime");
  try {
    const sessions = join(root, "sessions");
    const session = join(sessions, "recent.jsonl");
    mkdirSync(sessions);
    writeFileSync(session, "{}\n", "utf8");
    const discovered = walkFiles(sessions, (path) => path.endsWith(".jsonl"));
    rmSync(session);

    assert.deepEqual(filesModifiedSince(discovered, 0), []);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
