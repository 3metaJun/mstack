# Changelog

## 0.4.0 - 2026-09-12

This release adds a shared project workflow for teams using pstack and mstack
in the same business repository.

### Upgrade notes

- Use `npx --package @3metajun/mstack@0.4.0 mstack-policy --help` to run the new
  CLI. Reinstall mstack skills to get the shared contract instructions.
- Adoption is explicit. Initialize the project policy, reconcile existing
  verification definitions into `.harness/verify/<app>/`, prove the contract
  against the running app, and generate its wrappers. See the
  [adoption guide](docs/guide/11-mixed-harness.md).
- Initialization exports a standalone checker for business CI. Review its
  updates with the project policy. Configure GitHub branch protection separately.

### Changes

- Add `mstack-policy init`, `wrappers`, `check`, `preflight`, and `record` for
  project setup, structural checks, isolated Git work, and verification receipts.
- Keep app contracts, feature maps, and helpers in one canonical directory.
  Neutral wrappers support Cursor, Grok Bot, Codex, Claude Code, OpenCode, and pi.
  Cursor and Codex share an `.agents/skills` wrapper to avoid duplicate discovery.
- Route verification creation, maintenance, setup, and Benny to the shared map.
  Project entry instructions also direct native pstack to the repository workflow.
- Check the linked worktree, branch, and base before verification. Record command
  results and evidence digests, and reject stale or modified receipts.
- Track reviewed upstream adaptations with source and target digests.
- Handle Windows path aliases and CRLF receipts, and run the CLI correctly
  through npm launchers and linked package paths.

### Verification

The implementation passed the Node 18 and 22 CI matrix on Linux, macOS, and
Windows, package checks, both pinned-source integrity checks, and the meta-mode
Bun tests and typecheck. Installed tarballs passed CLI checks through npm
launchers and Windows junctions.

In the inkScroll pilot, Codex with mstack and Grok loading the pinned native
pstack source completed book creation, reload, IndexedDB readback, and editor
navigation. Both produced verification receipts and cleaned up their own
browser and server. This pilot did not test marketplace discovery or audit
every feature. Receipts check command results and evidence integrity; app
behavior still needs review.

## 0.3.0 - 2026-09-11

This release includes the workflow, installation, and model execution fixes
merged since npm version 0.2.0.

### Upgrade notes

- `run-role` no longer treats `inherit-parent` as the new CLI's default model.
  Add `--parent-model <known-parent-model>` to inherit explicitly, or choose
  `--model auto` to use the CLI default. An explicit `--model <name>` also works.
  Calls without a model configuration need an explicit model selection too.
- Codex's optional agent artifacts are now TOML files in `CODEX_HOME/agents`,
  defaulting to `~/.codex/agents`. Reinstall with the `agents` artifact selected.
  A custom remote skill directory needs an explicit agent artifact target.
- Malformed or repeated model options and whitespace-padded model names are
  rejected. History commands reject repeated single-value options while
  allowing repeated `--exclude` arguments.

### Changes

- Restore upstream workflow instructions, design references, TypeScript
  examples, and missing support files. Integrity checks now cover all 50 skill
  trees and moved files against both pinned upstream sources.
- Support reviewer model lists, explicit list selection, and concurrent
  read-only execution with per-model output and failure reporting.
- Ship a standalone history reader for Codex, Claude Code, OpenCode, and pi.
  It scopes reads to the requested workspace, reconstructs supported branches,
  bounds excerpts, and preserves warnings about incomplete results.
- Complete the bundled skill-authoring workflow and installed-skill fallbacks
  for `recall`, `reflect`, and `automate-me`.
- Correct Harness metadata and agent formats, preserve agent bodies during
  conversion, and reject conflicting or invalid artifact targets before writes.
- Keep npm ignore rules outside the reviewed runtime tree so installed-package
  integrity checks succeed. CI rejects packages missing any reviewed skill file.

### Verification

The integrated source passed 125 tests on Windows with one expected Unix-only
skip, package checks, and both pinned-source integrity checks. CI covers Linux,
macOS, and Windows on Node 18 and 22.

Real diagnosis workflows loaded the restored skill, reproduced an asynchronous
cache invalidation failure, and identified its cause in pi, OpenCode, Claude
Code, and Codex. The Claude Code and Codex runs used GLM in Debian WSL. Codex
completed with `low` reasoning effort; its first `max` run timed out. Its
sandboxed test subprocess needed a direct invocation of the same test file to
show the individual assertions. These checks cover the diagnosis workflow, not
every skill or model setting.
