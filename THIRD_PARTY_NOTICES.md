# Third-party notices

## pstack

The skills in this repository are adapted from the `pstack` plugin in
[`cursor/plugins`](https://github.com/cursor/plugins/tree/main/pstack/skills),
with the current complete snapshot pinned at commit
[`7366ac128bdf95f45e6734f412b49a4031800169`](https://github.com/cursor/plugins/commit/7366ac128bdf95f45e6734f412b49a4031800169).
The first port of selected skills was pinned at commit
[`799151d91b6e12ee7dbd09f708eec108d7de9b3b`](https://github.com/cursor/plugins/commit/799151d91b6e12ee7dbd09f708eec108d7de9b3b).

The upstream repository identifies the project license as MIT. The adaptations
remove Cursor-only paths and tool assumptions, add cross-platform helpers, and
define discovery conventions for Codex, Claude Code, OpenCode, and pi.

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

The bundle also includes these principles from the current upstream tree, pinned
at commit [`7366ac128bdf95f45e6734f412b49a4031800169`](https://github.com/cursor/plugins/commit/7366ac128bdf95f45e6734f412b49a4031800169):

- `principle-attack-the-premise`
- `principle-encode-lessons-in-structure`
- `principle-exhaust-the-design-space`
- `principle-experience-first`
- `principle-foundational-thinking`
- `principle-guard-the-context-window`
- `principle-laziness-protocol`
- `principle-migrate-callers-then-delete-legacy-apis`
- `principle-minimize-reader-load`
- `principle-never-block-on-the-human`
- `principle-outcome-oriented-execution`
- `principle-redesign-from-first-principles`
- `principle-subtract-before-you-add`
- `principle-test-behavior-not-implementation`

These files use portable capability names. They do not copy the upstream
Cursor-only commands or paths.

The remaining pstack workflow skills are included under their original names.
The portable bundle renames `poteto-mode` to `meta-mode` and `poteto-agent` to
`meta-agent`. The source inventory is recorded in `profiles/skills.json`.
Source commits and renames are recorded in `profiles/upstreams.json`. The
non-skill upstream artifacts are retained as follows:

- `automations/benny/` contains the dormant Benny automation pack, adapted to
  refer to mstack's skills. It remains an optional Cursor automation surface.
- `docs/guide/` contains the upstream guide with `meta-mode` and mstack names.
- `tools/meta-mode/` contains the Bun-based orchestration and pull-request
  watcher tools, with their upstream tests.
- `agents/` contains the portable mstack routing agents.

Run `npm run sync-upstream -- --source <pstack-checkout>` to preview a refresh.
Only `--apply` writes files, and changed source-managed files require
`--force`; adapted agents are preserved by default. The resulting transformed
upstream baseline hashes are recorded in `profiles/upstream-manifest.json`.

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
