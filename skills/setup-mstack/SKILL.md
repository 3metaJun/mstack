---
name: setup-mstack
description: "Configure the model used by each mstack role. Use for /setup-mstack, configuring mstack models, or changing model choices."
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

## Write the configuration

Store a JSON object with a `roles` object and an optional `overrides` object.
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
