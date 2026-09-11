# Reviewing skill baselines

`profiles/skill-manifest.json` records each pinned source file, its local target,
and both SHA-256 digests. Text uses LF line endings. Binary files retain their
bytes. The complete target skill tree is checked, including files added locally.
`profiles/skill-sources.json` declares source skill ownership, moves, and
omissions. Every source file must map to an existing target or an omission with
a reason. Missing files cannot become accepted omissions by refreshing hashes.

Target inventories include `skills/` and each move's exact target. A moved
directory includes local additions recursively; a single-file move includes
only that file, not its siblings. Installed `node_modules/` dependencies are
excluded from the target inventory. Preview and write use the same inventory
as checks, so intentional additions can be reviewed and recorded normally.

These are adapted workflows. A matching baseline proves that the recorded files
have not drifted. It does not prove semantic equivalence, that a shorter rewrite
retains every instruction, or that a Harness executed a workflow successfully.
Review those claims through the source diff and workflow verification.

## Refresh after an intentional edit

1. Check out the commits in `profiles/upstreams.json` into separate clean
   directories. The pstack argument points to the `pstack` subdirectory of
   `cursor/plugins`; the Matt Pocock argument points to the repository root.
2. Run the review command. It prints baseline changes, full upstream-to-target
   patches, local additions, and every omission reason:

   ```bash
   npm run skill-baseline -- --source /path/to/pstack --matt-source /path/to/mattpocock-skills --diff
   ```

3. Review changed instructions with their linked references. Check that removed
   steps are deliberate, links still resolve, and replacements preserve the
   workflow's required outcome. Restore accidental deletions. Add a move or
   omission rule only when the destination or reason can be reviewed.
4. Run the same command with `--write` in place of `--diff`, then review the Git
   diff and run `npm test`. CI additionally checks both pinned source trees.

The write command changes only the new manifest and uses the upstream sync
lock. It leaves adapted content untouched. Artifact synchronization preserves
its existing transaction behavior and never refreshes skill baselines.

The earlier `canonicalSkills` block in `profiles/upstream-manifest.json` still
checks the 47 pstack entry documents. When changing one of those entries, update
that existing target digest in the same review. The new manifest covers the
complete trees and the three Matt Pocock skills alongside that check.

## Parallel branches

Branches can edit separate workflows independently, but their baselines describe
their own complete checkout. After one branch lands, rebase the next branch and
review its changed content before refreshing the new manifest. Resolve legacy
entry digests against the final bodies. Run both source checks after integration;
do not choose one branch's entire manifest during conflict resolution.

## Initial inventory decisions

The initial complete inventory restores the missing Notes example recipes,
the skill-mechanics reference, and the optional Bash human-interaction template.
The template requires an interactive terminal; the reference explains how to
use the Harness's user-input tool when that terminal is unavailable.

The three Matt Pocock skill bodies and their design references use the pinned
originals as the editing base. The restoration brings back the interface and
adapter vocabulary, independent alternative-design briefs and outputs, the
six diagnostic phases and completion checks, and the writing rules for context
budgets, information hierarchy, co-location, sequence splitting, and pruning.
Local frontmatter, moved reference paths, diagnosis-only authorization, and
available delegation or interaction tools remain explicit adaptations.

The TypeScript reference again includes the upstream schema, narrowing,
exhaustiveness, boundary, derived-type, and object-argument examples. Corrections
retain validated non-negative durations, construct parsed objects without an
unchecked object assertion, make computed indexing total under
`noUncheckedIndexedAccess`, and qualify parser-specific unknown-field options.

The three upstream `agents/openai.yaml` files are UI metadata for the upstream
skill package. Their omission reasons and source digests remain in the manifest.
The logger is a Node replacement for a Bash script; meta-mode runtime tools live
under `tools/meta-mode`. The two codebase-design references have explicit moved
targets. Other existing instruction rewrites remain adaptations for review,
with the pinned source path available for every comparison.
