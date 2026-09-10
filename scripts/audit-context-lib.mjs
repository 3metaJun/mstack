import { existsSync, readdirSync, realpathSync, statSync } from "node:fs";
import { join } from "node:path";

function isMissing(error) {
  return typeof error === "object" && error !== null && "code" in error && error.code === "ENOENT";
}

function orUndefinedWhenMissing(operation) {
  try {
    return operation();
  } catch (error) {
    if (isMissing(error)) return undefined;
    throw error;
  }
}

export function walkFiles(root, predicate = () => true, seenDirectories = new Set()) {
  if (!existsSync(root)) return [];
  const realRoot = orUndefinedWhenMissing(() => realpathSync(root));
  if (realRoot === undefined) return [];
  const normalizedRoot = realRoot.toLowerCase();
  if (seenDirectories.has(normalizedRoot)) return [];
  seenDirectories.add(normalizedRoot);
  const files = [];
  const entries = orUndefinedWhenMissing(() => readdirSync(root, { withFileTypes: true }));
  if (entries === undefined) return [];
  for (const entry of entries) {
    const path = join(root, entry.name);
    const linkedStats = entry.isSymbolicLink() ? orUndefinedWhenMissing(() => statSync(path)) : undefined;
    const directory = entry.isDirectory() || linkedStats?.isDirectory() === true;
    if (directory) files.push(...walkFiles(path, predicate, seenDirectories));
    else if (entry.isFile() && predicate(path)) files.push(path);
  }
  return files;
}

export function filesModifiedSince(paths, cutoff) {
  const recent = [];
  for (const path of paths) {
    const stats = orUndefinedWhenMissing(() => statSync(path));
    if (stats !== undefined && stats.mtimeMs >= cutoff) recent.push({ path, mtimeMs: stats.mtimeMs });
  }
  return recent.sort((left, right) => right.mtimeMs - left.mtimeMs).map((entry) => entry.path);
}
