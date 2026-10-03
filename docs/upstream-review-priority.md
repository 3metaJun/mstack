# Priority workflow ports

This change selectively ports workflow fixes from pstack at
[`12d587df`](https://github.com/cursor/plugins/commit/12d587dfb20741cafc376c42c696c5f6e2a64487).
The source pins remain unchanged because model defaults, prompt pruning, and
verification reuse belong to a separate review. Target digests record these
reviewed adaptations against the existing pinned sources.

## Owner lifecycle

An autopilot owner's full-lifecycle brief authorizes babysitting. Ordinary
PR-opening workers still return without starting a watch. Independent
babysitters report conflicts to the topology owner. Autopilot-full owners
control their own branches; the Autopilot-stack root controls stack topology.

A code-ready report starts independent verification while self-proof, CI, and
babysitting continue. Merge-ready or STACK-READY reports include receipts and
the exact SHA. Each patch-changing push starts a new round. Merge preparation
requires current-head CI and the verdict checks in the shipping playbook.

Owners record delegated children. Replacement work uses isolated write targets
unless the old writer's access has been revoked. Audit ticks continue until all
delegated work is finished, and chat updates report only previously unreported
changes.

## Evidence and logs

Verification results identify the commit SHAs named in the brief. Measurement
results also identify sample count, sample definition, and execution order.
Missing attribution causes one retry, then an explicit gap rather than a pass.
Workers report every proven defect.

Decision trails remain append-only across handoffs. A `start` row identifies a
new run and the preceding rows it did not write. Each run audits its own
stretches and corrects inaccurate records with a superseding row. The portable
Node logger already creates new files exclusively; the upstream Bash header
append fix does not replace it.

Reflect reviewers report evidence-backed learnings without a required count.

## Verification boundary

The repository tests validate packaging, installation, skill integrity, and
source baselines. They do not prove that a future model will follow these
instructions. Review the owner and babysitter boundary together when changing
this workflow.
