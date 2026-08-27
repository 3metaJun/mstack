# Comparing interface designs

Explore alternatives only when interface shape has lasting architectural cost.
For a small local refactor, choose the simplest adequate design directly.

Frame the fixed constraints first: callers, invariants, dependency categories,
failure modes, and performance requirements. Then produce genuinely different
designs rather than cosmetic naming variants. Useful perspectives include:

- The smallest interface that maximizes depth.
- An interface optimized for the most common caller.
- A more extensible interface when concrete future variants already exist.
- A ports-and-adapters design when an owned or external remote dependency sets
  the seam.

For each design, show the interface, one realistic call site, hidden
responsibilities, dependency strategy, and known tradeoffs. Compare depth,
locality, invalid states, error handling, and migration cost. Recommend one
design or a specific hybrid.

Use parallel agents only when independent designs add useful breadth and the
task warrants multi-agent work. Give each agent file paths, constraints, and a
different design objective. Keep file ownership separate if they produce
artifacts.
