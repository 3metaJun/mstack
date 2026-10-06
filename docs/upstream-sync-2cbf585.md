# Upstream sync to pstack 2cbf585

The pstack pin moves from `f5bdd68` to
[`2cbf585`](https://github.com/cursor/plugins/commit/2cbf58508f40de470d7490b55c51d71241928fa2).
This is a selective port. mstack keeps its portable adapters, its role-based
model configuration, and its own autopilot policy.

## Ported

- New skills `benchmark-checklist` and `principle-explain-the-number`, which
  vet a measured number before anyone reports or acts on it. `meta-mode`
  triggers the checklist on a benchmark and indexes the principle. The Perf
  issue and Hillclimb playbooks run it.
- New skill `correct`, which fixes repeated agent mistakes at the highest level
  that works: architecture, types, lint, tests, then docs.
- New skill `meta-help` (upstream `poteto-help`) with its prompting and recipe
  references. It was rewritten without Cursor commands, Custom Modes, or the
  `pstack-models.mdc` rule. It points at the installer, `/setup-mstack`,
  `~/.config/mstack/models.json`, and the Harness's own loop and pinning
  features. Upstream's `poteto-help` is typed-only, which mstack cannot enforce
  because its portable frontmatter has no way to disable model invocation. The
  description is narrow instead, and the skill answers without starting work.
- `architect` assumes the next contributor is an agent, and
  `design-red-flags.md` gains four red flags: split ownership, two ways to do
  one task, importable internals, and a hand-synced list.
- Fresh subagents by default in `meta-mode`, a one-hour audit tick in the
  autopilots and the multi-phase plan (`check-plan.mjs` pins it, with a new
  test), an owner pushes after every verifiable unit, `children.tsv`, status
  messages only for new tracked changes, and the full-autonomy wording for
  decisions the grant covers.
- `agents/meta-agent.md` now tells callers to spawn a fresh agent per task, and a test keeps it consistent with `meta-mode`.
- Opening a PR: `##` section headings, a built-in PR tool first, and the
  "Size and stacks" and "Readiness" wording.
- Perf issue replaces its eight strategy families with seven mantras tried in
  order. Hillclimb orders hypotheses by them.
- `swarm` briefs name exact SHAs and measurement method, and a result without
  them is respawned once, then recorded as a gap. A worker reports every
  provable issue.
- `technical-writing` drops its fetch-date source lines. `typescript-best-practices`
  takes the schema-first cast guidance.
- The upstream guide refresh for `/correct`, `/benchmark-checklist`, prompting
  tips, `/meta-help`, and the 24 principles. The Cursor-specific wording is
  rewritten through replacements in `profiles/upstreams.json`. The four guide
  pages that carry mstack's mixed-Harness and verification-contract text were
  merged by hand, and their reviewed digests are recorded in
  `profiles/upstream-manifest.json`.

## Not ported

- Model slug and `pstack-models.mdc` changes in `arena`, `architect`, `how`,
  `why`, `interrogate`, `reflect`, `setup-mstack`, and the `meta-mode` task
  defaults. mstack reads roles from `~/.config/mstack/models.json`, and the
  reasoning budget is already handled by `model-budget.mjs`.
- The `log.sh` header-append fix. mstack's Node logger already creates the file
  exclusively.
- Prompt pruning that mstack's skills had already taken or rewrote, such as
  `blast-radius`, `tdd`, `unslop`, and the five affected principles.
- Upstream's rule that lets an owner skip a second rebase when a later trunk move is textually clean and touches disjoint paths. Disjoint files can still break each other, so the owner rebases again and waits for CI.
- Upstream's removal of the `/goal` arm in Autopilot-full, Autopilot-stack, and the multi-phase plan. mstack is portable and relied on the goal for restart recovery, so on the operator's go the root writes the program objective (queue and order, verification rule, who merges, done condition) to `program.md` beside the decision trail, and to the Harness's goal mechanism when it has one. Every audit tick re-reads it with the playbook, and its done condition ends the recurring wake. `check-plan.mjs` pins the objective and has a test.
- `profiles/legacy-skill-digests.json`. It records released tags used to
  recognize unmodified old installs and has no entry for a new skill.

## Verification

The repository tests cover packaging, inventory, link and frontmatter checks,
the `check-plan` cadence, and both source baselines. They do not show that a
model follows the new instructions.
