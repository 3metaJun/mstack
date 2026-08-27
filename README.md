# Harness Skills

Portable, evidence-first engineering skills for Codex, Claude Code, and
OpenCode. One canonical `skills/` tree feeds all three harnesses, so a fix or
improvement does not drift across copies. The canonical frontmatter is valid
for Codex plugins; small adapter manifests transform harness-specific metadata
during installation without placing runtime conditions in a skill body.

This initial collection ports 15 high-value workflows from
[`pstack`](https://github.com/cursor/plugins/tree/main/pstack/skills). Cursor-only
paths, commands, transcript locations, and delegation assumptions have been
replaced with capability-based instructions and harness-specific references.

## Install

Node.js 18 or newer is required for the installer.

```bash
git clone https://github.com/3metaJun/harness-skills.git
cd harness-skills
node scripts/install.mjs --harness all
```

Install only one target:

```bash
node scripts/install.mjs --harness codex
node scripts/install.mjs --harness claude
node scripts/install.mjs --harness opencode
```

The installer never overwrites an existing skill by default. Use `--dry-run`
to preview. Use `--replace` only when you want to replace matching skills; the
installer first moves old copies into `.harness-skills-backups/` beside the
target skills directory. Backups can contain private skill instructions, so
review their retention and permissions like any other local configuration.

Default user-level destinations:

| Harness | Destination |
| --- | --- |
| Codex | `~/.agents/skills/` |
| Claude Code | `~/.claude/skills/` or `$CLAUDE_CONFIG_DIR/skills/` |
| OpenCode | `~/.config/opencode/skills/` or `$XDG_CONFIG_HOME/opencode/skills/` |

For testing or nonstandard layouts, set an absolute
`HARNESS_SKILLS_CODEX_DIR`, `HARNESS_SKILLS_CLAUDE_DIR`, or
`HARNESS_SKILLS_OPENCODE_DIR`.

Restart a harness after first creating its skills directory. OpenCode users can
verify discovery with `opencode debug skill`.

## Included skills

| Skill | Purpose |
| --- | --- |
| `create-verification-skill` | Generate a project-local way to drive and prove the real app. |
| `blast-radius` | Trace effects beyond a diff and prove the safety-critical fact. |
| `principle-make-operations-idempotent` | Make retries and partial runs converge safely. |
| `principle-prove-it-works` | Verify the real artifact before declaring success. |
| `principle-separate-before-serializing-shared-state` | Remove shared writes before reaching for locks. |
| `principle-fix-root-causes` | Reproduce, trace, and fix causes instead of symptoms. |
| `principle-type-system-discipline` | Model invariants so invalid states do not compile. |
| `principle-sequence-verifiable-units` | Deliver multi-step work as small, checked units. |
| `recall` | Reconstruct recent work from harness history and live state. |
| `show-me-your-work` | Keep an append-only, reviewable decision trail. |
| `principle-model-the-domain` | Replace scattered branches with domain-shaped structures. |
| `tdd` | Use a failing test first when the test path is cheap and clear. |
| `typescript-best-practices` | Apply strict, modern TypeScript patterns. |
| `principle-boundary-discipline` | Validate at boundaries and keep the core typed and pure. |
| `principle-build-the-lever` | Build a rerunnable tool for non-trivial work. |

## Repository contract

- `skills/` is canonical and follows the Agent Skills `SKILL.md` layout.
- `adapters/` contains frontmatter differences that belong to a harness rather
  than the skill's runtime context.
- `.codex-plugin/plugin.json` packages the same tree as a Codex plugin.
- `scripts/install.mjs` installs the canonical tree into user-level harness paths.
- `scripts/validate.mjs` checks the inventory, frontmatter, references, and
  Cursor-specific dependency regressions.

Run validation before contributing:

```bash
npm test
```

Keep contributions portable. Describe capabilities such as "browser driver",
"delegation mechanism", or "session history" and put concrete harness mappings
in a reference file when they differ.

## Adding a skill

1. Add `skills/<name>/SKILL.md` with `name` and a specific `description`.
2. Keep the main instructions short. Put detailed examples or harness mappings
   under `references/`.
3. Prefer portable Node.js helpers for scripts needed on Windows, macOS, and Linux.
4. Add the name to `EXPECTED_SKILLS` in `scripts/validate.mjs`.
5. Run `npm test`, then test discovery in at least one harness.

## License and provenance

MIT. See [THIRD_PARTY_NOTICES.md](./THIRD_PARTY_NOTICES.md) for upstream
provenance and the pinned source revision.
