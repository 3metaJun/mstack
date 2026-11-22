import { describe, expect, it } from "bun:test";
import { main } from "./cli.ts";
import { WatchDeadline } from "./deadline.ts";
import {
  fakeReader,
  pendingCheck,
  type FakeReaderOptions,
} from "./fakes.test-helper.ts";
import { WatcherQueryError } from "./github.ts";
import { runSimple } from "./policy.ts";
import { renderPretty } from "./render.ts";
import {
  EYES_HOLD_CAP_SECONDS,
  parseHeadPush,
  parseReviewActivity,
  readReviewActivity,
  type ReviewActivity,
  type ReviewActivityItem,
} from "./settle.ts";
import type {
  GitHubReader,
  PrContext,
  ProgressVerdict,
  TerminalVerdict,
} from "./types.ts";
import { parsePrNumber } from "./types.ts";

const context = { owner: "owner", repo: "repo", number: parsePrNumber(1) };
const PUSH = Date.parse("2026-07-26T12:00:00Z") / 1_000;
const at = (offset: number): string =>
  new Date((PUSH + offset) * 1_000).toISOString();
type Wait = Extract<ProgressVerdict, { readonly kind: "WAITING" }>["reason"];
const bot = (offset: number, eyes = false): ReviewActivityItem => ({
  login: "review-bot",
  at: at(offset),
  eyes,
});

async function watch(
  items: readonly ReviewActivityItem[],
  options: {
    readonly settle?: number;
    readonly headPushedAt?: string | null;
    readonly pushRecordUntil?: number;
    readonly openedAt?: string;
    readonly readyAt?: string | null;
    readonly start?: number;
    readonly timeout?: number;
    readonly facts?: FakeReaderOptions["facts"];
  } = {}
): Promise<{
  readonly verdict: TerminalVerdict;
  readonly after: number;
  readonly waits: readonly Wait[];
}> {
  let now = PUSH + (options.start ?? 30);
  const waits: Wait[] = [];
  const timeout = options.timeout ?? 7_200;
  const reader = {
    ...fakeReader({ facts: options.facts }),
    async reviewActivity(): Promise<ReviewActivity> {
      return {
        authorLogin: "author",
        viewerLogin: "viewer",
        openedAt: options.openedAt ?? at(-3_600),
        readyAt: options.readyAt ?? null,
        headPushedAt:
          now - PUSH >= (options.pushRecordUntil ?? Number.POSITIVE_INFINITY)
            ? null
            : options.headPushedAt === undefined
              ? at(0)
              : options.headPushedAt,
        items: items.filter((item) => Date.parse(item.at) / 1_000 <= now),
      };
    },
  } satisfies GitHubReader;
  const verdict = await runSimple({
    dependencies: {
      deadline: new WatchDeadline(timeout, () => now),
      reader,
      clock: {
        now: () => now,
        observedAt: () => new Date(now * 1_000).toISOString(),
        async sleep(seconds) {
          now += seconds;
        },
      },
      emit(verdict) {
        if (verdict.kind === "WAITING") waits.push(verdict.reason);
      },
    },
    contexts: [context],
    mode: "single",
    statusOnly: false,
    options: {
      interval: 60,
      sweepInterval: 300,
      timeout,
      maxQueryErrors: 5,
      allowDraft: false,
      settle: options.settle ?? 300,
    },
  });
  return { verdict, after: now - PUSH, waits };
}

