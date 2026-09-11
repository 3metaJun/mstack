# Changelog

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
