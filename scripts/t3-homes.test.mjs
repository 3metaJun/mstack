import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { antigravityProfileDir, discoverT3Homes, t3SettingsPath } from "./t3-homes.mjs";
import { modelFamily, t3CatalogWarnings, validateT3Catalog } from "./model-config-lib.mjs";

function sandbox(t) {
  const root = mkdtempSync(join(tmpdir(), "mstack-t3-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function writeSkill(root, skill = "meta-mode") {
  const dir = join(root, skill);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, "SKILL.md"), `---\nname: ${skill}\ndescription: test\n---\n`);
}

test("discovers T3 claude, codex, and antigravity profiles, plugin layouts, and skips codex shadow homes", (t) => {
  const root = sandbox(t);
  const home = join(root, "home");
  const t3Home = join(root, "t3");
  const claudeCustom = join(home, "claude-work");
  const codexMain = join(home, "codex-main");
  const codexShadow = join(home, "codex-shadow");
  const settingsFile = t3SettingsPath({ T3CODE_HOME: t3Home }, home);
  mkdirSync(join(t3Home, "userdata"), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify({
    providerInstances: {
      claudeWork: { driver: "claudeAgent", enabled: true, config: { homePath: "~/claude-work" } },
      codexMain: { driver: "codex", enabled: true, config: { homePath: "~/codex-main", shadowHomePath: "~/codex-shadow" } },
      agyPlugin: { driver: "antigravity", enabled: true },
      agyOff: { driver: "antigravity", enabled: false },
    },
  }));

  // Claude installed via plugin cache layout.
  writeSkill(join(claudeCustom, "plugins", "cache", "mstack-market", "mstack", "1.0.0", "skills"));
  // Antigravity installed via config/plugins/<plugin>/skills/<skill>/SKILL.md.
  const agyProfile = antigravityProfileDir(settingsFile, "agyPlugin");
  const expectedHash = createHash("sha256").update("agyPlugin").digest("hex");
  assert.ok(agyProfile.endsWith(expectedHash));
  writeSkill(join(agyProfile, "config", "plugins", "mstack", "skills"));

  const report = discoverT3Homes({
    env: { T3CODE_HOME: t3Home, CODEX_HOME: codexShadow },
    home,
  });
  assert.equal(report.settings.instances, 4);
  assert.equal(report.settings.error, null);
  assert.equal(report.homes.some((entry) => entry.dir === codexShadow), false, "shadow home must be skipped");
  const claude = report.homes.find((entry) => entry.harness === "claude");
  const agyOn = report.homes.find((entry) => entry.dir === agyProfile);
  const codex = report.homes.find((entry) => entry.harness === "codex" && entry.dir === codexMain);
  assert.equal(claude?.installed, true);
  assert.equal(agyOn?.installed, true);
  assert.equal(codex?.installed, false);
});

test("detects redacted secret home env vars, deduplicates matching homes, and merges disabled+enabled", (t) => {
  const root = sandbox(t);
  const home = join(root, "home");
  const t3Home = join(root, "t3");
  const claudeDir = join(home, "claude-shared");
  const settingsFile = t3SettingsPath({ T3CODE_HOME: t3Home }, home);
  mkdirSync(join(t3Home, "userdata"), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify({
    providerInstances: {
      claudeSecret: {
        driver: "claudeAgent",
        enabled: true,
        environment: [{ name: "CLAUDE_CONFIG_DIR", secret: true, valueRedacted: true }],
      },
      claudeDisabled: { driver: "claudeAgent", enabled: false, config: { homePath: "~/claude-shared" } },
    },
  }));
  writeSkill(join(claudeDir, "skills"));

  const report = discoverT3Homes({
    env: { T3CODE_HOME: t3Home, CLAUDE_CONFIG_DIR: claudeDir },
    home,
  });
  assert.equal(report.warnings.length, 1);
  assert.match(report.warnings[0], /redacted secret/);
  const secretEntry = report.homes.find((entry) => entry.secret);
  assert.equal(secretEntry?.dir, null);
  assert.equal(secretEntry?.status, "unknown");
  assert.equal(secretEntry?.installed, false);

  const merged = report.homes.find((entry) => entry.dir === claudeDir);
  assert.ok(merged);
  assert.equal(merged.disabled, false, "an enabled source must override a disabled duplicate");
  assert.equal(merged.status, "installed");
  assert.equal(merged.from.length, 2);

  // --check exits 0 when only redacted-secret ("unknown") homes remain alongside installed env homes,
  // while --strict fails on unknown homes.
  const env = { ...process.env, HOME: home, USERPROFILE: home, T3CODE_HOME: t3Home, CLAUDE_CONFIG_DIR: claudeDir };
  const check = spawnSync(process.execPath, ["scripts/t3-homes.mjs", "--check"], { encoding: "utf8", env });
  assert.equal(check.status, 0, check.stderr);
  assert.match(check.stderr, /Warning:.*redacted secret/);
  const strict = spawnSync(process.execPath, ["scripts/t3-homes.mjs", "--check", "--strict"], { encoding: "utf8", env });
  assert.equal(strict.status, 1);
});

