# Set up mstack

In this page you install the plugin, pick which models mstack uses, and run your first task. Setup is one command plus a short conversation.

## Install the skills

From a terminal, install the skills for the Harness you use:

```bash
npx @3metajun/mstack --harness <codex|claude|opencode|pi>
```

The installer reports the target directory and the number of skills it staged.
Run it again for another Harness when you use more than one.

In Claude Code, run `/plugin marketplace add cursor/plugins`, then `/plugin install mstack@cursor-plugins`. Claude Code prefixes plugin commands, so each command in this guide takes a `mstack:` prefix there, such as `/mstack:setup-mstack`, which writes its model rule to `~/.claude/rules/mstack-models.md`. The [Claude Code adapter](../harness/claude-code.md) covers the other differences.

## Pick your models

Run:

```text
/setup-mstack
```

[`/setup-mstack`](../../skills/setup-mstack/SKILL.md) detects the models you have access to, asks for a reasoning budget, shows you each role (code delegates, judgment, the review panels), and asks what you want. Answer the questions. It writes `~/.config/mstack/models.json`, the portable configuration every mstack skill reads.

The defaults run at `xhigh` reasoning, the same as the `large` budget. `unlimited` lifts each model to its highest tier, up to `max`. Opus goes to `max`. Grok tops out at `xhigh`, so it stays there. `medium` and `small` lower the reasoning and spend fewer tokens.

You only override what you care about. A role with no line in the rule keeps the skill's default. To restore a default, delete that role's line. A rerun of `/setup-mstack` keeps any role whose model differs from the default. When a default changes, a rule written before the change still pins the old default, so delete those role lines, or delete the file, then run `/setup-mstack` again.

Use `inherit-parent` for the current chat model through the Harness's documented native inheritance. A new CLI process needs `run-role --parent-model <known-parent-model>` to use that same model. `auto` requests the Harness's default selection, which may differ from the chat model. Neither value is a model name. The `reviewer` role accepts a model string or a non-empty list of unique model strings. `/interrogate` runs one reviewer per list entry. CLI fanout uses `--all-models --read-only`; select just one entry with `--model-index 0`. The `implementer` role sets the default model for `/swarm` workers unless a race names a model for each arm.

## Accept the verification offers, or don't

At the end of setup, `/setup-mstack` looks for a way to prove app behavior in your project, either a `verify-*` skill or an existing harness. If it finds neither, it offers once to generate one with [`/create-verification-skill`](../../skills/create-verification-skill/SKILL.md).

Say yes and it writes `verify-<app>/` under the active Harness's project skill root. See [the project skill paths](../../skills/create-verification-skill/references/harness-paths.md) for the root used by each Harness. The generated skill teaches agents to drive your app the way a user does, and setup proves it once before handing it over. Say no and setup moves on. You can run `/create-verification-skill` yourself any time. [Verify and ship](./06-verify-and-ship.md#create-a-project-verification-skill) covers it in depth.

If you're new to mstack, say yes. An agent that can check its own work keeps going until the check passes. An agent that can't hands every result back to you to check by hand. Of everything in this guide, the verification skill pays off the most.

Then setup offers once to generate a formal verification skill with [`/create-formal-verification-skill`](../../skills/create-formal-verification-skill/SKILL.md), unless the project already has one. Tests check the cases someone thought to write. A formal verification skill checks one key property of your code, such as "a job never runs twice at once", in every case within a stated scope. Say yes when your code has concurrency, retries, a state machine, or a parser, where a bug is costly and tests rarely reach the case that breaks. Otherwise say no, and run it later if that changes. [Verify and ship](./06-verify-and-ship.md#prove-a-property-with-a-formal-verification-skill) covers it.

After setup, start a new session. The model configuration applies to new sessions.

## Keep the cost in check

mstack spends extra tokens on subagents and review panels. That's the price of the rigor. To spend fewer:

- Rerun `/setup-mstack` and pick a smaller reasoning budget or cheaper models. A strong model in the main chat with cheaper, faster models in the code roles is a good split.
- Set a role to `auto` or `inherit-parent` so it runs on the chat's own model.
- Shorten a panel list. Each entry runs one subagent.
- Save `/meta-mode` for work that needs rigor. A small, obvious edit doesn't.

## Run your first task

Pick something real but small, and describe it the way you'd describe it to a colleague:

```text
/meta-mode add a --json flag to this command. text output stays byte-identical. verify both.
```

Watch the todo list. Its first items are the matched playbook's steps copied in, the Feature playbook for this prompt. If `/meta-mode` skips a step, the step stays in the list with `skip: <reason>`, so you can see what it chose not to do.

From here you can type normal follow-ups. To keep `/meta-mode` on for the whole chat, pick it from the `/` menu with Option+Enter (Mac) or Alt+Enter (Windows) instead of Enter. That makes it a [Custom Mode](https://cursor.com/docs/skills#using-a-skill-as-a-custom-mode), which stays in context on every turn until you exit it. Custom Modes are available in the Agents Window and the CLI. Plain Enter attaches the skill to one message, and it fades as the chat moves on.

Next: [Route work through `/meta-mode`](./02-meta-mode.md).
