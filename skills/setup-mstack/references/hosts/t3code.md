# Model setup: T3 Code

Read this when `/setup-mstack` runs inside T3 Code and its `t3-code` MCP tools
are present. Tool names can carry a harness prefix such as `mcp__t3_code__`. If
a scan finds none, make one bounded call to `orchestrator_capabilities` before
concluding they are absent. Without the tools, follow `SKILL.md` unchanged.

T3 delegates by provider instance and model, and it exposes reasoning effort as
a separate per-model option, not as a suffix on the model name. The CLI rules in
`SKILL.md` for rewriting `-high` style suffixes do not apply here. Checked
against the T3 Code source at commit `8f75697`
(`packages/contracts/src/orchestratorMcp.ts`,
`apps/server/src/mcp/OrchestratorMcpService.ts`), not against a running T3. If a
call rejects an argument, trust the error over this page.

## Detect the models

Call `orchestrator_capabilities`. It is the only model source here. For each
provider instance it returns `providerInstanceId`, `models` (each with `id` and
an optional `options` list), `canRunChildTask`, `canRunCrossProviderChildTask`,
and `constraints`. Also read `inheritedProviderInstanceId` and `inheritedModel`,
the calling thread's own selection.

- Never write a provider instance or model it did not return.
- Write an instance only when both `canRunChildTask` and
  `canRunCrossProviderChildTask` are true. A later thread can run on a
  different provider than this one, which makes any entry cross-provider. Mark
  an entry whose instance has either flag false as needing a choice, and do not
  write it. `constraints` says why. At the checked commit the server sets both
  flags from the same `constraints` list, so they do not differ yet. The
  contract keeps them separate, so read both.
- If the call fails or lists nothing, stop and tell the user. Keep the existing
  T3 entries as they are.

## Effort options

A model's effort is one `select` option in its `options`. The option id is not
fixed. The source defines `effort` for Claude, `reasoningEffort` for Codex and
Grok, `thinking` for Pi, and `variant` for OpenCode. Treat the select option
whose choices include ladder values as the effort option.

The ladder is `max` > `xhigh` > `high` > `medium` > `low`. A choice id outside
it, such as `off`, `minimal`, or `ultracode`, is never written to mstack
configuration. A model with no such option has no effort to record. Omit
`effort` for it.

The file stores the effort value only, never the option id. The id belongs to a
provider driver and can change with its version, so the delegating agent looks
it up from the current catalog each time (see "Delegate from an entry").

## Entry shape

T3 entries live under `overrides.t3code` in `~/.config/mstack/models.json`, and
the budget under `budgets.t3code`. They do not touch the Harness overrides or
`roles`, which keep serving `run-role`. Write an entry as either form:

- `"<providerInstanceId>/<model> (<effort>)"`, with the parenthesis omitted when
  there is no effort. A provider instance id starts with a letter and holds
  only letters, digits, `_` and `-`, at most 64 characters, so the first `/`
  ends it. The validator rejects any other provider id. A model id can hold
  slashes.
- `{ "provider": "<providerInstanceId>", "model": "<model>", "effort": "<choice>" }`.

`inherit-parent` and `auto` stay plain strings. Both mean the role runs on the
parent thread's selection. `reviewer` is the only role that takes a list. One
panel can mix instances, and the same model at two efforts counts as two
entries. Identical entries do not.

The `<provider>/<model> (<effort>)` and object forms are read only in this
layer. Everywhere else a string is an opaque Harness model name, even one that
ends in `(high)` or contains a slash. A role with no `overrides.t3code` entry
falls back to `roles`, whose strings name no provider, so do not guess one.
Treat the role as `inherit-parent` and tell the user to run setup.

## Budget

Ask for the budget as `SKILL.md` describes. Map it to an effort target:
`unlimited` keeps each entry's effort, `large` targets `xhigh`, `medium`
`high`, and `small` `medium`. For each real entry, set `effort` to the target
if the model exposes it, else to the highest exposed ladder value below it. If
nothing at or below the target is exposed, or the model exposes no effort
option, mark the entry as needing a choice. Do not write it.

In a repository checkout, turn the capabilities result into a catalog and let
the script apply the same rules:

```json
[{ "provider": "<providerInstanceId>", "model": "<model>", "efforts": ["low", "medium", "high"] }]
```

`efforts` holds the choice ids of that model's effort option. Run
`node scripts/model-budget.mjs --harness t3code --budget <label> --catalog <catalog.json> --file <models.json>`
and repeat with `--apply` after the user confirms. It refuses every write when
an entry is unresolved, unknown to the catalog, or when a panel collapses to
duplicates.

## Delegate from an entry

Run one `delegate_task` per list entry, each with its own `clientRequestId`.
Before each call, read the current `orchestrator_capabilities` entry for the
entry's provider instance and model, then pass the entry in `target`:

```json
{ "providerInstanceId": "<providerInstanceId>", "model": "<model>", "options": { "<effort option id>": "<effort>" } }
```

Resolve `options` from that current entry, not from memory:

1. Find the model's `select` option whose choices include the stored effort
   value. Its `id` is the key (`effort`, `reasoningEffort`, `thinking`,
   `variant`, or whatever the driver uses now). Pass `{ <that id>: <value> }`.
2. If no option offers the value, use the highest ladder value at or below it
   that an option offers, and tell the user the entry ran at that value.
3. If none is offered, omit `options` and tell the user. The child then runs on
   the provider's default effort.

An entry with no effort needs no `options`.

- Always pass `model` with `providerInstanceId`. Without a model, T3 uses that
  provider's first advertised model.
- When the entry's provider instance differs from `inheritedProviderInstanceId`,
  the delegation is cross-provider. Require `canRunCrossProviderChildTask` in
  the current result. If it is false, treat the entry like a rejected one below.
- For `inherit-parent` or `auto`, omit `target`. The child inherits provider,
  model, and options. Naming a different model without `options` does not carry
  the parent's effort over.
- T3 rejects an unknown option id or a choice the model does not list
  (`invalid_request`), a model the instance does not advertise
  (`model_unavailable`), and an instance that cannot run a child
  (`provider_unavailable`). A credential or caller without the needed
  permission gets `capability_denied`. The source returns that for a missing
  orchestration capability, not for a provider difference, but handle it the
  same way. On any of these, call `orchestrator_capabilities` again and ask the
  user. Do not retry with a guessed value.

## Verify

Read the file after writing it. Every concrete entry must match a provider
instance and model that `orchestrator_capabilities` returned, on an instance
whose `canRunChildTask` and `canRunCrossProviderChildTask` are both true, with
an effort that model lists. Leave instances that fail those flags out of the
budget catalog too. `inherit-parent` and `auto` always pass. With a checkout,
`node scripts/model-config.mjs --file <models.json> --harness t3code` checks the
shape.
