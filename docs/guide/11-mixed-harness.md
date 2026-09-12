# Mix pstack and mstack in one repository

Use this procedure when teammates use native pstack in Cursor or Grok Bot and
mstack in Codex, Claude Code, OpenCode, or pi. Cursor and Grok Bot can also use
mstack when installed. Keep each person's workflow installation separate while
the repository owns one verification contract per app.

The commands below use `mstack-policy`. This checkout adds the command; older
npm releases do not contain it. During development, replace `mstack-policy` with
`node <mstack-checkout>/scripts/check-harness-policy.mjs`. After a release that
contains this command, invoke the team's exact package version with:

```bash
npx --package @3metajun/mstack@<version> mstack-policy --help
```

Do not use an unpinned latest version in CI. Replace every example version,
commit, command, app ID, and repository path with the team's actual value.

## Initialize the shared project workflow

Work in a dedicated feature worktree with one writer. Inventory existing
verification skills before adding a new definition:

```bash
rg --files --hidden -g SKILL.md -g '*feature*' -g '*contract*' -g '!node_modules' -g '!.git'
```

Choose the repository's actual base branch, required commands, supported
Harnesses, and exact workflow revisions. Record a pstack commit rather than a
branch or tag that can move. Initialize the project, for example:

```bash
mstack-policy init --root . --app web --base main --check 'node --test' --pstack <exact-pstack-commit> --harness cursor --harness codex
```

The command creates `.harness/policy.json` and `.harness/workflow.md`, adds
project-entry pointers, and prepares the canonical verification location. It
preserves existing instructions. Review conflicts instead of overwriting local
rules. Omitting `--harness` selects all supported Harnesses. A Codex-only setup
can pass `--harness codex` without a pstack pin.

The generated `AGENTS.md` pointer directs agents to `.harness/workflow.md`.
Initialization also adds a `CLAUDE.md` pointer for Claude Code and a Cursor
`alwaysApply` rule for Cursor or Grok Bot when those Harnesses are selected.
These entry points matter for native `/poteto-mode`,
whose installed upstream instructions still exist. A JSON file cannot override
the upstream workflow by itself. Keep the project entry rules active in every
team Harness. User instructions retain their normal priority.

Initialization does not discover or prove application behavior. Its incomplete
contract remains a setup task until the next step passes.

## Create or migrate one verification definition

Run `/create-verification-skill` against the real application. Put the result in:

```text
.harness/
  policy.json
  workflow.md
  verify/
    web/
      contract.md
      features/
        README.md
        create-note.md
      helpers/
```

The contract owns launch, instance isolation, Doctor checks, user actions,
expected results, evidence, cleanup, and helper invocations. Keep available
Harness tool names in their installed driver skills. The canonical contract can
name a repository-owned Playwright script, API client, or CLI directly.

When legacy `.cursor`, `.agents`, `.claude`, `.opencode`, or `.pi` skills contain
app facts, reconcile their differences against source and a running app. Move
the contract, maps, fixtures, and helpers together, then fix their relative
paths. Update maintenance jobs and Benny's `control.feature_map_path` to read
`.harness/verify/web/features/README.md` and its linked files.

