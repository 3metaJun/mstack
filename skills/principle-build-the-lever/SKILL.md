---
name: principle-build-the-lever
description: For repeated, bulk, or mechanically consistent edits, migrations, analyses, and checks, build the smallest rerunnable codemod, script, generator, or shared workflow when its reuse or proof value exceeds its cost.
license: MIT
---

# Build the Lever

When the work isn't trivial, build the tool that does it (a codemod, script, generator, or rerunnable check) instead of doing it by hand. The bar is triviality, not repetition. Skip the tool only for a couple of obvious edits.

- Do the first unit by hand, then build the tool and prove it by rerunning it on that unit. Make it safe to rerun.
- For a comparison tool, seed one known-bad change for each output it claims to compare, and confirm the tool reports each mismatch. If required input is missing, the tool must refuse or report the result as inconclusive, never as a match. Keep these controls with the experiment and rerun them before trusting its results.
- A deterministic tool beats fan-out. When you do fan out, write the recipe, the verification contract, and the fences as one skill the delegates read and cannot edit.
- Applying this produces a file. No script, codemod, generator, or delegate skill in the diff means you didn't apply it. Commit it when the work outlives the session.
- Build the smallest script that does or proves the job, never a framework.
