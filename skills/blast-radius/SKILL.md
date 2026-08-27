---
name: blast-radius
description: Find what a change could break beyond its diff, then prove the one or two safety-critical facts by running real code. Use for change-risk analysis, suspicious small diffs, migrations, or requests such as "what could this break?"
license: MIT
---

# Blast radius

Find effects that a symbol search alone will miss. A convincing write-up is not
proof, so reduce the analysis to the facts on which safety depends and execute
the cheapest real checks for those facts.

## Evidence ladder

For each safety-critical fact, get as far down this ladder as is practical and
state where the evidence stops:

1. Hypothesis only.
2. Source evidence with an exact file and line.
3. A traced failure path showing the bad case cannot reach the change.
4. A script or test that calls the real shipped code and fails loudly if wrong.
5. Reproduction in the running application.

Treat anything below level 4 as unproven unless the user accepts a lower bar.

## Workflow

1. Read the complete diff and identify changed behavior, including implicit
   behavior caused by deletions, reordered work, or changed defaults.
2. State the one or two facts that make the change safe. Focus effort there.
3. Trace beyond direct callers: pinned dependency source, local patches,
   teardown timing, serialization, APIs, schemas, databases, feature flags,
   other languages, and downstream consumers.
4. Classify each risk by concrete failure mode, likelihood, and impact. Cite
   exact evidence and list cleared risks separately.
5. Write and run the smallest script or test that proves each important fact.
   Use the real dependency and configuration where practical.
6. For genuinely broad changes, use independent parallel reviewers if the host
   supports delegation, then verify their claims yourself.

## Output

- **Change:** What behavior changed beyond the obvious diff.
- **Safety-critical fact:** The claim, evidence level, and executed proof or
  the word `unproven`.
- **Confirmed risks:** Failure mode, location, likelihood, impact, and check.
- **Cleared risks:** What was investigated and why it is safe.
- **Before merge:** The cheapest rerunnable proof that catches the real bug.

Strip private data before placing any result in a public issue or pull request.
