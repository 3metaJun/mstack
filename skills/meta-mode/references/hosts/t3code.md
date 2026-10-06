# Host binding: T3 Code

Read this when the playbook you are following sends you here and you run inside
T3 Code. T3 owns delegation, pull request watching, scheduling, thread history,
and an in-app browser as MCP tools. Using them makes child work visible in T3's
agent views, lets Stop reach it, and lets T3 wake the thread instead of a
polling loop. Without those tools, nothing in any playbook changes.

Checked against T3 Code at commit `8f75697` (`apps/server/src/mcp/toolkits/*`,
`packages/contracts`, `provider/T3OrchestrationInstructions.ts`). T3 changes
quickly. If a call rejects an argument, trust the tool's own schema over this
page and the error over both.

## Detect the host

1. The `t3-code` MCP server's tools are in your tool list. A harness can prefix
   the names, for example `mcp__t3_code__delegate_task`. The semantics are the
   same.
2. Some harnesses attach the server lazily. When a scan shows nothing but T3's
   own instructions are in your context, make one bounded call to
   `orchestrator_capabilities` before concluding the tools are absent.
3. Some ACP agents accept the server but never expose its tools. If
   `T3_ACP_MCP_NODE` is set, T3's instructions give a terminal form of the same
   call (`acp-mcp-call <tool> '<json>'`). Use the form from T3's instructions,
   not one reconstructed from this page.
4. If the tools are absent or the probe fails, follow the playbook's portable
   path. Do not retry the probe every step.

Check per capability, not once for the whole host. A thread can have the
orchestration tools and no `preview_*`, or the reverse. A delegated child gets
the same server but cannot watch pull requests.

## Capability map

