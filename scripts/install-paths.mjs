import { existsSync, lstatSync, readdirSync, realpathSync, statSync } from "node:fs";
import { dirname, join, parse, relative, resolve, sep } from "node:path";

const MAX_LOOKUPS = 32;
const foldsCaseByDirectory = new Map();

// Flip only ASCII letters: every case-insensitive filesystem equates those, whereas full Unicode case
// mapping (for example "ß" to "SS") is not something all of them agree on.
function swapAsciiCase(name) {
  return name.replace(/[a-z]/gi, (letter) => letter === letter.toLowerCase() ? letter.toUpperCase() : letter.toLowerCase());
}

// Whether the case variant `alias` of the entry `name` reaches the same entry. `undefined` means undecided.
function aliasReachesEntry(directory, name, alias) {
  try {
    const original = lstatSync(join(directory, name), { bigint: true });
    if (original.ino === 0n) return undefined;
    const variant = lstatSync(join(directory, alias), { bigint: true });
    return variant.dev === original.dev && variant.ino === original.ino;
  } catch (error) {
    return error?.code === "ENOENT" ? false : undefined;
  }
}

// Read-only observation of how names directly inside an existing directory compare. Two entries that differ
// only by case prove case sensitivity (and rule out hard-link look-alikes); an absent entry's case variant
// resolving to the same inode proves folding. `undefined` when the directory offers nothing to compare.
function observeDirectory(directory) {
  let entries;
  try {
    entries = readdirSync(directory);
  } catch {
    return undefined;
  }
  const present = new Set(entries);
  let lookups = 0;
  for (const name of entries) {
    const alias = swapAsciiCase(name);
    if (alias === name) continue;
    if (present.has(alias)) return false;
    const same = aliasReachesEntry(directory, name, alias);
    if (same !== undefined) return same;
    if ((lookups += 1) >= MAX_LOOKUPS) break;
  }
  return undefined;
}

function sameDevice(left, right) {
  try {
    return statSync(left, { bigint: true }).dev === statSync(right, { bigint: true }).dev;
  } catch {
    return false;
  }
}

function existingDirectoryFoldsCase(directory) {
  const cached = foldsCaseByDirectory.get(directory);
  if (cached !== undefined) return cached;
  const observed = observeDirectory(directory);
  if (observed !== undefined) {
    foldsCaseByDirectory.set(directory, observed);
    return observed;
  }
  // Nothing to compare (an empty directory). Within one device the parent's answer is the best guess, though
  // a per-directory case-fold flag can differ, so the guess is not cached: the directory is looked at again
  // once it has entries. A fresh volume root has no neighbour to ask, so use the OS default. No probe file is
  // ever written.
  const parent = dirname(directory);
  return parent !== directory && sameDevice(directory, parent)
    ? existingDirectoryFoldsCase(parent)
    : process.platform === "win32" || process.platform === "darwin";
}

// Whether names directly inside `directory` compare case-insensitively. Case sensitivity belongs to the
// directory's filesystem, not the OS, so ask the nearest existing directory; results are cached.
export function pathFoldsCase(directory) {
  let current = resolve(directory);
  for (;;) {
    try {
      if (statSync(current).isDirectory()) return existingDirectoryFoldsCase(current);
    } catch {
      // Keep climbing until something exists.
    }
    const parent = dirname(current);
    if (parent === current) return existingDirectoryFoldsCase(current);
    current = parent;
  }
}

// Each component is folded by the directory that contains it, so a case-insensitive mount inside a
// case-sensitive tree (or the reverse) keeps its parent prefix intact. `foldsCase(directory)` is injectable
// so tests do not depend on the host filesystem. Windows always folds.
export function localPathKey(value, { platform = process.platform, foldsCase = pathFoldsCase } = {}) {
  const normalized = resolve(value);
  if (platform === "win32") return normalized.toLowerCase();
  const { root } = parse(normalized);
  let key = root;
  let directory = root;
  for (const segment of normalized.slice(root.length).split(sep).filter(Boolean)) {
    key = join(key, foldsCase(directory) ? segment.toLowerCase() : segment);
    directory = join(directory, segment);
  }
  return key;
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
