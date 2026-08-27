---
name: create-verification-skill
description: Generate a durable project-local verification skill that launches and drives the real app, captures evidence, and cleans up safely. Use when the user explicitly asks to create or bootstrap a reusable verification or control workflow, not for a one-time verification pass.
license: MIT
---

# Create a verification skill

Create a project-local skill that another agent can read cold and use to prove
the real application behavior. Do not write a generic test plan. Record the
commands, stable handles, health checks, evidence, and cleanup that work in this
repository.

## 1. Interview the repository

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

## 2. Choose the project skill root

Use the current harness's project-level skill directory from
[harness-paths.md](./references/harness-paths.md). Name the generated skill
`verify-<app>` and create `<skill-root>/verify-<app>/SKILL.md`.

The generated frontmatter must contain `name` and a precise `description`. Its
body must include:

- **Launch:** Exact start command, readiness signal, ownership marker, and teardown.
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

## 3. Seed the feature map

Create `features/README.md` and one file for each of the three to five most
important user-visible features. Use the contract in
[feature-map-example/README.md](./references/feature-map-example/README.md).
Each feature records every user entry point, exact driving steps, observable end
state, and known traps.

## 4. Prove the generated skill

Run the generated instructions end to end:

1. Launch the isolated instance.
2. Run the doctor check.
3. Drive one mapped feature through its real user path.
4. Capture the named evidence and verify any side effect.
5. Clean up and confirm the evidence still exists.

Fix every failed instruction and repeat its affected step. A workflow that has
not driven the real application once is a draft, not a deliverable. After every
failed iteration, run the generated cleanup, confirm its owned processes, ports,
profiles, and scratch state are released, then retry.

## 5. Hand off

Report the generated path, the feature proved, the evidence paths, and any
remaining surface that could not be exercised. Do not claim untested paths.
