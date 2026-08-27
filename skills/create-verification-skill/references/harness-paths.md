# Project skill paths and drivers

Use the path for the active harness. Do not generate three copies unless the
user explicitly wants project-local copies for all three.

| Harness | Project skill root | Typical user-level root |
| --- | --- | --- |
| Codex | `.agents/skills/` | `~/.agents/skills/` |
| Claude Code | `.claude/skills/` | `~/.claude/skills/` |
| OpenCode | `.opencode/skills/` | `~/.config/opencode/skills/` |

Driver names vary by installation. Discover capabilities before writing the
workflow:

- For a web UI, prefer the harness's attached collaborative browser. If none is
  available, use the repository's Playwright or Cypress setup.
- For a desktop app, use the host's desktop-control capability or a
  repository-provided automation harness.
- For a CLI or TUI, use a PTY, expect script, or an isolated terminal session.
- For an API or service, use the repository's integration client or a plain
  HTTP client with structured assertions.

Record the capability actually present. Do not name a tool that the next agent
cannot discover or invoke from the same harness.
