---
name: setup-mstack
description: "Configure models and reasoning budgets for mstack roles. Use for /setup-mstack, configuring mstack models, changing model choices, or setting a reasoning budget."
---

# Set up mstack models

Write the user's model choices to `~/.config/mstack/models.json`. Keep the file
portable so the same role names work in every supported Harness.

## Read the current choices

1. Detect the model names available in the current Harness.
2. Read `~/.config/mstack/models.json` when it exists.
3. When no file exists, start from the seven-role example below. A repository
   checkout also provides `profiles/models.example.json`.
4. Use `inherit-parent` for the current session model. Native delegation must
   support inheritance; a new CLI process needs the concrete parent model via
   `run-role --parent-model <name>`. Use `auto` for the Harness's default model
   selection, which may differ from the current session.

Do not write a model name that the current Harness did not report as available.

## Select a reasoning budget

Ask for the reasoning budget when configuring models. Show the current
Harness's value from `budgets` when present. Offer these choices:

- `unlimited`: Keep the selected models' effort levels.
- `large`: Target `xhigh` reasoning.
- `medium`: Target `high` reasoning.
- `small`: Target `medium` reasoning.

Aliases `inherit-parent` and `auto` remain unchanged. They do not enforce an
effort level. For a concrete model name ending in `-max`, `-xhigh`, `-high`,
`-medium`, or `-low`, optionally followed by `-fast`, replace only that effort
token. Accept the rewritten name only if the selected Harness reports it as
available. Otherwise choose the highest detected effort at or below the target
with the same model stem and `-fast` suffix. Preserve the user's chosen model
family and version. If no such name exists, ask for a model choice or use the
Harness's separate reasoning setting. A model name with no effort suffix also
needs that separate setting; do not invent a suffix.

In a repository checkout, save the current Harness's detected concrete model
names as a JSON array, then preview the rewrite with:

```bash
node scripts/model-budget.mjs --harness <name> --budget <label> --catalog <detected-models.json> --file <models.json>
```

After the user confirms the preview, repeat with `--apply`. The command writes
only the selected Harness's role overrides and `budgets` entry. It refuses all
writes when a model is unresolved or reviewer entries collapse to duplicates.
Without this CLI, apply the same rules directly and verify the file afterward.
This budget selects reasoning effort, not a token or monetary spending cap.

## Write the configuration

Store a JSON object with a `roles` object, an optional `overrides` object, and
an optional `budgets` object keyed by Harness. A budget value is `unlimited`,
`large`, `medium`, or `small`; it records the selection, while the rewritten
role values are what workers execute.
Use these roles:

- `implementer` for feature and refactoring workers.
- `reviewer` for review and verification workers.
- `judge` for comparisons and final decisions.
- `explorer` for read-only repository exploration.
- `synthesizer` for combining findings into one answer or artifact.
- `candidate` for independent alternatives evaluated by an arena.
- `operator` for environment or lifecycle operations.

Merge the requested changes into the existing file. Preserve other role choices,
Harness overrides, and unrelated fields. Fill missing roles with `inherit-parent`.
Write the complete JSON file only when its values change.

Every role accepts one non-empty model string. `reviewer` also accepts a non-empty
list of unique model strings. `interrogate` runs one reviewer per list entry;
fixed-size review workflows select entries in order and cycle when needed.

Example:

```json
{
  "roles": {
    "implementer": "inherit-parent",
    "reviewer": ["inherit-parent"],
    "judge": "inherit-parent",
    "explorer": "inherit-parent",
    "synthesizer": "inherit-parent",
    "candidate": "inherit-parent",
    "operator": "inherit-parent"
  },
  "overrides": {
    "codex": {},
    "claude": {},
    "opencode": {},
    "pi": {}
  }
}
```

Use `overrides` when a Harness needs a different model for the same role.
The selected Harness entry replaces the role default, including an entire
reviewer list. Select list entries from model names the Harness actually reports;
the default example deliberately names no provider models.

## Verify the result

Read the file after writing it. Check that every changed model is available in
its target Harness or is `inherit-parent` or `auto`. Preserve choices for other
Harnesses when their model catalogs are unavailable. When working in the mstack
repository, run `node scripts/model-config.mjs --file <path>` to check the shape.
Report the roles and selected values to the user.

## Discover project verification

Read `AGENTS.md` and `.harness/workflow.md` when present. Inspect the apps in
`.harness/policy.json`, canonical `.harness/verify/` contracts, and project
`verify-*` wrappers. Resolve `metadata.verification-contract` from the repository
root. Multiple wrappers targeting one contract are one verification workflow.

If canonical verification exists, report its path and follow the project's
workflow. If legacy maps disagree or duplicate canonical facts, report the
conflict and use `/create-verification-skill`'s migration procedure when the
user requested verification setup. Do not generate another copy for this
Harness.

If neither a reusable verification contract nor an existing repository driver
exists, offer once to run `/create-verification-skill`. Create it when the user
has already requested that work or accepts the offer. Model configuration alone
does not require launching the app or adopting a team policy. Mixed-Harness
adoption is a separate project change described in the mstack guide.
