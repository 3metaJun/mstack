#!/usr/bin/env node

import {
  existsSync,
  lstatSync,
  readFileSync,
  realpathSync,
  readdirSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { dirname, extname, isAbsolute, join, posix, relative, resolve, sep, win32 } from "node:path";
import { fileURLToPath } from "node:url";
import {
  acquireUpstreamSyncLock,
  applyUpstreamSyncTransaction,
  assertUpstreamSyncTargetReadable,
  captureUpstreamSyncFingerprint,
  recoverUpstreamSyncTransactions,
  releaseUpstreamSyncLock,
} from "./sync-upstream-transaction.mjs";

const args = process.argv.slice(2);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

if (args.includes("--help")) {
  console.log(
    "Usage: node scripts/sync-upstream.mjs --source <pstack checkout> [--target <mstack checkout>] [--apply] [--force]\n\n" +
      "Previews transformed pstack artifact writes and removals. --apply requires a clean source checkout at the pinned commit, " +
      "writes missing files, and removes upstream-deleted files that still match the previous manifest hash. " +
      "--force also replaces or removes locally changed files. Manifest hashes are transformed upstream baselines; " +
      "adapted compareContent=false files may differ.",
  );
  process.exit(0);
}

const source = valueAfter("--source") ?? process.env.MSTACK_PSTACK_SOURCE;
if (!source) {
  console.error("Pass --source <pstack checkout> or set MSTACK_PSTACK_SOURCE.");
  process.exit(2);
}

const sourceRoot = resolve(source);
const targetRoot = resolve(valueAfter("--target") ?? repoRoot);
const apply = args.includes("--apply");
const force = args.includes("--force");
if (force && !apply) throw new Error("--force requires --apply");

const syncLock = acquireUpstreamSyncLock(targetRoot, { recoverStale: apply });
const releaseReadLockAtExit = () => {
  try {
    releaseUpstreamSyncLock(syncLock);
  } catch {
    // A stale read lock is recoverable by the next apply.
  }
};
if (!apply) process.once("exit", releaseReadLockAtExit);

try {
const recoveredTransactions = apply ? recoverUpstreamSyncTransactions(targetRoot, syncLock) : 0;
if (!apply) assertUpstreamSyncTargetReadable(targetRoot, syncLock);
if (recoveredTransactions) {
  console.log(`Recovered ${recoveredTransactions} interrupted upstream sync transaction(s).`);
}
if (!existsSync(sourceRoot)) throw new Error(`Upstream checkout not found: ${sourceRoot}`);
const upstreamsPath = resolveInside(targetRoot, "profiles/upstreams.json", "upstream profile");
if (!existsSync(upstreamsPath)) throw new Error(`mstack upstream profile not found: ${upstreamsPath}`);
const upstreams = JSON.parse(readFileSync(upstreamsPath, "utf8"));
const pstack = upstreams.pstack;
if (!pstack || typeof pstack !== "object") throw new Error("profiles/upstreams.json has no pstack entry");

function gitOutput(arguments_) {
  try {
    return execFileSync("git", ["-C", sourceRoot, ...arguments_], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return undefined;
  }
}

function sourceProvenanceProblems() {
  if (gitOutput(["rev-parse", "--is-inside-work-tree"]) !== "true") {
    return [`Source is not inside a Git checkout: ${sourceRoot}.`];
  }

  const problems = [];
  const sourceCommit = gitOutput(["rev-parse", "--verify", "HEAD"]);
  if (!sourceCommit) {
    problems.push(`Source Git checkout has no readable HEAD: ${sourceRoot}.`);
  } else if (typeof pstack.commit !== "string" || pstack.commit.length === 0) {
    problems.push("profiles/upstreams.json has no pinned pstack commit.");
  } else if (sourceCommit !== pstack.commit) {
    problems.push(`Source checkout is at ${sourceCommit}, profile pins ${pstack.commit}.`);
  }

  const sourceStatus = gitOutput(["status", "--porcelain=v1", "--untracked-files=all", "--", "."]);
  if (sourceStatus === undefined) {
    problems.push(`Could not inspect source subtree status: ${sourceRoot}.`);
  } else if (sourceStatus.length > 0) {
    problems.push(`Source subtree has tracked or untracked changes:\n${sourceStatus}`);
  }
  return problems;
}

const provenanceProblems = sourceProvenanceProblems();
if (apply && provenanceProblems.length > 0) {
  throw new Error(`Upstream source provenance check failed:\n${provenanceProblems.join("\n")}`);
}
for (const problem of provenanceProblems) {
  console.error(`Warning: ${problem}`);
}

const textExtensions = new Set([
  ".cjs",
  ".css",
  ".cts",
  ".hbs",
  ".html",
  ".js",
  ".lock",
  ".json",
  ".md",
  ".mjs",
  ".sh",
  ".ts",
  ".tsx",
  ".txt",
  ".yaml",
  ".yml",
]);

const defaultArtifacts = {
  agents: {
    source: "agents",
    target: "agents",
    compareContent: false,
    renameFiles: {
      "poteto-agent.md": "meta-agent.md",
      "comment-sicko.md": "comment-reviewer.md",
    },
  },
  automations: {
    source: "automations",
    target: "automations",
    compareContent: true,
  },
  guide: {
    source: "docs/guide",
    target: "docs/guide",
    compareContent: true,
    renameFiles: { "02-poteto-mode.md": "02-meta-mode.md" },
  },
  "meta-mode-tools": {
    source: "skills/poteto-mode/scripts",
    target: "tools/meta-mode",
    compareContent: false,
  },
};

const artifacts = { ...defaultArtifacts, ...(pstack.artifacts ?? {}) };

function normalizePath(value) {
  return value.split(/[\\/]/).filter(Boolean).join("/");
}

function toPlatformPath(value) {
  return value.split("/").join(sep);
}

function profilePath(value, label, { allowRoot = true } = {}) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty relative path.`);
  }
  if (posix.isAbsolute(value.replaceAll("\\", "/")) || win32.isAbsolute(value)) {
    throw new Error(`${label} must stay inside its checkout; absolute paths are not allowed: ${value}`);
  }
  const parts = value.split(/[\\/]/).filter((part) => part.length > 0 && part !== ".");
  if (parts.includes("..")) {
    throw new Error(`${label} must stay inside its checkout; parent traversal is not allowed: ${value}`);
  }
  const normalized = parts.join("/");
  if (!allowRoot && normalized.length === 0) {
    throw new Error(`${label} must identify a file inside its checkout.`);
  }
  return normalized || ".";
}

function resolveInside(root, path, label) {
  const candidate = resolve(root, toPlatformPath(path));
  const fromRoot = relative(root, candidate);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`${label} resolves outside its checkout: ${path}`);
  }
  let existing = candidate;
  while (true) {
    try {
      lstatSync(existing);
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
  const realRoot = realpathSync(root);
  const realExisting = realpathSync(existing);
  const fromRealRoot = relative(realRoot, realExisting);
  if (fromRealRoot === ".." || fromRealRoot.startsWith(`..${sep}`) || isAbsolute(fromRealRoot)) {
    throw new Error(`${label} resolves outside its checkout through a symbolic link: ${path}`);
  }
  return candidate;
}

function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) {
      return walkFiles(path).map((file) => join(entry.name, file));
    }
    if (entry.isFile()) return [entry.name];
    return [];
  });
}

function renamePath(path, renameFiles = {}, label = "artifact rename") {
  const parts = normalizePath(path).split("/");
  const renamed = renameFiles[parts.at(-1)];
  if (renamed !== undefined) {
    parts[parts.length - 1] = profilePath(renamed, label, { allowRoot: false });
  }
  return parts.join("/");
}

function transformText(value, replacements = []) {
  let transformed = value.replace(/\r\n/g, "\n")
    .replaceAll("setup-pstack", "setup-mstack")
    .replaceAll("poteto-mode", "meta-mode")
    .replaceAll("poteto-agent", "meta-agent")
    .replace(/\bpstack\b/g, "mstack");
  for (const replacement of replacements) {
    if (!replacement || typeof replacement.from !== "string" || typeof replacement.to !== "string") {
      throw new Error("Upstream artifact replacements require string from and to values");
    }
    transformed = transformed.replaceAll(replacement.from, replacement.to);
  }
  return transformed;
}

function transformedBuffer(sourcePath, replacements = []) {
  const value = readFileSync(sourcePath);
  if (!textExtensions.has(extname(sourcePath).toLowerCase())) return value;
  return Buffer.from(transformText(value.toString("utf8"), replacements), "utf8");
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function equalContent(path, current, expected) {
  if (textExtensions.has(extname(path).toLowerCase())) {
    return current.toString("utf8").replace(/\r\n/g, "\n") === expected.toString("utf8").replace(/\r\n/g, "\n");
  }
  return digest(current) === digest(expected);
}

function relativeTarget(name, spec, sourceFile) {
  const renamed = renamePath(sourceFile, spec.renameFiles, `artifact ${name} rename for ${sourceFile}`);
  return profilePath(join(spec.target, renamed), `artifact ${name} computed target`, { allowRoot: false });
}

const operations = [];
const expectedTargets = new Map();
const missingSourceNames = new Set();
for (const [name, configured] of Object.entries(artifacts)) {
  const spec = {
    ...configured,
    source: profilePath(configured.source, `artifact ${name} source`),
    target: profilePath(configured.target, `artifact ${name} target`),
  };
  const sourceDirectory = resolveInside(sourceRoot, spec.source, `artifact ${name} source`);
  if (!existsSync(sourceDirectory)) {
    operations.push({ name, kind: "missing-source", sourceDirectory });
    missingSourceNames.add(name);
    continue;
  }
  for (const sourceFile of walkFiles(sourceDirectory)) {
    const sourceRelative = profilePath(
      join(spec.source, sourceFile),
      `artifact ${name} computed source`,
      { allowRoot: false },
    );
    const sourcePath = resolveInside(sourceRoot, sourceRelative, `artifact ${name} computed source`);
    const targetRelative = relativeTarget(name, spec, sourceFile);
    const targetPath = resolveInside(targetRoot, targetRelative, `artifact ${name} computed target`);
    const targetOwner = expectedTargets.get(targetRelative);
    if (targetOwner) {
      throw new Error(
        `Upstream artifacts ${targetOwner} and ${name}:${normalizePath(sourceFile)} resolve to the same target: ${targetRelative}`,
      );
    }
    expectedTargets.set(targetRelative, `${name}:${normalizePath(sourceFile)}`);
    const expected = transformedBuffer(sourcePath, spec.replacements);
    const before = captureUpstreamSyncFingerprint(targetPath);
    const current = before.kind === "file" ? readFileSync(targetPath) : undefined;
    let kind = "unchanged";
    if (!current) kind = "new";
    else if (!equalContent(targetPath, current, expected)) kind = "changed";
    operations.push({ name, spec, sourceFile, sourcePath, targetPath, expected, before, kind });
  }
}

const manifestPath = resolveInside(targetRoot, "profiles/upstream-manifest.json", "upstream manifest");
const manifestBefore = captureUpstreamSyncFingerprint(manifestPath);
let previousManifest;
if (existsSync(manifestPath)) {
  try {
    previousManifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    throw new Error(`Invalid upstream provenance manifest: ${error.message}`);
  }
}

const previousTargets = new Map();
for (const [name, files] of Object.entries(previousManifest?.artifacts ?? {})) {
  if (!files || typeof files !== "object" || Array.isArray(files)) {
    throw new Error(`Invalid upstream provenance manifest artifact group: ${name}`);
  }
  for (const [path, hash] of Object.entries(files)) {
    const targetRelative = profilePath(path, `upstream manifest artifact ${name}`, { allowRoot: false });
    if (typeof hash !== "string" || !/^[0-9a-f]{64}$/.test(hash)) {
      throw new Error(`Invalid upstream manifest hash for ${targetRelative}.`);
    }
    const existing = previousTargets.get(targetRelative);
    if (existing && existing.hash !== hash) {
      throw new Error(`Upstream manifest contains conflicting hashes for ${targetRelative}.`);
    }
    previousTargets.set(targetRelative, { name, hash });
  }
}

for (const [targetRelative, previous] of previousTargets) {
  if (expectedTargets.has(targetRelative) || missingSourceNames.has(previous.name)) continue;
  const targetPath = resolveInside(targetRoot, targetRelative, `upstream manifest artifact ${previous.name}`);
  if (!existsSync(targetPath)) continue;
  const before = captureUpstreamSyncFingerprint(targetPath);
  const current = readFileSync(targetPath);
  const matchesBaseline = digest(
    textExtensions.has(extname(targetPath).toLowerCase())
      ? Buffer.from(current.toString("utf8").replace(/\r\n/g, "\n"), "utf8")
      : current,
  ) === previous.hash;
  operations.push({
    name: previous.name,
    kind: "removed",
    targetPath,
    targetRelative,
    before,
    matchesBaseline,
  });
}

const grouped = new Map();
for (const operation of operations) {
  const entry = grouped.get(operation.name) ?? {
    new: 0,
    changed: 0,
    unchanged: 0,
    removed: 0,
    missingSource: 0,
  };
  if (operation.kind === "missing-source") entry.missingSource += 1;
  else entry[operation.kind] += 1;
  grouped.set(operation.name, entry);
}

for (const [name, counts] of grouped) {
  console.log(
    `${name}: new=${counts.new} changed=${counts.changed} unchanged=${counts.unchanged} removed=${counts.removed}` +
      (counts.missingSource ? ` missing-source=${counts.missingSource}` : ""),
  );
}

const conflicts = operations.filter(
  (operation) => operation.kind === "changed" && operation.spec?.compareContent !== false,
);
const preservedChanges = operations.filter(
  (operation) => operation.kind === "changed" && operation.spec?.compareContent === false,
);
const removals = operations.filter((operation) => operation.kind === "removed");
const removalConflicts = removals.filter((operation) => !operation.matchesBaseline);
const missingSources = operations.filter((operation) => operation.kind === "missing-source");
if (!apply) {
  const pending = operations.filter(
    (operation) =>
      operation.kind === "new" ||
      (operation.kind === "changed" && operation.spec?.compareContent !== false),
  );
  if (pending.length || removals.length) {
    console.log(`Dry run: ${pending.length} file(s) would be written; ${removals.length} file(s) would be removed.`);
  } else if (preservedChanges.length) console.log("Dry run: no source-managed files would be written or removed.");
  else console.log("Dry run: upstream artifacts are synchronized.");
  if (conflicts.length) {
    console.log("Changed files require --apply --force:");
    for (const operation of conflicts) console.log(`  ${relative(targetRoot, operation.targetPath)}`);
  }
  if (preservedChanges.length) {
    console.log("Adapted files are preserved unless --apply --force is supplied:");
    for (const operation of preservedChanges) console.log(`  ${relative(targetRoot, operation.targetPath)}`);
  }
  if (removals.length) {
    console.log("Files removed upstream:");
    for (const operation of removals) {
      console.log(`  ${operation.targetRelative}${operation.matchesBaseline ? "" : " (locally changed)"}`);
    }
  }
  if (missingSources.length) process.exitCode = 1;
  process.exit();
}
if (missingSources.length) {
  throw new Error(
    `Configured upstream artifact directories are missing:\n${missingSources
      .map((operation) => `  ${operation.sourceDirectory}`)
      .join("\n")}`,
  );
}
if ((conflicts.length || removalConflicts.length) && !force) {
  const details = [
    ...conflicts.map((operation) => `  overwrite: ${relative(targetRoot, operation.targetPath)}`),
    ...removalConflicts.map((operation) => `  remove: ${operation.targetRelative}`),
  ];
  throw new Error(
    "Refusing to replace or remove changed upstream artifacts. Review the diff, then re-run with --force:\n" +
      details.join("\n"),
  );
}

const written = operations.filter((operation) =>
  operation.kind !== "unchanged" &&
  operation.kind !== "removed" &&
  (operation.kind !== "changed" || operation.spec?.compareContent !== false || force)
);
const removed = removals;

const manifest = {
  source: pstack.repository,
  commit: pstack.commit,
  artifacts: Object.fromEntries(
    [...grouped.keys()].map((name) => [
      name,
      Object.fromEntries(
        operations
          .filter((operation) =>
            operation.name === name &&
            operation.kind !== "missing-source" &&
            operation.kind !== "removed"
          )
          .map((operation) => [
            normalizePath(relative(targetRoot, operation.targetPath)),
            digest(operation.expected),
          ]),
      ),
    ]),
  ),
};
applyUpstreamSyncTransaction(targetRoot, [
  ...written.map((operation) => ({
    kind: "write",
    target: normalizePath(relative(targetRoot, operation.targetPath)),
    content: operation.expected,
    before: operation.before,
  })),
  ...removed.map((operation) => ({
    kind: "remove",
    target: operation.targetRelative,
    before: operation.before,
  })),
  {
    kind: "manifest",
    target: "profiles/upstream-manifest.json",
    content: Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`, "utf8"),
    before: manifestBefore,
  },
], syncLock);
console.log(`Applied ${written.length} file(s).`);
console.log(`Removed ${removed.length} file(s).`);
console.log(`Wrote ${relative(targetRoot, manifestPath)}.`);
} finally {
  releaseUpstreamSyncLock(syncLock);
  if (!apply) process.removeListener("exit", releaseReadLockAtExit);
}
