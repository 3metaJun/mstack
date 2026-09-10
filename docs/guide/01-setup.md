# Set up mstack

In this page you install the plugin, pick which models mstack uses, and run your first task. Setup is one command plus a short conversation.

## Install the skills

From a terminal, install the skills for the Harness you use:

```bash
npx @3metajun/mstack --harness <codex|claude|opencode|pi>
```

The installer reports the target directory and the number of skills it staged.
Run it again for another Harness when you use more than one.

## Pick your models

Run:

```text
/setup-mstack
```

[`/setup-mstack`](../../skills/setup-mstack/SKILL.md) detects the models you have access to, shows you each role (code delegates, judgment, the review panels), and asks what you want. Answer the questions. It writes `~/.config/mstack/models.json`, the portable configuration every mstack skill reads.

You only override what you care about. A role with no entry keeps the skill's default. To restore it later, delete that role's entry, or run `/setup-mstack` again.

You might be wondering what happens if you use Auto. Set a role to `inherit-parent` or `auto` and mstack omits the subagent `model` field, so the subagent inherits your parent chat model. Both values mean the same thing, and neither is a model slug. For a panel role the value is a list, and one subagent runs per entry, so the list length sets the panel size. Setup also configures `swarm workers`, the default model for every `/swarm` worker unless a race names a model for each arm.

## Accept the verification offer, or don't

At the end of setup, `/setup-mstack` looks for a way to prove app behavior in your project, either a `verify-*` skill or an existing harness. If it finds neither, it offers once to generate one with [`/create-verification-skill`](../../skills/create-verification-skill/SKILL.md).

Say yes and it writes `verify-<app>/` under the active Harness's project skill root. See [the project skill paths](../../skills/create-verification-skill/references/harness-paths.md) for the root used by each Harness. The generated skill teaches agents to drive your app the way a user does, and setup proves it once before handing it over. Say no and setup moves on. You can run `/create-verification-skill` yourself any time. [Verify and ship](./06-verify-and-ship.md#create-a-project-verification-skill) covers when it earns its place.

After setup, start a new session. The model configuration applies to new sessions.

## Run your first task

Pick something real but small, and describe it the way you'd describe it to a colleague:

```text
/meta-mode add a --json flag to this command. text output stays byte-identical. verify both.
```

Watch the todo list. Its first items are the matched playbook's steps copied in, the Feature playbook for this prompt. If `/meta-mode` skips a step, the step stays in the list with `skip: <reason>`, so you can see what it chose not to do.

From here you can type normal follow-ups. `/meta-mode` is sticky. It stays on for the conversation until you opt out by saying so.

Next: [Route work through `/meta-mode`](./02-meta-mode.md).
