---
name: principle-prove-it-works
description: Verify completed work against the real artifact before declaring success. Use after implementation, configuration, migration, automation, or delegated work when compilation or self-report is not enough.
license: MIT
---

# Prove it works

Check the real outcome directly. A build, timestamp, cached screenshot, or agent
summary is a useful signal but not proof of user-visible behavior.

After completing work, ask: "What direct observation would fail if this were
wrong?" Then perform that observation.

For code and features:

1. Build or type-check it.
2. Run it and exercise the affected user path.
3. Follow data from real input to observable output.
4. Verify side effects through a second read path.
5. Test the full communication path for integrations when safe and authorized.

For delegated work, inspect the diff, files, logs, and runtime artifacts. Treat
the delegate's summary as a lead, not evidence.

Prefer a deterministic, rerunnable script over a one-time visual check. Keep its
output visible to the reviewer. Commit the proof only when the work is large or
auditable enough to justify a durable trail.

When verification fails, first confirm that the observation method is reading
the intended instance, build, environment, and state.
