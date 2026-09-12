import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

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
