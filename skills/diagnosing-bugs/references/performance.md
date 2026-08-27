# Performance regressions

Measure the user-visible symptom before optimizing. Record workload, data size,
environment, warmup state, number of runs, and an appropriate distribution or
percentile instead of one convenient timing.

Use the tool that observes the suspected resource:

- CPU profile for compute or excessive call frequency.
- Allocation or heap profile for memory growth and garbage collection.
- Query plan and database timing for data access.
- Trace or network timing for distributed latency.
- Rendering and frame data for UI responsiveness.
- Automated bisection when two known states bound the regression.

Change one cause at a time and rerun the same workload. Compare against noise
and normal variance. After the focused measurement improves, verify the
original user scenario and check that throughput, memory, correctness, or tail
latency did not regress elsewhere.
