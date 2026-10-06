---
name: mstack-help
description: "Guide users through installing and setting up mstack, using meta-mode, and picking the skill or playbook for a task. Use for /mstack-help, or when the user asks how to install, set up, or use mstack, or which mstack skill fits. Answers and hands back a prompt to send. Not for requests to do work, even ones that name mstack."
license: MIT
---

# mstack help

Answer the user's question about mstack, hand them a prompt they can send, and name the file the answer came from. For a help question, do not start the work. The user asked how, and an mstack run spends real tokens, so let them send the prompt.

A message that asks for work, such as "use mstack to fix this bug", is not a help question. Read the `meta-mode` skill, do the work under it, and mention once that invoking `meta-mode` keeps the work in this style.

This file maps questions to the skills and docs that hold the answers. Those files own the details. Read the skill you route to before you quote it, and trust it when it disagrees with this map. Skills may be installed in isolation, so name another skill in plain text. The `README.md` and `docs/` paths below belong to the repository, and the default install does not ship them. Read them when the checkout is at hand. Otherwise give the user the public copy: `https://github.com/3metaJun/mstack/blob/main/` followed by the path. The `guide` artifact installs `docs/guide/` locally.

## Find out what they need

Infer the need from the message and the conversation. A named situation, such as "which skill reviews a diff?", goes straight to its section. If the need is still unclear, ask one multiple-choice question, then answer only the section they pick: get set up, start a task with `meta-mode`, pick a skill, fix a run that went wrong, or make mstack their own.

Check the state that changes the answer, and mention it only when it does:

- No `~/.config/mstack/models.json` means `/setup-mstack` has not run for this user, so roles use defaults.
- No `verify-*` skill or other app harness in the project means agents have no scripted way to drive the app. Mention `create-verification-skill` when the question is about proving a change works.
- Which harness the user runs decides the command names in the next section.

## Get set up

1. Install for the harnesses in use, from `README.md`:

   ```bash
   npx @3metajun/mstack --harness all
   npx @3metajun/mstack --harness codex,claude
   npx @3metajun/mstack --harness all --skill tdd,diagnosing-bugs
   ```

   `--dry-run` prints the plan. An existing skill directory is kept unless `--replace` is given, which moves it into a backup directory. `--artifact` adds the optional agents, `meta-mode-tools`, `guide`, or `session-context` files. Node.js 18 or newer is required.
2. Run `/setup-mstack`. It asks for a reasoning budget, maps a model to each role, and writes `~/.config/mstack/models.json`. New sessions pick it up.
3. Start a real task with `/meta-mode`, a goal, and a check that can pass or fail.

Installing changes nothing until the user invokes a skill. Offer to word their first prompt with them. The guide page `docs/guide/01-setup.md` has the walkthrough.

Harness differences that change the answer:

- Claude Code can also load mstack as a plugin. Its skills are namespaced, so the command is `/mstack:meta-mode`. The installer gives bare names such as `/meta-mode`. Pick one route per machine, because both loading duplicates the skills.
- Codex, OpenCode, pi, and Grok share one copy in `~/.agents/skills/`. Claude Code and Antigravity have their own directories. `docs/harness-adapters.md` lists them.
- Claude Desktop chat, Cowork, and claude.ai take one uploaded zip per skill from `npm run pack-claude-skills`. Uploaded skills are isolated, so sibling links become plain text, and `meta-mode` playbooks and tools are not reachable there.
- T3 Code lists whatever the provider finds, so installing for the provider is enough. See `docs/t3code.md`.

If cost is the worry, say where the tokens go. mstack spends extra tokens on subagents and review panels. Rerun `/setup-mstack` with a smaller budget or cheaper models. A role set to `inherit-parent` runs on the chat's own model. A shorter reviewer list runs fewer subagents, one per entry. Save `meta-mode` for work that needs rigor.

## Start a task with `meta-mode`

`meta-mode` matches the task to a playbook, copies the playbook's steps into the todo list, and runs other skills as the steps need them. A skipped step stays in the list as `skip: <reason>`. A good prompt states the goal and how to tell it is done. It does not list skills, because a hand-written sequence tends to drop steps the playbook would keep.

```text
/meta-mode the export writes duplicate rows when a retry lands mid-run. repro first, then fix and verify.
```

The mode stays on for the current task and fades as the chat moves on. Start the next task with `/meta-mode`, or say "new task" to rematch a playbook.

## Pick a skill

The default answer is `meta-mode`, which runs most of the others when its steps need them. Name a skill directly when the user wants more or less than the playbook gives. Read the skill before you recommend it, and give one example prompt.

