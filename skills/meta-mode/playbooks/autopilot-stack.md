### Autopilot-stack

Run [Autopilot-full](autopilot-full.md), but do not merge.

1. **In place of step 5, stop at verified.** Stop when each PR is verified and green at its current head, then hand the PRs to the operator. After the handoff, nobody pushes without the operator's go. Every loop tick names this playbook, so it retains the no-merge rule.
2. **Stack a PR only when it builds on another PR.** This is the exception to step 3. Base the PR on its dependency's branch instead of trunk, per **Size and stacks** in `playbooks/opening-a-pr.md`. In place of step 2's rebase onto trunk, each child rebases onto its parent PR's branch, and the stack root rebases onto trunk. A new head on a lower PR restacks the PRs above it. A PR whose `git patch-id` is unchanged keeps its verdict under `playbooks/shipping.md`.

**Reply:** list each PR with its verdict, in place of what merged.
