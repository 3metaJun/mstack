# TypeScript patterns

## Discriminated unions

```ts
type DiffState =
  | { kind: "loading" }
  | { kind: "ready"; diff: GitDiff }
  | { kind: "error"; error: string };
```

Do not use `{ loading: boolean; diff?: GitDiff; error?: string }`, which permits
contradictory combinations.

## Branded primitives

```ts
declare const agentIdBrand: unique symbol;
type AgentId = string & { readonly [agentIdBrand]: true };

function parseAgentId(input: string): AgentId {
  if (!isUUID(input)) throw new Error(`Invalid agent id: ${input}`);
  return input as AgentId;
}
```

The cast is localized after validation. Downstream functions accept `AgentId`
without repeating the check.

## Constructive models

```ts
type NonEmpty<T> = readonly [T, ...T[]];
type PairList<T> = readonly (readonly [T, T])[];
declare const durationBrand: unique symbol;
type NonNegativeDurationMs = number & { readonly [durationBrand]: true };
type TimeRange = { start: Date; durationMs: NonNegativeDurationMs };

function parseDurationMs(value: number): NonNegativeDurationMs {
  if (!Number.isFinite(value) || value < 0) throw new Error("expected a non-negative duration");
  return value as NonNegativeDurationMs;
}
```

Use a stronger input when the loose type would force a non-null assertion:

```ts
function newestSession(sessions: NonEmpty<Session>): Session {
  return sessions[0];
}
```

## Parse unknown data

```ts
function parseUser(data: unknown): User {
  if (typeof data !== "object" || data === null || !("id" in data)) {
    throw new Error("expected a user object");
  }
  if (typeof data.id !== "string") throw new Error("expected string id");
  return { id: data.id };
}
```

Prefer a maintained schema validator when the project already uses one.

## Exhaustive variants

```ts
function area(shape: Shape): number {
  switch (shape.kind) {
    case "circle":
      return Math.PI * shape.radius ** 2;
    case "rect":
      return shape.width * shape.height;
    default: {
      const exhaustive: never = shape;
      return exhaustive;
    }
  }
}
```

## `satisfies` and derived types

```ts
const config = { theme: "dark", columns: 3 } satisfies Config;

type RenderInput = Pick<GeneratedMessage, "totalCount" | "checks">;
type LoaderResult = Awaited<ReturnType<typeof loadData>>;
```

Derive from the authoritative value or generated schema instead of maintaining
a parallel interface.