describe("review settle window", () => {
  it("returns READY once other accounts have been quiet for the window", async () => {
    const { verdict, after, waits } = await watch([bot(60)]);
    expect(verdict.kind).toBe("READY");
    expect(after).toBe(390);
    expect(
      waits.map((wait) => wait.kind === "review-settling" && wait.endsAt)
    ).toEqual([at(300), at(360), at(360), at(360), at(360), at(360)]);
  });

  it("restarts the window on activity inside it", async () => {
    const { verdict, after } = await watch([bot(60), bot(250)]);
    expect(verdict.kind).toBe("READY");
    expect(after).toBe(570);
  });

  it("counts an edit to a comment posted before the push", async () => {
    const { items } = parseReviewActivity(
      graphql({
        comments: [
          {
            author: { login: "codex-bot" },
            createdAt: at(-600),
            lastEditedAt: at(200),
            reactions: { nodes: [] },
          },
        ],
      })
    );
    const { verdict, after } = await watch(items);
    expect(verdict.kind).toBe("READY");
    expect(after).toBe(510);
  });

  it("ignores an eyes reaction added before the head was pushed", async () => {
    const { verdict, after } = await watch([bot(-100, true)]);
    expect(verdict.kind).toBe("READY");
    expect(after).toBe(330);
  });

  it("keeps a push time it has read when a later read has none", async () => {
    const { verdict, after } = await watch([bot(500, true)], {
      start: 600,
      pushRecordUntil: 900,
    });
    expect(verdict.kind).toBe("READY");
    expect(after).toBe(EYES_HOLD_CAP_SECONDS);
  });

  it("starts the window when the watcher first sees a head GitHub has no push record for", async () => {
    const { verdict, after, waits } = await watch([], { headPushedAt: null });
    expect(verdict.kind).toBe("READY");
    expect(after).toBe(330);
    expect(waits[0]).toMatchObject({ endsAt: at(330) });
  });

  it("detects a PR head change that happens while reading review activity", async () => {
    let head = "head-1";
    const base = fakeReader();
    const reader = {
      ...base,
      async pullRequest(pr: PrContext) {
        return { ...(await base.pullRequest(pr)), headRefOid: head };
      },
      async reviewActivity(): Promise<ReviewActivity> {
        head = "head-2";
        return {
          authorLogin: "author",
          viewerLogin: "viewer",
          openedAt: at(-3_600),
          readyAt: null,
          headPushedAt: at(-600),
          items: [],
        };
      },
    } satisfies GitHubReader;
    const verdict = await runSimple({
      dependencies: {
        deadline: new WatchDeadline(0, () => 0),
        reader,
        clock: {
          now: () => 0,
          observedAt: () => at(0),
          async sleep() {},
        },
        emit() {},
      },
      contexts: [context],
      mode: "single",
      statusOnly: true,
      options: {
        interval: 60,
        sweepInterval: 300,
        timeout: 0,
        maxQueryErrors: 1,
        allowDraft: false,
        settle: 300,
      },
    });
    expect(verdict).toMatchObject({
      kind: "BLOCKER",
      blocker: {
        kind: "status-query",
        failure: { kind: "snapshot-changed" },
      },
    });
  });

  it("ignores the PR author's and the gh viewer's own activity", async () => {
    const { verdict, after } = await watch([
      { login: "author", at: at(200), eyes: false },
      { login: "Viewer[bot]", at: at(250), eyes: true },
    ]);
    expect(verdict.kind).toBe("READY");
    expect(after).toBe(330);
  });

  it("holds on an eyes reaction until the cap, then releases", async () => {
    const { verdict, after, waits } = await watch([bot(0, true)]);
    expect(verdict.kind).toBe("READY");
    expect(after).toBe(EYES_HOLD_CAP_SECONDS + 30);
    expect(waits.at(-1)).toMatchObject({
      kind: "review-settling",
      heldBy: "eyes",
      endsAt: at(EYES_HOLD_CAP_SECONDS),
    });
  });

  it("starts the window at ready-for-review when it follows the push", async () => {
    const { verdict, after, waits } = await watch([], { readyAt: at(600) });
    expect(verdict.kind).toBe("READY");
    expect(after).toBe(930);
    expect(waits[0]).toMatchObject({ endsAt: at(900) });
  });

  it("holds a draft-pr gate until the window ends", async () => {
    const { verdict, after, waits } = await watch([bot(60)], {
      facts: { isDraft: true },
    });
    expect(waits[0]).toMatchObject({ kind: "review-settling" });
    expect(verdict).toMatchObject({
      kind: "BLOCKER",
      blocker: { kind: "merge-gate", reason: "draft-pr" },
    });
    expect(after).toBe(390);
  });

  it("waits on the lowest settling PR of a stack before an upstack PR's pending checks", async () => {
    const emitted: ProgressVerdict[] = [];
    const base = fakeReader();
    const reader = {
      ...base,
      async checksFastPath(pr: PrContext) {
        return pr.number === 2
          ? { kind: "checks" as const, checks: [pendingCheck()] }
          : base.checksFastPath(pr);
      },
      async reviewActivity(): Promise<ReviewActivity> {
        return {
          authorLogin: "author",
          viewerLogin: "viewer",
          openedAt: at(-3_600),
          readyAt: null,
          headPushedAt: at(0),
          items: [bot(40)],
        };
      },
    } satisfies GitHubReader;
    await expect(
      runSimple({
        dependencies: {
          deadline: new WatchDeadline(0, () => 0),
          reader,
          clock: {
            now: () => 0,
            observedAt: () => at(100),
            async sleep() {
              throw new Error("stop after the first wait");
            },
          },
          emit: (verdict) => emitted.push(verdict),
        },
        contexts: [context, { ...context, number: parsePrNumber(2) }],
        mode: "stack",
        statusOnly: false,
        options: {
          interval: 60,
          sweepInterval: 300,
          timeout: 0,
          maxQueryErrors: 5,
          allowDraft: false,
          settle: 300,
        },
      })
    ).rejects.toThrow("stop after the first wait");
    expect(emitted.at(-1)).toMatchObject({
      kind: "WAITING",
      frontier: { number: 1 },
      reason: { kind: "review-settling", heldBy: "activity", endsAt: at(340) },
    });
  });

  it("renders a review-settling wait and timeout with time left", async () => {
    expect(
      renderPretty({
        schemaVersion: 1,
        sequence: 1,
        observedAt: at(100),
        mode: "single",
        kind: "WAITING",
        terminal: false,
        frontier: context,
        reason: { kind: "review-settling", endsAt: at(1_800), heldBy: "eyes" },
      })
    ).toBe(
      `WAITING: frontier=#1; review activity has not settled (an eyes reaction is on the PR); can end in 1700s, at ${at(1_800)}\n`
    );
    const { verdict } = await watch([bot(60)], { timeout: 120 });
    expect(verdict).toMatchObject({
      kind: "TIMEOUT",
      exitCode: 5,
      observedAt: at(150),
      reason: { kind: "review-settling", heldBy: "activity", endsAt: at(360) },
    });
    expect(renderPretty(verdict)).toBe(
      `TIMEOUT: review activity has not settled (quiet window since the push, opening, or last activity); can end in 210s, at ${at(360)}\n`
    );
  });
});

