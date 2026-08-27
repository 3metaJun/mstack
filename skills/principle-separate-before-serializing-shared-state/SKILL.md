---
name: principle-separate-before-serializing-shared-state
description: Apply when concurrent actors may write the same file, branch, key, queue, or state object. Eliminate the shared write target first and serialize structurally only when a single canonical writer is a real invariant.
license: MIT
---

# Separate before serializing shared state

Instructions and conventions are not concurrency control. When actors may
mutate the same state, first decide whether they truly need one mutable object.

1. Identify every object that multiple actors read and write.
2. Default to separate ownership: one file, key, branch, queue, or state
   directory per actor. Merge independent facts at a read or reporting boundary.
3. If a single shared writer is a real invariant, enforce it with a lockfile,
   sequential phase, single-writer actor, transaction, or atomic compare-and-swap.
4. Test crash recovery and simultaneous starts.

Two workers updating separate fields in one JSON file still share mutable
state. Two worker-owned files merged by a reader do not.

Treat a proposed lock as a prompt to revisit the ownership model before adding
serialization complexity.
