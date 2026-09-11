import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join, resolve } from "node:path";

const textExtensions = /\.(?:cjs|css|cts|hbs|html|js|json|lock|md|mjs|sh|ts|tsx|tsv|txt|yaml|yml)$/i;
const hashPattern = /^[a-f0-9]{64}$/;

export function inside(root, path) {
  if (typeof path !== "string" || !path || path.includes("\\") || path.startsWith("/") ||
      path.split("/").some((part) => !part || part === "." || part === ".." || part.includes(":"))) {
    throw new Error(`Invalid checkout-relative path: ${path}`);
  }
  let current = resolve(root);
  for (const part of path.split("/")) {
    current = join(current, part);
    if (existsSync(current) && lstatSync(current).isSymbolicLink()) {
      throw new Error(`Symbolic links are not supported in skill baselines: ${path}`);
    }
  }
  return current;
}

export function filesUnder(root, path) {
  const directory = inside(root, path);
  return readdirSync(directory, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name, "en"))
    .flatMap((entry) => {
      const child = `${path}/${entry.name}`;
      if (entry.isDirectory()) return filesUnder(root, child);
      if (!entry.isFile()) throw new Error(`Unsupported file type: ${child}`);
      return [child];
    });
}

export function contentDigest(root, path) {
  const buffer = readFileSync(inside(root, path));
  const content = textExtensions.test(path) || path.endsWith("/watch-pr")
    ? buffer.toString("utf8").replace(/\r\n/g, "\n") : buffer;
  return createHash("sha256").update(content).digest("hex");
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function json(root, path) {
  return JSON.parse(readFileSync(inside(root, path), "utf8"));
}

export function checkLocalBaseline(root, manifest) {
  if (!record(manifest) || manifest.version !== 1 || !record(manifest.files) ||
      !record(manifest.omitted) || !record(manifest.sources)) {
    throw new Error("Invalid skill manifest: expected version 1, sources, files, and omitted objects.");
  }
  const problems = [];
  const upstreams = json(root, "profiles/upstreams.json");
  for (const [name, profile] of Object.entries(upstreams)) {
    if (manifest.sources[name] !== profile.commit) problems.push(`${name}: source pin differs from profile`);
  }
  for (const name of Object.keys(manifest.sources)) {
    if (!upstreams[name]) problems.push(`${name}: stale source pin`);
  }
  const actual = new Set(filesUnder(root, "skills"));
  for (const [path, entry] of Object.entries(manifest.files)) {
    const target = inside(root, path);
    if (!record(entry) || !hashPattern.test(entry.targetDigest ?? "")) {
      problems.push(`${path}: invalid target digest`);
      continue;
    }
    if (entry.upstream === null) {
      if (typeof entry.reason !== "string" || !entry.reason.trim()) problems.push(`${path}: local addition has no reason`);
    } else if (!manifest.sources[entry.upstream] || !hashPattern.test(entry.sourceDigest ?? "")) {
      problems.push(`${path}: invalid upstream source baseline`);
    } else {
      inside(root, entry.source);
    }
    if (!existsSync(target)) problems.push(`${path}: target file missing`);
    else if (contentDigest(root, path) !== entry.targetDigest) problems.push(`${path}: target content changed`);
    actual.delete(path);
  }
  for (const path of actual) problems.push(`${path}: untracked skill file`);
  for (const [key, entry] of Object.entries(manifest.omitted)) {
    if (!record(entry) || !manifest.sources[entry.upstream] || !hashPattern.test(entry.sourceDigest ?? "") ||
        typeof entry.reason !== "string" || !entry.reason.trim()) problems.push(`${key}: invalid omission`);
    else inside(root, entry.source);
  }
  return problems;
}

function assertPinned(root, name, commit) {
  const git = (args) => execFileSync("git", ["-C", root, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  if (git(["rev-parse", "HEAD"]) !== commit) throw new Error(`${name}: source checkout does not match pinned commit ${commit}`);
  if (git(["status", "--porcelain=v1", "--untracked-files=all", "--", "."])) {
    throw new Error(`${name}: source checkout has tracked or untracked changes`);
  }
}

export function buildBaseline(root, sourceRoots) {
  const upstreams = json(root, "profiles/upstreams.json");
  const profiles = json(root, "profiles/skill-sources.json");
  const manifest = { version: 1, sources: {}, files: {}, omitted: {} };
  const owners = new Set();
  for (const [name, spec] of Object.entries(profiles)) {
    const sourceRoot = sourceRoots[name];
    if (!sourceRoot) throw new Error(`Missing source checkout for ${name}`);
    const commit = upstreams[name]?.commit;
    if (typeof commit !== "string" || !/^[a-f0-9]{40}$/.test(commit)) throw new Error(`Invalid source pin for ${name}`);
    assertPinned(sourceRoot, name, commit);
    manifest.sources[name] = commit;
    const skills = spec.skills ?? Object.fromEntries(
      readdirSync(inside(sourceRoot, spec.root), { withFileTypes: true }).map((entry) => {
        if (!entry.isDirectory()) throw new Error(`Unexpected source skill entry: ${entry.name}`);
        return [`${spec.root}/${entry.name}`, upstreams[name].renames?.[entry.name] ?? entry.name];
      }),
    );
    const usedMoves = new Set();
    const usedOmissions = new Set();
    for (const [sourceSkill, targetSkill] of Object.entries(skills)) {
      if (owners.has(targetSkill)) throw new Error(`Multiple sources own skill ${targetSkill}`);
      owners.add(targetSkill);
      if (!existsSync(inside(sourceRoot, `${sourceSkill}/SKILL.md`))) throw new Error(`${sourceSkill}: missing source SKILL.md`);
      for (const source of filesUnder(sourceRoot, sourceSkill)) {
        const sourceDigest = contentDigest(sourceRoot, source);
        const reason = spec.omit?.[source];
        if (reason !== undefined) {
          if (typeof reason !== "string" || !reason.trim()) throw new Error(`${source}: omission requires a reason`);
          manifest.omitted[`${name}:${source}`] = { upstream: name, source, sourceDigest, reason };
          usedOmissions.add(source);
          continue;
        }
        let target = `skills/${targetSkill}${source.slice(sourceSkill.length)}`;
        let moveReason;
        const moves = Object.entries(spec.moves ?? {}).filter(([prefix]) => source === prefix || source.startsWith(`${prefix}/`));
        if (moves.length > 1) throw new Error(`${source}: overlapping move rules`);
        if (moves.length) {
          const [prefix, move] = moves[0];
          if (typeof move.reason !== "string" || !move.reason.trim()) throw new Error(`${source}: move requires a reason`);
          inside(sourceRoot, prefix);
          inside(root, move.target);
          target = `${move.target}${source.slice(prefix.length)}`;
          moveReason = move.reason;
          usedMoves.add(prefix);
        }
        if (manifest.files[target]) throw new Error(`Multiple source files map to ${target}`);
        if (!existsSync(inside(root, target))) throw new Error(`${source}: missing target ${target}; restore it or record an explicit move/omission`);
        manifest.files[target] = { upstream: name, source, sourceDigest, targetDigest: contentDigest(root, target), ...(moveReason ? { reason: moveReason } : {}) };
      }
    }
    for (const path of Object.keys(spec.moves ?? {})) if (!usedMoves.has(path)) throw new Error(`${path}: stale move rule`);
    for (const path of Object.keys(spec.omit ?? {})) if (!usedOmissions.has(path)) throw new Error(`${path}: stale omission rule`);
  }
  const expectedSkills = json(root, "profiles/skills.json").skills;
  if (JSON.stringify([...owners].sort()) !== JSON.stringify([...expectedSkills].sort())) throw new Error("Skill sources do not cover the declared skill inventory");
  for (const path of filesUnder(root, "skills")) {
    if (!owners.has(path.split("/")[1])) throw new Error(`${path}: no upstream skill owner`);
    manifest.files[path] ??= { upstream: null, reason: "Local portability guidance or implementation; review alongside its owning skill.", targetDigest: contentDigest(root, path) };
  }
  manifest.files = Object.fromEntries(Object.entries(manifest.files).sort(([a], [b]) => a.localeCompare(b, "en")));
  manifest.omitted = Object.fromEntries(Object.entries(manifest.omitted).sort(([a], [b]) => a.localeCompare(b, "en")));
  return manifest;
}

export function baselineChanges(previous, next) {
  const changes = [];
  for (const group of ["sources", "files", "omitted"]) {
    const oldEntries = previous?.[group] ?? {};
    for (const key of new Set([...Object.keys(oldEntries), ...Object.keys(next[group])])) {
      if (JSON.stringify(oldEntries[key]) !== JSON.stringify(next[group][key])) {
        changes.push(`${group}: ${key} (${!oldEntries[key] ? "added" : !next[group][key] ? "removed" : "changed"})`);
      }
    }
  }
  return changes;
}
