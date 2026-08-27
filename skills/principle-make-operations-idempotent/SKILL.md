---
name: principle-make-operations-idempotent
description: Design commands, lifecycle steps, installers, migrations, and processing loops to converge safely across retries, crashes, and partial prior runs.
license: MIT
---

# Make operations idempotent

Design each state-mutating operation to converge to the intended state no
matter how often it runs or where a previous attempt stopped.

Use these patterns:

- Discover and reconcile existing state before creating new state.
- Adopt healthy live resources and remove only stale resources owned by the operation.
- Compare content or identity, not creation order.
- Use owner-aware locks with stale-owner detection.
- Regenerate transient input after a failed cycle.
- Make create, update, and cleanup safe to repeat independently.

Test the design by asking:

1. What happens on two immediate successful runs?
2. What happens if the first run crashes before and after every mutation?
3. What happens if cleanup runs twice?
4. Does every path converge to the same durable state?

If the answer depends on ambiguous leftover state, add an explicit
reconciliation step or strengthen resource ownership.
