# pi end-to-end evidence

The three requested skills ran through pi `0.85.1` in a disposable Git
workspace on 2026-09-11. The installer copied all 50 skills into the workspace
project root at `.pi/skills/`.

Each command used pi's documented non-interactive mode, disabled session writes,
and allowed only read tools:

```text
pi -p --no-session --tools read,grep,find,ls -- "/skill:meta-mode Smoke check only. Do not edit files or delegate. Reply exactly mstack-meta-mode-ok."
pi -p --no-session --tools read,grep,find,ls -- "/skill:architect Smoke check only. Do not edit files or delegate. Reply exactly mstack-architect-ok."
pi -p --no-session --tools read,grep,find,ls -- "/skill:create-verification-skill Inspect this disposable repository. Do not create files or run an app. Reply exactly mstack-create-verification-skill-ok."
```

Observed output:

```text
mstack-meta-mode-ok
mstack-architect-ok
mstack-create-verification-skill-ok
```

The run proves skill discovery and invocation through pi. It does not claim
that `create-verification-skill` drove an application, because this smoke
workspace has no application to launch.

