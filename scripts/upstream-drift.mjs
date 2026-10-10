#!/usr/bin/env node

// Reports upstream commits made after the pins in profiles/upstreams.json. Only
// the paths mstack adapts are counted, so unrelated activity in a shared upstream
// repository does not read as drift.

import { execFileSync } from "node:child_process";
import { appendFileSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

// The workflow finds its own issue by this marker, so it must stay in the report.
export const MARKER = "<!-- mstack-upstream-drift -->";

function git(args) {
  return execFileSync("git", args, { encoding: "utf8", maxBuffer: 64 * 1024 * 1024, windowsHide: true });
}

// Drift is ancestry, not time: a commit authored before the pin and merged after it
// still counts. `pin..HEAD` in a clone answers that exactly, where the commits API
// can only filter by date.
export function commitsSincePin(cloneSource, commit, paths) {
  const clone = mkdtempSync(join(tmpdir(), "mstack-upstream-drift-"));
  try {
    git(["clone", "--quiet", "--bare", "--filter=blob:none", cloneSource, clone]);
    const log = git(["-C", clone, "log", "--format=%H%x09%cs%x09%s", `${commit}..HEAD`, "--", ...paths]);
    const pinnedOn = git(["-C", clone, "show", "--no-patch", "--format=%cs", commit]).trim();
    const commits = log.split("\n").filter(Boolean).map((line) => {
      const [sha, date, ...subject] = line.split("\t");
      return { sha, date, subject: subject.join("\t") };
    });
    return { pinnedOn, commits: commits.reverse() };
  } finally {
    rmSync(clone, { recursive: true, force: true });
  }
}

function watchedPaths(name, treePath, sources) {
  const adopted = Object.keys(sources[name]?.skills ?? {});
  if (adopted.length) return adopted;
  if (treePath) return [treePath];
  throw new Error(`profiles/upstreams.json entry ${name} names no path, and profiles/skill-sources.json lists no adopted skills for it`);
}

function render({ name, slug, commit, pinnedOn, commits }) {
  const lines = [`## ${name}`, "", `Pinned at \`${commit.slice(0, 7)}\` (${pinnedOn}) in \`${slug}\`.`];
  if (!commits.length) return [...lines, "No later commit touches the adapted paths.", ""].join("\n");
  lines.push(`${commits.length} later commit(s) touch the adapted paths:`, "");
  for (const { sha, date, subject } of commits) {
    lines.push(`- [\`${sha.slice(0, 7)}\`](https://github.com/${slug}/commit/${sha}) ${date} ${subject}`);
  }
  return [...lines, ""].join("\n");
}

function main() {
  const readProfile = (name) => JSON.parse(readFileSync(join(repoRoot, "profiles", name), "utf8"));
  const sources = readProfile("skill-sources.json");
  const reports = Object.entries(readProfile("upstreams.json")).map(([name, { repository, commit }]) => {
    const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\/tree\/[^/]+\/(.+))?$/.exec(repository);
    if (!match) throw new Error(`Unsupported repository URL for ${name}: ${repository}`);
    const [, owner, repo, treePath] = match;
    const slug = `${owner}/${repo}`;
    return { name, slug, commit, ...commitsSincePin(`https://github.com/${slug}.git`, commit, watchedPaths(name, treePath, sources)) };
  });
  const total = reports.reduce((sum, report) => sum + report.commits.length, 0);
  console.log([MARKER, "", ...reports.map(render)].join("\n"));
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `drift=${total > 0}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) main();
