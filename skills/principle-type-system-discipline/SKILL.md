---
name: principle-type-system-discipline
description: Use in statically typed code to make illegal states unrepresentable, distinguish semantic primitives, parse external data at boundaries, exhaust variants, and derive types from authoritative schemas.
license: MIT
---

# Type system discipline

Use the type checker as a proof assistant. Model invariants so invalid states
cannot be constructed, rather than spreading runtime guards through the system.

## Patterns

- **Model variants explicitly.** Prefer sum types, discriminated unions, sealed
  classes, or enums with payloads over bags of booleans and optional fields.
- **Construct valid values.** A non-empty list is a head plus a tail. A valid
  range is a start plus a validated non-negative duration. Use an opaque or
  branded duration so raw negative numbers cannot construct the illegal case.
- **Distinguish semantic primitives.** Use branded, opaque, newtype, value-class,
  or phantom types when two strings or numbers must not be interchangeable.
- **Parse at boundaries.** JSON, RPC, IPC, CLI args, configuration, environment
  values, and database rows are untyped until validated into the domain model.
- **Do not lie to the compiler.** Replace casts and unchecked assertions with
  validation, narrowing, or a better model.
- **Exhaust every variant.** Configure matching so a new case fails compilation
  at each incomplete consumer.
- **Derive from the authority.** Generate or infer types from protocol, OpenAPI,
  GraphQL, database, and design-token schemas instead of duplicating shapes.
- **Strengthen only where partiality appears.** Extra precision is valuable when
  it removes a crash or assertion, not when it only adds ceremony.

## Review questions

- Can contradictory field combinations compile?
- Do same-primitive arguments represent different concepts?
- Where did each cast, `any`, non-null assertion, or unsafe operation originate?
- Will a newly added variant identify every unhandled match at compile time?
- Is this type duplicating a shape another artifact owns?
- Does the stronger type make an operation total, or only more elaborate?

Pair this with `principle-boundary-discipline` to place parsing and validation.