| Capability | Portable behavior | T3 binding | Notes and limits |
| --- | --- | --- | --- |
| Discover providers and models | Read the user's model configuration, else `inherit-parent` | `orchestrator_capabilities` | Lists provider instances, model ids, per-model options, and `features`. T3's catalog can differ from mstack's model names, so map each role to a listed model and fall back to inheriting. |
| Delegate one bounded task | The harness delegation tool, else `run-role` | `delegate_task` with `task`, optional `role`, `title`, `mode`, `target`, `clientRequestId` | The child receives only `task`. `role` just prefixes one line, so state the role in the brief. Provider and model go in `target` as `providerInstanceId` or `driverKind`, `model`, `options`. Never at the top level. Everything inherits unless `target` overrides it. Prefer the harness's native subagent tool when it supports the chosen model. Use `delegate_task` for models it lacks, for cross-provider work, or when T3 should own and track the child. |
| Run and drain workers | Run workers concurrently, read each complete result | `mode: "async"` (the default), then end the turn | T3 delivers each completion as a notification that wakes this thread. Do not poll or start a watcher. `mode: "wait"` blocks, and its `timeoutMs` is only your wait budget: on `waitTimedOut` keep the `taskId` and read `task_status` later. |
| Inspect or stop a worker | Read the worker's report, stop it through the harness | `task_status` (`taskId`), `task_cancel` (`taskId`, `reason`) | `workState` is `working`, `waiting_for_children`, or `result_available`. A completed turn with live nested work is not a finished task. Reading a terminal result acknowledges its delivery. Cancel stops the child like a user Stop, including its nested tasks and PR watches. |
| Next round with a worker | Fresh worker with consolidated scope | `delegate_task` again, new `clientRequestId` | See the rules below. Never `t3_thread_send` on `childThreadId`. |
| Separate top-level thread with its own worktree | A fresh worker with an exclusive worktree | `t3_thread_launch` with `title`, `message`, `workspaceStrategy` | Only when the user asks for separate or top-level threads. Strategies are `{type:"worktree", baseRef, branch?, startFromOrigin?}`, `{type:"existing_worktree", worktreePath, branch?}`, `{type:"root"}`. Omitting the strategy means the project root, not your worktree. For a stack set `baseRef` to the parent branch and `startFromOrigin:false`. Uncommitted edits are not copied. It needs a full-access or default caller. `t3_worktree_list` finds existing checkouts. `create_threads` batches threads that share your checkout (1 to 20) and cannot pick a workspace. |
| Follow a thread | Read branch, PR, and pushed state | `t3_thread_wait` (`threadId`, `runId?`, `timeoutMs`), `t3_thread_read` (`threadId`, `view`, `afterPosition`, `limit`), `t3_thread_list` | A wait timeout does not interrupt the run. Page long items with `itemId` and `textOffset`. Waiting reports status only and acknowledges nothing. |
| Steer or stop another thread | Message the owner through the harness | `t3_thread_send` (`mode` `auto`, `queue`, `steer`, `restart`), `t3_thread_interrupt` | The target cannot run with broader permissions than you. Use these for top-level threads you launched, not for delegated children. |
| Register a pull request | Record the PR in the report | `link_pull_request` (`url`, or `repository` plus `number`), `list_thread_pull_requests` | Call it right after creating or taking over a PR, for every layer of a stack. Linking twice is safe. The list returns each stack bottom to top. T3's own instructions require this, and it works beside `file-pr`. |
| Watch a pull request | `watch-pr` under the harness loop | `watch_pull_request`, then end the turn. `unwatch_pull_request` to stop | T3 checks every two minutes and wakes the thread when a check fails, the required checks pass (all checks if none is required), someone other than you comments or reviews, or the branch conflicts. Only comments posted after the call wake you, so triage existing threads first. It has no merge-ready verdict, no queue or stack frontier, and no `READY`, `WAITING`, `ADVANCE`, or `COMPLETE`. After each wake, read the PR and its threads with the forge CLI and apply the playbook's stop conditions to that state. The watch ends on merge or close, when the thread settles or is archived, after 8 failed reads, after 10 wakes in a row that bring only comments, or when the user stops the thread. A merge ends it silently, with no wake (a close does wake you), so it never tells you a merge landed. See the next row. A delegated child cannot watch because its parent owns the PR. |
| Wait for a merge to land (Shipping step 8, an owner waiting on auto-merge) | The portable watcher as an event wake, plus the forge's merge check polled until the PR is merged | `watch_pull_request` for check, comment, and conflict wakes, plus a bounded, self-deleting `schedule_task` confirmation wake | A wake on green can arrive before an armed merge completes. If you then end the turn, nothing wakes you when the merge lands. Follow "Merge-confirmation task" below, which also covers cleanup after a Stop. Without `schedule_task`, keep the portable watcher and poll in this turn, and say so. |
| Wake later or on a cadence | The harness loop, a persistent process, or an external scheduler | `schedule_task` with `prompt` and `schedule`; `list_scheduled_tasks`, `update_scheduled_task`, `delete_scheduled_task`, `run_scheduled_task_now` | Pass `schedule` as an object: `{type:"interval", everyMs}` (at least 60000), `{type:"fixed_time", timeOfDay, weekdays?}`, or `{type:"webhook"}`. By default each run posts into this thread (`bindToCurrentThread`). `false` starts a fresh thread per run. Report the returned cadence and `nextRunAt`. The run sees only its `prompt`, so make it self-contained and write the stop condition into it. Pause with `update_scheduled_task` (`scheduledTaskId`, `enabled:false`), end with `delete_scheduled_task`. `run_scheduled_task_now` takes `taskId`, not `scheduledTaskId`. A webhook run sees the request only through `{{body.path}}` placeholders. |
| Ask for a secret | Ask the user to enter it themselves | `request_secret` (`label`, `reason`) | The value never reaches you. Pass the returned `secretRef` to the tool that accepts one. It works once. Never ask for a secret in chat. |
| Prior conversations | The harness history adapter, `recall`'s history helper | `t3_thread_search` (`query` of 2 to 200 characters, `limit` up to 50), `t3_thread_read` | Search is bounded, scoped to one project, and has no pagination or completeness guarantee. Matches are user and assistant text with 240-character snippets. It does not read provider transcript files, so a thread run through a provider CLI outside T3 is not in it. |
| Questions pending in another thread | Read the worker's last message | `t3_pending_request_list`, `t3_pending_request_read`, `t3_pending_request_respond` | Answers user-input questions only. It cannot approve a permission request. Answering is a decision, so do it only when your autonomy grant covers it. |
| Browser evidence | A repository Playwright script, the harness browser | `preview_status`, `preview_open`, `preview_navigate`, `preview_snapshot`, `preview_click`, `preview_type`, `preview_press`, `preview_wait_for`, `preview_evaluate`, `preview_resize`, `preview_set_appearance`, `preview_recording_start`, `preview_recording_stop` | Call `preview_status`, then `preview_open` if nothing is attached, before concluding the browser is unavailable. Use another browser only when the `preview_*` tools are absent, the user asks for one, or `preview_open` reports it unsupported. Prefer locators from `preview_snapshot` over coordinates. `preview_snapshot` with `save:true` returns a `screenshotPath`. `preview_recording_stop` returns an environment-local path to a recording up to 50 MiB. `preview_navigate` takes `url` or `target:{kind:"environment-port", port}` for a dev server. |
| Mobile simulator evidence | The project's own simulator tooling | `device_list`, `device_open`, `device_screenshot`, `device_close` | `device_open` boots the device, shows it to the user, and returns the `agent-device` CLI invocation pinned to it. Taps, typing, installs, and logs go through that CLI, not through MCP tools. `device_screenshot` can be registered separately from the others, so use the CLI's screenshot when it is absent. `device_close` with `shutdown:true` powers the device off, so close only devices you opened. |

## Merge-confirmation task

T3's scheduled tasks have no expiry or run limit (`ScheduledTaskUpsertSchedule` is only `interval`, `fixed_time`, or `webhook`), and nothing runs when a user stops a thread or it crashes. So the task must bound and delete itself, and later runs must be able to find an orphan. I did not check whether a run still fires into a thread after a user Stop, so assume it does.

