---
name: diagnosing-bugs
description: Diagnose hard, flaky, intermittent, environment-specific, or performance regressions, especially when a prior fix failed. Use a tight reproduction and falsifiable hypotheses; do not invoke for a straightforward bug with an obvious local cause and cheap test.
license: MIT
---

# Diagnosing hard bugs

Build a trustworthy feedback loop before committing to a theory. Match the
amount of investigation to the bug's cost and uncertainty.

## Protect evidence

Redact credentials, tokens, private user data, auth headers, and sensitive
infrastructure details from commands, logs, traces, screenshots, and reports.
Keep credentials in environment variables. If redaction removes the signal,
ask for a safer artifact or access path.

## Establish the signal

Create one command or repeatable interaction that reaches the reported code
path and detects the exact symptom. Run it before relying on it. Tighten it by
making setup smaller, the assertion sharper, and sources of time, randomness,
filesystem state, and network behavior controlled where practical.

For intermittent bugs, optimize for a high measured reproduction rate rather
than a perfect single run. Record attempts, failures, and conditions. See
[references/feedback-loops.md](references/feedback-loops.md) for loop choices.

If no trustworthy loop is possible, report what was attempted and request the
missing environment, a redacted capture, or authorization for temporary
instrumentation. Do not disguise speculation as a diagnosis.

## Minimize and hypothesize

Reduce inputs, callers, configuration, data, and steps one variable at a time.
Keep a reduction only when the failure remains. Aim for a case where every
remaining element affects reproduction.

Rank several plausible causes when uncertainty is real. Each hypothesis must
predict an observation that would support or falsify it. Share the ranked list
when domain knowledge could reorder it, but continue with the strongest safe
probe if the user is unavailable.

## Instrument deliberately

Map each probe to one prediction and change one variable at a time. Prefer a
debugger or focused state inspection, then targeted logs at transitions that
distinguish hypotheses. Tag temporary instrumentation with a unique searchable
prefix. Avoid broad logging that creates noise or captures secrets.

For performance regressions, establish a baseline with the relevant profiler,
query plan, trace, allocation data, or timing harness before changing code. See
[references/performance.md](references/performance.md).

## Fix and prove

Fix the earliest incorrect assumption, state transition, or ownership boundary
supported by evidence. Turn the minimized reproduction into a regression test
when a stable interface can express the real failure. A brittle, mock-dominated
test at the wrong level is not proof.

Run the focused regression and the original scenario after the fix. Then run
nearby checks in proportion to the change's risk. Remove tagged instrumentation
and temporary artifacts unless the user asked to retain a reusable diagnostic.

Report the cause, evidence that separated it from competing hypotheses, the
change, before-and-after results, and any remaining uncertainty.
