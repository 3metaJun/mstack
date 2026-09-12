import { existsSync, realpathSync } from "node:fs";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export function localPathKey(value, platform = process.platform) {
  const normalized = resolve(value);
  return platform === "win32" || platform === "darwin" ? normalized.toLowerCase() : normalized;
}

export function physicalPathKey(value) {
  const absolute = resolve(value);
  let ancestor = absolute;
  while (!existsSync(ancestor) && dirname(ancestor) !== ancestor) ancestor = dirname(ancestor);
  return localPathKey(resolve(realpathSync(ancestor), relative(ancestor, absolute)));
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

export function targetPathsOverlap(left, right, platform = process.platform) {
  return pathIsWithin(left, right, platform) || pathIsWithin(right, left, platform);
}
