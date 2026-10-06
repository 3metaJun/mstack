# Changelog

## 0.8.0 - 2026-10-06

### Changes

- Sync pstack from f5bdd68 to 2cbf585. Add `benchmark-checklist`, `correct` and
  `principle-explain-the-number` (53 skills). Subagents are fresh by default,
  autopilot audit ticks run hourly, `architect` screens designs for agent
  mistakes, `perf-issue` and `hillclimb` follow the performance mantras, and the
  Opening a PR playbook prefers the run's built-in PR tool. The upstream model
  slug and Cursor rule edits are not ported. `poteto-help` is skipped because it
  needs repository docs that the installer does not ship.
- Keep autopilots restart-safe without `/goal`: on the operator's go the root
  writes a program objective (queue, order, verification rule, who merges, done
  condition) to a saved `program.md` or the Harness goal mechanism, and every
  hourly tick re-reads it. `check-plan.mjs` requires the objective and hourly
  cadence in program checklists, outside fenced examples.
- Add a Claude Code SessionStart hook to the plugin (`hooks/hooks.json`,
  `scripts/session-hook.mjs`). It routes multi-file or unknown-cause work to
  `meta-mode` on startup, resume, clear and compact. Turn it off with
  `"sessionHook": false` in `~/.config/mstack/models.json`. The installer path
  ships no hook. `readModelConfig` now reads UTF-8 BOM and UTF-16 LE files.
  Plugin validation checks the hook, its context file and agent paths.
- Harden `check-plan.mjs`: strip a UTF-8 BOM, parse fences like CommonMark
  (at most three spaces of indent), and require a box under each program task
  and under Close the program.
- Harden `worktree-audit`: scan Claude, Codex (`CODEX_HOME`) and pi session
  stores, match Windows, UNC and JSON-escaped path spellings without matching
  sibling paths, and mark a worktree safe only when its HEAD is in `origin/main`
  or exactly matches a PR merged into `main`.
- Add `docs/guide/12-claude-code-routing.md`.

### Upgrade notes

Reinstall skills to receive the new and updated skills. The hook ships with the
Claude Code plugin only and needs `node` on PATH; the plugin and the installer
should not both be active on one machine. Plans that already use the old
`/goal` and 30-minute tick wording fail `check-plan` until they name the program
objective and the hourly cadence. Effort-level agent variants were evaluated and
not added: the Codex agent conversion rejects an `effort` field and a
Claude-only generated copy would be dead code.

### Verification

Each of the three pull requests was reviewed with pi (provider relay-gpt, model
GPT-6.1-SOL) until its last round returned no P0 or P1 findings, and Node 18/22
CI passed on Linux, macOS and Windows with the package and pinned-source checks.
`claude plugin validate . --strict` passed for the hook PR on Claude Code
2.1.289. The hourly program-objective flow was not exercised through a real
restart.

## 0.7.0 - 2026-10-03

### Changes

- Add a Claude Code plugin marketplace (`.claude-plugin/`) so
  `claude plugin marketplace add 3metaJun/mstack` followed by
  `claude plugin install mstack@mstack` installs all 50 skills and both agents,
  including the files `meta-mode` needs under `tools/meta-mode`. The plugin
  version tracks the npm version.
- Add `npm run pack-claude-skills` to validate skills against Claude upload
  limits and build one zip per skill for Claude Desktop chat, Cowork, and
  claude.ai. The packer rewrites links that leave a skill, leaves code alone,
  rejects reference-style links that cannot be rewritten, applies the Agent
  Skills name rules, and checks the Skills API's 30 MB limit against
  uncompressed bytes.
- Check the Claude plugin manifest and its version in `npm test` and
  `npm run check-package`, and skip the local `.pi` runtime directory in the
  private-data scan.

### Upgrade notes

No skill content changed. Use either the plugin or the installer for Claude
Code on one machine, because both load and the duplicates compete for the skill
listing budget. Upload packages have not been tried against Claude Desktop or
claude.ai. Claude's skill-authoring documentation gives a 1,024-character
description limit while a Help Center article gives 200; several skills exceed
200, so shorten descriptions for the upload if one is rejected.

### Verification

Both pull requests passed independent subagent review with the confirmed
findings fixed (three rounds for the packer). Node 18/22 CI passed on Linux,
macOS, and Windows, together with package checks and both pinned-source
integrity checks. `claude plugin validate . --strict` passes with Claude Code
2.1.287, and an isolated install loaded 50 skills and 2 agents.

## 0.6.0 - 2026-10-03

### Changes

- Reconcile autopilot owner babysitting, code-ready verification rounds, stack
  topology ownership, and isolated replacement writers.
- Bind swarm evidence to the requested SHAs and measurement methods. Identify
  decision-log run boundaries and preserve corrections through append-only rows.
- Remove reflect's fixed finding count and port the requested upstream prompt
  reductions across the shared skill tree.
- Add `npm run model-budget -- --harness <name> --budget <label> --catalog <file>`
  to preview detected-model effort rewrites. Add `--apply` after reviewing the
  preview. Aliases and other Harness choices are preserved; unresolved models
  and duplicate reviewer panels reject writes.
- Allow individual shipping lane results to survive tests, docs, or lint-only
  changes after documented build-output comparisons. Dev-server lanes and
  lanes without saved build output rerun; CI and review always run fresh.

### Upgrade notes

Reinstall skills to receive the workflow updates. Reasoning budgets choose an
available effort variant, not a token or spending cap. Prompt reductions apply
across Harnesses; equivalent model behavior was not established by the tests.
The upstream pins remain unchanged because these are selective reviewed ports.

### Verification

Both changes passed independent subagent review with the confirmed findings
fixed. Node 18/22 CI passed on Linux, macOS, and Windows, together with Bun tests
and typechecking, package checks, and both pinned-source integrity checks.

## 0.5.0 - 2026-09-21

### Changes

- Publish as an official pi package: declare the `pi` manifest, tag the npm
  package with the `pi-package` keyword, and list skills explicitly so mstack
  appears in the pi.dev/packages gallery. Install with
  `pi install npm:@3metajun/mstack`.

## 0.4.2 - 2026-09-18

### Fixes

- Fetch release tags in CI so migration fixtures can verify released content.
- Keep the pinned upstream commit in CI aligned with the checked-in manifests.

## 0.4.1 - 2026-09-12

### Upgrade notes

Run `npx @3metajun/mstack@0.4.1 --harness all --migrate --replace --dry-run`
to inspect the migration, then repeat without `--dry-run`. Recognized legacy
copies are backed up outside skill discovery roots. Unrecognized local
copies stop migration before writes. SSH migration must run locally on the
target machine.

### Fixes

- Share one canonical skill copy across Codex, OpenCode and pi. Claude keeps
  its adapter and derives skill names from directories, so OpenCode skips its
  duplicate copy without changing global settings.
- Migrate legacy copies, archived backups and interrupted stages with retained
  originals and rollback. Validate physical path aliases before writing.
- Keep agent definitions in native directories and shared tools beside their
  skills. Deduplicate compatible explicit and remote targets.
- Reuse target resolution in the installer and smoke checks so OpenCode and pi
  checks inspect the shared installation.

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
