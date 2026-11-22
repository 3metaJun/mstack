### Session pickup

**You own the resume point. Read the prior trail, don't redo it.**

1. Locate the prior trail. First read the latest published checkpoint with `node "<meta-mode-tools>/resume.mjs" read --project .`, then follow its note and artifact paths. If `filesOk` is false or it warns that a file is changed or missing, treat that file as stale and say so. If none exists, use the active workspace's history adapter (a host that keeps its own thread history has a file under `../references/hosts/`; read it first), a remote-run URL, or a pushed branch. Read the metadata overview and last messages first, then scan back for the decision points. Parse a long transcript in a worker and keep the reduced timeline in the main thread (the **principle-guard-the-context-window** skill).
2. Reconstruct operational state. The branch and worktree, what already landed (`git log`, `git diff` against the base), the open todos, the decisions made. Use the prior trail to recover progress instead of re-deriving it. For claims about human rulings, find the person's original attributable words when the exact scope matters, with a source pointer and the speaker. An agent summary is not the original ruling, and copies of one summary in several notes are one evidence chain.
3. Diff done vs pending. Compare what shipped against what was planned, name the resume point, do not re-run the prior repro or redo completed work. Read artifacts linked by the resume note, including requested questions or checklists.
4. Verify the inherited claims against the original goal on the real artifact (the **principle-prove-it-works** skill). A passing prior self-report is not the proof.
5. Route the remaining work to the matching playbook and pick the verdict: continue the execution, ship a finished recommendation, ratify or override a prior conclusion, or postmortem a failed run. The pickup playbook ends here. The routed playbook owns the rest.

**Reply:** where the prior agent stopped, what you inherited vs redid (ideally nothing redone), the resume point, and the outcome.
