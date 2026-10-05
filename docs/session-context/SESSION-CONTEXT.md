# Optional session context

This file is an explicit, user-selected routing artifact for sessions that should
start with mstack's `/meta-mode` workflow. Load or reference it from the active
harness configuration when you want that behavior; the mstack installer never
registers it as a hook, startup command, or implicit instruction.

## Opt-in contract

1. Select this artifact explicitly with `--artifact session-context`.
2. Configure the active harness to read this file using its documented,
   user-owned session or project configuration surface.
3. Confirm the harness configuration and review the file before using it in a
   sensitive repository.

When loaded, route the user's request through `/meta-mode` at session start.
Keep routing advisory: do not execute commands, modify files, install hooks, or
send data without the harness's normal approval and tool policy. If the file is
not explicitly selected and configured, do nothing.

## Security and portability boundary

This is plain text, not executable configuration. It does not grant tools,
permissions, network access, or persistence. Harnesses differ in whether they
support session context, startup instructions, or project configuration, so
mstack does not provide an adapter that silently wires this file into any of
them. A harness-specific integration must be configured and reviewed by the
user. Hooks remain unsupported unless explicitly configured outside mstack.

Do not put secrets, credentials, transcript contents, or machine-specific paths
in this file. Keep the canonical skill tree Harness-neutral; this artifact is a
separate optional boundary for users who choose session routing.
