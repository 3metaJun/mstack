import { statSync } from "node:fs";
import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { pathIsWithin, physicalPathKey } from "./install-paths.mjs";

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
  if (project.split(/[\\/]/).some((segment) => TRANSACTION_SEGMENT.test(segment))) {
    throw new Error(`--project cannot be inside installer transaction storage: ${project}`);
  }
  const physical = physicalPathKey(project);
  if (physical === physicalPathKey(home)) {
    throw new Error("--project cannot be the home directory; omit --project for a user-level install");
  }
  if (packageRoot && pathIsWithin(physicalPathKey(packageRoot), physical)) {
    throw new Error(`--project cannot be inside the mstack package: ${project}`);
  }
  return project;
}
