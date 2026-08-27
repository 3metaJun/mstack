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

## Shared project records

Repository history, pull requests, issues, documentation, project chat, and
observability data may explain changes that one agent transcript cannot. Query
only systems already connected and within the user's requested scope. Keep
read-only recall separate from requests that authorize edits or messages.
