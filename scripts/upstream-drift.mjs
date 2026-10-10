#!/usr/bin/env node

// Reports upstream commits made after the pins in profiles/upstreams.json. Only
// the paths mstack adapts are counted, so unrelated activity in a shared upstream
// repository does not read as drift.

import { appendFileSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const readProfile = (name) => JSON.parse(readFileSync(join(repoRoot, "profiles", name), "utf8"));
const upstreams = readProfile("upstreams.json");
const sources = readProfile("skill-sources.json");

const token = process.env.GITHUB_TOKEN ?? process.env.GH_TOKEN;

async function github(path) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      accept: "application/vnd.github+json",
      "user-agent": "mstack-upstream-drift",
      ...(token ? { authorization: `Bearer ${token}` } : {}),
    },
  });
  if (!response.ok) throw new Error(`GitHub ${response.status} for ${path}: ${(await response.text()).slice(0, 200)}`);
  return response.json();
}

function watchedPaths(name, treePath) {
  const adopted = Object.keys(sources[name]?.skills ?? {});
  if (adopted.length) return adopted;
  if (treePath) return [treePath];
  throw new Error(`profiles/upstreams.json entry ${name} names no path, and profiles/skill-sources.json lists no adopted skills for it`);
}

async function drift(name, { repository, commit }) {
  const match = /^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\/tree\/[^/]+\/(.+))?$/.exec(repository);
  if (!match) throw new Error(`Unsupported repository URL for ${name}: ${repository}`);
  const [, owner, repo, treePath] = match;
  const base = `/repos/${owner}/${repo}`;
  const pinned = await github(`${base}/commits/${commit}`);
  const since = pinned.commit.committer.date;

  const commits = new Map();
  for (const path of watchedPaths(name, treePath)) {
    const page = await github(`${base}/commits?path=${encodeURIComponent(path)}&since=${encodeURIComponent(since)}&per_page=100`);
    for (const entry of page) {
      if (entry.sha !== commit) commits.set(entry.sha, { ...entry, path });
    }
  }
  const sorted = [...commits.values()].sort((a, b) => a.commit.committer.date.localeCompare(b.commit.committer.date));
  return { name, slug: `${owner}/${repo}`, commit, since, commits: sorted };
}

function render({ name, slug, commit, since, commits }) {
  const lines = [`## ${name}`, "", `Pinned at \`${commit.slice(0, 7)}\` (${since.slice(0, 10)}) in \`${slug}\`.`];
  if (!commits.length) return [...lines, "No later commit touches the adapted paths.", ""].join("\n");
  lines.push(`${commits.length} later commit(s) touch the adapted paths:`, "");
  for (const { sha, commit: detail, path } of commits) {
    const subject = detail.message.split("\n")[0];
    lines.push(`- [\`${sha.slice(0, 7)}\`](https://github.com/${slug}/commit/${sha}) ${detail.committer.date.slice(0, 10)} ${subject} (\`${path}\`)`);
  }
  return [...lines, ""].join("\n");
}

const reports = [];
for (const [name, entry] of Object.entries(upstreams)) reports.push(await drift(name, entry));
const total = reports.reduce((sum, report) => sum + report.commits.length, 0);

console.log(reports.map(render).join("\n"));
if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, `drift=${total > 0}\n`);
