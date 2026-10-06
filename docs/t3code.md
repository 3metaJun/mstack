# Use mstack in T3 Code

[T3 Code](https://github.com/pingdotgg/t3code) is a GUI that runs Codex, Claude Code, Cursor, Grok, OpenCode, Antigravity, Pi, and ACP Registry agents as subprocesses. It does not own skills. Each provider finds its own skills, and T3 lists them in the composer. Installing mstack for a provider is therefore enough; nothing is installed into T3 itself.

This page was checked against the T3 Code source at commit `8f75697` (October 2026), the Grok CLI 1.0.46, and the mstack installer in this repository. T3 changes quickly, so treat the tables as a starting point and use the checks in each section when something does not show up.

## How T3 finds skills

| Provider | Who lists the skills | User roots | Project roots |
| --- | --- | --- | --- |
| Codex | Codex app-server (`skills/list`) | Codex's own, `~/.agents/skills` for mstack | Codex's own, `.agents/skills` for mstack |
| Claude Code | T3 scans the directories | `<config dir>/skills`, where the config dir is the instance's home path, else `CLAUDE_CONFIG_DIR`, else `~/.claude` | `<cwd>/.claude/skills` only |
| Cursor | T3 scans the directories | `~/.cursor/skills`, `~/.agents/skills`, `~/.codex/skills`, `~/.claude/skills` | The same four names under `<cwd>` |
| Grok | `grok inspect --json` | Grok's own; on Grok CLI 1.0.46 both `~/.agents/skills` and `~/.claude/skills` were reported | Grok's own, not checked |
| Antigravity | T3 scans the directories | `~/.gemini/config/skills`, `~/.gemini/antigravity-cli/skills`. Not `~/.agents/skills`. | `<cwd>/.gemini/skills`, `<cwd>/.agents/skills`, `<cwd>/.agent/skills` |
| Pi | Pi (`get_commands`) | Pi's own | Pi's own; approve the project in Pi first |
| OpenCode | OpenCode, per project directory | OpenCode's own | OpenCode's own |
| ACP Registry agents | The agent; commands it names with a `$` prefix | Agent-defined | Agent-defined |

"Pi's own" and the other provider-defined cells mean T3 shows whatever the CLI reports. For the paths mstack installs to, see [Harness adapter reference](./harness-adapters.md). Cursor deduplicates by directory name, project roots first, so a copy in `~/.agents/skills` and one in `~/.claude/skills` show up once.

## Install for the providers you use

`~/.agents/skills` is the shared root, so one install covers most of the table:

```bash
npx @3metajun/mstack --harness codex,claude,pi
```

- Codex, Pi, OpenCode, and Cursor read the shared copy. Grok read it on 1.0.46.
- Claude Code needs its own copy in `~/.claude/skills`, which `--harness claude` writes. The installer leaves out the frontmatter `name` there because Claude Code names a skill after its directory.
- Antigravity does not read `~/.agents/skills`, and it needs the frontmatter `name`, so the Claude copy does not work for it either. Use an `antigravity` harness if your mstack version has one (`npx @3metajun/mstack --help` lists the harnesses). Otherwise install the canonical copy into its directory by overriding the Codex target:

  ```bash
  HARNESS_SKILLS_CODEX_DIR='~/.gemini/antigravity-cli/skills' \
    npx @3metajun/mstack --harness codex --dry-run
  ```

  Drop `--dry-run` once the printed plan looks right. On Windows PowerShell, set `$env:HARNESS_SKILLS_CODEX_DIR` first.

After installing, run **Restart agent session** from the command palette (web and desktop). The conversation continues and the next message starts the agent with the new skills. If a skill is still missing, open **Settings → Providers** and refresh that provider's status.

## Invoke a skill from the composer

Type `$` to pick a skill. Skills also appear after `/` unless you turned off **Settings → General → Show skills in slash menu**. T3 always inserts `$name`, then rewrites it per provider when the message is sent:

| Provider | What the agent receives |
| --- | --- |
| Codex | `$name`, which Codex parses natively |
| Claude Code | `/name`. Claude expands only one skill per message, so with several mentions the last one is expanded and earlier ones become `/name` text the model may start itself. |
| Cursor | `/name` |
| Pi | A leading `/skill:name` for each mentioned skill |
| OpenCode 2.x | T3 attaches the named skills to the prompt |
| Grok, Antigravity, ACP agents | `$name` unchanged. T3 does no rewriting, so the agent must understand the text itself. |

A mention only counts when the name matches `[a-zA-Z0-9][a-zA-Z0-9:_-]*`, contains a letter, and belongs to a skill T3 listed for that provider. Every mstack skill name fits. `$HOME` or `$20` in prose stays text.

## Gotchas

- **Claude reads fewer places.** T3 scans only the config directory's `skills` and `<cwd>/.claude/skills`. Skills in `~/.agents/skills` or a project's `.agents/skills` do not reach Claude, so a project's `verify-<app>` wrapper must also exist under `.claude/skills` for Claude threads. A user copy beats a project copy of the same name.
- **Claude names a skill by its directory,** not the frontmatter `name`. This is why the installer can drop `name` for Claude, and why renaming the frontmatter changes nothing.
- **Invalid YAML hides a skill.** Cursor and Antigravity skip a skill whose frontmatter fails strict YAML parsing. Claude Code tolerates an unquoted `: ` inside a plain scalar and T3 repairs it for Claude only, so a description like `description: Use when: x` works in Claude and vanishes in Cursor. Quote any description that contains `: `.
- **Antigravity needs `name`.** Without it T3 falls back to the file name and lists the skill as `SKILL`. Its project directories include `.agents/skills`, so a committed project wrapper is found there, but `~/.agents/skills` is only scanned when the project is your home directory.
- **Windows home directories differ.** Claude and mstack's installer use the OS home directory (`USERPROFILE`). Cursor checks `HOME` first, then `USERPROFILE`. Antigravity uses `USERPROFILE`, then `HOMEDRIVE` plus `HOMEPATH`. If `HOME` is set to something else in the environment T3 runs in, Cursor looks in a different place than the installer wrote.
- **Instance settings are not inherited by your own commands.** A Claude instance with a custom home path, or environment variables set on a provider instance, apply to the agent T3 starts. A terminal or script you run yourself, including `npx @3metajun/mstack`, does not see them. For a Claude instance with its own config directory, point the installer there explicitly with `HARNESS_SKILLS_CLAUDE_DIR=<that directory>/skills`.
- **Project skills for Pi** need the project approved in Pi, and then a provider refresh.

## Worktrees

By default T3 creates a worktree for a thread at:

```text
<T3 home>/worktrees/<repo folder name>/<branch with "/" replaced by "-">
```

`<T3 home>` is `~/.t3` unless `T3CODE_HOME` or a base-dir flag changes it. **Settings → Storage → Worktree location** replaces the `worktrees` folder with an absolute path. The branch starts as `t3/<8 hex digits>`, so the folder is `t3-<8 hex digits>`. T3 renames the branch in the background according to **Settings → Source Control → Worktree branch naming**, but keeps the folder name.

`npm run audit-worktrees` works on these worktrees. `tools/meta-mode/worktree-audit.mjs` lists them from `git worktree list`, not from a path convention, so a worktree is found wherever T3 put it. Checked behavior:

- Run it from the main checkout or from any worktree of the same repository; it skips the main worktree.
- The `PR` column asks `gh` for PRs you authored and matches them by branch name, so a worktree whose branch has no PR shows `-`.
- `LAST_CHAT` scans Claude Code, Codex, and pi transcripts only. Threads run through Cursor, Grok, OpenCode, or Antigravity, and T3's own thread history, are not read, so those worktrees can look idle. Set `MSTACK_TRANSCRIPTS_DIR` to scan one directory instead.
- Treat its `safe` bucket as a report. T3 has its own cleanup under **Settings → Storage** that removes only T3-managed worktrees without running sessions or uncommitted work. I did not check how T3 reacts when a worktree it manages is removed with `git worktree remove`, so use T3's cleanup or thread deletion for those.

## Project install for T3 worktrees

A user-level install is the simplest route. When a provider should find mstack only for one repository, or Claude and Antigravity need a copy in the thread's own directory, install into the project:

```bash
npx @3metajun/mstack --harness codex,claude,pi --project /path/to/repo --dry-run
npx @3metajun/mstack --harness codex,claude,pi --project /path/to/repo
```

This copies the skills into `<repo>/.agents/skills` (Codex, Pi, OpenCode, Grok, Antigravity) and `<repo>/.claude/skills` (Claude Code). Cursor reads both. The README has the [per-harness table](../README.md#install-into-a-project) and the rules: skills only, existing directory required, `--replace` backups under `.harness-skills-backups/` beside the skill roots.

- **Commit it or ignore it, on purpose.** T3 creates a worktree with `git worktree add` from a ref (`GitVcsDriverCore.ts` in T3 commit `8f75697`). A new worktree therefore holds only what is committed at that ref. Project skills you installed but did not commit exist in the main checkout and are missing from a fresh T3 thread. If the team should share them, commit them to the base branch before starting threads. If they are personal, add `.agents/skills/`, `.claude/skills/` and `.harness-skills-*` to `.gitignore` (or `.git/info/exclude`) and install again in each worktree, or keep using the user-level install.
- **An existing thread's worktree** has its own copy of the tree. Run the installer with `--project <worktree path>` to add skills there, then restart the agent session.
- **Precedence.** For Claude, a user copy beats a project copy of the same name. Cursor deduplicates by name with project roots first. Re-run the install after updating mstack, with `--replace`, to refresh a project copy.
- **Pi** still needs the project approved in Pi before it lists project skills.
- Not checked in a live T3 thread: that OpenCode, Pi, and Grok list `.agents/skills` from a worktree cwd. The paths come from their documentation.

## A `t3.json` setup script

T3 reads `t3.json` at the repository root. An invalid file is ignored as a whole, including its icon and scripts. For a project that uses mstack, a worktree starts from the committed tree, so skills and `.harness/` files are already there. The one gap is usually dependencies and gitignored files. This recipe installs dependencies before the agent starts and makes new threads default to worktrees:

```json
{
  "$schema": "https://t3.codes/schema/t3.json",
  "defaultThreadEnvMode": "worktree",
  "scripts": [
    {
      "name": "Setup Worktree",
      "command": "npm ci",
      "runOnWorktreeCreate": true,
      "async": false
    }
  ]
}
```

- The script runs in the worktree. `T3CODE_PROJECT_ROOT` is the main checkout and `T3CODE_WORKTREE_PATH` is the worktree, which is how a script can link a gitignored `.env` from the main checkout.
- `async` defaults to `true`, which starts the agent while the script runs. `false` holds the agent until the script exits.
- The terminal is PowerShell on Windows and `$SHELL` elsewhere, so keep the command a plain `node` or package-manager call rather than shell syntax.
- T3 offers the scripts in `t3.json` for import in the project's scripts menu and settings. I found no code that applies them without an import, so import once per project.
- `defaultThreadEnvMode` is overridden by a per-project or per-environment setting in T3.

## Orchestration overlap

When a provider session has the app's `t3-code` MCP server, T3 adds its own instructions to the first prompt or system prompt. They cover delegation (`orchestrator_capabilities`, `delegate_task`, `task_status`, `task_cancel`), launching threads (`t3_thread_launch`, `create_threads`), scheduling (`schedule_task`), and pull requests (`link_pull_request`, `watch_pull_request`, `unwatch_pull_request`). Two mstack features do the same job outside T3's view.

**Child agents.** `run-role` starts a provider CLI with `execFile` or `spawnSync`. T3 does not know about that process, so it has no entry in T3's agent views, `task_status` cannot see it, and T3's docs say Stop also stops the subagents T3 delegated, which does not cover processes an agent started itself. I did not check whether interrupting a turn also kills a `run-role` child that is still running. Inside T3:

- Prefer the provider's native subagent tools for same-provider work they can run with the chosen model, and `delegate_task` for cross-provider work you want T3 to track. T3's own instructions say the same.
- Take provider instance and model names from `orchestrator_capabilities`. T3 lists its own catalog, which can differ from the names in `~/.config/mstack/models.json`.
- Use `run-role` when the `t3-code` tools are not available in the session, or for a harness T3 does not run. Expect its output in the transcript only.

**Pull request watching.** The `babysit` playbook runs `bun "<meta-mode-tools>/watch-pr/watch-pr"` under `/loop`. T3's `watch_pull_request` polls the pull request every two minutes and wakes the agent when a check fails, required checks pass, someone else comments, or the branch conflicts. Running both gives two wake sources for one PR.

- When `watch_pull_request` is available, use it instead of the Bun watcher loop and end the turn; T3 wakes the agent. Handle existing comments first, because only comments posted after the call wake it.
- A wake is news and not a merge decision. The mstack rule stays: do not merge or arm auto-merge unless the user asked.
- T3's watch ends when the PR merges or closes, after 8 failed reads in a row, after 10 wakes that bring only comments, or when the user presses Stop. Call `unwatch_pull_request` before handing the work back.
- `watch-pr --status-only` is still a fine one-shot status read. T3 reports its own wake events, not the watcher's `READY`, `WAITING`, `ADVANCE`, or `COMPLETE` verdicts, so where `babysit` names a verdict, follow the T3 wake message instead.

T3 also tells the agent to call `link_pull_request` for every PR it creates. That works alongside `file-pr`; the link is how T3 shows PR status on the thread.

For long unattended work, the `autonomous-run` playbook picks "the wake mechanism exposed by the active harness". In T3 that can be `schedule_task`, which keeps the schedule in T3's scheduler.

## T3's own safety rules

These come from T3 Code's `AGENTS.md`, which is written for agents changing T3 Code. They matter to an mstack user when the project open in T3 is T3 Code itself, or when an agent starts and stops dev servers on a machine that already runs T3:

- Never stop a process by pattern (`pkill -f`, or `kill` on a PID found by matching a name or path). An agent's own argv contains its worktree path, and the machine may run several T3 servers. Kill only a PID captured when you spawned it. This applies to mstack cleanup steps too.
- Never start a server against `~/.t3/userdata`. It is the live database. Reading or copying from it is fine.
- Never set `VITE_HTTP_URL` or `VITE_WS_URL` when developing T3. They bake `localhost` into the bundle and break remote browsers.
