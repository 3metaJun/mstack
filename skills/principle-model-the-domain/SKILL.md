---
name: principle-model-the-domain
description: Replace scattered conditionals, synchronized booleans, repeated shape assumptions, and ad hoc mutations with a structure that directly represents the domain.
license: MIT
---

# Model the domain

Encode real domain rules in data structures instead of distributing them across
branches and files.

Consider:

- A state machine instead of synchronized booleans and lifecycle checks.
- A typed domain object instead of loose parameters and repeated assumptions.
- A registry, map, lookup table, or discriminated union instead of a growing
  conditional chain.
- A reducer or command/event model instead of ad hoc state mutation.
- A module organized around one body of domain knowledge instead of procedural
  phases such as load, validate, transform, and save.
- A queue, cache, index, graph, tree, or normalized collection when the access
  pattern calls for it.

Start with two questions: what must never be allowed, and how is the data read?
Choose the smallest structure that encodes those answers.

Do not force an abstraction when the existing code is clear, local, and stable.
An abstraction should remove branches, duplicate rules, invalid states, or
lifecycle risk. If it only adds indirection, keep the boring code.
