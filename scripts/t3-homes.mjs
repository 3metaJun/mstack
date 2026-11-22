#!/usr/bin/env node
// Read-only discovery and install diagnostics for T3 Code provider homes.
// Reads `${T3CODE_HOME:-~/.t3}/userdata/settings.json` to find custom Claude,
// Codex (skipping T3's auth-overlay shadow homes), and Antigravity private
// profiles (`providers/antigravity/<sha256(instanceId)>`) so users see every
// skill root T3 actually runs.
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCliArgs } from "./cli-args.mjs";

const DRIVERS = {
  claudeAgent: "claude",
  codex: "codex",
  antigravity: "antigravity",
  opencode: "opencode",
  pi: "pi",
  grok: "grok",
};

const HARNESS_ENV = {
  claude: { env: "CLAUDE_CONFIG_DIR", home: ".claude" },
  codex: { env: "CODEX_HOME", home: ".codex" },
};

function expandHome(value, home) {
  if (value === "~") return home;
  return /^~[/\\]/.test(value) ? join(home, value.slice(2)) : value;
}

const trimmed = (value) => (typeof value === "string" ? value.trim() || undefined : undefined);
const real = (path) => {
  try { return existsSync(path) ? realpathSync(path) : resolve(path); } catch { return resolve(path); }
};

export function t3SettingsPath(env = process.env, home = homedir()) {
  const base = trimmed(env.T3CODE_HOME) ? resolve(expandHome(env.T3CODE_HOME.trim(), home)) : join(home, ".t3");
  return join(base, "userdata", "settings.json");
}

// T3 isolates each Antigravity instance under `<userdata>/providers/antigravity/<sha256(instanceId)>`.
export function antigravityProfileDir(settingsPath, instanceId) {
  return join(dirname(settingsPath), "providers", "antigravity", createHash("sha256").update(instanceId).digest("hex"));
}

function readT3Settings(path) {
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return { instances: parsed?.providerInstances ?? {} };
  } catch (error) {
    // Do not echo SyntaxError text: JSON.parse excerpts can include tokens from settings.json.
    return {
      instances: {},
      error: error.code === "ENOENT" ? "not found" : error instanceof SyntaxError ? "invalid JSON" : error.message,
    };
  }
}

function findEnvVar(instance, name) {
  const entries = Array.isArray(instance.environment) ? instance.environment : [];
  for (let index = entries.length - 1; index >= 0; index--) {
    const entry = entries[index];
    if (entry && entry.name === name) return entry;
  }
  return undefined;
}

function quotePs(value) {
  return value.replaceAll("'", "''");
}

function quotePosix(value) {
  return value.replaceAll("\\", "\\\\").replaceAll('"', '\\"').replaceAll("$", "\\$").replaceAll("`", "\\`");
}

function installHint(harness, targetDir, isWindows = process.platform === "win32") {
  if (harness === "claude") {
    const skillsDir = join(targetDir, "skills");
    return isWindows
      ? `$env:HARNESS_SKILLS_CLAUDE_DIR='${quotePs(skillsDir)}'; npx @3metajun/mstack --harness claude`
      : `HARNESS_SKILLS_CLAUDE_DIR="${quotePosix(skillsDir)}" npx @3metajun/mstack --harness claude`;
  }
  if (harness === "antigravity") {
    const skillsDir = join(targetDir, "antigravity-cli", "skills");
    return isWindows
      ? `$env:HARNESS_SKILLS_ANTIGRAVITY_DIR='${quotePs(skillsDir)}'; npx @3metajun/mstack --harness antigravity`
      : `HARNESS_SKILLS_ANTIGRAVITY_DIR="${quotePosix(skillsDir)}" npx @3metajun/mstack --harness antigravity`;
  }
  return `npx @3metajun/mstack --harness ${harness}`;
}

function listDirs(directory) {
  if (!existsSync(directory)) return [];
  try {
    return readdirSync(directory, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => join(directory, entry.name));
  } catch {
    return [];
  }
}

