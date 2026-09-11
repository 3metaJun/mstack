# Skill mechanics

Use the writing rules in [SKILL.md](SKILL.md) for the body. This reference covers
how an agent discovers a skill and how the skill reaches other instructions.

## Frontmatter and invocation

Every mstack skill keeps a `name` and a non-empty `description`. The name matches
its directory. The description tells the agent which task should trigger the
skill, so it costs context whenever the Harness loads its skill catalog.

Use automatic discovery when the agent must recognize the task independently
or another workflow needs to select the skill. A human can still invoke it by
name. Describe distinct task branches once and leave the execution steps in
the body.

For workflows the human should select, document explicit invocation in the
body. Check the active Harness's support before adding metadata that disables
automatic invocation. mstack's shared format does not assume all Harnesses can
hide a description or enforce invocation-only behavior.

Shared references can be ordinary Markdown files linked by multiple skills.
They need no skill description when agents only reach them through those links.

## Splitting by invocation

Create a separate discoverable skill when it has a distinct trigger that users
actually use, or another workflow must select it independently. A new skill
adds a description to the catalog and a name for humans to remember. Keep a
branch as a linked reference when it needs neither form of independent reach.

## Router skills

A router gives the human one entry point for several related workflows. Name
each destination, state when to use it, and provide a resolvable link. When a
destination requires explicit human invocation in the active Harness, explain
how to invoke it; a router must not assume it can bypass that restriction.
