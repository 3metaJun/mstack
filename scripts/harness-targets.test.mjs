import assert from "node:assert/strict";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { configuredPath, resolveHarnessRoots, resolveProjectRoots, validateProjectDir, withoutInvalidOverrides } from "./harness-targets.mjs";

const repository = resolve(".");
const registry = JSON.parse(readFileSync(join(repository, "profiles", "harnesses.json"), "utf8"));
const home = resolve("fixture-home");

test("default skills share a root while native roots retain harness-specific locations", () => {
  const roots = resolveHarnessRoots(registry, { env: {}, home });
  const shared = join(home, ".agents", "skills");
  assert.deepEqual(roots.skills, {
    codex: shared,
    claude: join(home, ".claude", "skills"),
    opencode: shared,
    pi: shared,
    antigravity: join(home, ".gemini", "antigravity-cli", "skills"),
    grok: shared,
  });
  assert.deepEqual(roots.native, {
    codex: shared,
    claude: join(home, ".claude", "skills"),
    opencode: join(home, ".config", "opencode", "skills"),
    pi: join(home, ".pi", "agent", "skills"),
    antigravity: join(home, ".gemini", "antigravity-cli", "skills"),
    grok: join(home, ".grok", "skills"),
  });
  assert.deepEqual(roots.legacy, roots.native);
  assert.equal(roots.externalClaudeRoot, join(home, ".claude", "skills"));
});