function cliRuntime(reader: GitHubReader, stdout: string[]) {
  return {
    deadline: new WatchDeadline(0, () => 0),
    reader,
    clock: {
      now: () => 0,
      observedAt: () => at(100),
      async sleep() {
        throw new Error("test unexpectedly slept");
      },
    },
    stdout: (value: string) => stdout.push(value),
    stderr: () => {},
  };
}

describe("watch-pr --settle", () => {
  const recent: ReviewActivity = {
    authorLogin: "author",
    viewerLogin: "viewer",
    openedAt: at(-3_600),
    readyAt: null,
    headPushedAt: at(0),
    items: [bot(40)],
  };

  it("is off by default and reads no review activity", async () => {
    const stdout: string[] = [];
    const reader = fakeReader({ reviewActivity: recent });
    expect(await main(["--pr", "1"], cliRuntime(reader, stdout))).toBe(0);
    expect(JSON.parse(stdout[0] ?? "")).toMatchObject({ kind: "READY" });
    expect(reader.calls).not.toContain("reviewActivity");
  });

  it("shows the settling state in the --status-only table and JSON when --settle is set", async () => {
    const pretty: string[] = [];
    await main(
      ["--pr", "1", "--settle", "300", "--status-only", "--pretty"],
      cliRuntime(fakeReader({ reviewActivity: recent }), pretty)
    );
    expect(pretty.join("")).toContain("| ✅, ⏳ settling, 4m left |");
    const eyes: string[] = [];
    await main(
      ["--pr", "1", "--settle", "300", "--status-only", "--pretty"],
      cliRuntime(
        fakeReader({ reviewActivity: { ...recent, items: [bot(40, true)] } }),
        eyes
      )
    );
    expect(eyes.join("")).toContain("| ✅, 👀 reviewing, 29m left |");
    const json: string[] = [];
    await main(
      ["--pr", "1", "--settle", "300", "--status-only"],
      cliRuntime(fakeReader({ reviewActivity: recent }), json)
    );
    expect(JSON.parse(json[0] ?? "").rows[0].settle).toEqual({
      kind: "settling",
      since: { at: at(0), source: "push" },
      lastActivityAt: at(40),
      endsAt: at(340),
      secondsLeft: 240,
      heldBy: "activity",
    });
  });

  it("does not settle a queued stack's status table", async () => {
    const json: string[] = [];
    const reader = fakeReader({ reviewActivity: recent });
    await main(
      ["--queued-stack", "--stack-prs", "1", "--settle", "300", "--status-only"],
      cliRuntime(reader, json)
    );
    expect(JSON.parse(json[0] ?? "").rows[0].settle).toBeUndefined();
    expect(reader.calls).not.toContain("reviewActivity");
  });

  it("rejects out-of-range --settle values with exit 64 instead of throwing RangeError", async () => {
    const stderr: string[] = [];
    const runtime = {
      ...cliRuntime(fakeReader({ reviewActivity: recent }), []),
      stderr: (value: string) => stderr.push(value),
    };
    expect(await main(["--pr", "1", "--settle", "1e20"], runtime)).toBe(64);
    expect(stderr.join("")).toContain("at most 86400");
  });

  it("fails closed when --settle is requested on a reader without reviewActivity", async () => {
    const base = fakeReader();
    const { reviewActivity: _omitted, ...withoutActivity } = base;
    await expect(
      runSimple({
        dependencies: {
          deadline: new WatchDeadline(0, () => 0),
          reader: withoutActivity,
          clock: {
            now: () => 0,
            observedAt: () => at(0),
            async sleep() {},
          },
          emit() {},
        },
        contexts: [context],
        mode: "single",
        statusOnly: true,
        options: {
          interval: 60,
          sweepInterval: 300,
          timeout: 0,
          maxQueryErrors: 1,
          allowDraft: false,
          settle: 300,
        },
      })
    ).rejects.toThrow("reader.reviewActivity is not implemented");
  });
});

