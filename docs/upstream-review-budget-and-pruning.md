# Budget, prompt pruning, and verification reuse

This change ports the reasoning-budget selection from
[pstack #366](https://github.com/cursor/plugins/pull/366), prompt pruning from
[#414](https://github.com/cursor/plugins/pull/414) and
[#419](https://github.com/cursor/plugins/pull/419), and the shipping build-output
exception present at
[`12d587df`](https://github.com/cursor/plugins/commit/12d587dfb20741cafc376c42c696c5f6e2a64487).
It builds on the priority workflow ports. Source pins remain unchanged because
this is a selective adaptation, not a full upstream sync.

## Reasoning budget

`model-budget.mjs` previews or applies effort-suffix rewrites using a JSON array
of model names detected by the selected Harness. `unlimited` keeps current
efforts. `large`, `medium`, and `small` target `xhigh`, `high`, and `medium`.
The command preserves model stem, version, trailing `-fast`, and aliases. When
the target variant is missing, it selects the highest detected lower effort
of that exact stem, rather than substituting a different model.

The command writes only the selected Harness's overrides and budget label.
It preserves defaults, other Harnesses, and unrelated fields. Unresolved
models or duplicate reviewer entries reject the whole write. Repeating an
already-applied mapping does not rewrite the configuration. `unlimited` does
not restore an earlier effort level; choosing a larger bounded budget can
raise the effort to a detected variant.

A model without an effort suffix needs an explicit model choice or the
Harness's separate reasoning setting. Aliases are preserved, so their effort
remains under the Harness's control. The budget label is not a spending cap.
No provider defaults or automatic model-family fallback are introduced.

## Prompt pruning

The port removes repeated review, verification, sequencing, and writing
instructions identified by upstream as unnecessary for Opus 5.5. The changes
cover blast-radius, figure-it-out, interrogate references, feature and bug-fix
playbooks, refactoring, pause-safely, TDD, writing skills, and the affected
principles. Reflect's fixed finding count was removed in the priority port.

The canonical instructions are shorter for all supported Harnesses, not only
Opus. Runtime proof requirements, evidence-based findings, human authorization
boundaries, and source integrity checks remain. No behavioral evaluation of
other models establishes that the removed reminders are redundant for them;
that is a review risk of accepting this shared-tree change.

## Shipping exception

Shipping links a procedure for reusing individual lane results after changes
limited to tests, docs, or lint config. Two builds at the verdict SHA establish
noise; one at the current head establishes the comparison. Each accepted
difference needs evidence. A substantive difference in a noisy file still
requires a rerun. Dev servers, missing saved build output, runtime inputs, and
inconclusive comparisons do not qualify. CI, mergeability, and review run fresh.

Autopilot verdict language points to that rule rather than requiring an
unchanged patch ID in every case. Orchestrate's SHA-keyed ledger remains
strict; it has no build-output reuse implementation.

The exception is an agent-facing procedure, not an automatic classifier.
Repository tests prove model-budget CLI behavior and packaging integrity, not
that a model correctly classifies build noise or follows the shortened prompts.
