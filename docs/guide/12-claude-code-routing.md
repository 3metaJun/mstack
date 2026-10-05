# How mstack is layered, and the Claude Code session hook

In this page you learn what sits under `/meta-mode`, how the Claude Code plugin nudges a new session toward it, and how to switch that nudge off.

## The layers

Each layer has one job, and the layers above call the ones below:

1. **Agent coordination.** [`meta-agent`](../../agents/meta-agent.md) runs the full mstack style in a subagent, and [`comment-reviewer`](../../agents/comment-reviewer.md) reviews prose. `~/.config/mstack/models.json` says which model each role uses (see [Set up mstack](./01-setup.md)). Fan-out skills such as `/swarm` and `/interrogate` read those roles.
2. **Principles.** The `principle-*` skills are short, named rules. [Steer with principle names](./08-principles.md) lists them. Playbooks and agents cite them by name when one shaped a decision.
3. **Playbooks.** [`skills/meta-mode/playbooks/`](../../skills/meta-mode/playbooks/) holds one step list per kind of task: bug fix, feature, refactoring, perf issue, shipping, and the rest. `/meta-mode` picks the smallest match and copies its steps into the todo list.
4. **User-invocable skills.** `/how`, `/why`, `/tdd`, `/architect`, `/arena`, `/interrogate`, `/unslop`, and the others. You can call any of them directly. Playbooks call them when a step needs one.

[Route work through `/meta-mode`](./02-meta-mode.md) covers layers 3 and 4 in use.

## What the session hook does

The Claude Code plugin ships a `SessionStart` hook ([`hooks/hooks.json`](../../hooks/hooks.json)). When a session starts, resumes, is cleared, or is compacted, it adds a short note to the session context ([`hooks/session-start-context.md`](../../hooks/session-start-context.md)):

- A task that touches several files, changes a shared signature, involves a design choice, or is a bug with an unknown cause or a performance problem starts with `mstack:meta-mode`.
- A contained one-file change, a question, or a one-line edit is done directly and checked on the real artifact.
- A specific intent goes straight to the matching skill, for example `mstack:tdd` or `mstack:how`.

Without the hook, the skill descriptions still let Claude choose `/meta-mode`, but the note makes the routing explicit at the start of every session and again after `/clear` and compaction.

The hook is one Node script, [`scripts/session-hook.mjs`](../../scripts/session-hook.mjs), so it behaves the same on Windows, macOS, and Linux. It needs `node` on your `PATH`. It prints the note and exits 0. If anything goes wrong, such as an unreadable config or context file, it prints nothing and the session starts normally.

The hook ships with the plugin only. `npx @3metajun/mstack --harness claude` copies skills and agents but never edits Claude settings or registers hooks, so installer-only setups get no note. Pick one route per machine, as the [README](../../README.md#claude-code-plugin-recommended) explains. The two never load the hook twice.

## Autonomy stance

The note carries the same stance as `/meta-mode`:

- Reversible work proceeds without asking. You see the result and correct it.
- Irreversible or externally visible actions stop for you: force-pushes, deploys, data deletion, messages to customers.
- Your own instructions win. `CLAUDE.md`, `AGENTS.md`, and what you type in the session override the note.

## Turn the hook off

Add one key to `~/.config/mstack/models.json`:

```json
{
  "roles": { "implementer": "inherit-parent" },
  "sessionHook": false
}
```

Remove the key or set it to `true` to turn the hook back on. Only the boolean `false` disables it. A missing file, malformed JSON, or any other value leaves the hook on, so a broken config never changes what you get silently. `npm run check-models` rejects a `sessionHook` that is not a boolean. The change applies from the next session start.

## Effort levels

Claude Code's Agent tool takes a model but no effort per call, so a subagent runs at the session's effort. mstack does not ship per-effort agent variants. Nothing in the skills dispatches by effort, and the installer shares `agents/` with Codex and OpenCode, which do not read an `effort` field. To pin effort for a role, start the session with `claude --effort <level>`, or add your own agent file under `.claude/agents/` with an `effort:` line in its frontmatter. The `budget` setting in [`/setup-mstack`](../../skills/setup-mstack/SKILL.md) already maps a budget to model-name effort suffixes where a Harness exposes them.

Back to the [guide index](./README.md).
