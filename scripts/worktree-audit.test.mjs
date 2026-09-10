import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { resolve } from "node:path";
import test from "node:test";

test("worktree audit reads transcript timestamps on Unix", { skip: process.platform === "win32" }, () => {
  const result = spawnSync("bash", [resolve("tools", "meta-mode", "worktree-audit.test.sh")], {
    cwd: resolve("."),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr || result.stdout);
});
