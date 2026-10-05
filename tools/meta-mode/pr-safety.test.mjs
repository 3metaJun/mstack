import assert from "node:assert/strict";
import test from "node:test";
import { DeadlineExceeded, WatchDeadline, assertLandingRevision, guardedMergeArgs, parseLandingRevision, sameLandingRevision } from "./pr-safety.mjs";

test("landing revisions compare head, destination, and repository identity", () => {
  const revision = parseLandingRevision({ owner: "Owner", repo: "Repo", number: 7, headRefOid: "a".repeat(40), baseRefName: "main", baseRefOid: "b".repeat(40) });
  assert.equal(sameLandingRevision(revision, { ...revision, owner: "owner", repo: "repo" }), true);
  assert.equal(sameLandingRevision(revision, { ...revision, baseRefOid: "c".repeat(40) }), false);
  assert.throws(() => assertLandingRevision(revision, { ...revision, headRefOid: "c".repeat(40) }), /changed/);
});

test("rejects incomplete landing revisions at the boundary", () => {
  const valid = { owner: "Owner", repo: "Repo", number: 7, headRefOid: "a".repeat(40), baseRefName: "main", baseRefOid: "b".repeat(40) };
  for (const invalid of [
    { ...valid, owner: "" },
    { ...valid, repo: "repo name" },
    { ...valid, headRefOid: "abc" },
    { ...valid, baseRefOid: "" },
    { ...valid, baseRefName: " main" },
  ]) assert.throws(() => parseLandingRevision(invalid), /invalid landing revision/);
});

test("guarded merge always carries the verified head", () => {
  const head = "a".repeat(40);
  assert.deepEqual(guardedMergeArgs({ pr: 7, head }), ["pr", "merge", "7", "--match-head-commit", head]);
  assert.deepEqual(guardedMergeArgs({ forge: "origin", pr: 7, head }), ["pr", "merge", "7", "--expected-head", head]);
  for (const bad of ["", "abc", "HEAD", `${head} `, "g".repeat(40)]) assert.throws(() => guardedMergeArgs({ pr: 7, head: bad }), /full verified head oid/);
});

test("deadline is monotonic and rejects after expiry", () => {
  let now = 100;
  const deadline = new WatchDeadline(20, () => now);
  assert.equal(deadline.remaining(), 20);
  now = 121;
  assert.equal(deadline.remaining(), 0);
  assert.throws(() => deadline.assert(), DeadlineExceeded);
});
