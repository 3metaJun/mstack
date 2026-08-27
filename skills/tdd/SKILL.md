---
name: tdd
description: Use when the user explicitly requests TDD or a regression test, or when a bug has an obvious, cheap local test target. Skip when the test path is unclear, integration-heavy, brittle, or disproportionately expensive.
license: MIT
---

# TDD bug fix

Make broken behavior executable before changing production code when a focused
test can be written cheaply.

## Workflow

1. Identify intended behavior, current behavior, affected path, and the smallest
   observable reproduction.
2. Choose the narrowest existing test level that reaches the code path.
3. Add the smallest test that encodes intended behavior without mirroring the implementation.
4. Run it before the fix and confirm it fails for the intended reason.
5. Make the smallest production change that fixes the cause.
6. Run the new test and confirm it passes.
7. Run nearby tests, type checks, lint, or scenario checks in proportion to risk.

## When a failing test is impractical

Explain why before fixing, then use the closest executable proof: a targeted
script, reproduction command, browser path, snapshot comparison, log assertion,
or focused integration check.

Prefer no new test over one dominated by mocks, timing, unrelated global state,
large fixture churn, or infrastructure that costs more than the bug warrants.

## Guardrails

- Do not weaken assertions to fit a wrong implementation.
- Do not change expected behavior without making that decision explicit.
- Keep the regression focused on the bug.
- Make flaky signals deterministic where practical.
- Fix the focused case before expanding to sibling coverage.

Report the failing-before evidence, passing-after evidence, and adjacent checks.
If red-before could not be demonstrated, say why.
