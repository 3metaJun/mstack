# Harness adapter reference

This page records the vendor rules that shape mstack's adapters. The links point
to the official documentation used for each entry.

## Skill locations and frontmatter

| Harness | User skill root | Project skill root | Supported optional fields |
| --- | --- | --- | --- |
| Codex | `~/.agents/skills/` | `.agents/skills/` | Agent Skills fields; Codex-specific `agents/openai.yaml` lives beside each skill |
| Claude Code | `~/.claude/skills/` | `.claude/skills/` | `name`, `description`, `license`, `compatibility`, `metadata`, and Claude invocation fields |
| OpenCode | `~/.agents/skills/`, `~/.config/opencode/skills/`, `~/.claude/skills/` | `.opencode/skills/` | `license`, `compatibility`, and `metadata` |
| pi | `~/.agents/skills/`, `~/.pi/agent/skills/` | `.pi/skills/` | `license`, `compatibility`, `metadata`, `allowed-tools`, and `disable-model-invocation` |

Sources:

- [Codex skills](https://learn.chatgpt.com/docs/build-skills) and [Codex subagents](https://learn.chatgpt.com/docs/agent-configuration/subagents)
- [Claude Code skills](https://code.claude.com/docs/en/skills)
- [OpenCode skills](https://opencode.ai/docs/skills)
- [pi skills](https://pi.dev/docs/latest/skills)

The canonical tree keeps the Agent Skills fields that all supported Harnesses
can read. Claude Code accepts `metadata` but does not act on its contents, so
`adapters/claude.json` removes that map and surfaces the logger requirement in
the `compatibility` field instead. OpenCode and pi retain `metadata` because
their official references support it.

mstack installs one canonical copy in `~/.agents/skills/` for Codex, OpenCode
and pi. Claude output omits frontmatter `name`; Claude's documented fallback
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
Bot places it in `.cursor/skills/`. Claude Code, OpenCode, and pi use the project
roots in the table above. These wrappers contain the same capability-neutral
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
