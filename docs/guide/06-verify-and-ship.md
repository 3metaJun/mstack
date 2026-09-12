# Verify the result and open a PR

"It compiles" is not evidence. The [Prove It Works principle](../../skills/principle-prove-it-works/SKILL.md) makes the agent check the real artifact before it reports success, and your job is to make "the real artifact" checkable. This page covers stating a finish condition, generating a verification skill for your app, opening the PR, and driving it to merged.

![A prototype plane flies a real test course while she times it with a stopwatch and robots film and checklist the run; the terminal reads verify: pass, evidence: captured.](./images/verification.jpg)

## State the finish condition up front

Put what done means in the first prompt, in whatever words fit:

```text
/meta-mode add json output to this command. text output stays byte-identical, the json parses, both run against the sample project. show me the evidence.
```

Now the agent has three checks it can run, not a mood to satisfy. When the reply comes back, it should carry the exact commands and outputs. If a check couldn't run, a good reply says "inconclusive", and you should treat a confident reply without evidence as a red flag.

Match the check to the change:

- A CLI change runs the real command.
- A UI change walks the changed flow in the running app.
- A parser or migration replays a saved input.
- A perf change compares before and after profiles.
- A storage change reads back the written value.

For a small diff you don't fully trust, [`/blast-radius`](../../skills/blast-radius/SKILL.md) finds what it could break elsewhere. It picks the one fact the change is safe because of and proves it by running code instead of writing an essay about it.

## Create a project verification skill

The UI bullet above hides a real requirement. The agent needs a scripted way to drive your app. If your project has one, great. If not, run:

```text
/create-verification-skill
```

[`/create-verification-skill`](../../skills/create-verification-skill/SKILL.md) interviews the repository, not you. It works out what a user touches, how the app launches locally, what can drive it (an existing harness first, otherwise browser and CDP, a PTY, or plain HTTP), what evidence proves behavior, and whether two instances can run side by side. It asks you only what the code can't answer.

It writes one `.harness/verify/<app>/contract.md` with Launch, Isolation, Doctor, Drive, Evidence, Cleanup, and Helpers sections. The adjacent `features/README.md` indexes the app's user paths and expected results. Owned scripts live in `helpers/`. The [worked feature-map example](../../skills/create-verification-skill/references/feature-map-example/) shows the required detail.

The generator then renders thin `verify-<app>` wrappers for the configured Harnesses. Each wrapper's `metadata.verification-contract` points at the same contract from the repository root. Wrappers select an available driver without copying launch commands, selectors, or proof requirements. Because Cursor also discovers `.agents/skills/`, a project using both Cursor and Codex has one shared wrapper there. See [the wrapper paths](../../skills/create-verification-skill/references/harness-paths.md).

Before handing over the result, the generator launches an isolated instance, runs Doctor, drives one feature, captures evidence, and cleans up. The evidence must survive cleanup. One successful feature does not prove every mapped path or every Harness. A missing required capability remains a reported gap.

A [`/swarm`](../../skills/swarm/SKILL.md) can split a full pass by feature-map entry. Give concurrent drivers separate instances, ports, and data directories. When the app cannot isolate them, keep one coordinator driving serially.

## Keep the verification skill honest

Apps change and feature maps rot. When yours drifts, run:

```text
/maintain-verification-skill
```

[`/maintain-verification-skill`](../../skills/maintain-verification-skill/SKILL.md) resolves wrappers to the canonical contract. Read-only source readers cover features in parallel, then one coordinator drives every mapped feature. Corrections go into `.harness/verify/<app>/`, with wrapper regeneration only when needed. Cursor automation and a local Claude Code session maintain the same map.

The outcome is `clean` when all features have source and live coverage without corrections, `changed` when one PR contains proven corrections, or `blocked` when coverage cannot finish. The pass never edits product code. It reports product regressions without changing the map to accept broken behavior.

For repositories with `.harness/policy.json`, follow `.harness/workflow.md` to run required commands and record evidence at the final commit. A passing policy check or command receipt does not certify app behavior. Review the named artifacts against the mapped feature. [Mixed-Harness adoption](./11-mixed-harness.md) describes the CI and handoff steps.

## Open the PR

```text
/meta-mode open the pr. small ordered commits, evidence in the description.
```

The [Opening a PR playbook](../../skills/meta-mode/playbooks/opening-a-pr.md) works from a worktree, rebases the work into small ordered commits, cleans the diff, unslops the prose, and returns the PR link. Five narrow PRs beat one fat one, and stacked follow-ups beat a growing branch.

## Drive the PR to merge-ready with Babysit

An open PR starts collecting blockers immediately. Checks fail, reviewers comment, trunk moves. Hand that churn to the [Babysit playbook](../../skills/meta-mode/playbooks/babysit.md):

```text
/meta-mode babysit this pr. get it green.
```

Babysit watches the PR with a bundled watcher and takes blockers in order: conflicts, then review threads, then CI. Every known fix batches into one push, so the checks restart once instead of after every fix. The comment triage is skeptical, because humans and bots file real catches and noise in the same list. A real finding gets a fix, and noise gets dismissed with the disproof posted on the thread. When all you want is status, ask smaller and Babysit answers without starting the loop:

```text
/meta-mode check on pr 123. anything outstanding?
```

Babysit stops at merge-ready. It never merges, even with everything green, because merging is a different decision.

## Land the stack with Shipping

Green is not the same as safe. When you're ready to land, say so:

```text
/meta-mode land the stack.
```

The [Shipping playbook](../../skills/meta-mode/playbooks/shipping.md) verifies each PR independently before it arms anything. One fresh agent per PR proves the behavior live, and the agent that judges a change is never the one that wrote it. Then Shipping lands only the contiguous verified run from the bottom, one PR at a time through GitHub by default or Origin when its CLI is available, and reports the first PR that breaks the chain. A verified PR sitting above an unverified one waits, because merging it would pull the gap in underneath.

Next: [Run work while you sleep](./07-overnight.md).