test("t3-homes CLI supports --json, --check exit 1/0, --skill, and rejects invalid --skill", (t) => {
  const root = sandbox(t);
  const home = join(root, "home");
  const t3Home = join(root, "t3");
  const claudeDir = join(home, "claude-cli");
  const settingsFile = t3SettingsPath({ T3CODE_HOME: t3Home }, home);
  mkdirSync(join(t3Home, "userdata"), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify({
    providerInstances: {
      claudeCli: { driver: "claudeAgent", enabled: true, config: { homePath: "~/claude-cli" } },
    },
  }));
  const env = { ...process.env, HOME: home, USERPROFILE: home, T3CODE_HOME: t3Home };

  const missing = spawnSync(process.execPath, ["scripts/t3-homes.mjs", "--check", "--json"], { encoding: "utf8", env });
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stdout).homes[0].installed, false);

  writeSkill(join(claudeDir, "skills"), "custom-skill");
  const ok = spawnSync(process.execPath, ["scripts/t3-homes.mjs", "--check", "--skill", "custom-skill"], { encoding: "utf8", env });
  assert.equal(ok.status, 0, ok.stderr);

  const bad = spawnSync(process.execPath, ["scripts/t3-homes.mjs", "--skill", "../escape"], { encoding: "utf8", env });
  assert.notEqual(bad.status, 0);
});

test("t3-homes escapes shell metacharacters in install hints", (t) => {
  const root = sandbox(t);
  const home = join(root, "home");
  const t3Home = join(root, "t3");
  const tricky = join(home, "claude's$dir");
  const settingsFile = t3SettingsPath({ T3CODE_HOME: t3Home }, home);
  mkdirSync(join(t3Home, "userdata"), { recursive: true });
  writeFileSync(settingsFile, JSON.stringify({
    providerInstances: {
      claudeTricky: { driver: "claudeAgent", enabled: true, config: { homePath: tricky } },
    },
  }));
  const report = discoverT3Homes({ env: { T3CODE_HOME: t3Home }, home });
  const hint = report.homes[0]?.hint ?? "";
  if (process.platform === "win32") {
    assert.ok(hint.includes("claude''s$dir"), `expected escaped PowerShell single quote in: ${hint}`);
  } else {
    assert.ok(hint.includes("claude's\\$dir"), `expected escaped POSIX dollar in: ${hint}`);
  }
});

test("malformed T3 settings reports invalid JSON without leaking raw token excerpts", (t) => {
  const root = sandbox(t);
  const t3Home = join(root, "t3");
  const settingsFile = t3SettingsPath({ T3CODE_HOME: t3Home }, root);
  mkdirSync(join(t3Home, "userdata"), { recursive: true });
  writeFileSync(settingsFile, '{"secret": "sk-super-secret-token-12345" broken');
  const report = discoverT3Homes({ env: { T3CODE_HOME: t3Home }, home: root });
  assert.equal(report.settings.error, "invalid JSON");
  assert.doesNotMatch(JSON.stringify(report), /sk-super-secret-token/);
});

test("modelFamily isolates claude-fable and strips route prefixes", () => {
  assert.equal(modelFamily("claude-fable-5-2"), "claude-fable");
  assert.equal(modelFamily("openrouter/anthropic/claude-fable-5.2"), "claude-fable");
  assert.equal(modelFamily("claude-opus-5-5"), "claude");
  assert.equal(modelFamily("ml-gpt-plus/gpt-6.2-sol"), "gpt");
  assert.equal(modelFamily("antigravity/gemini-4-neon"), "gemini");
});

