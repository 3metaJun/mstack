# Feature verification map

Treat this directory as the maintained source for user-facing verification.
Start with baseline preconditions and driving conventions, then index each
feature file.

## Baseline preconditions

- Name the exact application URL, executable, or endpoint.
- Use disposable ports, profiles, and data directories when possible.
- Seed the smallest state required by the recipes.
- Run the doctor check before driving.
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
