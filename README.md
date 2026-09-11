# mstack

[![CI](https://github.com/3metaJun/mstack/actions/workflows/validate.yml/badge.svg?branch=main)](https://github.com/3metaJun/mstack/actions/workflows/validate.yml)
[![npm version](https://img.shields.io/npm/v/%403metajun%2Fmstack?logo=npm&logoColor=white)](https://www.npmjs.com/package/@3metajun/mstack)

mstack packages portable engineering skills for Codex, Claude Code, OpenCode,
and pi. One canonical `skills/` tree feeds every supported harness. The
installer adapts harness metadata at install time, so skill instructions do not
contain harness-specific paths or commands.

![mstack portable engineering skills across Codex, Claude Code, OpenCode, and pi](https://raw.githubusercontent.com/3metaJun/mstack/main/.github/assets/social-preview.png)

The collection started with selected workflows from
[`pstack`](https://github.com/cursor/plugins/tree/main/pstack/skills) and
[`mattpocock/skills`](https://github.com/mattpocock/skills). Source and license
records live in [`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md).

## Install skills

Node.js 18 or newer is required.

To install every skill for every supported harness, run:

```bash
npx @3metajun/mstack --harness all
```

To install skills for selected harnesses, list them with commas:

```bash
npx @3metajun/mstack --harness codex,claude
npx @3metajun/mstack --harness opencode,pi
```

To install selected skills, add `--skill`:

```bash
npx @3metajun/mstack --harness all \
  --skill writing-for-agents,codebase-design,diagnosing-bugs
```

The installer preserves an existing skill directory. Use `--dry-run` to inspect
the plan. Use `--replace` to move existing directories into a timestamped
`.harness-skills-backups/` directory under the replaced target's parent. Skill
backups therefore stay inside that Harness's `skills/` directory, and custom
artifact backups stay beside the artifact target. mstack retains backups until
you inspect and remove them.

## Install optional artifacts

The same installer can copy the portable artifacts that accompany the skills.
By default it installs skills only. Select artifacts explicitly, or use
`--no-skills` when an artifact-only install is needed:

```bash
npx @3metajun/mstack --harness codex --artifact agents,meta-mode-tools
npx @3metajun/mstack --harness all --no-skills --artifact all
```

The available installable artifacts are:

| Artifact | Default destination |
| --- | --- |
| `agents` | Codex: `$CODEX_HOME/agents/` as TOML; other harnesses: `agents/` beside `skills/` as Markdown |
| `meta-mode-tools` | `tools/meta-mode/` beside `skills/` |
| `guide` | `docs/guide/` beside `skills/` |

Codex skills default to `~/.agents/skills/`, while Codex agents default to
`~/.codex/agents/`. An unset or empty `CODEX_HOME` uses `~/.codex`.
`HARNESS_SKILLS_CODEX_DIR` relocates skills only; agents follow `CODEX_HOME`
unless an artifact override is supplied. Codex TOML and Markdown agents must
use separate target directories. Shared targets are allowed only when the
artifact source and output format match.

For SSH installs, both `/home/dev/.agents/skills` and
`/home/dev/.codex/skills` map agents to `/home/dev/.codex/agents`.
For a custom remote layout or remote `CODEX_HOME`, set
`artifacts.agents.codex` to that remote agent directory. The installer cannot
infer a remote home from an arbitrary skill path or the local `CODEX_HOME`.

Artifact destinations can be overridden per harness with
`MSTACK_ARTIFACT_<ARTIFACT>_<HARNESS>_DIR`, for example
`MSTACK_ARTIFACT_AGENTS_CODEX_DIR`. Named environments can provide the same
overrides in either shape below (artifact-first is the documented form):

```json
{
  "fleet": {
    "targets": {
      "codex": "C:\\path\\to\\Fleet\\codex\\skills"
    },
    "artifacts": {
      "agents": {
        "codex": "C:\\path\\to\\Fleet\\codex\\agents"
      }
    }
  }
}
```

`benny` is intentionally listed in `profiles/artifacts.json` as a
Cursor-only source and is rejected by the cross-harness installer. It must be
reviewed and copied into a project repository's committed
`.cursor/automations/benny/` directory using its own setup instructions.
mstack does not ship portable `commands/`, `hooks/`, or `settings/` trees:
those are harness- and project-owned configuration surfaces and must be
written or merged explicitly by the user.

## Choose installation directories

The default directories are defined in
[`profiles/harnesses.json`](./profiles/harnesses.json):

| Harness | Default directory | Override |
| --- | --- | --- |
| Codex | `~/.agents/skills/` | `HARNESS_SKILLS_CODEX_DIR` |
| Claude Code | `~/.claude/skills/` | `HARNESS_SKILLS_CLAUDE_DIR` |
| OpenCode | `~/.config/opencode/skills/` | `HARNESS_SKILLS_OPENCODE_DIR` |
| pi | `~/.pi/agent/skills/` | `HARNESS_SKILLS_PI_DIR` |

Set an override to install into a mounted Fleet directory or another local
path. The path must be absolute or start with `~/`.

```powershell
$env:HARNESS_SKILLS_OPENCODE_DIR = 'C:\path\to\fleet\opencode\skills'
npx @3metajun/mstack --harness opencode
```

For named local or mounted environments, copy
[`profiles/environments.example.json`](./profiles/environments.example.json) to
`~/.config/mstack/environments.json`, replace the paths, and pass the name:

```bash
npx @3metajun/mstack --harness opencode --environment fleet
```

Set `MSTACK_ENVIRONMENTS_FILE` to use another environment file. Each target must
be an absolute path or start with `~/` for local environments.

For a Tailscale, VPS, or Mac mini target, use an SSH environment. The machine
running mstack must have Node.js, `ssh`, and `rsync`. The target must expose a
POSIX shell and `rsync`; it needs the selected Harness CLI only when roles or
live smoke tests will run there:

```json
{
  "fleet-ssh": {
    "transport": "ssh",
    "host": "dev@tailnet-host",
    "shell": "posix",
    "targets": {
      "opencode": "/home/dev/.config/opencode/skills"
    }
  }
}
```

Put identity and connection options in the SSH host alias when possible. If an
environment supplies them directly, configure both transports because `rsync`
starts its own SSH process and does not reuse `sshArgs`:

```json
{
  "sshArgs": ["-i", "/home/dev/.ssh/id_ecdsa.pem"],
  "rsyncArgs": ["-e", "ssh -i /home/dev/.ssh/id_ecdsa.pem"]
}
```

The same `npx @3metajun/mstack --harness opencode --environment fleet-ssh`
command stages
locally, transfers with `rsync`, takes a remote lock, and moves each selected
directory into place. Add `--dry-run` to print the remote plan without opening
an SSH connection. Windows remotes can still be used through a mounted path;
remote installation currently targets POSIX shells.

Remote lock directories record a timestamped owner. After an interrupted
install, inspect `<target-parent>/.mstack.install.lock/owner`, verify that no
install is running, remove the lock directory, and retry.

The SSH/rsync path has been verified end to end against a disposable POSIX
target, including remote locking, atomic installation, checksum comparison,
and cleanup.

## Run a configured role

`run-role` turns a configured role into the selected Harness command. Without
`--execute` it only prints the plan:

```bash
npm run run-role -- --harness opencode --role explorer \
  --prompt "Inspect the repository and do not edit files" \
  --environment fleet-ssh --model auto
```

Add `--execute` to run the command. SSH environments pass the prompt through
strict POSIX quoting or a PowerShell encoded command, depending on `shell`.

Model roles live in `~/.config/mstack/models.json`. Each role accepts a model
string. The `reviewer` role also accepts a non-empty list of unique model strings.
A Harness override replaces the role's whole value. Use `/setup-mstack` to choose
names reported by your Harness; existing string configurations remain valid.

`inherit-parent` requests the current chat model. Native delegation can use its
documented inheritance mechanism, but `run-role` starts a new CLI process and
requires `--parent-model <known-parent-model>` for that value. `auto` omits the
model argument and selects the CLI's default, which may be different. Existing
CLI calls that used `inherit-parent` must add `--parent-model`, or explicitly
choose `--model auto`. With no configuration file, the seven roles default to
`inherit-parent`, so the same choice is required.

For a configured reviewer list, select one entry with `--model-index 0` or run
all entries concurrently:

```bash
npm run run-role -- --harness codex --role reviewer \
  --file ~/.config/mstack/models.json --prompt "Review this diff" \
  --all-models --read-only --execute
```

Replace `roles.reviewer` or `overrides.codex.reviewer` with a JSON array of the
model names you selected. Add `--parent-model <known-parent-model>` if an entry
is `inherit-parent`. Without `--execute`, fanout prints a JSON array of plans.
Execution returns a JSON array with each model's `stdout`, `stderr`, and `status`,
in configuration order. A string role used with `--all-models` returns the same
array shape with one entry. Any failure makes the overall exit code nonzero. Output
is buffered up to 16 MiB per stream per worker; larger output fails that worker.
`--all-models` requires `--read-only`. Writable workers need individual launches
with separate worktrees. Review the Harness's read-only limits below.

## Smoke test Harnesses

Check CLI availability and installed skill files after installation:

```bash
npm run smoke-harnesses -- --harness all --require-installed
```

Add `--execute` for a live prompt on every available Harness. It uses the CLI
default model unless you supply `--model`, `--parent-model`, or a `--file` with
model choices. An inherited role in that file needs `--parent-model`. The live
prompt checks a reply marker; it does not prove that the Harness loaded the skill
or completed its workflow. These live calls always use `--read-only`.
Codex, Claude Code, and pi use CLI-enforced tool restrictions.
OpenCode selects its built-in `plan` agent, which denies direct edits but still
allows shell commands in OpenCode 1.18; use a disposable checkout when its
prompt-only write boundary is insufficient. A live check also needs that
Harness's credentials and configured model access.

The Claude live path was verified with Claude Code 2.1.267, the Kiro-Pro
configuration, and `claude-haiku-4-5-20251001`. The check required Claude
Code's native `Skill` tool to invoke `meta-mode` and return an exact marker;
the remote fixture and temporary credentials were removed afterward.

## Recover recent context

`recall` includes a history reader in `recall/scripts/history.mjs`; it also works
when only the skill directory is installed. List session metadata for the active
workspace before selecting a session to read:

```bash
node <recall-directory>/scripts/history.mjs list --harness codex --workspace <workspace> --exclude <current-session-id>
node <recall-directory>/scripts/history.mjs read --harness codex --workspace <workspace> --session <session-id> --query parser
```

The reader supports Codex, Claude Code, OpenCode, and pi, with configured storage
roots, session exclusions, branch selection where available, and bounded text
output. OpenCode exports are sanitized by default; explicitly use `--local-text`
for private local recovery because sanitization can remove all message text.
See [history sources](./skills/recall/references/history-sources.md) for supported
formats and limits. Tests use disposable sessions; no user transcript is bundled.

The [authoring playbook](./skills/meta-mode/playbooks/authoring-a-skill.md) gives
`automate-me` and `reflect` a concrete draft, description review, and validation
workflow even when no native skill creator or repository validator is installed.

## Repository layout

- `skills/` contains the canonical, harness-neutral skill files.
- `adapters/` contains per-harness frontmatter changes.
- `profiles/harnesses.json` defines supported harnesses and default paths.
- `docs/harness-adapters.md` records the official skill and session rules used
  by each Harness adapter.
- `profiles/artifacts.json` defines optional artifacts and documents unsupported
  harness-owned surfaces.
- `profiles/skills.json` defines the canonical skill inventory.
- `profiles/upstreams.json` records source commits and renamed entries.
- `profiles/models.example.json` gives model-role configuration a portable
  shape without forcing a provider.
- `agents/` contains portable routing and comment-review agents.
- `automations/benny/` keeps the optional Cursor automation pack from pstack.
- `docs/guide/` contains the adapted upstream workflow guide.
- `tools/meta-mode/` contains the optional Bun orchestration and PR watcher
  tools.
- `scripts/install.mjs` stages, validates, and commits an installation.
- `scripts/remote-install.mjs` stages and transfers an SSH environment install.
- `scripts/validate.mjs` checks inventory, frontmatter, links, and portability.
- `.codex-plugin/` packages the same skill tree for Codex.

The installer stages every selected skill, applies its adapter, validates the
result, and then renames the staged directory into place. It uses a lock per
target directory and restores backups if a commit fails.

## Included skills

The current bundle contains 50 skills. It includes the 47 entries in the
portable pstack tree and three skills adapted from `mattpocock/skills`:

- Engineering principles for boundaries, domain modelling, idempotence,
  verification, sequencing, and type safety.
- Workflows for diagnosis, design review, context recovery, TDD, and agent
  instruction writing.
- `create-verification-skill` for generating a project-specific verification
  workflow.
- `meta-mode` for routing a multi-step task through the capabilities available
  in the current harness.

The bundle includes the pstack workflow and principle names. `meta-mode` is the
portable replacement for pstack's `poteto-mode`; it describes capabilities and
uses the current harness's adapter instead of naming one vendor's commands.

Run `node scripts/validate.mjs` to print the validated skill count.

To validate and print a user's model configuration, run:

```bash
npm run check-models -- --file ~/.config/mstack/models.json
```

To check the complete skill trees against both pinned upstreams, run:

```bash
npm run skill-baseline -- --check --source /path/to/pstack --matt-source /path/to/mattpocock-skills
```

This checks every file in all 50 skill trees, including references, playbooks,
and scripts. It also checks tools moved out of skill directories. Local
additions and intentional upstream omissions are recorded explicitly. Both
source checkouts must be clean and at their pinned commits. `npm test` checks
the target files without needing upstream checkouts.

For intentional changes, preview with the same source arguments and `--diff`,
review the source-to-adaptation patches, then use `--write` to update
`profiles/skill-manifest.json`. Commit the baseline with the corresponding
content changes. The hashes detect drift; they do not establish that an adapted
workflow behaves like its source. See [the baseline review process](docs/skill-integrity.md).

To compare the pstack inventory and non-skill artifacts, run:

```bash
npm run check-upstream -- --source /path/to/pstack
```

The check applies the renames in `profiles/upstreams.json`, verifies the
reviewed body digest for every canonical pstack skill, reports the portable
skill count, and reports the state of the agents, Benny automation, guide, and
meta-mode tools. Add `--strict` to fail when a canonical skill body or
configured artifact is missing, differs, or remains after removal upstream.
Strict mode requires the source to be a clean Git checkout whose `HEAD` exactly
matches the pinned commit. If you intentionally edit a canonical skill, update
its reviewed target digest in `canonicalSkills` as part of that review; sync
preserves these entries and does not silently re baseline them.

To preview and apply a transformed refresh of those non-skill artifacts:

```bash
npm run sync-upstream -- --source /path/to/pstack
npm run sync-upstream -- --source /path/to/pstack --apply
```

The sync command is dry-run by default. It transforms pstack and poteto names
to mstack and meta names, preserves adapted agents, and refuses to overwrite
changed source-managed files. `--apply` requires the same clean, pinned source
checkout as strict checking. It removes files deleted upstream only when their
content still matches the previous manifest. Pass `--apply --force` after
reviewing a diff when overwriting or removing a locally changed file is
intentional.

All sync commands use one exclusive lock per target, so concurrent `--apply`,
dry-run, and `check-upstream` commands are serialized. The lock records the
host, platform, and process start identity. A lock from another runtime (for
example Windows versus WSL), or one whose owner cannot be verified, is left in
place and the command explains how to inspect and remove it after confirming
that no sync is running.

Writes and removals are staged and journaled before the target is changed; an
ordinary failure rolls the whole refresh back. If the process is interrupted,
the next `--apply` recovers the unfinished transaction before rebuilding the
sync plan. If a user changed a target during an unfinished rollback, mstack
moves that file to `.mstack-sync-upstream/recovery/<transaction>/<index>.user`
and restores the previous version; the command prints both paths. A
`COMMITTED` marker is authoritative, so later user edits are preserved while
transaction sidecars are cleaned up. Dry runs and `check-upstream` refuse to
inspect a target while a sync is active or needs recovery.

On Windows, directory fsync is best-effort because Node cannot portably flush a
directory handle. The transaction provides process-crash recovery, but it does
not provide a power-loss durability guarantee on that platform. Readers that
ignore the sync lock can still observe files changing during the commit.

`--apply` writes `profiles/upstream-manifest.json`. Its artifact hashes describe
the transformed upstream baseline, while `canonicalSkills` records the pinned
source body and reviewed target body for each canonical skill. Files configured with
`compareContent: false`, including the adapted agents, may intentionally differ
from those hashes. A different checkout can be used as the destination with
`--target /path/to/mstack`.

## Verify changes

Run the complete local check before you commit:

```bash
npm test
```

The check validates the canonical tree and runs installer, context, upstream
sync, runtime, and environment tests.

## Add a skill

1. Add `skills/<name>/SKILL.md` with `name` and `description` frontmatter.
2. Keep the main file portable. Put harness-specific paths and commands in a
   reference file.
3. Add the skill name to `profiles/skills.json`.
4. Add adapter metadata only when a harness needs it.
5. Run `npm test` and verify discovery in at least one supported harness.

Use the same name for a skill in the canonical tree, adapters, tests, and docs.
This keeps installation and validation data-driven.

## License

mstack is released under the MIT License. See
[`THIRD_PARTY_NOTICES.md`](./THIRD_PARTY_NOTICES.md) for upstream licenses and
source revisions.
