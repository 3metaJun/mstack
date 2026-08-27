---
name: principle-fix-root-causes
description: Debug by reproducing the symptom, tracing the causal chain, and fixing the earliest incorrect assumption or state transition. Use for crashes, flaky behavior, restart failures, and recurring workarounds.
license: MIT
---

# Fix root causes

Do not silence a symptom while leaving the cause intact.

1. Reproduce the failure with the smallest observable case.
2. Ask why each preceding condition became possible until reaching the first
   incorrect assumption, invalid state, or broken boundary.
3. Instrument uncertain transitions and read actual values. Do not guess.
4. Fix the cause at its owner, then search for the same pattern elsewhere.
5. Re-run the reproduction and the nearest meaningful validation.

Resist guards that merely suppress a crash. If a workaround needs a long
comment to remain believable, revisit the model or boundary.

For failures that appear after restart, inspect durable state before blaming
unchanged code: configuration, caches, locks, checkpoints, serialized objects,
and version skew. If clearing state restores behavior, add validation,
migration, or reconciliation rather than institutionalizing manual cleanup.
