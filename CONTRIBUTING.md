# Contributing

Contributions should make a workflow more useful without binding it to one
agent harness.

## Checklist

- Keep one canonical skill under `skills/<name>/`.
- Use only portable frontmatter fields: `name`, `description`, `license`,
  `compatibility`, and string-valued `metadata`.
- Put harness-specific paths and commands in a dedicated reference.
- Put harness-specific runtime requirements in `adapters/<harness>.json`, never
  in the skill body.
- Do not assume a particular delegation API, browser controller, shell, or
  transcript format in the main workflow.
- Keep scripts deterministic, rerunnable, and cross-platform when practical.
- Do not include credentials, private transcripts, machine-specific paths, or
  generated audit data.
- Run `npm test` before opening a pull request.

If a skill is adapted from another project, add its source and license to
`THIRD_PARTY_NOTICES.md`.

## Releases

Every npm version needs a GitHub Release. A release pull request sets the
version in `package.json` and both plugin manifests and adds a
`## <version> - <date>` section to `CHANGELOG.md`. When it merges, the `release`
workflow runs `npm test` and creates the `v<version>` release from that section.
It warns while the version is missing from npm; publishing stays a manual step.

## Upstream pins

`npm run upstream-drift` lists upstream commits that touch the adapted paths
after the pins in `profiles/upstreams.json`. The `upstream-drift` workflow runs
it weekly and keeps one "Upstream drift report" issue current. Set `GH_TOKEN`
locally to avoid GitHub's anonymous rate limit.
