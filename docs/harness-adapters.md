# Harness adapter reference

This page records the vendor rules that shape mstack's adapters. The links point
to the official documentation used for each entry.

## Skill locations and frontmatter

| Harness | User skill root | Project skill root | Supported optional fields |
| --- | --- | --- | --- |
| Codex | `~/.agents/skills/` | `.agents/skills/` | Agent Skills fields; Codex-specific `agents/openai.yaml` lives beside each skill |
| Claude Code | `~/.claude/skills/` | `.claude/skills/` | `name`, `description`, `license`, `compatibility`, `metadata`, and Claude invocation fields |
| OpenCode | `~/.agents/skills/`, `~/.config/opencode/skills/`, `~/.claude/skills/` | `.opencode/skills/`, `.claude/skills/`, `.agents/skills/` | `license`, `compatibility`, and `metadata` |
| pi | `~/.agents/skills/`, `~/.pi/agent/skills/` | `.pi/skills/`, `.agents/skills/` | `license`, `compatibility`, `metadata`, `allowed-tools`, and `disable-model-invocation` |
| Antigravity (`agy`) | `~/.gemini/config/skills/`, `~/.gemini/antigravity-cli/skills/` | `.gemini/skills/`, `.agents/skills/`, `.agent/skills/` | `name` (required) and `description`; other fields are not documented |
| Grok | `~/.grok/skills/`, `~/.agents/skills/`, `~/.claude/skills/`, `~/.cursor/skills/` | `.grok/skills/`, `.agents/skills/`, `.claude/skills/`, `.cursor/skills/` | `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`, `user-invocable`, and `disable-model-invocation` |
| Cursor | `~/.cursor/skills/`, `~/.agents/skills/` | `.cursor/skills/`, `.agents/skills/`, `.claude/skills/` | Agent Skills fields |

Sources:

