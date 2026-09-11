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
