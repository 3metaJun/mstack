# Meta-mode tools

This directory contains the optional Bun tools that support `meta-mode`:

- `orch/` stores units, evidence, and gates for a long-running program.
- `watch-pr/` reads GitHub checks and review signals for a pull request stack.
- `check-plan.mjs` validates a generated plan.
- `check-playbooks.mjs` validates project playbook extensions against the bundled playbooks.
- `worktree-audit.mjs` produces a read-only, cross-platform worktree audit.
- `worktree-audit.sh` remains a compatibility wrapper for the historical name.
- `resume.mjs` creates, publishes, and reads durable cold-start checkpoints under the repository's common Git directory.
- `pr-safety.mjs` provides harness-neutral deadline, landing-revision, guarded-merge, and command-transport helpers.

The tools are not required by the portable skill installer. Run them from this
directory with Bun after installing dependencies from `package.json`. Their
inputs and outputs are deliberately separate from the canonical
`skills/meta-mode/SKILL.md`, so each Harness can use its own equivalent runtime.

Run `node check-playbooks.mjs <project-root>` to validate `.agents/playbooks/` before using project extensions. Pass `--bundled <path>` to check against another installed skill tree. The normal output remains human-readable. Add `--json` for a machine-readable object with `errors`, `warnings`, and `diagnostics`. Errors fail the command; warnings for duplicate `extends` entries or anchors do not fail unless you add `--strict`.

`pr-safety.mjs` accepts both GitHub CLI (`gh`) and Origin-style guarded merge arguments; callers retain responsibility for authorization and post-merge readback.

`worktree-audit.mjs` (or its `worktree-audit.sh` compatibility wrapper) can include the latest session that touched a worktree when
you set `MSTACK_TRANSCRIPTS_DIR` to a directory containing the active Harness's
workspace transcripts. Leave it unset when transcript history is unavailable;
the audit reports `-` in the `LAST_CHAT` column and still checks every Git
worktree.

Resume checkpoints are project-local and Git-bound. They are stored under
`<git-common-dir>/mstack/resume/<worktree-key>/`, so each worktree has its own
namespace and removing a linked worktree does not delete them. The note and
evidence paths must be regular files inside the worktree. `begin` writes an
unpublished draft; `publish` validates those paths, records their sha256, and
atomically exposes the complete record; `read` never returns drafts and, without
`--id`, returns the checkpoint with the newest `publishedAt`. `read` re-hashes
the referenced files and reports each one as `ok`, `changed`, or `missing`
(`filesOk` plus a stderr warning), so a stale note is not mistaken for current.
Only `begin` needs `user.name` and `user.email`.

`worktree-audit.mjs` reports `unknown` in the `DIRTY` column when `git status`
fails and classifies that worktree as `hold-unknown`, never `safe`.
