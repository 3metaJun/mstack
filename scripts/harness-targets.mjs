import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

export function expandHome(path, home) {
  if (path === "~") return home;
  if (/^~[\\/]/.test(path)) return join(home, path.slice(2));
  return path;
}

export function configuredPath(value, fallback, label, home = homedir()) {
  const expanded = expandHome(value ?? fallback, home);
  if (value && !isAbsolute(expanded)) {
    throw new Error(`${label} must be an absolute path or start with ~/`);
  }
  return resolve(expanded);
}

export function pathFromParts(parts, home = homedir()) {
  return parts.reduce((current, part) => join(current, part), home);
}

function harnessConfigRoot(registry, harness, env, home) {
  const config = registry[harness];
  const configured = env[config.configVariable]
    ? configuredPath(env[config.configVariable], "", config.configVariable, home)
    : pathFromParts([config.configFallback], home);
  return join(configured, ...(config.prefix ?? []));
}

export function ownConfigRoot(registry, harness, env = process.env, home = homedir()) {
  if (harness === "codex") {
    return configuredPath(env.CODEX_HOME || undefined, join(home, ".codex"), "CODEX_HOME", home);
  }
  return harnessConfigRoot(registry, harness, env, home);
}

export function defaultSkillsDir(registry, harness, env = process.env, home = homedir()) {
  const config = registry[harness];
  const skills = config.skills ?? {};
  if (skills.install && skills.install !== "own") {
    const referenced = registry[skills.install];
    if (!referenced?.fallback) {
      throw new Error(
        `Harness ${harness} installs skills into the ${skills.install} directory, but ${skills.install} defines no fallback`,
      );
    }
    return pathFromParts(referenced.fallback, home);
  }
  if (config.fallback) return pathFromParts(config.fallback, home);
  return join(harnessConfigRoot(registry, harness, env, home), ...(config.suffix ?? []));
}

export function skillsTarget(registry, harness, options = {}) {
  const env = options.env ?? process.env;
  const home = options.home ?? homedir();
  const config = registry[harness];
  if (options.environmentTarget) {
    return configuredPath(
      options.environmentTarget,
      "",
      `${options.environmentName ?? "environment"}.${harness}`,
      home,
    );
  }
  const directory = env[config.directoryVariable];
  if (directory) return configuredPath(directory, "", config.directoryVariable, home);
  return defaultSkillsDir(registry, harness, env, home);
}

export function legacySkillsDir(registry, harness, env = process.env, home = homedir()) {
  const config = registry[harness];
  if (config.skills?.legacy !== "own") return undefined;
  return join(harnessConfigRoot(registry, harness, env, home), ...(config.suffix ?? []));
}
