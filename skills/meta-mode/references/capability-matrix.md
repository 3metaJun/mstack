# Capability map

Use this table when a workflow needs a capability that differs between
Harnesses. Keep the table about behavior. Put paths and commands in the
Harness adapter or in a user environment profile.

| Capability | Native mapping | Fallback | Evidence |
| --- | --- | --- | --- |
| Skill discovery | The Harness skill directory and native skill mechanism | Install into the configured directory | The Harness invokes the selected skill and returns the expected exact marker |
| Task delegation | The Harness delegation API | Run one ordered worker at a time | Each worker leaves a result |
| Automation trigger | A Harness-managed event or schedule | A watcher process or external scheduler | The triggering event and resulting run are linked |
| Background execution | A Harness-managed cloud or background job | A supervised local process with a saved log | The run survives the initiating session and records its final status |
| Remote execution | A Harness-managed cloud or self-hosted environment | An mstack SSH environment or mounted directory | Installation and cleanup succeed on the recorded target |
| Role models | The Harness model setting | The configured default model | The selected role and model are recorded |
| Session history | The Harness transcript store | A saved decision log and command output | The next run can locate the record |

Native automation and fallback executors are complementary layers. An event or
schedule can dispatch work to a Harness-managed cloud agent, a persistent local
process, or an SSH target. The native service owns isolation, retries,
credentials, and run history when it is available. A local or SSH fallback
must provide those lifecycle guarantees explicitly, so report the difference
when it affects the result or the operator's control.

Benny remains a vendor-specific automation pack because its Slack triggers and
run lifecycle depend on one Harness's automation service. Its operational
skills can reuse mstack workflows, but installing mstack in another Harness
does not recreate those triggers.
