---
name: principle-sequence-verifiable-units
description: Break migrations, sweeps, multi-step changes, commits, and pull requests into small units that each end in a known, verifiable state before the next begins.
license: MIT
---

# Sequence work into verifiable units

Order work so each unit ends in a check and no later unit builds on an unknown
state.

For delivery, arrange commits or pull requests so a reviewer can replay the
argument. Useful sequences include failing test then fix, baseline capture then
treatment, schema then consumer, or scaffold then feature. Each unit should be
coherent on its own and make the next unit easier to verify.

Use `principle-prove-it-works` to keep checks direct and
`principle-build-the-lever` to make them rerunnable.
