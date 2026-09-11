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
3. Start from `profiles/models.example.json` when no file exists.
4. Keep `inherit-parent` or `auto` when the user wants the role to use the
   current session model.

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

Write the complete file on every run. A later run must produce the same file
when the choices have not changed.

Example:

```json
{
  "roles": {
    "implementer": "inherit-parent",
    "reviewer": "inherit-parent",
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

Use `overrides` only when a Harness needs a different model for the same role.
The adapter reads the selected Harness entry before it reads the role default.

## Verify the result

Read the file after writing it. Check that every selected model is either
available in the current Harness or is `inherit-parent` or `auto`. Report the
roles and selected values to the user.
