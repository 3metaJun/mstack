---
name: automate-me
description: "Use for \"automate me\", \"create/update/refresh my -mode skill\", \"turn/capture my preferences or working style into a skill\", or wanting agents to follow how the user works. Drafts or revises a personal -mode skill via the skill-authoring workflow and unslop, optionally pulling fresh evidence from recent transcripts."
---

# Automate me

A guided flow for turning the user's working conventions into a skill agents will follow. The output is one `-mode` skill tailored to them (e.g. `jay-mode`, `priya-mode`).

This skill sequences an inline mining pass (see step 1), the bundled
[authoring playbook](../meta-mode/playbooks/authoring-a-skill.md), and the
**unslop** skill. If a selected-skills installation omits either sibling, use
step 4's standalone draft rules and check the prose directly.

## Flow

### 0. Check for an existing skill

Look recursively for the active Harness's project and user skill roots for `*-mode/SKILL.md` matching the user's handle. Mode skills can live in a personal category directory, not only at the top level. If one exists, confirm intent with `ask the user` (unless they already said "update my skill" or similar):

- Update the existing skill (default for repeat runs)
- Start fresh (rare, ask why before doing it)

Update mode changes the rest of the flow:
- Step 1 mines only history since the skill was last edited (`git log -1 --format=%cI <path>`).
- Step 2 asks what's changed or missing, not what to capture from zero.
- Step 4 edits the existing file in place. Preserve sections the user hasn't contradicted. Revise ones with new evidence. Add new sections only for genuinely new rules.

### 1. Mine their history

Locate the active workspace's transcripts before fanning out. Use
[recall's history reader](../recall/references/history-sources.md) to list scoped
session IDs and read bounded excerpts, excluding the current session. If recall
is not installed, use the harness's documented workspace-scoped history view.
If no history source is available, record that limitation and continue with the
user's stated preferences. Do not glob across unrelated project stores.

Survey recent agent conversations within that scope for recurring patterns. Run multiple parallel subagents across slices of history (e.g. last 2-4 weeks, split into 3 slices so each has enough material). Each slice mining subagent reads transcripts from the workspace-scoped path the parent provides, looks for the signals below, and returns a short structured list of patterns it saw with evidence pointers. Default signals worth hunting:

- Response preferences (length, tone, format, "dumb it down" corrections)
- Delegation habits (subagents, models, specialized workflows, parallelism)
- Verification posture (what "done" means, unit tests vs live repro, reviewers)
- Code and prose discipline (style, principles cited, lint/format tools)
- Process conventions (worktrees, commits, PRs, review/merge tooling)
- Meta preferences (fixing skills mid-task, proposing new ones)

Cross-check across slices before elevating a signal. Patterns seen in 2+ slices are high-confidence. Lone signals are weak and usually get dropped.

### 2. Ask the user directly

Mining misses intent that hasn't come up yet. Use the host's structured question
tool when available, within its supported option count. Otherwise ask one short
question in chat with concrete examples.

Start broad ("Which areas matter most?"), then follow up on selected areas with
specific options. Use multiple selection only when the host supports it. After
the structured rounds, one free-form chat question catches anything the options
missed.

Don't dump 20 questions.

### 3. Cluster findings

Group the combined signals into sections. Common ones (use only what applies):

- **Response style**: length, tone, format.
- **Autonomy**: how much to do without asking, MCP tool use.
- **Understand first**: which skills to reach for when scoping or investigating a change.
- **Subagents**: default, parallelism, model-to-task, specialized workflows.
- **Prose / code discipline**: principles, lint tools, style guides.
- **Review and verify**: repro posture, verification skills, live-testing tools.
- **Process**: git worktrees, commits, PRs, review/merge tooling.
- **Skills**: skill-authoring habits, fix-the-skill-first, proposing new skills.

The **meta-mode** skill shows the shape. Read it for granularity. Don't copy its content. The user's rules are not the same as meta-mode's.

### 4. Draft the skill

Follow the [authoring playbook](../meta-mode/playbooks/authoring-a-skill.md),
including its description review. These draft rules also work when only
`automate-me` is installed:

- Path: preserve an existing mode skill's category. For a new mode, use the active Harness's project skill root and its user-level skill root when the user prefers a personal skill.
- Handle: the user's first name or chosen identifier.
- Frontmatter `description`: trigger on their name + `/<handle>-mode` + "work in their style", not on generic keywords like "write code" or "review PR".
- Frontmatter formatting: follow the authoring workflow's YAML rules. Keep `description` as one YAML scalar. Quote it or use `description: >-` with indented continuation lines when punctuation or wrapping requires it.
- Keep the mode explicit by default. Apply it on every turn only when the user asks for that behavior.

Check that every linked file exists and every tool reference is available. Try
two requests that should select this mode and two nearby requests that should
not. Tighten the description when it selects the wrong cases. Use a local
validator if one exists; otherwise inspect the frontmatter and links directly.

### 5. Iterate on prose

Apply the **unslop** skill and the authoring workflow's writing guidelines to every line.

Show the draft to the user and take feedback. Expect multiple iterations. Cut ruthlessly. A mode skill is not a manual.

### 6. Land it

For a repository-owned skill, work in an isolated worktree, commit, and open a PR
within the user's authorized workflow. For a personal skill outside a repository,
report the validated local path. Keep private transcript evidence out of commits.

## Guardrails

- **Don't overfit to one conversation.** A preference stated once and contradicted another time is noise. Require multiple instances before codifying it.
- **Don't be clever.** Restating other skills' contents, inventing metaphors, or writing "poetic" prose for an agent reader is cost without benefit. Keep it operational.
- **Reference, don't inline.** Other skills the user relies on should appear as path references, not pasted excerpts. Same for any principle docs they maintain elsewhere.
- **Keep sections minimal.** Only add a section if the user has a specific, non-default rule there. "Communicate clearly" is not a section. "Short paragraphs. Tables when comparing options. Bullets only when items are genuinely parallel." is.
- **Name conventions generic.** Use "the user" or "the human" in imperatives, not the author's first name.
- **Don't force symmetry.** If a user has no process rules worth writing down, skip the Process section entirely.

## Evaluation

A `-mode` skill is subjective output. A benchmark loop designed for generic skill authoring isn't useful here. Vibe-check with the user: does it read like them? Did it miss anything? Then ship.

Run a description-optimization loop only if the skill's trigger accuracy turns out to be a problem in practice.

## When not to use

- User wants a task-specific skill (not working conventions): use the authoring workflow alone, with no mining required.
- User wants to capture one narrow workflow (e.g. "how I write commit messages"). That's a regular skill, not a mode skill.