| The user wants to | Skill |
|---|---|
| Do any non-trivial task with rigor | `meta-mode` |
| Know how code works now, or where new code should live | `how` |
| Know why code is shaped this way | `why` |
| Understand a change or subsystem plainly | `teach` |
| Catch up on recent work in a repository | `recall` |
| Find what a change could break beyond its diff | `blast-radius` |
| Settle types and module shape before code | `architect` |
| Design or review a module's interface and seams | `codebase-design` |
| Diagnose a flaky, intermittent, or twice-failed bug | `diagnosing-bugs` |
| Fix a bug test-first when a cheap local test exists | `tdd` |
| Get several attempts at one brief, merged into the best | `arena` |
| Fan out parallel workers for coverage, races, or exploration | `swarm` |
| Have several models review a diff and try to break it | `interrogate` |
| Apply strict TypeScript practices to `.ts` or `.tsx` work | `typescript-best-practices` |
| Strip comments before review | `no-comments` |
| Clean AI tells out of prose | `unslop` |
| Write docs, an RFC, a README, a PR description, or a commit message | `technical-writing` |
| Write or revise skills, AGENTS.md, or other agent instructions | `writing-for-agents` |
| Restate the last reply in plain words | `bro` |
| Give agents a scripted way to drive the app and prove behavior | `create-verification-skill` |
| Audit a verification skill against the app | `maintain-verification-skill` |
| Vet a benchmark number before reporting it | `benchmark-checklist` |
| Run a large or cross-cutting change, or one to review later | `figure-it-out` |
| Keep a decision log during a long or unattended run | `show-me-your-work` |
| Choose models per role and a reasoning budget | `setup-mstack` |
| Turn their own working habits into a personal mode skill | `automate-me` |
| Turn what a finished task taught into skill edits | `reflect` |
| Stop agents repeating the same mistake in this repository | `correct` |
| Build a page whose buttons wake a bot over a webhook | `make-bot-ui` |
| Find their way around mstack | `mstack-help` |

If a skill directory is missing from the table, read its frontmatter and route by its description. `principle-*` skills are covered below.

Close calls:

- `how` explains what the code does. `why` explains the reasons. `teach` runs both and explains the result plainly.
- `arena` gives every worker the same brief and merges the best parts. `swarm` splits work into slices or a race and returns one report.
- `interrogate` reviews the diff. `blast-radius` looks for breakage outside it and proves the one fact that makes the change safe.
- `figure-it-out` designs one rigorous run. The Orchestrate playbook runs a program of many PRs. The Autonomous run playbook drives one task to a finish condition.

## Playbooks and principles

Playbooks are step lists inside `meta-mode`, not skills, so they are not invoked by name. Describing the task picks one. The Playbooks section of the `meta-mode` skill (`skills/meta-mode/SKILL.md`) lists every playbook and when it applies. Common phrasings:

- "babysit this pr" or "check on pr 123" runs Babysit. It drives the PR to merge-ready and stops there.
- "land the stack" runs Shipping. "take over this branch" runs Session pickup. "pause safely" runs Pause safely.
- "prototype" or "sketch it to decide" runs Prototype. For a multi-phase plan, ask for a plan and the Multi-phase plan playbook writes it without implementing.

Principles are one-rule skills that `meta-mode` reads and cites in its replies. The user steers with the names, as in "apply prove it works. show me the real output." The guide page `docs/guide/08-principles.md` lists them.

## Fix a run that went wrong

| Symptom | Fix |
|---|---|
| The mode stopped applying after a few turns | Start the next task with `/meta-mode`. |
| A question was treated as the next step of the last task | Say "new task", or say the turn does not need the mode. |
| A model choice had no effect | `models.json` applies to new sessions. Start one. |
| Runs cost more than expected | See the cost paragraph under Get set up. |
| The reply claims success from a green build | Ask for the real command, flow, or output. That is the `principle-prove-it-works` rule. |
| A skill shows up twice | The plugin and the installer both loaded. Keep one route per machine. |

## Make mstack my own

- `automate-me` drafts a personal mode skill from the user's history. `reflect` turns a session's lessons into skill edits the user approves. `/meta-mode write a skill for <workflow>` runs the authoring playbook, and the Eval playbook tests a skill change.
- `docs/guide/09-make-it-yours.md` covers both. Fix a misbehaving skill in its own PR, not inside the feature work where it went wrong.

## Reply

Lead with the answer. Give at most one example prompt in a code block, then name the file it came from. Keep it short unless the user asked for the whole map.
