# Meta-mode tools

This directory contains the optional Bun tools that support `meta-mode`:

- `orch/` stores units, evidence, and gates for a long-running program.
- `watch-pr/` reads GitHub checks and review signals for a pull request stack.
- `check-plan.mjs` validates a generated plan.
- `worktree-audit.sh` produces a read-only worktree audit.

The tools are not required by the portable skill installer. Run them from this
directory with Bun after installing dependencies from `package.json`. Their
inputs and outputs are deliberately separate from the canonical
`skills/meta-mode/SKILL.md`, so each Harness can use its own equivalent runtime.

`worktree-audit.sh` can include the latest session that touched a worktree when
you set `MSTACK_TRANSCRIPTS_DIR` to a directory containing the active Harness's
workspace transcripts. Leave it unset when transcript history is unavailable;
the audit reports `-` in the `LAST_CHAT` column and still checks every Git
worktree.