// Finds a skill installed either directly under `<root>/<skill>/SKILL.md` or
// inside a plugin layout: `<pluginRoot>/<plugin>/skills/<skill>/SKILL.md`,
// Claude's `<pluginRoot>/cache/<market>/<plugin>/<version>/skills/<skill>/SKILL.md`,
// or `<pluginRoot>/installed_plugins.json` install paths.
function findInstalledSkill(skillRoots, pluginRoots, skill) {
  for (const root of skillRoots) {
    if (existsSync(join(root, skill, "SKILL.md"))) return root;
  }
  for (const pluginRoot of pluginRoots) {
    if (!existsSync(pluginRoot)) continue;
    for (const pluginDir of listDirs(pluginRoot)) {
      const candidate = join(pluginDir, "skills", skill, "SKILL.md");
      if (existsSync(candidate)) return join(pluginDir, "skills");
    }
    // Claude Code plugin cache: plugins/cache/<marketplace>/<plugin>/<version>/skills/<skill>/SKILL.md
    for (const market of listDirs(join(pluginRoot, "cache"))) {
      for (const plugin of listDirs(market)) {
        for (const version of listDirs(plugin)) {
          const candidate = join(version, "skills", skill, "SKILL.md");
          if (existsSync(candidate)) return join(version, "skills");
        }
      }
    }
    const registryPath = join(pluginRoot, "installed_plugins.json");
    if (existsSync(registryPath)) {
      try {
        const parsed = JSON.parse(readFileSync(registryPath, "utf8"));
        const records = Object.values(parsed?.plugins ?? {}).flat();
        for (const record of records) {
          const installPath = trimmed(record?.installPath);
          if (installPath && existsSync(join(installPath, "skills", skill, "SKILL.md"))) {
            return join(installPath, "skills");
          }
        }
      } catch {
        // Ignore malformed plugin registry metadata during read-only inspection.
      }
    }
  }
  return null;
}

function instanceDetails(instance, harness, settingsPath, id, home) {
  if (harness === "antigravity") {
    const dir = antigravityProfileDir(settingsPath, id);
    return {
      dir,
      skillRoots: [join(dir, "config", "skills"), join(dir, "antigravity-cli", "skills")],
      pluginRoots: [join(dir, "config", "plugins")],
      hint: installHint("antigravity", dir),
    };
  }
  if (harness === "claude") {
    const config = instance.config ?? {};
    const homePath = trimmed(config.homePath);
    const envVar = findEnvVar(instance, "CLAUDE_CONFIG_DIR");
    if (!homePath && (envVar?.secret || envVar?.valueRedacted === true)) {
      return {
        dir: null,
        secret: true,
        warning: `T3 instance ${id} sets CLAUDE_CONFIG_DIR as a redacted secret; install path cannot be inspected from settings.json`,
        skillRoots: [],
        pluginRoots: [],
        hint: "Set CLAUDE_CONFIG_DIR in your shell to that instance's home and run npx @3metajun/mstack --harness claude",
      };
    }
    const custom = homePath ?? trimmed(envVar?.value);
    const dir = custom ? resolve(expandHome(custom, home)) : join(home, ".claude");
    return {
      dir,
      skillRoots: [join(dir, "skills")],
      pluginRoots: [join(dir, "plugins")],
      hint: installHint("claude", dir),
    };
  }
  if (harness === "codex") {
    const config = instance.config ?? {};
    const homePath = trimmed(config.homePath);
    const envVar = findEnvVar(instance, "CODEX_HOME");
    const shadow = trimmed(config.shadowHomePath);
    if (!homePath && (envVar?.secret || envVar?.valueRedacted === true)) {
      return {
        dir: null,
        secret: true,
        shadow: shadow ? resolve(expandHome(shadow, home)) : undefined,
        warning: `T3 instance ${id} sets CODEX_HOME as a redacted secret; custom Codex home cannot be inspected from settings.json (shared ~/.agents/skills still applies)`,
        skillRoots: [join(home, ".agents", "skills")],
        pluginRoots: [],
        hint: "npx @3metajun/mstack --harness codex",
      };
    }
    const custom = homePath ?? trimmed(envVar?.value);
    const dir = custom ? resolve(expandHome(custom, home)) : join(home, ".codex");
    return {
      dir,
      shadow: shadow ? resolve(expandHome(shadow, home)) : undefined,
      skillRoots: [join(home, ".agents", "skills"), join(dir, "skills")],
      pluginRoots: [join(dir, "plugins")],
      hint: installHint("codex", dir),
    };
  }
  const shared = join(home, ".agents", "skills");
  return {
    dir: shared,
    skillRoots: [shared],
    pluginRoots: [],
    hint: installHint(harness, shared),
  };
}

