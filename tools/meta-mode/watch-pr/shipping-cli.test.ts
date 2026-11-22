import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { object } from "./landing.ts";
import { GhShippingService } from "./shipping.ts";
import { main } from "./shipping-cli.ts";
import { fakeGitHub } from "./shipping.test-helper.ts";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function createHarness() {
  const dir = mkdtempSync(join(tmpdir(), "shipping-cli-"));
  tempDirs.push(dir);
  const state: Record<string, unknown> = {
    id: "pr-id",
    state: "OPEN",
    headRefOid: "head",
    baseRefName: "main",
    baseRefOid: "stored-base",
    baseRef: { target: { oid: "base" } },
    autoMergeRequest: { enabledAt: "now" },
    mergeQueueEntry: { id: "queue" },
    mergeCommit: null,
  };
  const service = new GhShippingService(async (args) =>
    fakeGitHub(state, args)
  );
  const run = async (...args: string[]) => {
    const out: string[] = [];
    const err: string[] = [];
    const status = await main(args, {
      service,
      stdout: (text) => out.push(text),
      stderr: (text) => err.push(text),
    });
    const raw = out.join("").trim();
    return {
      status,
      raw,
      stderr: err.join(""),
      output: raw ? object(JSON.parse(raw), "CLI result") : null,
    };
  };
  return { dir, state, run };
}

describe("shipping-cli", () => {
  it("inspects, saves, cancels both pending mechanisms, and reads back clean state", async () => {
    const { dir, state, run } = createHarness();
    const inspected = await run("inspect", "--repo", "owner/repo", "--pr", "1");
    expect(inspected.status).toBe(0);
    expect(object(inspected.output?.record, "record").revision).toEqual({
      context: { owner: "owner", repo: "repo", number: 1 },
      headRefOid: "head",
      baseRefName: "main",
      baseRefOid: "base",
    });

    const saved = join(dir, "record.json");
    writeFileSync(saved, JSON.stringify(inspected.output));
    const cancelled = await run("cancel-pending", "--record", saved);
    expect(cancelled.status).toBe(0);
    expect(cancelled.output).toMatchObject({
      kind: "cancelled",
      record: { pending: { autoMerge: false, queueEntryId: null } },
    });
    expect(state).toMatchObject({
      autoMergeRequest: null,
      mergeQueueEntry: null,
    });
  });

  it("refuses a changed base without cancelling anything", async () => {
    const { dir, state, run } = createHarness();
    const inspected = await run("inspect", "--repo", "owner/repo", "--pr", "1");
    const saved = join(dir, "record.json");
    writeFileSync(saved, JSON.stringify(inspected.output));
    state.baseRef = { target: { oid: "advanced" } };

    const result = await run("cancel-pending", "--record", saved);
    expect(result.status).toBe(1);
    expect(result.output?.kind).toBe("changed");
    expect(state.autoMergeRequest).toEqual({ enabledAt: "now" });
    expect(state.mergeQueueEntry).toEqual({ id: "queue" });
  });

  it("treats a missing queue field as unavailable", async () => {
    const { state, run } = createHarness();
    delete state.mergeQueueEntry;
    const result = await run("inspect", "--repo", "owner/repo", "--pr", "1");
    expect(result.status).toBe(1);
    expect(result.output?.kind).toBe("unavailable");
  });

  for (const terminalState of ["CLOSED", "MERGED"] as const) {
    it(`inspects a ${terminalState} PR with a deleted base and refuses cancellation`, async () => {
      const { dir, state, run } = createHarness();
      const inspected = await run("inspect", "--repo", "owner/repo", "--pr", "1");
      const saved = join(dir, "record.json");
      writeFileSync(saved, JSON.stringify(inspected.output));

      state.state = terminalState;
      state.baseRef = null;
      state.autoMergeRequest = null;
      state.mergeQueueEntry = null;
      state.mergeCommit = terminalState === "MERGED" ? { oid: "merged" } : null;

      const observed = await run("inspect", "--repo", "owner/repo", "--pr", "1");
      expect(observed.status).toBe(0);
      expect(observed.output).toMatchObject({
        kind: "inspected",
        record: {
          state: terminalState,
          revision: { baseRefOid: "stored-base" },
          mergeCommitOid: terminalState === "MERGED" ? "merged" : null,
        },
      });
      const cancelled = await run("cancel-pending", "--record", saved);
      expect(cancelled.status).toBe(1);
      expect(cancelled.output).toMatchObject({ kind: "not-open" });
    });
  }

  it("rejects bad --repo, invalid record JSON, and missing required options", async () => {
    const { dir, run } = createHarness();
    const badRepo = await run("inspect", "--repo", "not-a-repo", "--pr", "1");
    expect(badRepo.status).toBe(1);
    expect(badRepo.output).toMatchObject({
      kind: "unavailable",
      detail: "--repo must be owner/repo",
    });

    const badRecord = join(dir, "bad.json");
    writeFileSync(badRecord, JSON.stringify({ kind: "changed", record: {} }));
    const rejected = await run("cancel-pending", "--record", badRecord);
    expect(rejected.status).toBe(1);
    expect(rejected.output).toMatchObject({ kind: "unavailable" });

    const usage = await run("inspect");
    expect(usage.status).toBe(64);
  });
});