- [Codex skills](https://learn.chatgpt.com/docs/build-skills) and [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [Claude Code skills](https://code.claude.com/docs/en/skills)
- [OpenCode skills](https://opencode.ai/docs/skills)
- [pi skills](https://pi.dev/docs/latest/skills)
- Antigravity: the `agy` 1.2.16 CLI and T3 Code's skill discovery for it,
  [`AntigravitySkills.ts`](https://github.com/pingdotgg/t3code/blob/main/apps/server/src/provider/Drivers/AntigravitySkills.ts)
  and the [Antigravity provider guide](https://github.com/pingdotgg/t3code/blob/main/docs/user/providers-antigravity.md).
  Antigravity publishes no skill-path reference, so the roots above come from
  that implementation.
- Grok: the Grok Build user guide shipped with the CLI (`docs/user-guide/08-skills.md`
  under the Grok home directory), checked against `grok inspect --json` on 1.0.46,
  which listed skills from `~/.agents/skills/`.
- [Cursor skills](https://cursor.com/docs/context/skills)

### Project install targets

`--project <dir>` writes to one project root per harness, defined as `project` in
`profiles/harnesses.json`. Where a harness reads several project directories,
mstack picks the one that lets harnesses share a copy:

| Harness | mstack project target | Evidence |
| --- | --- | --- |
| Codex | `.agents/skills/` | Codex skills documentation |
| OpenCode | `.agents/skills/` | The OpenCode skills page lists `.opencode/skills/`, `.claude/skills/` and `.agents/skills/` as project paths and walks up to the git worktree root |
| pi | `.agents/skills/` | The pi skills page: project `.agents/skills/` directories are discovered from the working directory through its ancestors, stopping at the repository root. `.pi/skills/` is also read |
| Grok | `.agents/skills/` | Grok user guide: scans `.agents/skills/` at each tier and walks every directory between the working directory and the repository root |
| Antigravity | `.agents/skills/` | T3 Code `AntigravitySkills.ts` scans `<cwd>/.gemini/skills`, `<cwd>/.agents/skills` and `<cwd>/.agent/skills`. Its canonical frontmatter is unchanged, so it shares the copy |
| Claude Code | `.claude/skills/` | Claude reads only `<cwd>/.claude/skills` (T3 Code `ClaudeSkills.ts`); it needs its own copy without the frontmatter `name` |
| Cursor | none needed | T3 Code `CursorSkills.ts` scans `<cwd>/.cursor`, `.agents`, `.codex` and `.claude` skills, so the two targets above cover it |

Unlike the user level, Antigravity joins the shared copy because it does read
`.agents/skills/` in a project. The Cursor, Claude and Antigravity rows were
checked against T3 Code commit `8f75697`. The OpenCode, pi and Grok rows come from
their documentation and were not run in a thread. Project installs are skills
only: agent files have project locations for only some harnesses
(`.claude/agents`, `.opencode/agents`, `.codex/agents`), in different formats, so
`--artifact` is refused with `--project`.

The canonical tree keeps the Agent Skills fields that all supported Harnesses
can read. Claude Code accepts `metadata` but does not act on its contents, so
`adapters/claude.json` removes that map and surfaces the logger requirement in
the `compatibility` field instead. OpenCode and pi retain `metadata` because
their official references support it.

mstack installs one canonical copy in `~/.agents/skills/` for Codex, OpenCode,
pi and Grok. Cursor reads that directory as well, so it needs no installer
target. Antigravity does not read `~/.agents/skills/` (the agent treats
`.agents/skills/` only as a project directory), so its harness has its own
canonical copy under `~/.gemini/antigravity-cli/skills/`. Antigravity requires
the `name` field and a file named `SKILL.md`, which the canonical skills already
satisfy, so `adapters/antigravity.json` and `adapters/grok.json` are empty. Grok
also scans `~/.claude/skills/`; skills with the same name collapse to one entry.
Claude output omits frontmatter `name`; Claude's documented fallback
uses the directory name, so `/meta-mode` keeps its name. OpenCode requires an
explicit name before registration and skips the Claude copy. This behavior
was checked with OpenCode 1.18.30 using a named Claude control skill and an
unnamed Claude copy alongside the canonical shared skill. Claude Code 2.1.267
also returned the directory-derived command name during an isolated
stream-JSON initialization without a user prompt or model request. Recheck this adapter
if OpenCode adds a directory-name fallback for external skills.

pi 0.85.1 keeps the first same-name skill and reports a collision for later
independent copies. A stale native pi copy can therefore hide a shared update.
The installer migration removes recognized redundant copies from discovery;
see [migration instructions](../README.md#migrate-an-existing-installation).
It also keeps backups outside skill roots so recursive scanners do not load
archived versions. Project wrappers use their separate generator and are not
migrated by the user-level installer.

## Claude plugin and upload surfaces

Claude Code, the Code tab of the Claude desktop app, Cowork, and claude.ai read
skills from different places and enforce different frontmatter rules:

| Surface | Source | Frontmatter rules |
| --- | --- | --- |
| Claude Code and the desktop Code tab | `~/.claude/skills/` (installer) or the `mstack` plugin | Unknown keys ignored; `name` falls back to the directory name |
| Claude Code plugin | `.claude-plugin/marketplace.json`, `.claude-plugin/plugin.json`, default `skills/`, `agents/`, and `hooks/hooks.json` | `name` is kept, skills are namespaced `/mstack:<skill>` |
| Desktop chat, Cowork, claude.ai | Zip per skill from `npm run pack-claude-skills` | Only `name`, `description`, `license`, `compatibility`, `metadata`, `allowed-tools`; `name` is required |

The installer's Claude adapter drops `name` so OpenCode, which scans
`~/.claude/skills/`, skips that copy. Plugin loading and uploads read the
canonical files, which keep `name`. Because uploads reject unknown keys, the
canonical frontmatter must stay inside the upload field set; the packer test and
`npm run pack-claude-skills -- --check` enforce this, along with the description
and archive limits. Claude-only invocation fields such as `user-invocable` and
`disable-model-invocation` therefore belong in an install-time adapter, never in
the canonical tree.

The plugin also carries a `SessionStart` hook. Claude Code loads
`hooks/hooks.json` from the plugin root by default, so `plugin.json` does not
reference it; `validatePluginHooks` rejects a second reference as a duplicate and
checks that the hook command names an existing script. The command is
`node "${CLAUDE_PLUGIN_ROOT}/scripts/session-hook.mjs"`, one Node script for
every platform, and it fails open. The off switch is `"sessionHook": false` in
`~/.config/mstack/models.json`. The installer adapter cannot ship this hook
cleanly: registering it means merging into the user's `settings.json`, which
mstack leaves to the user, so installer-only setups have no hook. Subagent
effort is not adapted either. Claude Code's Agent tool accepts no per-call
effort and Codex agent conversion rejects an `effort` field, so `agents/` stays
one file per role; see the
[guide page](./guide/12-claude-code-routing.md#effort-levels).

Claude's skill-authoring documentation lists a 1,024-character `description`
limit, which the packer enforces. A Help Center article on custom skills lists
200 characters. The Skills API guide limits an upload to 30 MB uncompressed; the
packer checks that figure, but claude.ai's own size limit is not documented. If
an upload rejects a skill for description length, shorten that description for the
upload rather than the canonical file, and report which limit applied.

The plugin manifest version must equal `package.json`; `npm test` and
`npm run check-package` verify it. Check plugin changes with
`claude plugin validate . --strict` using Claude Code 2.1 or later.

Sources: [Claude Code plugins reference](https://code.claude.com/docs/en/plugins-reference),
[marketplaces](https://code.claude.com/docs/en/plugin-marketplaces), and
[skills](https://code.claude.com/docs/en/skills).

## Shared project verification wrappers

Project verification has one canonical contract at
`.harness/verify/<app>/contract.md`, with its map and helpers beside it.
`mstack-policy wrappers` generates discovery wrappers separately from the
portable skill installer. Each wrapper retains
`metadata.verification-contract` as a repository-relative pointer, including
on Claude Code. The wrapper body also names the contract, so execution does
not depend on the Harness interpreting custom metadata. The policy checker
uses the metadata to validate the shared target.

[Cursor's skill documentation](https://cursor.com/docs/context/skills) includes
both `.cursor/skills/` and `.agents/skills/` as project discovery locations.
For a project configured for Codex and Cursor or Grok Bot, generate one neutral
`verify-<app>` wrapper in `.agents/skills/`. A project using only Cursor or Grok
Bot places it in `.cursor/skills/`. Claude Code, OpenCode, pi, the Grok CLI, and
Antigravity use the project roots in the table above. These wrappers contain the same capability-neutral
instructions, with no duplicate maps or host-specific driver commands.

`compatibility` text is not a reliable discovery filter. Two wrappers with
different app instructions remain conflicting definitions even if one says
"Codex only". The project check rejects conflicting or stale wrapper structure.

Native pstack installations keep their own workflow instructions. The project
initializer adds an `AGENTS.md` entry pointer and a Cursor `alwaysApply` rule
that load `.harness/workflow.md`. Claude Code also receives a `CLAUDE.md`
pointer when selected. The policy alone cannot change `/poteto-mode`.
See [mixed-Harness adoption](./guide/11-mixed-harness.md) for the commands,
migration, and evidence requirements.

## Delegation and session records

Codex stores agent configuration in `.codex/agents/*.toml` and
`~/.codex/agents/*.toml`. The installer converts the portable Markdown agent
artifacts to Codex TOML with `name`, `description`, and
`developer_instructions`. Canonical agent files must be top-level Markdown
with non-empty, single-line `name` and `description` strings. Plain, JSON
double-quoted, and YAML single-quoted strings are supported. Unsupported
metadata and nested agent directories fail conversion before installation;
an existing same-name TOML file is never overwritten by conversion.
Claude Code stores subagent definitions in
`.claude/agents/`. OpenCode stores agent definitions in `.opencode/agents/` or
`~/.config/opencode/agents/`. pi does not require a separate agent file for
skill use; it loads skills through discovery, the `--skill` flag, or the
`/skill:name` command.

Pi sessions are JSONL files under `~/.pi/agent/sessions/` by default. The
`PI_CODING_AGENT_SESSION_DIR` variable and `--session-dir` flag select another
root. Session records can form a tree through `id` and `parentId`, so a history
reader follows the active leaf instead of assuming that file order is one
linear transcript. Use `pi --export <session-file>` or `/export` when an HTML
record is needed. `--no-session` creates no persistent record.

The [pi session format](https://pi.dev/docs/latest/session-format), [pi
sessions](https://pi.dev/docs/latest/sessions), and [pi environment variables](https://pi.dev/docs/latest/environment-variables)
pages define these rules. The repository-specific history procedure is in
[`skills/recall/references/history-sources.md`](../skills/recall/references/history-sources.md).
