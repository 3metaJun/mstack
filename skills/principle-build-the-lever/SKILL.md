---
name: principle-build-the-lever
description: For repeated, bulk, or mechanically consistent edits, migrations, analyses, and checks, build the smallest rerunnable codemod, script, generator, or shared workflow when its reuse or proof value exceeds its cost.
license: MIT
---

# Build the lever

When repeated or mechanically consistent work would be safer or faster through
a tool, build the smallest one that does it or proves it. Do not build a tool
for a complex one-off when direct work is clearer and equally verifiable.

1. Perform one representative unit manually to learn the recipe.
2. Encode that recipe in a codemod, script, generator, query, or shared skill.
3. Make the tool safe to rerun.
4. Run it against the learned unit and compare the result with the manual version.
5. Use it for the remaining units and retain the verification output.

A deterministic lever improves both throughput and confidence. A reviewer can
read and rerun one artifact instead of reproducing many manual steps.

Prefer a lever over parallel manual edits when one deterministic pass can own
the entire operation. If work must be delegated, give every worker the same
read-only workflow and non-overlapping file ownership so instructions and edits
do not drift.

Applying this principle should produce an artifact. If there is no script,
generator, query, codemod, or shared workflow to inspect, the lever was not
built. Keep it small and commit it when the task will outlive the session.
