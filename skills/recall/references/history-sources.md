# Harness history sources

Use only the active workspace and the scope authorized by the user. History
formats change, so prefer a harness CLI or index before reading raw storage.

## Codex

Typical user-level sources:

- `~/.codex/history.jsonl` for a lightweight prompt index.
- `~/.codex/session_index.jsonl` for session metadata when present.
- `~/.codex/sessions/` and `~/.codex/archived_sessions/` for session records.

Use metadata to narrow the candidate set before reading session contents. Do
not scan unrelated workspace sessions.

## Claude Code

Typical user-level sources:

- `~/.claude/history.jsonl` for history metadata.
- `~/.claude/projects/` for project-scoped session records.

Map the active workspace to its project directory, order records by modification
time, and read only matching conversations.

## OpenCode

Prefer the stable CLI surface:

```bash
opencode session list
opencode export <sessionID> --sanitize
```

Use `--sanitize` whenever exported data will leave the local machine. Do not
depend on OpenCode's internal database layout unless the CLI cannot provide the
required authorized record.

## Pi

Pi stores persistent sessions as JSONL trees. The default root is
`~/.pi/agent/sessions/`; project sessions are nested under a slugged directory
(`--<path>--`, with `/`, `\\`, and `:` replaced by `-`), and files are named
`<timestamp>_<session-id>.jsonl`. Set `PI_CODING_AGENT_SESSION_DIR` or pass
`--session-dir <path>` when using a custom root; the CLI flag takes precedence.

Prefer `pi -r`/`/resume` for interactive discovery and `pi --export <file>` (or
`/export`) when a readable HTML transcript is needed. For programmatic recall,
parse JSONL entries by `type` and follow the `id`/`parentId` tree from the active
leaf; do not treat the file as a linear transcript. Session versions 1 and 2
are migrated to version 3 when loaded. `--no-session` and RPC clients started
with `--no-session` do not create a persistent session.

Limit scans to the active workspace's slug and use the newest matching session
metadata before opening message contents. Session records can contain tool
outputs and extension data, so keep raw reads local unless the user explicitly
authorizes sharing.

Official references: [skills](https://pi.dev/docs/latest/skills),
[sessions](https://pi.dev/docs/latest/sessions),
[session format](https://pi.dev/docs/latest/session-format),
[environment variables](https://pi.dev/docs/latest/environment-variables),
and [RPC mode](https://pi.dev/docs/latest/rpc).

## Shared project records

Repository history, pull requests, issues, documentation, project chat, and
observability data may explain changes that one agent transcript cannot. Query
only systems already connected and within the user's requested scope. Keep
read-only recall separate from requests that authorize edits or messages.
