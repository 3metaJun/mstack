# Upstream sync to mattpocock/skills 49dd158

The mattpocock/skills pin moves from `6654f6b` to
[`49dd158`](https://github.com/mattpocock/skills/commit/49dd158d1076134a641b33efb035946536778336).
mstack adapts three of its skills: `codebase-design`, `diagnosing-bugs`, and
`writing-for-agents`. Only two of their files changed upstream between the pins.

## Ported

- `diagnosing-bugs` reads `GLOSSARY.md` for the domain model. Upstream renamed
  its `CONTEXT.md` convention to `GLOSSARY.md`.
- `diagnosing-bugs` asks for a `diff` against a pristine copy when the red was
  forced by mutating code or a fixture, so a mutation that never landed cannot
  pass as a failing test.

## Not ported

- The `GLOSSARY.md` wording in upstream's `DESIGN-IT-TWICE.md`. mstack's
  `design-alternatives.md` already names the repository's domain vocabulary
  without a file name.
- Every other upstream skill, including the newly graduated `pr`, `retro`, and
  `implement-spec`, and the alignment flow (`grilling`, `grill-with-docs`,
  `to-spec`, `to-tickets`, `wayfinder`, `domain-modeling`). pstack stays the
  primary upstream. Its workflow goes from a prompt to a playbook without an
  interview stage, and `meta-mode` already covers PR bodies, session review,
  and multi-ticket runs through its playbooks, `reflect`, and `correct`.

## Verification

`skill-baseline --check` passes against both pinned sources. The repository
tests do not show that a model follows the changed instructions.
