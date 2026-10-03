---
name: principle-prove-it-works
description: Verify completed work against the real artifact before declaring success. Use after implementation, configuration, migration, automation, or delegated work when compilation or self-report is not enough.
license: MIT
---

# Prove it works

Check the real outcome directly. A build, timestamp, cached screenshot, or agent
summary is a useful signal but not proof of user-visible behavior.

Prefer a deterministic, rerunnable script over a one-time visual check. Keep its
output visible to the reviewer. Commit the proof only when the work is large or
auditable enough to justify a durable trail.

When verification fails, first confirm that the observation method is reading
the intended instance, build, environment, and state.
