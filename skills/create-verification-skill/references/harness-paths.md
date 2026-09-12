# Verification paths and drivers

Project facts live once in `.harness/verify/<app>/contract.md`, `features/`, and
`helpers/`. A project skill root contains only a `verify-<app>/SKILL.md` wrapper.
Workflow skills such as `meta-mode` and `poteto-mode` stay in their installed
plugin or user directories.

## Render wrappers

When `.harness/policy.json` exists, run `mstack-policy wrappers --root <repo>`
using the project's pinned mstack package. The command renders wrappers for the
Harnesses declared in the policy. Run `mstack-policy check --root <repo>` after
rendering.

Without a policy, run `mstack-policy wrappers --root <repo> --app <app> --harness
<harness>` after writing the canonical contract. Repeat `--harness` for each
requested Harness. This creates discovery wrappers without adopting a team
policy or requiring a pstack installation.

Resolve `mstack-policy` from the project's exact mstack package version, using
`npx --package @3metajun/mstack@<version> mstack-policy` when needed. For an
unreleased development checkout, use
`node <mstack-checkout>/scripts/check-harness-policy.mjs`. Do not assume an older
installed package provides this command.

The wrapper frontmatter has a `name`, a precise `description`, and this pointer:

```yaml
metadata:
  verification-contract: .harness/verify/web/contract.md
```

Resolve the pointer from the repository root. The wrapper reads the shared
project workflow when present, the contract, and the relevant feature files.
It selects an available driver that satisfies the contract. It contains no
independent commands, selectors, fixtures, feature map, or evidence rules.
`compatibility` and a Harness name in prose are documentation, not a discovery
filter.

| Harness | Project wrapper root | Typical user skill root |
| --- | --- | --- |
| Codex | `.agents/skills/` | `~/.agents/skills/` |
| Cursor or Grok Bot | `.cursor/skills/`, or the shared `.agents/skills/` wrapper when Codex is also configured | Installed pstack or mstack plugin |
| Claude Code | `.claude/skills/` | `~/.claude/skills/` |
| OpenCode | `.opencode/skills/` | `~/.config/opencode/skills/` |
| pi | `.pi/skills/` | `~/.pi/agent/skills/` |

Cursor reads `.agents/skills/` as well as `.cursor/skills/`. When both Codex and
Cursor or Grok Bot are configured, generate only the shared `.agents` wrapper
for that app. The other roots receive the same neutral wrapper text as needed.
Do not rely on directory precedence to choose between conflicting definitions.

## Choose a driver

Discover capabilities before proving the contract:

- For a web UI, use the attached browser or the repository's Playwright or
  Cypress setup when it supports the specified user actions and observations.
- For a desktop app, use the host's desktop-control capability or the
  repository's automation harness.
- For a CLI or TUI, use a PTY, expect script, or isolated terminal session.
- For an API or service, use the repository's integration client or an HTTP
  client with structured assertions.

Record the actual driver and any missing capabilities in the run evidence.
Keep tool-specific setup in its installed driver skill. A unit test or HTTP
response cannot replace a required UI interaction.

## Migrate existing verification

1. Inventory every `verify-*` definition and feature map in project skill roots,
   automation configuration, and repository documentation. Resolve wrappers
   before counting targets.
2. Compare their launch steps, feature coverage, helpers, evidence, and cleanup.
   Check differing claims against source and the running app. Report unresolved
   differences instead of choosing authority by directory location.
3. Move the reconciled contract, map, fixtures, and helpers into the canonical
   app directory. Rewrite relative links and helper invocations for that path.
4. Point all consumers, including maintenance automations and Benny's
   `control.feature_map_path`, at the canonical contract or feature index.
5. Prove the moved instructions and each changed helper against the app. Keep
   the resulting artifacts and account for any untested feature.
6. Replace the retired definitions with generated wrappers and remove duplicate
   maps in the same PR. Review each deletion. The CLI diagnoses conflicts and
   does not choose, merge, or silently delete legacy project facts.
7. Run the project policy check and review the diff for stale paths. Retain no
   alternate active definition after migration.

Plan files and run artifacts are scratch. Delete completed plans. Keep evidence
in the contract's retained artifact location and run receipts in ignored
`.harness/runs/`. Publish required review artifacts through the team's existing
CI or artifact system.
