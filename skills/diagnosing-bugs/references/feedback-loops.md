# Feedback loops

Choose the smallest loop that reaches the real failure:

1. A focused unit, integration, or end-to-end test at the correct interface.
2. An HTTP or CLI script with fixture input and an exact assertion.
3. A browser driver that checks the relevant DOM, console, or network result.
4. Replay of a redacted request, event stream, trace, or recorded payload.
5. A small executable harness around the affected subsystem.
6. A seeded property or fuzz loop for input-dependent failures.
7. Automated bisection across commits, versions, configuration, or data.
8. Differential execution against a known-good implementation or state.
9. A structured human interaction with exact steps and captured observations.
   If Bash and an interactive terminal are available, copy and customize
   [the human interaction template](../scripts/hitl-loop.template.sh), then run
   `bash <your-copy>.sh` there. The human follows prompts and shares observations;
   the template echoes answers, so never enter credentials. If the active
   Harness cannot offer interactive input, use its user-input tool for the same
   steps and record the observations in the task log.

A useful loop is specific enough to catch this bug, repeatable enough to
compare changes, fast enough for several iterations, and runnable in the
available environment. These are goals, not absolute gates. Document any
constraint that prevents one of them.

For flakes, run enough trials to estimate the failure rate. Increase stress or
narrow timing windows only when that still represents the production failure.
Do not turn a race into a different artificial bug.
