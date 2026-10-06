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
an optional `options` list), `canRunChildTask`, and `constraints`. Also read
`inheritedProviderInstanceId` and `inheritedModel`, the calling thread's own
selection.

- Never write a provider instance or model it did not return.
- Skip an instance with `canRunChildTask: false`; its `constraints` say why.
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

A role with no `overrides.t3code` entry falls back to `roles`. A plain model
string there names no provider, so do not guess one. Treat the role as
`inherit-parent` and tell the user to run setup.

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
Pass the entry in `target`:

```json
{ "providerInstanceId": "<providerInstanceId>", "model": "<model>", "options": { "<effort option id>": "<effort>" } }
```

- Always pass `model` with `providerInstanceId`. Without a model, T3 uses that
  provider's first advertised model.
- For `inherit-parent` or `auto`, omit `target`. The child inherits provider,
  model, and options. Naming a different model without `options` does not carry
  the parent's effort over.
- T3 rejects an unknown option id or a choice the model does not list
  (`invalid_request`), a model the instance does not advertise
  (`model_unavailable`), and an instance that cannot run a child
  (`provider_unavailable`). On any of these, call `orchestrator_capabilities`
  again and ask the user. Do not retry with a guessed value.

## Verify

Read the file after writing it. Every concrete entry must match a provider
instance and model that `orchestrator_capabilities` returned, with an effort
that model lists. `inherit-parent` and `auto` always pass. With a checkout,
`node scripts/model-config.mjs --file <models.json> --harness t3code` checks the
shape.