test("validateT3Catalog checks provider capability, listed models, and effort options (ignoring unrelated select options)", () => {
  const catalog = {
    providers: [
      {
        providerInstanceId: "claudeAgent",
        canRunChildTask: true,
        canRunCrossProviderChildTask: true,
        models: [
          { id: "claude-opus-5-5", options: [{ id: "effort", values: ["low", "medium", "high", "xhigh"] }] },
          { id: "claude-no-effort", options: [{ id: "verbosity", values: ["low", "medium", "high"] }] },
        ],
      },
      {
        providerInstanceId: "antigravity",
        canRunChildTask: true,
        canRunCrossProviderChildTask: true,
        models: [
          { id: "gemini-4-neon", options: [{ id: "thought_level", values: ["low", "medium", "high", "xhigh"] }] },
        ],
      },
      {
        providerInstanceId: "disabledProvider",
        canRunChildTask: false,
        canRunCrossProviderChildTask: false,
        constraints: ["Provider instance is disabled."],
        models: [{ id: "some-model" }],
      },
    ],
  };

  const valid = {
    roles: { implementer: "inherit-parent", reviewer: ["inherit-parent"] },
    overrides: {
      t3code: {
        implementer: "claudeAgent/claude-opus-5-5 (high)",
        reviewer: ["claudeAgent/claude-opus-5-5 (high)", "antigravity/gemini-4-neon (xhigh)"],
      },
    },
  };
  assert.deepEqual(validateT3Catalog(valid, catalog), []);
  assert.deepEqual(t3CatalogWarnings(valid), []);

  // Same model at two efforts is valid per t3code.md and emits an advisory warning, not a hard error.
  const singleFamily = {
    roles: { reviewer: ["inherit-parent"] },
    overrides: {
      t3code: {
        reviewer: ["claudeAgent/claude-opus-5-5 (high)", "claudeAgent/claude-opus-5-5 (low)"],
      },
    },
  };
  assert.deepEqual(validateT3Catalog(singleFamily, catalog), []);
  assert.equal(t3CatalogWarnings(singleFamily).length, 1);

  const bad = {
    roles: { implementer: "inherit-parent", reviewer: ["inherit-parent"] },
    overrides: {
      t3code: {
        implementer: "disabledProvider/some-model",
        reviewer: ["claudeAgent/claude-opus-5-5 (max)", "claudeAgent/claude-no-effort (high)"],
      },
    },
  };
  const problems = validateT3Catalog(bad, catalog).join("\n");
  assert.match(problems, /cannot run cross-provider child tasks/);
  assert.match(problems, /effort "max" is not offered/);
  assert.match(problems, /claude-no-effort.*effort "high" is not offered/);
});

test("model-config CLI validates --catalog for t3code including BOM files, warnings, and failure exit codes", (t) => {
  const root = sandbox(t);
  const configPath = join(root, "models.json");
  const catalogPath = join(root, "catalog.json");
  writeFileSync(configPath, JSON.stringify({
    roles: { implementer: "inherit-parent", reviewer: ["inherit-parent"] },
    overrides: {
      t3code: {
        implementer: "antigravity/gemini-4-neon (high)",
        reviewer: ["antigravity/gemini-4-neon (high)", "antigravity/gemini-4-neon (medium)"],
      },
    },
  }));
  // Write catalog with UTF-8 BOM to verify decodeText handling.
  writeFileSync(catalogPath, Buffer.from(`\uFEFF${JSON.stringify({
    providers: [{
      providerInstanceId: "antigravity",
      canRunChildTask: true,
      canRunCrossProviderChildTask: true,
      models: [{ id: "gemini-4-neon", options: [{ id: "thought_level", values: ["low", "medium", "high", "xhigh"] }] }],
    }],
  })}`, "utf8"));
  const ok = spawnSync(process.execPath, ["scripts/model-config.mjs", "--file", configPath, "--harness", "t3code", "--catalog", catalogPath], {
    encoding: "utf8",
  });
  assert.equal(ok.status, 0, ok.stderr);
  assert.match(ok.stderr, /Warning:.*one model family/);

  const badConfig = join(root, "bad-models.json");
  writeFileSync(badConfig, JSON.stringify({
    roles: { implementer: "inherit-parent" },
    overrides: { t3code: { implementer: "antigravity/nonexistent-model (high)" } },
  }));
  const rejected = spawnSync(process.execPath, ["scripts/model-config.mjs", "--file", badConfig, "--harness", "t3code", "--catalog", catalogPath], {
    encoding: "utf8",
  });
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /does not list model/);
});
