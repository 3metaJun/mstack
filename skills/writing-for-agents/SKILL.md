---
name: writing-for-agents
description: Write or revise instructions consumed by coding agents, including skills, AGENTS.md, CLAUDE.md, and linked agent documentation. Use when triggers, context cost, routing, or completion criteria affect agent behavior.
license: MIT
---

# Writing for agents

Write instructions that change decisions reliably without spending context on
facts the agent can discover from the environment.

## Context pointers

A context pointer names material that is currently out of context and states
when to load it. Skill descriptions and links from agent instructions are
context pointers.

A useful pointer:

- Starts with the task or object that should trigger it.
- Names each distinct branch once instead of listing synonyms.
- Says what the target contains and when it matters.
- Stays short because the pointer may be present on every turn.

Sharpen a weak pointer before moving its target into always-loaded context.

## Place information by need

Keep ordered actions and universal constraints in the entry document. Move
details needed by only one branch into a linked reference beside that branch's
pointer. Keep a concept's definition, rules, and caveats together.

Split a document when it has become hard to navigate, when branches need
different reference material, or when later steps cause the agent to rush an
uncertain current step. A split must reduce the material a normal path loads;
otherwise it only adds another file to remember.

For a skill, prefer automatic discovery when the agent must recognize the task
without prompting or another workflow needs to route to it. Prefer explicit
invocation when the human should decide each time and can reasonably remember
the skill. A router can reduce that memory cost when several explicit skills
form one recognizable family.

## Make completion observable

End each important step with a condition the agent can check. Prefer bounds
such as "every modified public entry point accounted for" or "the command was
run and its exit status recorded" over vague outcomes such as "understand the
system."

The bound should demand enough work to prevent premature completion without
prescribing ceremony unrelated to the task.

## Use compact, stable language

Reuse a short, established term when it carries the intended behavior more
reliably than a repeated explanation. Define project-specific terms once.
Prefer positive instructions that name the desired action. Use prohibitions
only for real guardrails, paired with the safe behavior.

## Prune

For each sentence, ask whether it changes likely agent behavior. Remove:

- Facts available cheaply from code, configuration, directory layout, or
  command help.
- Duplicate rules and stale examples.
- Generic advice the target agent already follows.
- Branch-specific detail from the common path.
- Rules added for a single incident when a narrower trigger would suffice.

Keep one source of truth for each rule. Test disputed wording against realistic
requests when the behavior matters more than editorial preference.