function graphql(pr: {
  readonly comments?: readonly unknown[];
  readonly reviews?: readonly unknown[];
  readonly threads?: readonly unknown[];
  readonly reactions?: readonly unknown[];
  readonly readyAt?: string;
}): unknown {
  return {
    data: {
      viewer: { login: "viewer" },
      repository: {
        pullRequest: {
          author: { login: "author" },
          createdAt: at(-3_600),
          headRefName: "feature",
          headRepository: { name: "repo", owner: { login: "fork" } },
          timelineItems: {
            nodes: pr.readyAt === undefined ? [] : [{ createdAt: pr.readyAt }],
          },
          comments: { nodes: pr.comments ?? [] },
          reviews: { nodes: pr.reviews ?? [] },
          reviewThreads: {
            nodes: (pr.threads ?? []).map((comment) => ({
              comments: { nodes: [comment] },
            })),
          },
          reactions: { nodes: pr.reactions ?? [] },
        },
      },
    },
  };
}

describe("review activity reader", () => {
  it("fails closed on a response that carries GraphQL errors", () => {
    const failure = (() => {
      try {
        parseReviewActivity({
          ...(graphql({}) as object),
          errors: [{ message: "Something went wrong" }],
        });
      } catch (error) {
        return error;
      }
    })();
    expect(failure).toBeInstanceOf(WatcherQueryError);
    expect((failure as WatcherQueryError).failure).toMatchObject({
      kind: "missing-field",
      retryable: true,
    });
  });

  it("dates the head only by the branch's newest push", () => {
    expect(
      parseHeadPush(
        [{ activity_type: "force_push", after: "head", timestamp: at(0) }],
        "head"
      )
    ).toBe(at(0));
    expect(
      parseHeadPush(
        [
          { activity_type: "push", after: "newer", timestamp: at(50) },
          { activity_type: "push", after: "head", timestamp: at(0) },
        ],
        "head"
      )
    ).toBeNull();
  });

  const failingLog = (detail: string) => async (argv: readonly string[]) => {
    if (argv[2] === "graphql") return graphql({});
    throw new WatcherQueryError({
      kind: "command-exit",
      retryable: true,
      detail,
      code: 1,
    });
  };

  it("falls back to no push record on 403/404 and retries other failures", async () => {
    for (const detail of [
      "gh: Not Found (HTTP 404)",
      "gh: Forbidden (HTTP 403)",
    ])
      expect(
        (await readReviewActivity(failingLog(detail), context, "head"))
          .headPushedAt
      ).toBeNull();
    await expect(
      readReviewActivity(
        failingLog("gh: Service Unavailable (HTTP 503)"),
        context,
        "head"
      )
    ).rejects.toBeInstanceOf(WatcherQueryError);
  });
});
