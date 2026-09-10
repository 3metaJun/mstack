---
name: meta-mode
description: "Route a non-trivial engineering task through a verifiable mstack workflow and the capabilities available in the current harness."
---

# Meta mode

Use this skill for a task that needs more than one focused action. It is the
portable replacement for pstack's `poteto-mode`. It keeps the workflow intact
while leaving execution details to the current harness.

## Apply the mode

1. State the requested result in one sentence.
2. Choose the smallest matching playbook from `playbooks/`.
3. Read that playbook and every principle it names before you act.
4. Write a short todo list whose first entries are the playbook steps.
5. Choose a local or configured remote execution environment. Use a remote
   environment only when the task needs another machine.
6. Choose a model for each role from the user's mstack model configuration.
   Use `inherit-parent` when no override exists.
7. End each step with evidence from the real artifact.

The mode stays active for the current task. Do not apply it to a casual turn or
after the user opts out.

## Choose a playbook

| Request | Playbook |
| --- | --- |
| Understand a subsystem | `investigation.md` |
| Fix a defect | `bug-fix.md` |
| Improve measured performance | `perf-issue.md` or `hillclimb.md` |
| Add behavior | `feature.md` |
| Reshape code without changing behavior | `refactoring.md` |
| Compare a design or prototype | `prototype.md` or `visual-parity.md` |
| Write or change a skill | `authoring-a-skill.md` |
| Review or evaluate agent behavior | `eval.md` or `interrogate` |
| Drive a pull request | `babysit.md`, `shipping.md`, or `opening-a-pr.md` |
| Run work while the user is away | `autonomous-run.md` or `orchestrate.md` |
| Resume or suspend work | `session-pickup.md` or `pause-safely.md` |
| Plan several phases | `multi-phase-plan.md` |

Use `figure-it-out` when no listed playbook fits. Use `swarm` for independent
coverage and `arena` for competing proposals. Keep each worker in its own
worktree or output directory when it writes files.

## Map capabilities

Read [the capability map](references/capability-matrix.md) when a playbook
mentions delegation, background work, remote execution, model roles, or session
history. The map distinguishes a native implementation from a documented
fallback. Report the distinction when it changes the result.

The canonical skill tree uses capability names. Adapters map those names to a
Harness. Do not put vendor-specific paths, commands, transcript formats, or
model names in this skill.

## Configure models

Copy `profiles/models.example.json` to `~/.config/mstack/models.json` and replace
`inherit-parent` with models available in that Harness. Run
`node scripts/model-config.mjs --file ~/.config/mstack/models.json` to validate
the file. Keep the role names stable so a workflow can move between Harnesses.

## Finish with proof

Run the narrowest meaningful verification and read its output. For code, run
the relevant test and inspect the diff. For an installation, inspect the target
directory and adapted frontmatter. For a remote run, record the environment and
the command that produced the evidence.
