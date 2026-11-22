# Meta-mode tools

This directory contains the optional Bun tools that support `meta-mode`:

- `watch-pr/` reads GitHub checks and review signals for a pull request stack (`watch-pr`) and inspects or safely cancels pending auto-merge / merge-queue entries (`ship-pr`).
- `check-playbooks.mjs` validates project playbook extensions against the bundled playbooks.
- `worktree-audit.mjs` produces a read-only, cross-platform worktree audit.
- `worktree-audit.sh` remains a compatibility wrapper for the historical name.
- `resume.mjs` creates, publishes, and reads durable cold-start checkpoints under the repository's common Git directory.
- `pr-safety.mjs` provides harness-neutral deadline, landing-revision, guarded-merge, and command-transport helpers.

The tools are not required by the portable skill installer. `watch-pr` and `ship-pr` use Bun
and `bootstrap.ts` caches production dependencies under
`${XDG_CACHE_HOME:-~/.cache}/mstack/meta-mode-tools/<install-key>/` via
`NODE_PATH` (leaving the installed plugin directory unmodified so plugin file
hashes stay intact; if upgrading in place from an older checkout that created
`tools/meta-mode/node_modules/`, remove that legacy `node_modules/` directory so
`NODE_PATH` resolves the lockfile-keyed cache cleanly). `watch-pr` supports
`--expect-app <slug>` for GitHub Apps whose queued suite with no runs counts as
pending, and `--settle <seconds>` (default `0`; max `86400`) for an optional
post-push review-bot quiet window (requires readable push activity or a
continuous watch run, since one-shot `--status-only` calls do not persist an
in-memory `first-seen` timer). Their inputs and outputs are deliberately
separate from the canonical `skills/meta-mode/SKILL.md`, so each Harness can use
its own equivalent runtime.

Run `node check-playbooks.mjs <project-root>` to validate `.agents/playbooks/` before using project extensions. Pass `--bundled <path>` to check against another installed skill tree. The normal output remains human-readable. Add `--json` for a machine-readable object with `errors`, `warnings`, and `diagnostics`. Errors fail the command; warnings for duplicate `extends` entries or anchors do not fail unless you add `--strict`.

`pr-safety.mjs` accepts both GitHub CLI (`gh`) and Origin-style guarded merge arguments; callers retain responsibility for authorization and post-merge readback.

`worktree-audit.mjs` (or its `worktree-audit.sh` compatibility wrapper) is read-only unless `--fetch` is passed and accepts `-b`/`--base <ref>` (defaulting to `origin/HEAD`, then `origin/main`, then `origin/master`, resolved under `refs/remotes/` so a local branch or tag cannot shadow a remote ref). It sets `GIT_OPTIONAL_LOCKS=0` so it never refreshes another worktree's index, checks `LAST_CHAT` across Claude Code `projects`, Codex `sessions` and `archived_sessions` (including custom non-secret T3 provider homes from `${T3CODE_HOME:-~/.t3}/userdata/settings.json`), pi sessions, and GitHub Copilot `session-state` (or `MSTACK_TRANSCRIPTS_DIR` when set), and holds worktrees with locks (`hold-locked`), unreadable status (`hold-unknown`), tracked edits (`hold-wip`), untracked files (`hold-scratch`), worktree-only HEAD/reflog commits (`hold-reflog`), non-disposable ignored files including inside submodules (`hold-ignored`), initialized submodules that `git worktree remove` refuses (`hold-submodule`), or open PRs (`hold-open-pr`). A worktree reaches `safe` only when every safety fact is known and clean and its HEAD is in the resolved base ref or carried by a PR merged into that base branch.

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
