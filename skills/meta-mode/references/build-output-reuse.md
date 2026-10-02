# Reuse a verification lane after a non-runtime patch change

Use this procedure only when the patch changed in tests, docs, or lint config.
Any other patch change requires fresh verification. File extensions alone do
not establish eligibility; a documentation file or configuration consumed at
runtime is a runtime change.

1. Record the lane's verdict head SHA, current head SHA, compared patch IDs,
   build command, environment, and the saved output that the lane exercised.
2. If the lane ran a dev server or has no saved build output, rerun the lane.
   A build produced after verification cannot establish what that lane tested.
3. Build the lane's artifact twice at the verdict SHA and once at the current
   head. Use isolated output directories, matching dependencies, inputs, and
   environment. Keep the original verified artifact and all three build outputs.
4. Compare each difference between verdict and current output against the two
   verdict builds. A difference is noise only when those verdict builds also
   exhibit that difference, or when it is an embedded commit SHA. Evaluate
   differences within files, not whether a whole file differs.
5. Record every accepted kind of noise with its files and comparison evidence.
   A substantive change inside a file with noisy timestamps is still a change.
   Unexplained differences, missing artifacts, or an inconclusive comparison
   require rerunning that lane.
6. If only documented noise differs, retain that lane's result. Run current-head
   checks and a fresh review of the changed tests, docs, or lint config. Reuse
   does not carry forward old CI, mergeability, or review results.
7. Report retained and rerun lanes separately, with their verdict and current
   SHAs. A missing lane remains a gap, not a passing verdict.

This procedure ports pstack's shipping exception without treating a matching
build as authorization to merge. The execution playbook and operator gates
still determine who can land the PR.