Prove the moved instructions before retiring the old definitions. Remove
obsolete maps in the same PR. The checker reports legacy conflicts; it does not
select the correct copy or silently delete one. Use the
[verification migration procedure](../../skills/create-verification-skill/references/harness-paths.md#migrate-existing-verification)
for the full inventory.

Render wrappers after the canonical files exist:

```bash
mstack-policy wrappers --root .
mstack-policy check --root .
```

Wrappers contain `metadata.verification-contract` with a repository-relative
path and instructions to use the available driver. They contain no separate
map or launch procedure. Cursor scans `.agents/skills/`, so a Cursor and Codex
project gets one shared wrapper there. Other configured Harnesses receive the
same wrapper in their discovery roots.

For a project that only needs a reusable verification skill, generate wrappers
without adopting a policy:

```bash
mstack-policy wrappers --root . --app web --harness codex --harness claude
```

Start from each wrapper and confirm it reaches the same contract. Drive at least
one mapped feature, inspect its evidence, and clean up the owned instance. A
static wrapper check does not prove that every installed Harness has a working
browser or desktop driver.

## Start each development run in its own worktree

Give each writable task a dedicated linked worktree and branch. Separate app
ports, data directories, profiles, and artifact locations as the contract
requires. If a resource cannot be isolated, follow its exclusive-use procedure.
A second agent must not edit a checkout another agent is using.

Fetch the actual PR target before preflight, then run the shared workflow:

```bash
git fetch origin main
mstack-policy preflight --root . --harness codex --workflow mstack --revision <pinned-mstack-version> --base-ref origin/main
```

For native pstack, use the same project command with the actual Harness and
workflow declaration:

```bash
mstack-policy preflight --root . --harness cursor --workflow pstack --revision <pinned-pstack-commit> --base-ref origin/main
```

Preflight checks the policy, clean dedicated worktree, branch, and declared
workflow revision. The `--revision` value is a declaration checked against the
project pin. It does not inspect another tool's installation. Confirm installed
versions through that Harness's supported installation records during rollout
and upgrades.

Plain clones still support read-only inspection. The writable preflight requires
a dedicated linked worktree so concurrent tasks have separate checkout state.

## Record evidence at the commit being reviewed

Drive the changed user path through the canonical contract. Capture the action,
result, and a second read path for durable side effects. Retain artifacts outside
tracked source, under a location the project can attach to the run receipt.
Finish source changes and commit them before recording the final checks:

```bash
mstack-policy record --root . --harness codex --workflow mstack --revision <pinned-mstack-version> --base-ref origin/main --feature web/create-note --evidence .harness/runs/create-note.png --evidence .harness/runs/create-note.json
```

`record` runs the policy's required commands and writes command logs and a
receipt under `.harness/runs/<run-id>/`. The receipt binds the feature, declared
workflow, base, head, command results, and evidence digests. Keep this directory
ignored. Use an artifact archive when a reviewer or CI needs the receipt and
its evidence outside your machine.

Validate the resulting receipt against the current checkout:

```bash
mstack-policy check --root . --receipt .harness/runs/<run-id>/receipt.json
```

A command result of `PASS` means the recorded commands passed. Runtime review
remains required. A reviewer must inspect the named artifacts against the
feature's expected behavior. A unit test result cannot replace a required UI
flow, and a receipt cannot determine whether a screenshot proves that flow.

After a code change, rebase, or target-branch update, rerun the required proof
and record a fresh receipt for the new base and head. For handoff, give the next
agent the branch, commit, canonical feature ID, receipt, artifacts, and unresolved
work. Do not require access to another Harness's transcript.

## Add CI and repository protection

Add `mstack-policy check --root .` to the business repository's CI using the
pinned package version. Run the actual required commands there as well. To
validate a submitted receipt, restore its artifact archive, check out the exact
PR head with the actual target available, and pass `--receipt`.

Make these CI jobs required through the repository host's protected-branch
settings. Configure reviews and the team's merge permissions there. The policy
file and local CLI do not enable branch protection, prevent direct remote
pushes, or prove that a check is required. Verify those host settings before
calling the team's rollout complete.

Keep publishing under the team's existing release owner. If the project
publishes to npm and requires a matching GitHub Release, verify both from the
release workflow. Do not infer release authorization from a passing receipt.

## Prove the team rollout and maintain it

Test the adopted project through native pstack and an mstack Harness using
separate worktrees. Confirm that both enter through the shared project workflow,
resolve the same canonical map, run its real app path, and produce evidence a
reviewer can inspect. Then rerun `/maintain-verification-skill` from either
workflow and confirm corrections land in the canonical directory.

An unavailable Harness or app prerequisite is an explicit rollout gap. A CLI
fixture or a passing static check does not establish real-team compatibility.

Pin workflow revisions independently. During an upgrade, compare changes to
verification generation and maintenance instructions, regenerate wrappers when
needed, and repeat affected rollout checks. Keep model choices in each user's
Harness configuration. Delete completed plans and retain durable lessons in the
canonical contract, tests, or project documentation.
