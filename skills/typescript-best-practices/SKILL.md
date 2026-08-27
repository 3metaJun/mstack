---
name: typescript-best-practices
description: Apply strict, modern TypeScript practices when reading or editing .ts or .tsx files, especially domain modeling, boundary parsing, exhaustive variants, inference, and removal of unsafe casts or any.
license: MIT
---

# TypeScript best practices

Apply `principle-type-system-discipline` first, then use these TypeScript-specific
patterns. Detailed examples are in [patterns.md](./references/patterns.md).

| Rule | Practice |
| --- | --- |
| Discriminated unions | Give every variant one literal discriminant. Avoid optional-field bags. |
| Branded primitives | Distinguish semantic IDs and validated strings at construction. |
| Constructive modeling | Use tuples and domain-shaped objects so illegal values cannot be built. |
| Simplest total type | Strengthen a type only where a loose input forces partial behavior. |
| `unknown` over `any` | Treat external data as `unknown` and parse it at the boundary. |
| Avoid `as` | Narrow or validate first. Keep an unavoidable cast at the proved boundary. |
| Exhaustiveness | Bind an unhandled variant to `never` so new cases fail compilation. |
| `satisfies` over `as` | Validate object shape without losing literal inference. |
| Derived types | Prefer `Pick`, `Omit`, `Parameters`, `ReturnType`, `Awaited`, and `typeof` over duplicate interfaces. |
| Object arguments | Prefer named object parameters except in measured hot paths. |
| Real tests | Run real framework primitives and mock only unavailable external boundaries. |
| Structured telemetry | Emit contextual structured diagnostics, not shipped `console.log` calls. |

Keep inference working across changes. Avoid wrapper functions whose only job is
to cast one type to another.
