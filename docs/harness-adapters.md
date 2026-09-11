# Harness adapter reference

This page records the vendor rules that shape mstack's adapters. The links point
to the official documentation used for each entry.

## Skill locations and frontmatter

| Harness | User skill root | Project skill root | Supported optional fields |
| --- | --- | --- | --- |
| Codex | `~/.agents/skills/` | `.agents/skills/` | Agent Skills fields; Codex-specific `agents/openai.yaml` lives beside each skill |
| Claude Code | `~/.claude/skills/` | `.claude/skills/` | `name`, `description`, `license`, `compatibility`, `metadata`, and Claude invocation fields |
| OpenCode | `~/.config/opencode/skills/` | `.opencode/skills/` | `license`, `compatibility`, and `metadata` |
| pi | `~/.pi/agent/skills/` | `.pi/skills/` | `license`, `compatibility`, `metadata`, `allowed-tools`, and `disable-model-invocation` |

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