export function discoverT3Homes({ env = process.env, home = homedir(), skill = "meta-mode" } = {}) {
  const settingsPath = t3SettingsPath(env, home);
  const settings = readT3Settings(settingsPath);
  const found = [];
  const warnings = [];
  const shadows = new Set();

  for (const [id, instance] of Object.entries(settings.instances)) {
    const harness = DRIVERS[instance?.driver];
    if (!harness) continue;
    const disabled = instance.enabled === false || instance.config?.enabled === false;
    const details = instanceDetails(instance, harness, settingsPath, id, home);
    if (details.shadow) shadows.add(real(details.shadow));
    if (details.warning) warnings.push(details.warning);
    found.push({
      harness,
      dir: details.dir,
      secret: Boolean(details.secret),
      skillRoots: details.skillRoots,
      pluginRoots: details.pluginRoots,
      hint: details.hint,
      from: `T3 instance ${id}${disabled ? " (disabled)" : ""}`,
      disabled,
    });
  }

  for (const [harness, spec] of Object.entries(HARNESS_ENV)) {
    const value = trimmed(env[spec.env]);
    if (!value) continue;
    const dir = resolve(expandHome(value, home));
    if (shadows.has(real(dir))) continue;
    const skillRoots = harness === "claude"
      ? [join(dir, "skills")]
      : [join(home, ".agents", "skills"), join(dir, "skills")];
    const pluginRoots = [join(dir, "plugins")];
    found.push({
      harness,
      dir,
      secret: false,
      skillRoots,
      pluginRoots,
      hint: installHint(harness, dir),
      from: spec.env,
      disabled: false,
    });
  }

  const deduped = new Map();
  for (const entry of found) {
    const key = entry.secret ? `${entry.harness}\0secret\0${entry.from}` : `${entry.harness}\0${real(entry.dir)}`;
    const existing = deduped.get(key);
    if (existing) {
      existing.from.push(entry.from);
      existing.disabled = existing.disabled && entry.disabled;
    } else {
      const installedAt = findInstalledSkill(entry.skillRoots, entry.pluginRoots, skill);
      const status = installedAt !== null ? "installed" : entry.secret ? "unknown" : "missing";
      deduped.set(key, {
        harness: entry.harness,
        dir: entry.dir,
        secret: entry.secret,
        skillRoots: entry.skillRoots,
        pluginRoots: entry.pluginRoots,
        status,
        installed: installedAt !== null,
        installedAt,
        hint: entry.hint,
        from: [entry.from],
        disabled: entry.disabled,
      });
    }
  }

  return {
    settings: {
      path: settingsPath,
      instances: Object.values(settings.instances).filter((entry) => DRIVERS[entry?.driver]).length,
      error: settings.error ?? null,
    },
    warnings,
    homes: [...deduped.values()],
  };
}

function isDirectEntry() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  }
}

if (isDirectEntry()) {
  const options = parseCliArgs(process.argv.slice(2), ["--skill"], ["--json", "--check", "--strict", "--help"]);
  if (options["--help"]) {
    console.log("Usage: node scripts/t3-homes.mjs [--skill <name>] [--check] [--strict] [--json]\n\n" +
      "Inspect T3 Code provider instances and check whether mstack skills are installed in each target.\n" +
      "--check exits 1 when any enabled T3 provider home is missing the skill (redacted secret homes warn as unknown unless --strict is also passed).");
    process.exit(0);
  }
  const skill = options["--skill"] ?? "meta-mode";
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(skill)) throw new Error(`Invalid skill name: ${skill}`);
  const report = discoverT3Homes({ skill });
  if (options["--json"]) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    console.log(`T3 settings: ${report.settings.path}${report.settings.error ? ` (${report.settings.error})` : ` (${report.settings.instances} provider instance(s))`}`);
    for (const warning of report.warnings) {
      console.error(`Warning: ${warning}`);
    }
    for (const entry of report.homes) {
      const status = entry.status === "unknown"
        ? "unknown (redacted secret home)"
        : entry.status === "installed"
          ? `installed (${entry.installedAt})`
          : "missing";
      console.log(`  ${entry.harness} [${entry.from.join(", ")}]: ${status}`);
      if (entry.status !== "installed" && !entry.disabled) console.log(`    fix: ${entry.hint}`);
    }
  }
  if (options["--check"]) {
    const failing = report.homes.some((entry) =>
      !entry.disabled && (entry.status === "missing" || (options["--strict"] && entry.status === "unknown")),
    );
    if (failing) process.exitCode = 1;
  }
}
