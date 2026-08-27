---
name: principle-boundary-discipline
description: Concentrate validation, narrowing, error translation, and framework adaptation at system boundaries while keeping internal business logic typed, trusted, and pure.
license: MIT
---

# Boundary discipline

Validate once where untrusted representations enter. Keep the core typed and
free of framework concerns.

At boundaries such as CLI arguments, configuration, files, databases, network
protocols, and external APIs:

- Parse raw input into named domain types.
- Validate required invariants.
- Translate external errors into domain errors.
- Handle malformed or version-skewed data defensively.

Inside the system:

- Trust the parsed types and propagate errors normally.
- Do not repeat boundary validation deep in call chains.
- Keep business rules in pure functions where practical.
- Expose domain concepts, not transport, storage, framework, or wire types.
- Keep general mechanisms inside and special policy at the edge.

Review each guard by asking whether data is crossing a boundary at that exact
point. If not, strengthen the upstream type or remove the redundant check.
Review each framework handler by asking whether its logic can become a pure
function called by a thin shell.
