---
name: codebase-design
description: Design or review a module's public interface, seam placement, depth, and testability. Use for module boundaries, pass-through abstractions, dependency injection, or alternative interface designs, not routine implementation inside an established design.
license: MIT
---

# Codebase design

Design deep modules that hide substantial behavior behind a small interface.
The result should reduce what callers must know and concentrate related change
in one place.

Use the repository's existing domain and architecture terms. The concepts below
are analytical tools, not a replacement vocabulary:

- **Module:** code with an interface and implementation, at any useful scale.
- **Interface:** everything a caller must know, including types, invariants,
  ordering, errors, configuration, and relevant performance characteristics.
- **Seam:** a place where behavior can vary without editing the caller.
- **Adapter:** an implementation selected at a seam.
- **Depth:** useful behavior provided per unit of interface callers must learn.
- **Locality:** related knowledge, change, and verification remain together.

## Review the shape

1. Identify callers and list what each must know or coordinate.
2. Find rules, sequencing, error translation, or lifecycle state repeated across
   callers.
3. Propose the smallest interface that can own those responsibilities.
4. Place seams only where behavior actually varies or a real external
   dependency requires substitution.
5. Test through the same interface callers use.

Apply the deletion test. If deleting the abstraction removes complexity, it was
probably pass-through code. If its responsibilities spread back across many
callers, the module was earning its place.

One production adapter alone rarely justifies a new seam. A production adapter
plus a meaningful test implementation, or two real production variants, does.
Do not expose private seams merely to make implementation details mockable.

Accept dependencies instead of constructing remote or stateful dependencies
inside domain logic. Prefer returned results over hidden mutation when that
makes behavior easier to compose and verify.

When deepening several shallow modules, read
[references/deepening.md](references/deepening.md). When materially different
interfaces could change the architecture, read
[references/design-alternatives.md](references/design-alternatives.md).
