#!/usr/bin/env node

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const usage = `Usage:
  node tools/meta-mode/resume.mjs begin --project <dir> --note <file> [--artifact <file>]... [--id <id>]
  node tools/meta-mode/resume.mjs publish --project <dir> --id <id>
  node tools/meta-mode/resume.mjs read --project <dir> [--id <id>]

A resume is drafted in .git/mstack/resume and becomes visible only after publish.`;

function git(project, args) {
  try {
    return execFileSync("git", ["-C", project, ...args], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  } catch (error) {
    const detail = error.stderr?.toString().trim();
    throw new Error(`Git query failed in ${project}: ${detail || error.message}`);
  }
}

function repository(project) {
  const input = resolve(project || process.cwd());
  const root = resolve(git(input, ["rev-parse", "--show-toplevel"]));
  const worktree = root;
  const gitDir = join(resolve(git(input, ["rev-parse", "--absolute-git-dir"])), "mstack", "resume");
  let name = "";
  let email = "";
  try { name = git(input, ["config", "--get", "user.name"]); } catch { /* report the combined identity error below */ }
  try { email = git(input, ["config", "--get", "user.email"]); } catch { /* report the combined identity error below */ }
  if (!name || !email) throw new Error("Git identity is incomplete: configure user.name and user.email before creating a resume");
  return { input, root, worktree, gitDir, identity: { name, email } };
}

function inside(root, file, label) {
  const path = resolve(root, file);
  const rel = relative(root, path);
  if (!rel || rel.startsWith("..") || isAbsolute(rel)) throw new Error(`${label} must be inside the project worktree: ${file}`);
  if (rel.split(/[\\/]/).includes(".git")) throw new Error(`${label} cannot be under .git: ${file}`);
  return path;
}

function requireFile(path, label) {
  if (!existsSync(path)) throw new Error(`${label} does not exist: ${path}`);
  if (!lstatSync(path).isFile()) throw new Error(`${label} is not a regular file: ${path}`);
}

function atomic(path, value) {
  const temporary = `${path}.tmp-${process.pid}-${Date.now()}`;
  writeFileSync(temporary, value, { encoding: "utf8", flag: "wx", mode: 0o600 });
  renameSync(temporary, path);
}

function store(repo) {
  mkdirSync(repo.gitDir, { recursive: true, mode: 0o700 });
  return repo.gitDir;
}

function begin(repo, options) {
  if (!options.note) throw new Error("begin requires --note <file>");
  const note = inside(repo.root, options.note, "Note path");
  requireFile(note, "Note");
  const artifacts = options.artifact.map((file) => {
    const path = inside(repo.root, file, "Artifact path");
    requireFile(path, "Artifact");
    return relative(repo.root, path).replaceAll("\\", "/");
  });
  const id = options.id || `resume-${Date.now()}-${process.pid}`;
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,96}$/.test(id)) throw new Error("Resume id must contain only letters, numbers, dot, underscore, or hyphen");
  const dir = store(repo);
  const draft = join(dir, `${id}.draft.json`);
  if (existsSync(draft) || existsSync(join(dir, `${id}.json`))) throw new Error(`Resume already exists: ${id}`);
  const record = { version: 1, id, state: "draft", project: repo.root, worktree: repo.worktree, identity: repo.identity, note: relative(repo.root, note).replaceAll("\\", "/"), artifacts, createdAt: new Date().toISOString() };
  atomic(draft, JSON.stringify(record, null, 2) + "\n");
  console.log(JSON.stringify({ ...record, path: draft }));
}

function publish(repo, options) {
  if (!options.id) throw new Error("publish requires --id <id>");
  const dir = store(repo);
  const draft = join(dir, `${options.id}.draft.json`);
  if (!existsSync(draft)) throw new Error(`No draft resume found for id: ${options.id}`);
  const record = JSON.parse(readFileSync(draft, "utf8"));
  if (record.project !== repo.root || record.worktree !== repo.worktree) throw new Error("Draft belongs to a different project or worktree");
  requireFile(inside(repo.root, record.note, "Note path"), "Note");
  for (const artifact of record.artifacts) requireFile(inside(repo.root, artifact, "Artifact path"), "Artifact");
  const published = { ...record, state: "published", publishedAt: new Date().toISOString() };
  const target = join(dir, `${options.id}.json`);
  atomic(target, JSON.stringify(published, null, 2) + "\n");
  // Removing the draft after the atomic publication makes readers see either a complete record or no record.
  unlinkSync(draft);
  console.log(JSON.stringify({ ...published, path: target }));
}

function readResume(repo, options) {
  const dir = store(repo);
  let id = options.id;
  if (!id) {
    const entries = readdirSync(dir).filter((name) => name.endsWith(".json") && !name.endsWith(".draft.json")).sort();
    id = entries.at(-1)?.slice(0, -5);
  }
  if (!id) throw new Error("No published resume checkpoints found");
  const path = join(dir, `${id}.json`);
  if (!existsSync(path)) throw new Error(`No published resume found for id: ${id}`);
  const record = JSON.parse(readFileSync(path, "utf8"));
  if (record.project !== repo.root || record.worktree !== repo.worktree) throw new Error("Resume belongs to a different project or worktree");
  console.log(JSON.stringify({ ...record, path }));
}

function parse(args) {
  const command = args.shift();
  if (!command || !["begin", "publish", "read"].includes(command)) throw new Error(usage);
  const options = { artifact: [] };
  while (args.length) {
    const arg = args.shift();
    const key = { "--project": "project", "--note": "note", "--artifact": "artifact", "--id": "id" }[arg];
    if (!key) throw new Error(`Unknown option: ${arg}\n${usage}`);
    const value = args.shift();
    if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
    if (key === "artifact") options.artifact.push(value); else if (options[key]) throw new Error(`Duplicate option: ${arg}`); else options[key] = value;
  }
  return { command, options };
}

export { begin, publish, readResume, repository };

if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1])) {
  try {
    const { command, options } = parse(process.argv.slice(2));
    const repo = repository(options.project);
    ({ begin, publish, read: readResume }[command])(repo, options);
  } catch (error) {
    console.error(`resume: ${error.message}`);
    process.exitCode = 1;
  }
}
