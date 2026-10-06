# Optional session context: T3 Code

This file is an explicit, user-selected routing artifact for sessions that run
inside T3 Code and should keep following mstack's `/meta-mode` workflow. It
complements `SESSION-CONTEXT.md`; the mstack installer never registers it as a
hook, startup command, or implicit instruction.

## Opt-in contract

1. Select the `session-context` artifact explicitly with
   `--artifact session-context`. This installs the whole `session-context/`
   directory, so this file arrives next to `SESSION-CONTEXT.md`.
2. Configure the active harness to read this file using its documented,
   user-owned session or project configuration surface.
3. Confirm the harness configuration and review the file before using it in a
   sensitive repository.

If the file is not explicitly selected and configured, do nothing.

## When this applies

Apply this only when the `t3-code` MCP server's tools are actually present in
the session. T3 Code injects that server and its own orchestration instructions
into hosted provider sessions, and its tool names may carry a harness prefix such
as `mcp__t3_code__delegate_task`. T3 attaches the server lazily on some
harnesses, so if a tool scan shows nothing, make one bounded direct call to
`orchestrator_capabilities` before concluding the tools are absent.

If the tools are absent or that call fails, do nothing special and follow
`/meta-mode` normally, including its usual `run-role` and PR-watching paths.

## Routing inside T3 Code

These rules refine, and never replace, T3's own injected instructions and the
harness's normal approval and tool policy.

- Delegation: prefer `delegate_task` over spawning provider CLIs with
  `run-role` for child work. Pick the provider and model from
  `orchestrator_capabilities`, keep each returned `taskId`, and manage it with
  `task_status` or `task_cancel`. For every further round, call `delegate_task`
  again with the full brief, prior findings, and unresolved objections and a new
  `clientRequestId`; do not continue a child with `t3_thread_send` on its
  `childThreadId`.
- Threads: do not use `t3_thread_launch` or `create_threads` for a plain
  "subagent" or parallel-work request. They create top-level conversations and
  are for when the user explicitly asks for separate threads.
- Pull requests: call `link_pull_request` with the full URL for every PR you
  create or work on, including each layer of a stack. When asked to watch or
  babysit a PR, call `watch_pull_request` and end the turn instead of polling or
  running the Bun PR watcher in `tools/meta-mode/watch-pr`; T3 wakes the thread
  on check completion, new comments, or conflicts. Call `unwatch_pull_request`
  before handing the work back to the user.

## When the task is T3 Code itself

If the repository being changed is T3 Code, its `AGENTS.md` applies and takes
precedence over this file. Its three hazards, because the user's own T3 instance
is often the one running you:

- Never kill a process by matching a name, path, or worktree string. Kill only a
  PID you captured when you started it.
- Never start a server against, or write to, `~/.t3/userdata`. Copy data into
  your worktree's own state instead.
- Never set `VITE_HTTP_URL` or `VITE_WS_URL` for development.

## Security and portability boundary

This is plain text, not executable configuration. It does not grant tools,
permissions, network access, or persistence, and it does not configure or
authenticate the `t3-code` MCP server; T3 Code owns that. Keep routing advisory:
do not execute commands, modify files, install hooks, or send data without the
harness's normal approval and tool policy. Hooks remain unsupported unless
explicitly configured outside mstack.

Do not put secrets, credentials, transcript contents, bearer tokens, or
machine-specific paths in this file. Keep the canonical skill tree
Harness-neutral; this artifact is a separate optional boundary for users who
choose session routing.
