import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { commitsSincePin } from "./upstream-drift.mjs";

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "mstack-drift-test-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = (args, date) => execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8",
    env: {
      ...process.env,
      GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@example.com",
      GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@example.com",
      ...(date ? { GIT_AUTHOR_DATE: date, GIT_COMMITTER_DATE: date } : {}),
    },
  }).trim();
  const commit = (file, subject, date) => {
    mkdirSync(dirname(join(root, file)), { recursive: true });
    writeFileSync(join(root, file), `${subject}\n`);
    git(["add", "."]);
    git(["commit", "--quiet", "-m", subject], date);
    return git(["rev-parse", "HEAD"]);
  };
  git(["init", "--quiet", "--initial-branch=main"]);
  return { root, git, commit };
}

test("a commit older than the pin but merged after it counts as drift", (t) => {
  const { root, git, commit } = fixture(t);
  commit("watched/a.md", "base", "2026-01-01T00:00:00Z");
  git(["switch", "--quiet", "-c", "side"]);
  commit("watched/b.md", "authored before the pin", "2026-01-02T00:00:00Z");
  git(["switch", "--quiet", "main"]);
  const pin = commit("watched/a.md", "pin", "2026-02-01T00:00:00Z");
  git(["merge", "--quiet", "--no-ff", "-m", "merge side", "side"], "2026-03-01T00:00:00Z");

  const { pinnedOn, commits } = commitsSincePin(root, pin, ["watched"]);
  assert.equal(pinnedOn, "2026-02-01");
  assert.deepEqual(commits.map(({ subject }) => subject), ["authored before the pin", "merge side"]);
});

test("commits outside the watched paths and ancestors of the pin are not drift", (t) => {
  const { root, commit } = fixture(t);
  commit("watched/a.md", "before the pin", "2026-01-01T00:00:00Z");
  // Same timestamp as its parent: a date filter cannot tell these two apart.
  const pin = commit("watched/a.md", "pin", "2026-01-01T00:00:00Z");
  commit("elsewhere/c.md", "unrelated", "2026-01-03T00:00:00Z");
  const later = commit("watched/a.md", "later\twith a tab", "2026-01-04T00:00:00Z");

  const { commits } = commitsSincePin(root, pin, ["watched"]);
  assert.deepEqual(commits, [{ sha: later, date: "2026-01-04", subject: "later\twith a tab" }]);
});

test("an unknown pin fails instead of reporting no drift", (t) => {
  const { root, commit } = fixture(t);
  commit("watched/a.md", "base");
  assert.throws(() => commitsSincePin(root, "0".repeat(40), ["watched"]));
});
