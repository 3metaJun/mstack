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

[`/setup-mstack`](../../skills/setup-mstack/SKILL.md) detects the models you have access to, asks for a reasoning budget, shows you each role (code delegates, judgment, the review panels), and asks what you want. Answer the questions. It writes `~/.config/mstack/models.json`, the portable configuration every mstack skill reads.

You only override what you care about. To restore a role to the parent chat model, set it to `inherit-parent` or run `/setup-mstack` again. Setup preserves other choices and Harness overrides.

Use `inherit-parent` for the current chat model through the Harness's documented native inheritance. A new CLI process needs `run-role --parent-model <known-parent-model>` to use that same model. `auto` requests the Harness's default selection, which may differ from the chat model. Neither value is a model name. The `reviewer` role accepts a model string or a non-empty list of unique model strings. `/interrogate` runs one reviewer per list entry. CLI fanout uses `--all-models --read-only`; select just one entry with `--model-index 0`. The `implementer` role sets the default model for `/swarm` workers unless a race names a model for each arm.

## Accept the verification offer, or don't

At the end of setup, `/setup-mstack` looks for a shared verification contract, a `verify-*` wrapper, or an existing repository driver. Several wrappers pointing at one contract count as one workflow. Setup reports conflicting legacy definitions instead of creating another copy.

If it finds neither a reusable verification workflow nor a repository driver, setup offers once to run [`/create-verification-skill`](../../skills/create-verification-skill/SKILL.md). When you accept, the generator writes `.harness/verify/<app>/contract.md`, its feature map, and thin discovery wrappers. It proves one feature in the real app before handing over the result. Model setup alone does not start the app or create a team policy.

Say no and setup moves on. You can run `/create-verification-skill` yourself any time. [Verify and ship](./06-verify-and-ship.md#create-a-project-verification-skill) covers the proof. For a team using both native pstack and mstack, follow [the mixed-Harness adoption guide](./11-mixed-harness.md) to add the shared project workflow and CI checks.

If you're new to mstack, say yes. An agent that can check its own work keeps going until the check passes. An agent that can't hands every result back to you to check by hand. Of everything in this guide, the verification skill pays off the most.

After setup, start a new session. The model configuration applies to new sessions.

## Keep the cost in check

mstack spends extra tokens on subagents and review panels. That's the price of the rigor. To spend fewer:

- Rerun `/setup-mstack` and pick a smaller reasoning budget or cheaper models. A strong model in the main chat with cheaper, faster models in the code roles is a good split.
- Set a role to `inherit-parent` so it runs on the chat's own model.
- Shorten a panel list. Each entry runs one subagent.
- Save `/meta-mode` for work that needs rigor. A small, obvious edit doesn't.

## Run your first task

Pick something real but small, and describe it the way you'd describe it to a colleague:

```text
/meta-mode add a --json flag to this command. text output stays byte-identical. verify both.
```

Watch the todo list. Its first items are the matched playbook's steps copied in, the Feature playbook for this prompt. If `/meta-mode` skips a step, the step stays in the list with `skip: <reason>`, so you can see what it chose not to do.

From here you can type normal follow-ups. `/meta-mode` stays active for the current task and fades as the chat moves on. When it fades, start the next task with `/meta-mode`, or pin it for the whole chat if your Harness can pin a skill or mode. Mid-chat, "new task" makes it match a fresh playbook.

Next: [Route work through `/meta-mode`](./02-meta-mode.md).
