### Authoring or modifying a skill

**You own the skill's voice.**

1. Locate the skill and its owner. Preserve an existing path. For a new skill,
   use the active harness's discovered project skill root, or its user skill
   root when the user requested a personal skill. Read applicable local
   instructions. If a skill creator is listed in the harness catalog, read it;
   otherwise continue with the steps here. A skills-only mstack installation
   includes this playbook and does not require an extra authoring tool.
2. Draft `<name>/SKILL.md`. Use a lowercase kebab-case directory name and matching
   `name` frontmatter. Write `description` as one quoted YAML scalar with the
   task that should trigger it. Put the ordered workflow and a checkable
   completion condition in the body. Keep examples, scripts, and branch-specific
   instructions beside the skill and link them relative to `SKILL.md`. Preserve
   existing useful instructions when adapting a skill to another harness.
3. Review the description. Write two realistic requests that should select the
   skill and two nearby requests that should not. Check the description against
   each without reading the body. Name a missing trigger or remove an overly
   broad one, then check the examples again. Keep personal mode skills explicitly
   invoked unless the user requested automatic use. If the host can test actual
   discovery, run one positive and one negative case and record what happened.
4. Validate the draft. Check `name` and `description`, YAML quoting, linked files,
   and every referenced tool or command. Use a repository or harness validator
   when one is present. In an mstack source checkout, run
   `node scripts/validate.mjs` from its root and follow the repository's inventory
   and integrity baseline instructions. In an installed skill directory, perform
   these checks directly; do not assume the repository's `scripts/` exists.
   For a separately installed subset, resolve each sibling skill through the
   active catalog. Supply an inline fallback or report a missing dependency.
5. Exercise changed behavior. Run a bundled helper on disposable input, or walk
   through one realistic request and check that every step has an available
   action and an observable result. Test structural behavior when it has a cheap
   reproducible check. For subjective prose, review the draft with the user.
6. For repository-owned skills, run [Opening a PR](./opening-a-pr.md) within the
   user's authorized workflow. For a personal skill outside a repository,
   validate the local edit and report its path; do not invent a repository or
   publish personal conventions.

When in doubt, delete. Keep only prose that changes a decision. Tell it to do the thing and skip the reason. Explain only when the rule is confusing without one. Match tone to scope. Point at structural sources (types, READMEs, config) per the **encode-lessons-in-structure** principle skill. Delegate to other skills by path. Don't restate. A workflow you keep hitting but isn't captured → propose a new skill.

**Reply:** summary of the skill, key design decisions, validation notes.
