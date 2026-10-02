---
name: show-me-your-work
description: Keep a reviewable, append-only TSV decision trail for long-running, unattended, multi-agent, or multi-phase work. Use when a human will review important choices and evidence after stepping away.
license: MIT
metadata:
  requirements: Node.js 18 or newer for scripts/log.mjs
---

# Show me your work

Keep one canonical decision log so a reviewer can reconstruct what changed,
why, what evidence supported it, and what happened without reading the complete
conversation.

## Format

Resolve `<skill-dir>` as the directory containing this loaded `SKILL.md`, then
copy `<skill-dir>/references/decision-log-template.tsv`. Use one single-line
row per decision with these columns:

- `ts`: UTC ISO 8601 timestamp.
- `phase`: Phase or workstream.
- `decision`: Concrete choice or checkpoint.
- `why`: Plain-language reason.
- `evidence`: Commit, pull request, `file:line`, artifact, trace, or screenshot.
- `result`: Observable result such as `tests green`, `reverted`, `open`, or
  `INCONCLUSIVE`.

Append rows with:

```bash
node "<skill-dir>/scripts/log.mjs" <logfile> <phase> <decision> <why> <evidence> <result>
```

The helper creates the header, removes tabs and newlines from cells, and guards
spreadsheet formula prefixes.

## What to log

The coordinator is the sole log writer. Delegates return proposed rows and
evidence to the coordinator instead of appending concurrently. Log forks,
pivots, completed units with verification, reverts, blockers, and gates. For
repeated work, log one row per meaningful iteration. Skip routine commands and
narration.

Keep the log local at `decisions.tsv` or `.audit/<task>.tsv` by default. Commit
it only when the work is large enough that the review trail is part of the
deliverable, such as a major migration or cross-language port.

## Rules

- Append only. Correct a wrong decision with a later row that supersedes it.
- Evidence is a resolvable pointer, not an argument.
- Use plain language. Avoid agent jargon and vague claims.
- Prefer evidence made by committed, rerunnable scripts.
- Never place credentials, raw private messages, or sensitive payloads in a row.

## Run boundaries

A run is one agent conversation, including later turns and summaries. A pickup,
replacement agent, or new chat starts a new run. Keep the coordinator as the
sole writer; transfer that ownership before another run appends.

When appending to a log with existing rows, first append a row with phase
`start`. Its decision names the timestamp range of preceding rows this run did
not write; its evidence identifies the current run, such as an agent ID or
session pointer. Reserve `start` for this purpose. Before appending in a later
turn, read the last rows. If another run wrote a `start` row since this run's
last entry, append a new `start` row before continuing.

## Audit before handoff

Audit only this run's stretches. Each starts at its `start` row, or the first
row if this run created the log, and ends at another run's next `start` row.
Compare those rows with the current run's interaction trace. Use the active
harness's current-session API or transcript pointer when exposed. If the
harness does not expose the current session, compare against the commands,
messages, diffs, and artifacts still present in the current context, and mark
the transcript portion unavailable:

1. Confirm every row in this run's stretches maps to a real decision or action.
2. Resolve every evidence pointer and verify its claim.
3. Add omitted pivots or abandoned approaches that affected the outcome.
4. Correct invented, padded, or inaccurate rows by appending a superseding row
   with the actual outcome and a resolvable pointer. The audit preserves history.

Do not audit other runs' rows as your own. If this run's work proves an earlier
row wrong, append a correction with the evidence.

When an independent reviewer or subagent is available, ask it to inspect the
trail and artifacts for weak evidence, skipped verification, risky choices, and
important omissions. Verify its findings before reporting them. End the final
handoff with an `Attention` section only when that review found something the
user should scrutinize.
