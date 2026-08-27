# Third-party notices

## pstack

The skills in this repository are adapted from the `pstack` plugin in
[`cursor/plugins`](https://github.com/cursor/plugins/tree/main/pstack/skills),
pinned during the port at commit
[`799151d91b6e12ee7dbd09f708eec108d7de9b3b`](https://github.com/cursor/plugins/commit/799151d91b6e12ee7dbd09f708eec108d7de9b3b).

The upstream repository identifies the project license as MIT. The adaptations
remove Cursor-only paths and tool assumptions, add cross-platform helpers, and
define discovery conventions for Codex, Claude Code, and OpenCode.

Adapted upstream skill names:

- `create-verification-skill`
- `blast-radius`
- `principle-make-operations-idempotent`
- `principle-prove-it-works`
- `principle-separate-before-serializing-shared-state`
- `principle-fix-root-causes`
- `principle-type-system-discipline`
- `principle-sequence-verifiable-units`
- `recall`
- `show-me-your-work`
- `principle-model-the-domain`
- `tdd`
- `typescript-best-practices`
- `principle-boundary-discipline`
- `principle-build-the-lever`

## mattpocock/skills

The following skills are adapted from
[`mattpocock/skills`](https://github.com/mattpocock/skills), pinned during the
port at commit
[`6654f6b60cd9d5be8b54c6fafe44346dabeb3b76`](https://github.com/mattpocock/skills/commit/6654f6b60cd9d5be8b54c6fafe44346dabeb3b76):

- `writing-for-agents`
- `codebase-design`
- `diagnosing-bugs`

The upstream repository is licensed under MIT. These adaptations preserve the
core methods while narrowing automatic triggers, respecting repository
terminology, and removing harness-specific runtime assumptions.