test("Grok and Antigravity directory variables override roots and only Grok shares by default", () => {
  const roots = resolveHarnessRoots(registry, {
    home,
    env: { HARNESS_SKILLS_GROK_DIR: "~/grok-explicit", HARNESS_SKILLS_ANTIGRAVITY_DIR: "~/antigravity-explicit" },
  });
  assert.equal(roots.skills.grok, join(home, "grok-explicit"));
  assert.equal(roots.native.grok, join(home, "grok-explicit"));
  assert.equal(roots.legacy.grok, join(home, ".grok", "skills"));
  assert.equal(roots.skills.antigravity, join(home, "antigravity-explicit"));
  assert.equal(roots.legacy.antigravity, join(home, ".gemini", "antigravity-cli", "skills"));
  assert.throws(() => resolveHarnessRoots(registry, { home, env: { HARNESS_SKILLS_GROK_DIR: "relative" } }), /HARNESS_SKILLS_GROK_DIR must be an absolute path/);
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

test("project roots come from the registry and ignore user-scope variables", () => {
  const project = resolve("fixture-project");
  const roots = resolveProjectRoots(registry, project);
  assert.deepEqual(roots, {
    codex: join(project, ".agents", "skills"),
    claude: join(project, ".claude", "skills"),
    opencode: join(project, ".agents", "skills"),
    pi: join(project, ".agents", "skills"),
    antigravity: join(project, ".agents", "skills"),
    grok: join(project, ".agents", "skills"),
  });
  for (const [harness, config] of Object.entries(registry)) {
    assert.deepEqual(config.project, [harness === "claude" ? ".claude" : ".agents", "skills"], harness);
  }
  assert.throws(() => resolveProjectRoots({ codex: { project: ["..", "skills"] } }, project), /no safe project skill root/);
  assert.throws(() => resolveProjectRoots({ codex: { project: ["a/b"] } }, project), /no safe project skill root/);
  assert.throws(() => resolveProjectRoots({ codex: {} }, project), /no safe project skill root/);
});

test("project directories must exist, be directories, and stay out of home, the package, and transaction storage", (t) => {
  const root = mkdtempSync(join(tmpdir(), "mstack-project-dir-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const fakeHome = join(root, "home");
  const packageRoot = join(root, "package");
  const project = join(root, "project");
  const file = join(root, "file");
  for (const directory of [fakeHome, packageRoot, join(packageRoot, "skills"), project, join(root, ".harness-skills-backups", "p")]) {
    mkdirSync(directory, { recursive: true });
  }
  writeFileSync(file, "x", "utf8");
  const options = { packageRoot, home: fakeHome, cwd: root };
  assert.equal(validateProjectDir(project, options), project);
  assert.equal(validateProjectDir("project", options), project);
  assert.throws(() => validateProjectDir(join(root, "missing"), options), /existing directory/);
  assert.throws(() => validateProjectDir(file, options), /must name a directory/);
  assert.throws(() => validateProjectDir(fakeHome, options), /home directory/);
  assert.throws(() => validateProjectDir("~", options), /home directory/);
  assert.throws(() => validateProjectDir(packageRoot, options), /inside the mstack package/);
  assert.throws(() => validateProjectDir(join(packageRoot, "skills"), options), /inside the mstack package/);
  assert.throws(() => validateProjectDir(join(root, ".harness-skills-backups", "p"), options), /transaction storage/);
  // A repository that merely contains the package, such as one with it in node_modules, is a valid project.
  assert.equal(validateProjectDir(root, options), root);
});

test("invalid overrides are dropped for project installs and valid ones are kept", () => {
  const cleaned = withoutInvalidOverrides(registry, {
    HARNESS_SKILLS_PI_DIR: "relative",
    HARNESS_SKILLS_GROK_DIR: "~/grok-explicit",
    XDG_CONFIG_HOME: "relative-xdg",
    UNRELATED: "relative",
  }, home);
  assert.deepEqual(cleaned, { HARNESS_SKILLS_GROK_DIR: "~/grok-explicit", UNRELATED: "relative" });
  assert.doesNotThrow(() => resolveHarnessRoots(registry, { home, env: cleaned }));
});

test("project directories inside discovery roots are refused on the physical path", (t) => {
  const root = mkdtempSync(join(tmpdir(), "mstack-project-roots-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const nested = join(root, ".agents", "skills", "repo");
  mkdirSync(nested, { recursive: true });
  const options = { packageRoot: join(root, "package"), home: join(root, "home"), cwd: root };
  assert.throws(() => validateProjectDir(nested, options), /inside a skill discovery root/);
  assert.equal(validateProjectDir(root, options), root);
});

// Case folding follows the filesystem, so probe the real temporary directory.
function caseInsensitiveTemporaryFilesystem(directory) {
  const probe = join(directory, "CaseProbe");
  writeFileSync(probe, "x", "utf8");
  return existsSync(join(directory, "caseprobe"));
}

test("mixed-case discovery roots are refused where the filesystem folds case", (t) => {
  const root = mkdtempSync(join(tmpdir(), "mstack-project-case-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  if (!caseInsensitiveTemporaryFilesystem(root)) {
    t.skip("the temporary filesystem treats path case as significant");
    return;
  }
  const nested = join(root, ".Agents", "Skills", "repo");
  mkdirSync(nested, { recursive: true });
  const options = { packageRoot: join(root, "package"), home: join(root, "home"), cwd: root };
  assert.throws(() => validateProjectDir(nested, options), /inside a skill discovery root/);
});

for (const explicit of [false, true]) {
  test(`smoke finds skills from a real isolated ${explicit ? "explicit" : "default"} installation`, (t) => {
    const root = mkdtempSync(join(tmpdir(), "mstack-harness-targets-"));
    t.after(() => rmSync(root, { recursive: true, force: true }));
    const bin = join(root, "bin");
    mkdirSync(bin);
    for (const { runtime } of Object.values(registry)) {
      const executable = join(bin, `${runtime.command}${process.platform === "win32" ? ".ps1" : ""}`);
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
      env.HARNESS_SKILLS_GROK_DIR = join(root, "custom-grok-skills");
      env.HARNESS_SKILLS_ANTIGRAVITY_DIR = join(root, "custom-antigravity-skills");
    }
    const installed = spawnSync(process.execPath, [join(repository, "scripts", "install.mjs"), "--harness", "all", "--skill", "bro"], { cwd: root, env, encoding: "utf8" });
    assert.equal(installed.status, 0, installed.stderr);
    const smoked = spawnSync(process.execPath, [join(repository, "scripts", "smoke-harnesses.mjs"), "--harness", "all", "--skill", "bro", "--require-installed", "--json"], { cwd: root, env, encoding: "utf8" });
    assert.equal(smoked.status, 0, `${smoked.stderr}\n${smoked.stdout}`);
    const entries = JSON.parse(smoked.stdout);
    assert.equal(entries.length, 6);
    for (const entry of entries) {
      const expected = entry.harness === "claude" ? join(root, ".claude", "skills")
        : entry.harness === "antigravity" && !explicit ? join(root, ".gemini", "antigravity-cli", "skills")
          : explicit && ["pi", "opencode", "grok", "antigravity"].includes(entry.harness) ? join(root, `custom-${entry.harness}-skills`)
            : join(root, ".agents", "skills");
      assert.equal(entry.target, expected, entry.harness);
      assert.equal(entry.installed, true, entry.harness);
      assert.equal(entry.cli, "available", entry.harness);
      assert.equal(entry.version, "fixture-cli 1.0", entry.harness);
      assert.equal(entry.live, undefined);
    }
  });
}
