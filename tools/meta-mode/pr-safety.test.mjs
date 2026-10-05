import assert from "node:assert/strict";
import test from "node:test";
import { DeadlineExceeded, WatchDeadline, assertLandingRevision, guardedMergeArgs, parseLandingRevision, sameLandingRevision } from "./pr-safety.mjs";

test("landing revisions compare head, destination, and repository identity", () => {
  const revision = parseLandingRevision({ owner: "Owner", repo: "Repo", number: 7, headRefOid: "abc", baseRefName: "main", baseRefOid: "def" });
  assert.equal(sameLandingRevision(revision, { ...revision, owner: "owner", repo: "repo" }), true);
  assert.equal(sameLandingRevision(revision, { ...revision, baseRefOid: "new" }), false);
  assert.throws(() => assertLandingRevision(revision, { ...revision, headRefOid: "new" }), /changed/);
});

test("guarded merge always carries the verified head", () => {
  assert.deepEqual(guardedMergeArgs({ pr: 7, head: "abc" }), ["pr", "merge", "7", "--match-head-commit", "abc"]);
  assert.deepEqual(guardedMergeArgs({ forge: "origin", pr: 7, head: "abc" }), ["pr", "merge", "7", "--expected-head", "abc"]);
  assert.throws(() => guardedMergeArgs({ pr: 7, head: "" }), /verified head/);
});

test("deadline is monotonic and rejects after expiry", () => {
  let now = 100;
  const deadline = new WatchDeadline(20, () => now);
  assert.equal(deadline.remaining(), 20);
  now = 121;
  assert.equal(deadline.remaining(), 0);
  assert.throws(() => deadline.assert(), DeadlineExceeded);
});
