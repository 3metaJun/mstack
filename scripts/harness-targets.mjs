import { statSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { pathIsWithin, physicalPathKey, targetPathsOverlap } from "./install-paths.mjs";

export function configuredPath(value, fallback, label, home = homedir()) {
  const path = value ?? fallback;
  const expanded = path === "~" ? home : /^~[\\/]/.test(path) ? join(home, path.slice(2)) : path;
  if (value && !isAbsolute(expanded)) throw new Error(`${label} must be an absolute path or start with ~/`);
  return resolve(expanded);
}

export function resolveHarnessRoots(registry, { env = process.env, home = homedir(), environmentTargets = {}, environmentName } = {}) {
  const sharedRoot = join(home, ".agents", "skills");
  const externalClaudeRoot = join(home, ".claude", "skills");
  const skills = {};
  const native = {};
  const legacy = {};
  for (const [harness, config] of Object.entries(registry)) {
    if (config.fallback) {
      legacy[harness] = join(home, ...config.fallback);
    } else {
      const configRoot = env[config.configVariable]
        ? configuredPath(env[config.configVariable], "", config.configVariable, home)
        : join(home, config.configFallback);
      legacy[harness] = join(configRoot, ...(config.prefix ?? []), ...(config.suffix ?? []));
    }
    const environmentTarget = environmentTargets[harness];
    const directory = env[config.directoryVariable];
    native[harness] = environmentTarget
      ? configuredPath(environmentTarget, "", `${environmentName}.${harness}`, home)
      : directory ? configuredPath(directory, "", config.directoryVariable, home) : legacy[harness];
    skills[harness] = config.sharedSkills && !environmentTarget && !directory ? sharedRoot : native[harness];
  }
  return { skills, native, legacy, sharedRoot, externalClaudeRoot };
}

const TRANSACTION_SEGMENT = /^\.harness-skills-/;
// Directories under which some harness scans for skills recursively. Segments arrive lower-cased on
// case-insensitive platforms, so the names here are lower-case.
const DISCOVERY_PARENTS = [".agents", ".claude", ".cursor", ".codex", ".gemini", ".agent", ".pi", ".opencode", ".grok"];

function enclosingDiscoveryRoot(segments) {
  for (let index = 0; index < segments.length - 1; index += 1) {
    if (DISCOVERY_PARENTS.includes(segments[index]) && segments[index + 1] === "skills") {
      return `${segments[index]}/skills`;
    }
  }
  return undefined;
}

// An override that resolveHarnessRoots would reject must not block a project install, which ignores overrides.
export function withoutInvalidOverrides(registry, env, home = homedir()) {
  const cleaned = { ...env };
  for (const config of Object.values(registry)) {
    for (const variable of [config.directoryVariable, config.configVariable]) {
      if (!variable || !cleaned[variable]) continue;
      try {
        configuredPath(cleaned[variable], "", variable, home);
      } catch {
        delete cleaned[variable];
      }
    }
  }
  return cleaned;
}

// Every target and its transaction storage must physically stay inside the project, away from the mstack
// package, and out of user-level skill roots. Compare physical paths so symlinks and junctions cannot
// redirect a write, and check both directions so nesting is caught either way.
export function validateProjectTargets({ projectDir, targets, userRoots, packageRoot }) {
  const projectKey = physicalPathKey(projectDir);
  const packageKey = packageRoot ? physicalPathKey(packageRoot) : undefined;
  const userKeys = userRoots.map(physicalPathKey);
  const check = (label, path) => {
    const key = physicalPathKey(path);
    if (!pathIsWithin(projectKey, key)) throw new Error(`--project ${label} resolves outside the project directory: ${path} -> ${key}`);
    if (packageKey && targetPathsOverlap(key, packageKey)) throw new Error(`--project ${label} overlaps the mstack package: ${path}`);
    const user = userKeys.find((userKey) => targetPathsOverlap(key, userKey));
    if (user) throw new Error(`--project would overlap a user-level skill root: ${label} ${path} and ${user}`);
  };
  for (const [harness, target] of Object.entries(targets)) {
    check(`${harness} skill root`, target);
    for (const category of ["backups", "failed", "stage"]) {
      // Mirrors the installer: storage sits beside the skills root, one level above each skill directory.
      check(`${harness} ${category} storage`, join(dirname(target), `.harness-skills-${category}`));
    }
  }
  const contained = userKeys.find((userKey) => pathIsWithin(projectKey, userKey));
  if (contained) throw new Error(`--project cannot contain a user-level skill root: ${projectDir} contains ${contained}`);
}

// Project roots come only from the registry's `project` path; user-scope overrides never apply.
export function resolveProjectRoots(registry, projectDir) {
  const roots = {};
  for (const [harness, config] of Object.entries(registry)) {
    const parts = config.project;
    if (!Array.isArray(parts) || parts.length === 0 || parts.some((part) =>
      typeof part !== "string" || !part.trim() || part === "." || part === ".." || /[\\/]/.test(part))) {
      throw new Error(`Harness ${harness} has no safe project skill root`);
    }
    roots[harness] = join(projectDir, ...parts);
  }
  return roots;
}

export function validateProjectDir(value, { packageRoot, home = homedir(), cwd = process.cwd() } = {}) {
  const expanded = value === "~" ? home : /^~[\\/]/.test(value) ? join(home, value.slice(2)) : value;
  const project = resolve(cwd, expanded);
  let status;
  try {
    status = statSync(project);
  } catch {
    throw new Error(`--project must name an existing directory: ${project}`);
  }
  if (!status.isDirectory()) throw new Error(`--project must name a directory: ${project}`);
  // Judge the physical, case-normalized path: a symlink or an uppercase spelling must not slip past.
  const physical = physicalPathKey(project);
  const segments = physical.split(/[\\/]/).filter(Boolean);
  if (segments.some((segment) => TRANSACTION_SEGMENT.test(segment))) {
    throw new Error(`--project cannot be inside installer transaction storage: ${project}`);
  }
  const discoveryRoot = enclosingDiscoveryRoot(segments);
  if (discoveryRoot) {
    throw new Error(`--project cannot be inside a skill discovery root (${discoveryRoot}): ${project}`);
  }
  if (physical === physicalPathKey(home)) {
    throw new Error("--project cannot be the home directory; omit --project for a user-level install");
  }
  if (packageRoot && pathIsWithin(physicalPathKey(packageRoot), physical)) {
    throw new Error(`--project cannot be inside the mstack package: ${project}`);
  }
  return project;
}
