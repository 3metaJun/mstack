---
name: maintain-verification-skill
description: "Audit a project's canonical verification contract and feature map with parallel source readers and one live coordinator, then ship proven corrections. Use for /maintain-verification-skill or an audit of a reusable verification workflow."
---

# Maintain a verification contract

Cover every mapped feature from source and exercise every feature live. Update
one canonical definition regardless of which Harness runs this pass.

## Outcomes

Report one outcome:

- `clean`: Every feature has source and live coverage, with no corrections to ship.
- `changed`: One PR contains proven contract, helper, or map corrections.
- `blocked`: Coverage or delivery could not finish. Name the missing prerequisite.

## Edit scope

Edit the target's canonical `.harness/verify/<app>/` directory, including its
contract, feature map, and owned helpers. Regenerate affected discovery wrappers
with `mstack-policy wrappers` when their pointers or supported Harnesses change.
Keep project facts out of wrapper directories. Never edit product code during
this pass. An incorrect map is doc drift. A product regression is a finding to
report, not a reason to redefine expected behavior.

## Pass

0. **Locate the target.** Read `AGENTS.md` and `.harness/workflow.md` when present.
   Use `.harness/policy.json` to find registered apps, then read their canonical
   contracts and feature indexes. Resolve a discovered wrapper's
   `metadata.verification-contract` from the repository root. Wrappers with the
   same target are one app. Without a policy, inspect `.harness/verify/` directly.
   Infer the target from the request when possible. Ask only when apps remain
   ambiguous. For legacy definitions, use `/create-verification-skill`'s
   migration procedure before claiming shared maintenance. When no target
   exists, report that creation is needed.

1. **Check the index.** Read the feature README and compare its links with the
   sibling files. Fix missing, duplicate, and dead entries.

2. **Read source in parallel.** Assign one read-only subagent per feature. Each
   returns a feature summary, source entry points, likely drift with citations,
   and one live recipe. Children never drive the app or edit files.

3. **Reconcile.** Require a result for every feature. Combine overlapping
   recipes into as few app states as practical. Check cited drift against source.
   Inspect recent changes for unmapped user paths, citing a concrete source path
   for each addition.

4. **Run the live pass.** The coordinator owns all driving. Follow the contract's
   launch model, whether one long-lived instance or a fresh CLI session per
   drive. Exercise every feature even when source looks unchanged. Apply these
   rules throughout the pass:

   - Run Doctor before the first drive, for every fresh session, and after a
     failed drive. Reset or relaunch when process health cannot explain a stuck
     UI state.
   - Check captured evidence at its named location after cleanup.
   - Clean failed-iteration residue before retrying. Clean only owned resources.
     For a shared instance, remove the run's residue without stopping the instance.
   - If Doctor fails because instructions drifted, correct them within scope and
     retry once. Restart only resources the correction invalidates.
   - A `verified-unreachable` result requires the attempted route and a concrete
     missing prerequisite such as auth, entitlement, OS, or external state.
     Record a missing prerequisite in the map. It does not count as live proof.
   - Re-drive every corrected helper before shipping. Perform final teardown
     after the last drive and retain the evidence.

5. **Triage.** Correct wrong or missing user descriptions. Fix gaps in owned
   helpers, document exact invocations, and keep executable scripts runnable.
   Report broken product behavior separately. Do not weaken the expected result
   to turn a failed feature green.

6. **Check and deliver.** Run `mstack-policy check --root <repo>` when a policy
   exists. Re-read every changed file. For `changed`, open one PR of proven
   corrections through `/file-pr`. For `clean` or `blocked`, report coverage and
   the outcome without opening a PR. Follow the project's receipt and evidence
   requirements. A passing policy check does not replace the live pass.

Keep run notes in scratch, including covered features, unreachable prerequisites,
confirmed drift, and the outcome. Do not commit temporary notes or copies of the
map. Delete any completed plan.
