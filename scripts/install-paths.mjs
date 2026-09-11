import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export function localPathKey(value, platform = process.platform) {
  const normalized = resolve(value);
  return platform === "win32" || platform === "darwin" ? normalized.toLowerCase() : normalized;
}

export function pathIsWithin(root, candidate, platform = process.platform) {
  const difference = relative(localPathKey(root, platform), localPathKey(candidate, platform));
  return difference === "" || (!isAbsolute(difference) && difference !== ".." && !difference.startsWith(`..${sep}`));
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

export function stagingPath(target, transactionId, sequence) {
  return join(dirname(target), `.harness-skills-stage-${transactionId}-${sequence}`);
}

export function targetPathsOverlap(left, right, platform = process.platform) {
  return pathIsWithin(left, right, platform) || pathIsWithin(right, left, platform);
}
