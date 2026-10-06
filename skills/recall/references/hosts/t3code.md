# Host history: T3 Code

Use this only when you run inside T3 Code and its `t3-code` MCP tools are
present. Tool names can carry a harness prefix such as `mcp__t3_code__`. If a
scan finds none, make one bounded call to `orchestrator_capabilities` before concluding they
are absent. Without the tools, use the harness entries in
[history-sources.md](../history-sources.md).

T3 keeps its own thread store, separate from the provider CLI's transcript
files. A thread run through T3 may be missing from the bundled helper's
provider store, and a thread run through the provider CLI directly is missing
from T3.

- **Find threads.** `t3_thread_list` lists the project's threads newest first,
  with `titleContains`, `statuses`, and `settled` filters and paged results. Delegated
  children are hidden unless `includeSubagents` is true. `t3_thread_search`
  (`query` of 2 to 200 characters, `limit` up to 50) searches titles and message
  text. It is bounded to one project, returns up to 240-character snippets, and
  gives no completeness guarantee. A null result means the search found nothing
  in its window, not that nothing happened.
- **Read a thread.** `t3_thread_read` with `threadId`. The default `messages`
  view returns user messages, assistant messages, and proposed plans.
  `activity` also returns the tool and work items, which is what to read when the
  answer depends on what an agent actually did. Continue with `afterPosition`
  set to `nextPosition`, and recover a long item with `itemId` and `textOffset`.
- **Scope.** The calling thread's project is the default. Pass a different
  `projectId` only when the user asked for it. Exclude the current thread, and
  skip delegated-task, evaluation, and test threads as with any other source.
- **Linked work.** `list_thread_pull_requests` shows the PRs registered to a
  thread. Verify them against live state as the main workflow requires.
- **Privacy.** Thread text can contain secrets. Keep raw reads out of the final
  context and the brief, and sanitize as the main workflow requires.
