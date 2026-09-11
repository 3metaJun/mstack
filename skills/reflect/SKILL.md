---
name: reflect
description: Spawn three parallel review subagents over the active transcript, surface learnings, and route each to a concrete edit on an existing skill. Use when the user says reflect.
---

# Reflect

Mine the current conversation for durable learnings, then route them into skill edits.

## When to invoke

Invoke when the user says "reflect" or "/reflect". Skip when the conversation is trivial, off-topic, or already covered by an existing skill the parent followed correctly. One-offs are not learnings.

## Process

### 1. Locate the active transcript

The parent identifies the active session before fanning out. Prefer the
conversation already in context or a transcript path supplied by the host. When
lookup is necessary, use [recall's history sources](../recall/references/history-sources.md)
with the active workspace and known session ID. Match the opening user prompt
within the selected conversation, not at a fixed JSONL line or field shared
across harnesses. Keep warnings and truncation limits with the excerpts.

If recall is not installed or the active session has no readable persisted
record, write a tight digest of the current conversation and pass that instead.
Do not search other project stores to compensate for a missing active session.

### 2. Spawn three reviewers in parallel

One delegation request with three reviewers, an explicit model on each, and agent mode with the access needed for context lookups (tickets, chat threads, and observability traces referenced in the transcript). Reviewers need the active Harness's connected tools.

| Lens | `model` | Prompt template |
|---|---|---|
| Judgment | the active mstack `reviewer` role, default `inherit-parent` | `references/judgment-reviewer.md` |
| Tooling | the active mstack `reviewer` role, default `inherit-parent` | `references/tooling-reviewer.md` |
| Divergent | the active mstack `reviewer` role, default `inherit-parent` | `references/divergent-reviewer.md` |

If the resolved `reviewer` role is a list, assign its model strings in order
across the three lenses, cycling when there are fewer than three entries.

Pass each template verbatim, substituting the transcript path or digest where marked. Reviewers return findings in the delegation result body.

### 3. Synthesize

One delegation request using the active mstack `synthesizer` role (default `inherit-parent`) and the access needed for citation checks. Use `references/synthesizer.md` verbatim, with each reviewer's full output inlined where marked. The synthesizer returns a structured Accepted / Rejected / Backlog list.

### 4. Structural enforcement check

Sanity-check the synthesizer's Accepted list. For any item that would be enforced more reliably by a lint rule, script, metadata flag, or runtime check, move it from Accepted to Backlog. See the **encode-lessons-in-structure** principle skill.

### 5. Apply

Before applying any Accepted edit, present the synthesizer's full Accepted/Rejected/Backlog output to the user and wait for explicit approval. The user picks which subset to apply and may redirect routings. Skill changes affect every future agent in the org. Do not auto-apply.

Backlog items file to whatever devex / backlog tracker your team uses automatically. Only the Accepted list waits for approval.

For each approved Accepted item, follow the Routing field exactly:

- Trivial existing-skill edit (a one-line bullet, a tightened sentence, a stale fact corrected): parent does directly.
- Substantive existing-skill edit (a new section, a new pattern table, more than ~10 lines): follow [the bundled authoring playbook](../meta-mode/playbooks/authoring-a-skill.md) and run its draft, validation, and review steps.
- `tune description: <skill path>` (the skill exists but didn't trigger when it should have): use the authoring playbook's description review in step 3.
- `new skill via authoring workflow: <kebab-name>`: follow that playbook's placement and draft steps.

If the playbook is absent from a selected-skills installation, preserve the
existing skill format or create `<name>/SKILL.md` with matching `name` and a
quoted `description`. Check links and available tools, and verify two triggering
and two non-triggering requests against the description. Exercise changed
structural behavior with a disposable example. Report the checks you could run.

If your environment ships a SKILL.md validator, run it on every touched skill before declaring done. Skip this step if it doesn't.

### 6. Summarize for the user

Short list, no preamble:

- Edits applied: `<skill path>`. What changed, one line each.
- New skills created: `<skill path>`. One line each (rare).
- Backlog filed to the devex tracker: `<issue title>` (`<tags>`). One line each.
- Dropped: one line per rejected finding + reason from the synthesizer.
