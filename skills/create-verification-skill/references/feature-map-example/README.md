# Notes verification map

This worked example describes a fictional Notes app and its `control-notes`
driver. The commands show the precision a real feature map needs; they are
not tools shipped by mstack. Replace the app, driver, paths, and seeded data
when writing your project's map.

## Baseline preconditions

- Launch Notes at `http://127.0.0.1:4173` with a disposable data directory.
- Seed notes titled `Quarterly plan` with body `Draft budget`, and `Grocery list`.
- Put `control-notes` and the `notes` CLI on `PATH`.
- Run `control-notes doctor` and check the URL, data directory, and build revision.
- Never drive an instance not owned by this verification run.

## Proof and skip reporting

- Capture the action and resulting state, not only the final screen.
- Include commands, stdout, stderr, and exit codes for terminal proof.
- Confirm mutations through a second read-only view.
- Keep evidence after cleanup.
- Report an unreachable entry point with its attempted step and unmet precondition.

## Feature file contract

Each feature starts with an H1 and a short user-visible description, followed by
exactly these four H2 sections:

1. `Sub-features`
2. `How to get to it (user POV)`
3. `Driving it with <harness>`
4. `Gotchas`

Keep implementation details out. Record user paths, stable handles, required
state, literal commands, and observable proof.

## Features

- [Create a note](create-note.md) covers browser and CLI creation, cancellation,
  persistence, and cleanup.
- [Search notes](search.md) covers toolbar, keyboard, and CLI search with matching,
  empty, and clear states.
