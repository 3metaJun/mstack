---
name: recall
description: Reconstruct recent working context from the active harness history, repository state, and shared project records, then return a concise current-state brief. Use for catch-up, resume, handoff, or "where did I leave off?"
license: MIT
---

# Recall

Rebuild enough recent context to resume work without loading unrelated private
history. Prefer live repository state over stale conversation claims.

## Workflow

1. **Classify the request.** If the user supplied a complete handoff with paths,
   branch, and next action, use it and skip transcript mining.
2. **Lock scope.** Pin the topic, workspace, and time window. Default "recent"
   to seven days. Never expand one project's request into other workspaces.
3. **Discover history safely.** Use the active harness entry in
   [history-sources.md](./references/history-sources.md). The bundled
   [history helper](./scripts/history.mjs) lists workspace-scoped metadata before
   reading a selected session. It is available in a skills-only installation.
   Prefer documented CLI export commands over direct database reads. Exclude
   the current session and obvious subagent, evaluation, and test noise.
4. **Search narrowly.** Order candidates by actual modification time, search for
   the topic first, then read only matching sessions and relevant regions. Pass
   `--query` and output limits to the helper, and preserve its warnings and
   truncation status in your assessment. For a
   large authorized corpus, delegate non-overlapping time slices if the host
   supports parallel agents. Keep raw transcripts out of the final context.
5. **Sweep shared records.** For a named feature, file, subsystem, or incident,
   inspect source control, issues, project chat, documentation, and observability
   systems that the user placed in scope. Unavailable sources and null results
   are findings.
6. **Verify live state.** Check surfaced branches, commits, pull requests,
   tickets, and artifacts with the current repository and relevant read-only
   tools. History records intent; live state determines truth.
7. **Sanitize.** Do not copy credentials, unrelated messages, private URLs, or
   personal content into the brief or any public artifact.

## Output contract

- **Capsule:** At most five bullets covering purpose and overall state.
- **Threads:** One line per thread with one of `[merged #N]`, `[open PR #N]`,
  `[in flight <branch>]`, `[verified, uncommitted]`, `[reverted #N]`, or
  `[planned, not started]`.
- **Problems:** At most five recurring or unresolved problems, including failed
  or reverted approaches.
- **Next move:** One concrete, highest-value action.

Cite session findings by stable session ID and shared-record findings by their
native identifier. Keep the result on the named topic and short enough to scan.
