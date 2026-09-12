import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { configuredPath, resolveHarnessRoots } from "./harness-targets.mjs";

const repository = resolve(".");
const registry = JSON.parse(readFileSync(join(repository, "profiles", "harnesses.json"), "utf8"));
const home = resolve("fixture-home");

test("default skills share a root while native roots retain harness-specific locations", () => {
  const roots = resolveHarnessRoots(registry, { env: {}, home });
  const shared = join(home, ".agents", "skills");
  assert.deepEqual(roots.skills, { codex: shared, claude: join(home, ".claude", "skills"), opencode: shared, pi: shared });
  assert.deepEqual(roots.native, {
    codex: shared,
    claude: join(home, ".claude", "skills"),
    opencode: join(home, ".config", "opencode", "skills"),
    pi: join(home, ".pi", "agent", "skills"),
  });
  assert.deepEqual(roots.legacy, roots.native);
  assert.equal(roots.externalClaudeRoot, join(home, ".claude", "skills"));
});

test("configuration roots affect native and legacy locations without moving shared skills", () => {
  const roots = resolveHarnessRoots(registry, {
    home,
    env: { CLAUDE_CONFIG_DIR: "~/claude-config", XDG_CONFIG_HOME: "~/xdg", PI_CODING_AGENT_DIR: "~/pi-config" },
  });
  assert.equal(roots.skills.claude, join(home, "claude-config", "skills"));
  assert.equal(roots.skills.opencode, join(home, ".agents", "skills"));
  assert.equal(roots.skills.pi, join(home, ".agents", "skills"));
  assert.equal(roots.native.opencode, join(home, "xdg", "opencode", "skills"));
  assert.equal(roots.native.pi, join(home, "pi-config", "skills"));
  assert.deepEqual(roots.legacy, roots.native);
  assert.equal(roots.externalClaudeRoot, join(home, ".claude", "skills"));
});

test("named environment targets override directory variables while legacy roots ignore both", () => {
  const roots = resolveHarnessRoots(registry, {
    home,
    env: { HARNESS_SKILLS_PI_DIR: "~/pi-explicit", HARNESS_SKILLS_OPENCODE_DIR: "~/opencode-explicit", XDG_CONFIG_HOME: "~/xdg" },
    environmentTargets: { pi: "~/environment-pi" },
    environmentName: "local-workspace",
  });
  assert.equal(roots.skills.pi, join(home, "environment-pi"));
  assert.equal(roots.native.pi, join(home, "environment-pi"));
  assert.equal(roots.legacy.pi, join(home, ".pi", "agent", "skills"));
  assert.equal(roots.skills.opencode, join(home, "opencode-explicit"));
  assert.equal(roots.legacy.opencode, join(home, "xdg", "opencode", "skills"));
});

test("configured paths expand home and reject relative overrides at the common boundary", () => {
  assert.equal(configuredPath("~", "", "override", home), home);
  assert.equal(configuredPath("~/custom", "", "override", home), join(home, "custom"));
  assert.throws(() => configuredPath("relative", "", "override", home), /override must be an absolute path/);
  assert.throws(() => resolveHarnessRoots(registry, { home, env: { HARNESS_SKILLS_PI_DIR: "relative" } }), /HARNESS_SKILLS_PI_DIR must be an absolute path/);
  assert.throws(() => resolveHarnessRoots(registry, { home, env: {}, environmentTargets: { pi: "relative" }, environmentName: "example" }), /example.pi must be an absolute path/);
});

for (const explicit of [false, true]) {
  test(`smoke finds skills from a real isolated ${explicit ? "explicit" : "default"} installation`, (t) => {
    const root = mkdtempSync(join(tmpdir(), "mstack-harness-targets-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const bin = join(root, "bin");
    mkdirSync(bin);
    for (const harness of Object.keys(registry)) {
      const executable = join(bin, `${harness}${process.platform === "win32" ? ".ps1" : ""}`);
      writeFileSync(executable, process.platform === "win32"
        ? 'if ($args.Count -eq 1 -and $args[0] -eq "--version") { Write-Output "fixture-cli 1.0"; exit 0 }; exit 9\n'
        : '#!/bin/sh\nif [ "$#" = 1 ] && [ "$1" = "--version" ]; then printf "fixture-cli 1.0\\n"; exit 0; fi\nexit 9\n');
      if (process.platform !== "win32") chmodSync(executable, 0o755);
    }
    const env = Object.fromEntries(Object.entries(process.env).filter(([key]) =>
      !/^(HARNESS_SKILLS_|MSTACK_|CLAUDE_|CODEX_|PI_CODING_AGENT_DIR$|XDG_|NODE_OPTIONS$|PATH$)/i.test(key)));
    Object.assign(env, { HOME: root, USERPROFILE: root, APPDATA: join(root, "appdata"), LOCALAPPDATA: join(root, "localappdata"), PATH: `${bin}${delimiter}${process.env.PATH ?? process.env.Path ?? ""}` });
    if (explicit) {
      env.HARNESS_SKILLS_PI_DIR = join(root, "custom-pi-skills");
      env.HARNESS_SKILLS_OPENCODE_DIR = join(root, "custom-opencode-skills");
    }
    const installed = spawnSync(process.execPath, [join(repository, "scripts", "install.mjs"), "--harness", "all", "--skill", "bro"], { cwd: root, env, encoding: "utf8" });
    assert.equal(installed.status, 0, installed.stderr);
    const smoked = spawnSync(process.execPath, [join(repository, "scripts", "smoke-harnesses.mjs"), "--harness", "all", "--skill", "bro", "--require-installed", "--json"], { cwd: root, env, encoding: "utf8" });
    assert.equal(smoked.status, 0, `${smoked.stderr}\n${smoked.stdout}`);
    const entries = JSON.parse(smoked.stdout);
    assert.equal(entries.length, 4);
    for (const entry of entries) {
      const expected = entry.harness === "claude" ? join(root, ".claude", "skills")
        : explicit && ["pi", "opencode"].includes(entry.harness) ? join(root, `custom-${entry.harness}-skills`)
          : join(root, ".agents", "skills");
      assert.equal(entry.target, expected, entry.harness);
      assert.equal(entry.installed, true, entry.harness);
      assert.equal(entry.cli, "available", entry.harness);
      assert.equal(entry.version, "fixture-cli 1.0", entry.harness);
      assert.equal(entry.live, undefined);
    }
  });
}
