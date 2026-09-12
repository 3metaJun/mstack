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

You only override what you care about. To restore a role to the parent chat model, set it to `inherit-parent` or run `/setup-mstack` again. Setup preserves other choices and Harness overrides.

Use `inherit-parent` for the current chat model through the Harness's documented native inheritance. A new CLI process needs `run-role --parent-model <known-parent-model>` to use that same model. `auto` requests the Harness's default selection, which may differ from the chat model. Neither value is a model name. The `reviewer` role accepts a model string or a non-empty list of unique model strings. `/interrogate` runs one reviewer per list entry. CLI fanout uses `--all-models --read-only`; select just one entry with `--model-index 0`. The `implementer` role sets the default model for `/swarm` workers unless a race names a model for each arm.

## Accept the verification offer, or don't

At the end of setup, `/setup-mstack` looks for a shared verification contract, a `verify-*` wrapper, or an existing repository driver. Several wrappers pointing at one contract count as one workflow. Setup reports conflicting legacy definitions instead of creating another copy.

If it finds neither a reusable verification workflow nor a repository driver, setup offers once to run [`/create-verification-skill`](../../skills/create-verification-skill/SKILL.md). When you accept, the generator writes `.harness/verify/<app>/contract.md`, its feature map, and thin discovery wrappers. It proves one feature in the real app before handing over the result. Model setup alone does not start the app or create a team policy.

You can run `/create-verification-skill` yourself any time. [Verify and ship](./06-verify-and-ship.md#create-a-project-verification-skill) covers the proof. For a team using both native pstack and mstack, follow [the mixed-Harness adoption guide](./11-mixed-harness.md) to add the shared project workflow and CI checks.

After setup, start a new session. The model configuration applies to new sessions.

## Run your first task

Pick something real but small, and describe it the way you'd describe it to a colleague:

```text
/meta-mode add a --json flag to this command. text output stays byte-identical. verify both.
```

Watch the todo list. Its first items are the matched playbook's steps copied in, the Feature playbook for this prompt. If `/meta-mode` skips a step, the step stays in the list with `skip: <reason>`, so you can see what it chose not to do.

From here you can type normal follow-ups. `/meta-mode` is sticky. It stays on for the conversation until you opt out by saying so.

Next: [Route work through `/meta-mode`](./02-meta-mode.md).
