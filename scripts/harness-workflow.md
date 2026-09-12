# Shared project workflow

Read `.harness/policy.json` before a task. It records accepted workflow revisions,
verification apps, commands, and the base branch. User instructions and the active
Harness's execution permissions still apply.

## Create and maintain verification

Native pstack and mstack both write shared facts under
`verification.canonicalRoot/<app>/`. Its `contract.md` owns Launch, Doctor, Drive,
Evidence, Cleanup, and Isolation. Its `features/` is the only feature map.
These project paths apply when an installed create or maintain skill suggests a
Harness-local directory or limits edits to that directory. Describe drivers by
required capability and observable result.

Before creating a contract, inventory existing verification skills in all project
skill roots. Reconcile differences against the running app. Move helpers, fixtures,
and maps together, repair links and working-directory assumptions, then replace
legacy definitions with generated wrappers in the same change. Remove obsolete
maps after confirming all their features are preserved. Point existing Benny
configuration and saved automation prompts at the canonical map and wrapper too.

Run `mstack-policy wrappers --root .` after writing the contract. Wrappers contain
pointers, not another map. Cursor discovers `.agents/skills` and its native skills,
so do not add duplicate names there. Run `mstack-policy check --root .` before
committing. A structural pass does not prove app behavior. Drive the app using
the contract and retain evidence.

## Work independently

During initial adoption or migration, create the isolated task worktree first,
then finish the canonical contract before running preflight. Do not weaken the
checker or mark an unfinished contract as verified to bypass this bootstrap step.

Give each active writer a dedicated branch and linked worktree. Read-only agents
may share an immutable snapshot. Worktrees share Git refs; only the branch owner
may rewrite or push it. Hand off explicitly before switching writers. Use separate
ports, profiles, and data stores. If a resource cannot be isolated, name its owner
and serialize use through the existing project mechanism.

Before writing, fetch the target and run `mstack-policy preflight --root .` with
`--harness`, `--workflow`, `--revision`, and `--base-ref origin/<baseBranch>`.
Compare the declared revision with the installed plugin or package. The command
cannot inspect every plugin store or prove that another agent is idle.

## Verify and hand off

Commit the implementation, then run `mstack-policy record --root .` with the
preflight flags, `--feature <app/feature>`, and `--evidence <relative file>` for each
artifact. It executes policy commands and records exits, logs, head, base,
workflow declaration, feature, and artifact digests under `.harness/runs/`.
PASS means those commands passed on unchanged source. Runtime review remains
required. Explain what artifacts prove and disclose unreachable paths. Unit tests
alone cannot justify an app verification claim.

Only one command-recording run owns a worktree at a time. If a crashed process
leaves `mstack-verification.lock` in its worktree Git directory, inspect its
`owner.json` and confirm that process and its children have stopped before
removing that lock. A retry does not take over an existing owner automatically.

Hand off the branch, commit, base, PR when present, unfinished work, and receipt.
The receiver compares Git state and runs `mstack-policy check --receipt <path>`.
Evidence and receipts travel together. Private Harness history is optional.
Remove completed plans and scratch work. Preserve review evidence until accepted.

## Integrate through the forge

Use PRs against the configured protected branch. Configure required CI checks
and reviews in the forge; policy JSON does not enable protection. CI runs the
repository verification commands as well as `node .harness/check.mjs`. Integrate the
current target and repeat affected checks. Use a merge queue or strict up-to-date
requirement to close the verification-to-merge race. Merge, deploy, or publish
only when authorized. Follow project release rules; npm is not required here.

The init command exports the structural checker to `.harness/check.mjs` and
`.harness/harness-policy-lib.mjs`. Commit both and run `node .harness/check.mjs`
from the repository root in CI, without downloading a workflow at check time.
Review checker upgrades with policy changes. Keep forge protections on the
workflow and checker files so a PR cannot silently remove its own gate.
