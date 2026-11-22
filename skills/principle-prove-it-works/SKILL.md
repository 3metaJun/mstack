---
name: principle-prove-it-works
description: Verify completed work against the real artifact before declaring success. Use after implementation, configuration, migration, automation, or delegated work when compilation or self-report is not enough.
license: MIT
---

# Prove It Works

Verify every output by checking the real thing directly: run the feature, read the actual value, inspect the diff. Proxies (file mtimes, self-reports, cached output, "it compiles") do not count. When a check fails, suspect the observation method before the system.

Before reporting success (merged, sent, started), read the real state and the exit code. Truncated output (`| tail -1`) and your own echo prove nothing.

Verify the process as well as the outcome. A correct result can rest on a broken process, such as a clause reconstructed from a paste instead of the durable record. For each fact you relied on, name the record it came from and confirm it is the authoritative source.

Red is a color, not a measurement. A failing check proves the instrument only when the failure content is the disagreement you predicted. Quote the mismatch itself, not only the assertion line.

Script the check when you can. A deterministic script that reruns the comparison beats a one-time look. Keep its output where the human can see it, and commit it only when the trail must be auditable later.
