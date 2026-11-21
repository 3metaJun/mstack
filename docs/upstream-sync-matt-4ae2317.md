# Upstream sync to mattpocock/skills 4ae2317

The mattpocock/skills pin moves from `49dd158` to
[`4ae2317`](https://github.com/mattpocock/skills/commit/4ae2317ddb22b046e26455e4f9c9b3aaaf62212d).
One commit between the pins touches the three adapted skills:
[`7739eae`](https://github.com/mattpocock/skills/commit/7739eaed7f8f3915437a8def198a6d0d7206dbc7),
"Start subagents with a fresh context window, not a fork".

## Ported

- `codebase-design` starts each design-alternative subagent with a fresh
  context window instead of a fork of the current conversation. Upstream notes
  that some Harnesses, Codex among them, fork by default, and a fork carries the
  parent context the subagent is meant to escape.

## Not ported

- The same sentence in upstream skills that mstack does not adapt
  (`implement-spec`, `code-review`, `improve-codebase-architecture`, `wayfinder`,
  `research`, `grilling`, `chief-of-staff`).
- Upstream's repository rule in `CLAUDE.md`. mstack's subagent briefs live in
  pstack-derived skills, which follow pstack rather than this upstream.

`diagnosing-bugs` and `writing-for-agents` have no upstream change between the
pins.

## Verification

`skill-baseline --check` passes against both pinned sources. The repository
tests do not show that a model follows the changed instruction.
