import { randomBytes } from "node:crypto";
import { existsSync, lstatSync, readdirSync, realpathSync, statSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";

const MAX_LOOKUPS = 32;
const foldsCaseByDirectory = new Map();

// Whether `alias` (a case variant of `name`) reaches the same directory entry as `name`.
// `undefined` means the lookup could not decide.
function sameEntry(directory, name, alias) {
  try {
    const original = lstatSync(join(directory, name), { bigint: true });
    if (original.ino === 0n) return undefined;
    try {
      const variant = lstatSync(join(directory, alias), { bigint: true });
      return variant.dev === original.dev && variant.ino === original.ino;
    } catch (error) {
      return error?.code === "ENOENT" ? false : undefined;
    }
  } catch {
    return undefined;
  }
}

function probeDirectory(directory) {
  let entries = [];
  try {
    entries = readdirSync(directory);
  } catch {
    // An unreadable directory falls through to the write probe.
  }
  let lookups = 0;
  for (const name of entries) {
    const alias = name === name.toLowerCase() ? name.toUpperCase() : name.toLowerCase();
    if (alias === name) continue;
    const same = sameEntry(directory, name, alias);
    if (same !== undefined) return same;
    if ((lookups += 1) >= MAX_LOOKUPS) break;
  }
  // No cased entry to compare, so create one. The name is unique per call.
  const name = `.mstack-Case-Probe-${process.pid}-${randomBytes(4).toString("hex")}`;
  const probe = join(directory, name);
  try {
    writeFileSync(probe, "", { flag: "wx" });
  } catch {
    return undefined;
  }
  try {
    return existsSync(join(directory, name.toLowerCase()));
  } finally {
    try {
      unlinkSync(probe);
    } catch {
      // A leftover dot-file is harmless; the probe result stands.
    }
  }
}

function nearestExistingDirectory(path) {
  let current = resolve(path);
  for (;;) {
    try {
      if (statSync(current).isDirectory()) return current;
    } catch {
      // Keep climbing until something exists.
    }
    const parent = dirname(current);
    if (parent === current) return current;
    current = parent;
  }
}

// Whether the filesystem holding `path` treats names that differ only by case as the same entry.
// Case sensitivity is a property of the volume (or directory), not of the OS, so ask the nearest existing
// directory. Results are cached per directory. When nothing can be observed, fall back to the OS default.
export function pathFoldsCase(path) {
  const directory = nearestExistingDirectory(path);
  let folds = foldsCaseByDirectory.get(directory);
  if (folds === undefined) {
    folds = probeDirectory(directory) ?? (process.platform === "win32" || process.platform === "darwin");
    foldsCaseByDirectory.set(directory, folds);
  }
  return folds;
}

// `foldsCase(absolutePath)` is injectable so tests do not depend on the host filesystem. Windows always folds.
export function localPathKey(value, { platform = process.platform, foldsCase = pathFoldsCase } = {}) {
  const normalized = resolve(value);
  return platform === "win32" || foldsCase(normalized) ? normalized.toLowerCase() : normalized;
}

export function physicalPathKey(value, options) {
  const absolute = resolve(value);
  let ancestor = absolute;
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor);
  return localPathKey(resolve(realpathSync(ancestor), relative(ancestor, absolute)), options);
}

export function pathIsWithin(root, candidate, options) {
  // Compare the case-normalized keys as exact strings: path.relative would re-fold case on a Windows host.
  const rootKey = localPathKey(root, options);
  const candidateKey = localPathKey(candidate, options);
  return candidateKey === rootKey || candidateKey.startsWith(rootKey.endsWith(sep) ? rootKey : `${rootKey}${sep}`);
}

export function artifactPathParts(name, definition, harness) {
  const baseParts = definition?.path;
  const parts = definition?.harnesses?.[harness]?.path ?? baseParts;
  for (const candidate of [baseParts, parts]) {
    if (!Array.isArray(candidate) || candidate.length === 0 || candidate.some((part) =>
      typeof part !== "string" ||
      part.trim().length === 0 ||
      part === "." ||
      part === ".." ||
      part.includes("/") ||
      part.includes("\\"))) {
      throw new Error(`Artifact ${name} must define a safe non-empty path array`);
    }
  }
  return parts;
}

export function validateArtifactOverrides(name, definition, validHarnesses) {
  artifactPathParts(name, definition);
  const overrides = definition.harnesses;
  if (overrides === undefined) return;
  if (!overrides || typeof overrides !== "object" || Array.isArray(overrides)) {
    throw new Error(`Artifact ${name} harnesses must be an object`);
  }
  for (const [harness, override] of Object.entries(overrides)) {
    if (!validHarnesses.includes(harness)) throw new Error(`Artifact ${name} has unknown harness: ${harness}`);
    if (!override || typeof override !== "object" || Array.isArray(override)) {
      throw new Error(`Artifact ${name} harness ${harness} must be an object`);
    }
    for (const field of Object.keys(override)) {
      if (!["path", "base", "format"].includes(field)) {
        throw new Error(`Artifact ${name} harness ${harness} has unsupported field: ${field}`);
      }
    }
    if (override.path === null) throw new Error(`Artifact ${name} must define a safe non-empty path array`);
    artifactPathParts(name, definition, harness);
    if (override.base !== undefined && !["harness", "codex-home"].includes(override.base)) {
      throw new Error(`Artifact ${name} harness ${harness} has unsupported base: ${override.base}`);
    }
    if (override.format !== undefined && !["copy", "codex-toml"].includes(override.format)) {
      throw new Error(`Artifact ${name} harness ${harness} has unsupported format: ${override.format}`);
    }
    if (harness !== "codex" && (override.base === "codex-home" || override.format === "codex-toml")) {
      throw new Error(`Artifact ${name}: codex-home and codex-toml are only valid for codex`);
    }
  }
}

export function stagingPath(target, transactionId, sequence) {
  return join(dirname(target), `.harness-skills-stage-${transactionId}-${sequence}`);
}

export function targetPathsOverlap(left, right, options) {
  return pathIsWithin(left, right, options) || pathIsWithin(right, left, options);
}
