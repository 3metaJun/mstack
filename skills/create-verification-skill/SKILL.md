---
name: create-verification-skill
description: Create or migrate a shared project verification contract and discoverable skill wrappers, prove one real app path, and retain evidence. Use for a reusable verification or control workflow, not a one-time verification pass.
license: MIT
---

# Create a verification skill

Create one verification contract that agents in different Harnesses can use to
prove the same application behavior. Store project facts in
`.harness/verify/<app>/`, with thin `verify-<app>` skill wrappers for discovery.
Record commands and observations from this repository, not a generic test plan.

## 1. Interview the repository

Read `AGENTS.md`, `.harness/policy.json`, and `.harness/workflow.md` when present.
Follow the shared project workflow before editing. Inventory canonical contracts
and existing `verify-*` or control skills across every project skill root in
[harness-paths.md](./references/harness-paths.md). Follow each wrapper's
`metadata.verification-contract` path from the repository root. Several wrappers
pointing to one contract are one target, not competing verification definitions.

Answer what you can from code and documentation before asking the user:

- **Surface:** Identify the primary user surface and any secondary surfaces.
- **Run:** Find the repository's own launch command, required environment,
  ports, seed data, and authentication.
- **Drive:** Prefer an existing Playwright, Cypress, PTY, expect, API, desktop,
  or mobile harness. Otherwise use the host agent's available browser, terminal,
  desktop, or HTTP driver.
- **Observe:** Identify screenshots, terminal transcripts, response bodies,
  logs, exit codes, files, and durable state that can prove behavior.
- **Isolate:** Determine whether parallel instances can use distinct ports,
  profiles, or data directories. If not, require exclusive use.

If the checkout does not run as documented, fix or precisely report that base
problem before recording a workflow against it.

## 2. Write or migrate the canonical contract

Reuse the app ID and canonical path already registered in the project policy.
For a new app, use `.harness/verify/<app>/contract.md`. Keep its feature map in
`features/` and its owned scripts in `helpers/` beside the contract.

For existing verification definitions, follow
[the migration procedure](./references/harness-paths.md).
Reconcile conflicting instructions against the running app before choosing a
canonical version. A copied legacy map is not evidence of correct behavior.

The contract must include these H2 sections:

- **Launch:** Exact start command, readiness signal, ownership marker, and teardown.
- **Isolate:** Instance-specific ports, profiles, and data directories, or an
  explicit exclusive-use procedure for resources that cannot be separated.
- **Doctor:** A read-only check that confirms the right instance, build, port,
  data directory, and auth are healthy.
- **Drive:** Real commands and stable selectors from this repository. Prefer
  roles, accessible names, route paths, prompt strings, and structured output
  over coordinates or tab order.
- **Evidence:** Capture both the user action and resulting state. Verify durable
  side effects from a second read path. Treat dry-run and test modes as claims
  that still require observation.
- **Cleanup:** Stop only the instances this run created. Remove scratch state,
  never proof artifacts. Never kill by process name alone.
- **Helpers:** Explain every shipped helper and its exact invocation.

State the working directory for commands and resolve helper paths from the
repository root. Keep app facts, selectors, fixtures, assertions, and cleanup in
this directory. Describe required driver capabilities without naming the host
agent's browser or desktop tool. A repository-owned Playwright, HTTP, PTY, or
control script is portable and may appear by its exact name. If a capability is
unavailable, report that path as blocked instead of substituting a weaker check.

## 3. Seed the feature map

Create `features/README.md` and one file for each of the three to five most
important user-visible features. Use the contract in
[feature-map-example/README.md](./references/feature-map-example/README.md).
Each feature records every user entry point, exact driving steps, observable end
state, and known traps.

Do not copy the map into a Harness skill root or an automation directory. Other
consumers must reference this index and load its linked feature files.

## 4. Render the discovery wrappers

Use [the wrapper rules](./references/harness-paths.md). Each
wrapper contains a repository-relative `metadata.verification-contract` pointer
and capability adaptation only. Launch commands, feature facts, evidence
requirements, and helpers stay in the canonical directory. Cursor discovers
`.agents/skills/`, so a shared Codex and Cursor project needs one neutral wrapper
there instead of two same-name definitions.

## 5. Prove the generated workflow

Run the generated instructions end to end:

1. Launch the isolated instance.
2. Run the doctor check.
3. Drive one mapped feature through its real user path.
4. Capture the named evidence and verify any side effect.
5. Clean up and confirm the evidence still exists.

Start from each generated wrapper and confirm it resolves the same contract.
Run the project policy check when a policy exists. A static wrapper check proves
discovery structure, not another Harness's runtime capabilities.

Fix every failed instruction and repeat its affected step. A workflow that has
not driven the real application once is a draft, not a deliverable. After every
failed iteration, run the generated cleanup, confirm its owned processes, ports,
profiles, and scratch state are released, then retry.

## 6. Hand off

Report the canonical path, generated wrappers, the feature proved, evidence
paths, and any surface that could not be exercised. For migrations, account for
every retired definition and updated consumer. Do not claim untested paths.
