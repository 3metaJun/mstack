# pi end-to-end evidence

The three requested skills ran through pi `0.85.1` in a disposable Git
workspace on 2026-09-11. The installer copied all 50 skills into the workspace
project root at `.pi/skills/` with `HARNESS_SKILLS_PI_DIR=<workspace>/.pi/skills`.

Each command used pi's documented non-interactive mode, approved the project so
project-local skills were discoverable, emitted JSONL events, kept a session
directory for inspection, and allowed only read tools:

```text
pi -p --approve --mode json --session-dir .pi/e2e-sessions --tools read,grep,find,ls -- "/skill:meta-mode Read the installed skill before answering. Reply exactly mstack-meta-mode-ok."
pi -p --approve --mode json --session-dir .pi/e2e-sessions --tools read,grep,find,ls -- "/skill:architect Read the installed skill before answering. Reply exactly mstack-architect-ok."
pi -p --approve --mode json --session-dir .pi/e2e-sessions --tools read,grep,find,ls -- "/skill:create-verification-skill Read the installed skill before answering. Do not create files or run an app. Reply exactly mstack-create-verification-skill-ok."
```

Observed output:

```text
mstack-meta-mode-ok
mstack-architect-ok
mstack-create-verification-skill-ok
```

Each JSONL session contains a user `message_start` event whose text includes the
resolved `<skill name="..." location=".../.pi/skills/.../SKILL.md">` block,
followed by the marker in the assistant `message_end` event. The run proves
project skill discovery and invocation through pi. The marker prompts exercise
loading only. They do not claim that the skills completed their full workflows.
In particular, `create-verification-skill` did not drive an application because
this smoke workspace has no application to launch.