1. **Create it once the merge is armed.** `schedule_task` with `{type:"interval", everyMs:120000}` (the minimum is 60000) and `bindToCurrentThread` left at its default so the tick wakes this thread. Use the title `mstack merge-confirm <owner>/<repo>#<n>`, exactly one task per PR. Check `list_scheduled_tasks` for that title first and reuse or replace it rather than adding a second.
2. **Embed the bounds in the prompt, in a form the run can read.**
   - `DEADLINE <UTC ISO timestamp>`: creation time plus 6 hours. A queue stuck for longer is a problem for a person, not for a poller. The window covers a slow CI queue and caps an orphan's life at a working day.
   - `RUNS LEFT <n>`, starting at 180 (6 hours at 2 minutes). The deadline is the binding bound and the counter a second guard.
   - The PR URL and the playbook's merge check, on GitHub `gh pr view <pr> --json state,mergedAt,mergeStateStatus,statusCheckRollup,autoMergeRequest`.
   - The task title, so the run can find itself. `list_scheduled_tasks` does not report `runCount`, and the task's own id is not known until after creation, so the prompt does not rely on either.
3. **Each run does exactly this.** Read the current UTC time from the shell. Without a trusted clock, treat the deadline as passed. Find its task with `list_scheduled_tasks` by exact title.
   - Deadline passed or `RUNS LEFT` is 0: do nothing else. `delete_scheduled_task`, then report that the task expired and the merge is unconfirmed.
   - Otherwise run the merge check. Merged: `delete_scheduled_task`, `unwatch_pull_request`, and continue the playbook's next step.
   - Closed without merging, or one of the playbook's hard-fail conditions: `delete_scheduled_task` and report the failure.
   - Still pending: rewrite its own prompt with `update_scheduled_task` (`scheduledTaskId`, `prompt`) so `RUNS LEFT` drops by one, then end the turn without reply text.
4. **Sweep orphans at the start of any Shipping, Babysit, or session-pickup run on this host.** Call `list_scheduled_tasks` and look only at titles starting with `mstack merge-confirm `. Delete a task, with `delete_scheduled_task`, when its PR is merged or closed or its `DEADLINE` has passed. Leave alone a task for a PR that this run is itself still waiting on.
5. **Say so in the final reply of the run.** Name the task title and `scheduledTaskId`, say whether it is deleted or still armed, and note that a Stop leaves an armed task running until its deadline. Give the one-line fix: `delete_scheduled_task` with that id, or ask the agent to delete the `mstack merge-confirm` tasks.
6. **Fallback.** If `schedule_task` is absent or refused, keep the portable watcher and the forge poll in this turn, and say that no confirmation task exists.

## Rules that do not change

- **Merging stays a user decision.** A watch wake, a passing check, or a
  schedule tick is news. Do not merge or arm merge-when-ready unless the user
  asked, and read PR state yourself first.
- **Child limits cannot exceed the parent's.** T3 rejects a `runtimeMode` or
  `interactionMode` broader than yours with `runtime_mode_escalation_denied` or
  `interaction_mode_escalation_denied`. Do not try to escalate. Report the
  limit instead.
- **Every delegated round carries a full brief.** A child sees nothing of this
  conversation. Each new round is a new `delegate_task` call with the original
  brief, prior findings, replies, and unresolved objections. Give each round its
  own `clientRequestId`, and reuse that id only when retrying the same round.
  `childThreadId` is storage, not a handle for another round.
- **Idempotency is opt-in and per tool.** `delegate_task`, `schedule_task`,
  `request_secret`, `t3_thread_send`, and `task_cancel` derive their command from
  `clientRequestId`, so a reused id is a retry and not a new round, and a new
  round under an old id may not start. Without an id T3 generates one, so a
  blind retry of a lost `delegate_task` or `schedule_task` creates a duplicate.
  List before retrying. `t3_thread_launch` has no key at all: after an error or
  a lost response, inspect `t3_thread_list` before retrying. This is read from
  the source and not exercised.
- **A "subagent" request is not a thread request.** Parallel or delegated work
  uses `delegate_task`. Reach for `t3_thread_launch` or `create_threads` only
  when the user asks for separate, new, or top-level threads.
- **Hand the PR back unwatched.** Call `unwatch_pull_request` before returning
  work to the user, so the thread leaves T3's working list.
- **Bounded waits.** Keep any wait loop bounded and never duplicate active work.
  Prefer ending the turn so T3 can wake you.

## Fallbacks

- No `t3-code` tools, or a probe that fails: use the playbook's portable path
  unchanged (`run-role` or the harness delegation tool, `watch-pr` under the
  harness loop, the history helper).
- A call that returns an error: read it. `model_unavailable` or
  `provider_unavailable` means pick again from `orchestrator_capabilities` or
  inherit. `parent_not_active` and `capability_denied` mean this caller cannot
  use that tool, so take the portable path for that capability only.
- `watch_pull_request` refused because the caller is a delegated child: report
  the PR state to the parent, or use the portable watcher in this child. Do not
  ask the parent to poll on your behalf.
- When a fallback changes who can observe or stop the work, for example a
  `run-role` child that T3's Stop does not reach, say which path ran.
