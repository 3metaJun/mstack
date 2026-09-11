# Harness history sources

Use only the active workspace and the scope authorized by the user. History
formats change, so prefer a harness CLI or index before reading raw storage.

## Bundled reader

Run the helper relative to the installed `recall` directory. It needs Node.js
18 or newer and no repository checkout or optional artifact installation:

```bash
node <recall-directory>/scripts/history.mjs list --harness codex --workspace <workspace> --exclude <current-session-id>
node <recall-directory>/scripts/history.mjs read --harness codex --workspace <workspace> --session <session-id> --query parser --limit 8 --max-chars 6000
```

Choose `codex`, `claude`, `opencode`, or `pi` for `--harness`. `list` emits IDs,
workspaces, and update times, without titles or message text. It defaults to the
last seven days and 20 results. `--since <ISO-date>` changes the time window;
`--limit` changes the result count. `read` requires a session ID from that
workspace, returns the last 20 user/assistant messages by default, and caps text
at 12,000 characters. Pi branch and compaction summaries use role `summary`.
The character budget is allocated to the newest messages first, then output is
returned in conversation order.
`--query` keeps messages containing that literal text, without case sensitivity.
Reading an explicit session has no default time cutoff.

Repeat `--exclude <id>` for the current session and known test/evaluation runs.
Codex also excludes `CODEX_THREAD_ID` automatically. Known child-session metadata
and `subagents/` directories are excluded. Other harnesses do not reliably expose
the active session ID to a child process, so supply it explicitly. For `reflect`,
which intentionally reads the active session, use the transcript already in
context or a digest when its ID cannot be selected through this reader.

The helper checks workspace metadata before extracting messages. Claude and
default pi discovery first restrict the filesystem search to the workspace
directory. Codex and explicit pi session directories require reading session
headers to find the workspace. Symlink entries are not followed. Missing stores
return an empty list; unreadable or unsupported metadata and malformed selected
records produce warnings without including raw record contents. A selected file
over 16 MiB is rejected. Use a native export or reader for larger sessions.

Read output remains private source material. The helper omits tool payloads but
does not redact secrets that appear in user or assistant text. Review excerpts
before using them in a brief. `truncated: true` and warnings mean the result is
incomplete; do not treat it as proof that an event never happened.

## Codex

Resolve the user root from non-empty `CODEX_HOME`, otherwise `~/.codex`.
`--root <path>` overrides that root for the helper. Typical sources below that
root are:

- `history.jsonl` for a lightweight prompt index.
- `session_index.jsonl` for session metadata when present.
- `sessions/` and `archived_sessions/` for session records.

Use metadata to narrow the candidate set before reading session contents. Do
not scan unrelated workspace messages. The helper supports rollouts whose first
record is `session_meta` with `payload.id` and `payload.cwd`; it reads
`response_item` messages, or older user/agent `event_msg` records when response
messages are absent. It does not reconstruct an unsaved active branch or load
history index prompts across projects.

## Claude Code

Resolve the user root from non-empty `CLAUDE_CONFIG_DIR`, otherwise `~/.claude`.
`--root <path>` overrides that root for the helper. Typical sources are:

- `history.jsonl` for history metadata.
- `projects/` for project-scoped session records.

Map the active workspace to its project directory, order records by modification
time, and read only matching conversations. The helper uses the standard project
slug, replacing each non-alphanumeric workspace character with `-`, and verifies
`cwd` and `sessionId` in a record before extracting text. It supports UUID and
`parentUuid` conversation trees, defaults to the last persisted entry, and accepts
`--leaf <uuid>` for a specific branch. Missing parents or duplicate IDs fail
explicitly. Nonstandard or shortened project slugs require native discovery;
the helper does not fall back to scanning all project directories.

## OpenCode

Prefer the stable CLI surface:

```bash
opencode session list --format json --pure
opencode export <sessionID> --sanitize --pure
```

Use `--sanitize` whenever exported data will leave the local machine. Do not
depend on OpenCode's internal database layout unless the CLI cannot provide the
required authorized record. The helper runs these commands with the requested
workspace as its working directory. It filters list entries by exact `directory`
and excludes `parentID` sessions before exporting the selected ID, then verifies
the export's `info.id` and `info.directory`. Sanitized exports may replace the
directory with `[redacted:session-directory:<session-id>]`; the helper accepts
only the marker for the already selected session. It inherits OpenCode's configured
environment, including `XDG_DATA_HOME`; `--root` is not supported. A missing CLI
or unsupported JSON schema is an error, not an empty-history result.

OpenCode's sanitizer can replace all message text with `[redacted:text:...]`.
The helper reports that limitation; sanitized text cannot recover a conversation.
For private local recovery, explicitly add `--local-text` to `read` with a
workspace and session ID. Only that selected session is exported without
`--sanitize`. Output goes to stdout, no transcript file is written, and the
result contains `sanitized: false`. As with the other harness readers, inspect
unredacted text before quoting it in any brief or shared artifact.

## Pi

Pi stores persistent sessions as JSONL trees. The default root is
`~/.pi/agent/sessions/`; project sessions are nested under a slugged directory
(`--<path>--`, with `/`, `\\`, and `:` replaced by `-`), and files are named
`<timestamp>_<session-id>.jsonl`. Set `PI_CODING_AGENT_SESSION_DIR` or pass
`--session-dir <path>` when using a custom root; the CLI flag takes precedence.
For the helper, `--root <path>` names that exact custom session directory and
takes precedence over the environment variable. Otherwise the helper uses the
workspace slug under `$PI_CODING_AGENT_DIR/sessions/`, falling back to
`~/.pi/agent/sessions/` when the agent directory is unset or empty.

Prefer `pi -r`/`/resume` for interactive discovery and `pi --export <file>` (or
`/export`) when a readable HTML transcript is needed. For programmatic recall,
parse JSONL entries by `type` and follow the `id`/`parentId` tree from the active
leaf; do not treat the file as a linear transcript. Session versions 1 and 2
are migrated to version 3 when loaded by pi. The read-only helper accepts version
3 and does not migrate files. It follows the last persisted entry by default;
pass `--leaf <entry-id>` when a different branch matters. Missing parents,
duplicate IDs, and cycles fail explicitly. An in-memory branch change with no
persisted entry cannot be inferred from the file. `--no-session` and RPC clients started
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
