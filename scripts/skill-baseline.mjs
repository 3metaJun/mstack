import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { baselineChanges, buildBaseline, checkLocalBaseline, inside } from "./skill-baseline-lib.mjs";
import { acquireUpstreamSyncLock, assertUpstreamSyncTargetReadable, releaseUpstreamSyncLock } from "./sync-upstream-transaction.mjs";

const args = process.argv.slice(2);
const options = {};
for (let index = 0; index < args.length; index++) {
  const flag = args[index];
  if (["--check", "--diff", "--write", "--help"].includes(flag)) options[flag] = true;
  else if (["--source", "--matt-source", "--target"].includes(flag)) {
    const value = args[++index];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    options[flag] = value;
  } else throw new Error(`Unknown argument: ${flag}`);
}
if (options["--help"]) {
  console.log("Usage: node scripts/skill-baseline.mjs [--target <mstack>] [--source <pstack>] [--matt-source <mattpocock/skills>] [--check | --diff | --write]\n\n" +
    "--check validates every local skill file. With both sources it also verifies provenance and mappings.\n" +
    "The default previews baseline changes; --diff prints upstream-to-adaptation patches for review.\n" +
    "--write records the reviewed baseline. Preview, diff and write require both clean pinned source checkouts.");
  process.exit(0);
}
if (["--check", "--diff", "--write"].filter((flag) => options[flag]).length > 1) throw new Error("Choose only one of --check, --diff, or --write");
const root = resolve(options["--target"] ?? resolve(dirname(fileURLToPath(import.meta.url)), ".."));
const sourceRoots = {
  pstack: options["--source"] ?? process.env.MSTACK_PSTACK_SOURCE,
  "mattpocock/skills": options["--matt-source"] ?? process.env.MSTACK_MATT_SOURCE,
};
const lock = acquireUpstreamSyncLock(root, { recoverStale: false });
try {
  assertUpstreamSyncTargetReadable(root, lock);
  const path = "profiles/skill-manifest.json";
  const previous = existsSync(inside(root, path)) ? JSON.parse(readFileSync(inside(root, path), "utf8")) : undefined;
  if (options["--check"] && !previous) throw new Error(`Missing skill baseline: ${path}`);
  let problems = previous ? checkLocalBaseline(root, previous) : [];
  let next;
  if (!options["--check"] || Object.values(sourceRoots).some(Boolean)) {
    next = buildBaseline(root, sourceRoots);
    const changes = baselineChanges(previous, next);
    for (const change of changes) console.log(change);
    if (options["--check"]) problems.push(...changes);
    console.log(`${Object.keys(next.files).length} tracked files, ${Object.keys(next.omitted).length} explicit omissions, ${changes.length} baseline changes.`);
  }
  if (options["--diff"]) {
    for (const [target, entry] of Object.entries(next.files)) {
      if (entry.upstream === null) {
        console.log(`\nLocal addition: ${target}\n${readFileSync(inside(root, target), "utf8")}`);
        continue;
      }
      if (entry.sourceDigest === entry.targetDigest) continue;
      console.log(`\nAdaptation: ${entry.upstream}:${entry.source} -> ${target}${entry.reason ? `\n${entry.reason}` : ""}`);
      const result = spawnSync("git", ["diff", "--no-index", "--no-ext-diff", "--ignore-cr-at-eol", "--", inside(sourceRoots[entry.upstream], entry.source), inside(root, target)], { encoding: "utf8", maxBuffer: 16 * 1024 * 1024 });
      if (result.error || ![0, 1].includes(result.status)) throw new Error(result.stderr || result.error?.message || "git diff failed");
      process.stdout.write(result.stdout);
    }
    for (const entry of Object.values(next.omitted)) console.log(`\nOmitted: ${entry.upstream}:${entry.source}\n${entry.reason}`);
  }
  if (options["--write"]) {
    const temporary = inside(root, `profiles/.skill-manifest-${randomUUID()}.json`);
    try {
      writeFileSync(temporary, `${JSON.stringify(next, null, 2)}\n`, { flag: "wx" });
      renameSync(temporary, inside(root, path));
    } finally {
      if (existsSync(temporary)) unlinkSync(temporary);
    }
    console.log(`Wrote ${path}; review its Git diff together with the changed skills.`);
  } else if (options["--check"]) {
    if (problems.length) throw new Error(`Skill integrity check failed:\n${[...new Set(problems)].join("\n")}`);
    console.log("All skill files match their reviewed baseline.");
  } else {
    console.log("No files changed. Inspect --diff before recording an intentional refresh with --write.");
  }
} finally {
  releaseUpstreamSyncLock(lock);
}
