import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const installer = resolve("scripts/install.mjs");

function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), "mstack-discovery-"));
  const env = { ...process.env, HOME: root, USERPROFILE: root };
  for (const key of Object.keys(env)) {
    if (key.startsWith("HARNESS_SKILLS_") || ["CODEX_HOME", "CLAUDE_CONFIG_DIR", "PI_CODING_AGENT_DIR", "XDG_CONFIG_HOME"].includes(key)) delete env[key];
  }
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, env };
}

function run(args, env) {
  return spawnSync(process.execPath, [installer, ...args], { env, encoding: "utf8" });
}

function succeeded(result) {
  assert.equal(result.status, 0, `${result.stdout}\n${result.stderr}`);
}

function skillFiles(root, prefix = "") {
  if (!existsSync(root)) return [];
  return readdirSync(root, { withFileTypes: true }).flatMap((entry) => {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) return skillFiles(join(root, entry.name), relative);
    return entry.name === "SKILL.md" ? [relative] : [];
  }).sort();
}

function installedText(root, directory, skill) {
  return readFileSync(join(root, directory, skill, "SKILL.md"), "utf8");
}

test("all harnesses install two canonical skills and two directory-named Claude skills", (t) => {
  const { root, env } = fixture(t);
  succeeded(run(["--harness", "all", "--skill", "meta-mode,show-me-your-work"], env));
  assert.deepEqual(skillFiles(root), [
    ".agents/skills/meta-mode/SKILL.md",
    ".agents/skills/show-me-your-work/SKILL.md",
    ".claude/skills/meta-mode/SKILL.md",
    ".claude/skills/show-me-your-work/SKILL.md",
    ".gemini/antigravity-cli/skills/meta-mode/SKILL.md",
    ".gemini/antigravity-cli/skills/show-me-your-work/SKILL.md",
  ]);
  for (const skill of ["meta-mode", "show-me-your-work"]) {
    for (const directory of [".agents/skills", ".gemini/antigravity-cli/skills"]) {
      assert.match(installedText(root, directory, skill), new RegExp(`^name: ${skill}\\r?$`, "m"));
    }
    const claude = installedText(root, ".claude/skills", skill);
    assert.doesNotMatch(claude.split(/^---\s*$/m)[1], /^name:/m);
    assert.match(claude, /^description:/m);
  }
  assert.equal(existsSync(join(root, ".pi/agent/skills")), false);
  assert.equal(existsSync(join(root, ".config/opencode/skills")), false);
  assert.equal(existsSync(join(root, ".grok/skills")), false);
});

test("Grok shares the default copy while Antigravity keeps its own native root", (t) => {
  const { root, env } = fixture(t);
  succeeded(run(["--harness", "grok", "--skill", "meta-mode"], env));
  assert.deepEqual(skillFiles(root), [".agents/skills/meta-mode/SKILL.md"]);
  assert.equal(existsSync(join(root, ".grok/skills")), false);
  succeeded(run(["--harness", "antigravity", "--skill", "meta-mode"], env));
  assert.deepEqual(skillFiles(root), [
    ".agents/skills/meta-mode/SKILL.md",
    ".gemini/antigravity-cli/skills/meta-mode/SKILL.md",
  ]);
  const shared = installedText(root, ".agents/skills", "meta-mode");
  assert.equal(installedText(root, ".gemini/antigravity-cli/skills", "meta-mode"), shared);
  const refreshed = run(["--harness", "codex,opencode,pi,grok", "--skill", "meta-mode", "--replace"], env);
  succeeded(refreshed);
  assert.match(refreshed.stdout, /shared meta-mode: .* \(codex, opencode, pi, grok\)/);
  assert.deepEqual(skillFiles(join(root, ".agents/skills")), ["meta-mode/SKILL.md"]);
});

test("project install leaves only skill roots in the repository and none under the home directory", (t) => {
  const { root, env } = fixture(t);
  const project = join(root, "workspace", "repo");
  mkdirSync(project, { recursive: true });
  succeeded(run(["--harness", "all", "--project", project, "--skill", "meta-mode,show-me-your-work"], env));
  assert.deepEqual(skillFiles(project), [
    ".agents/skills/meta-mode/SKILL.md",
    ".agents/skills/show-me-your-work/SKILL.md",
    ".claude/skills/meta-mode/SKILL.md",
    ".claude/skills/show-me-your-work/SKILL.md",
  ]);
  assert.deepEqual(readdirSync(project).sort(), [".agents", ".claude"]);
  assert.deepEqual(readdirSync(join(project, ".agents")), ["skills"]);
  assert.deepEqual(readdirSync(join(project, ".claude")), ["skills"]);
  assert.deepEqual(readdirSync(root), ["workspace"]);
  const claude = installedText(project, ".claude/skills", "meta-mode");
  assert.doesNotMatch(claude.split(/^---\s*$/m)[1], /^name:/m);
  assert.match(installedText(project, ".agents/skills", "meta-mode"), /^name: meta-mode\r?$/m);
});

test("explicit Grok and Antigravity roots override their defaults", (t) => {
  const { root, env } = fixture(t);
  env.HARNESS_SKILLS_GROK_DIR = join(root, "custom-grok/skills");
  env.HARNESS_SKILLS_ANTIGRAVITY_DIR = join(root, "custom-antigravity/skills");
  succeeded(run(["--harness", "grok,antigravity", "--skill", "meta-mode"], env));
  assert.deepEqual(skillFiles(root), [
    "custom-antigravity/skills/meta-mode/SKILL.md",
    "custom-grok/skills/meta-mode/SKILL.md",
  ]);
});

test("repeat replacement and a pi-only refresh keep one current shared copy", (t) => {
  const { root, env } = fixture(t);
  const args = ["--harness", "all", "--skill", "meta-mode", "--replace"];
  succeeded(run(args, env));
  succeeded(run(args, env));
  const canonical = join(root, ".agents/skills/meta-mode/SKILL.md");
  const expected = readFileSync(resolve("skills/meta-mode/SKILL.md"), "utf8");
  writeFileSync(canonical, `${readFileSync(canonical, "utf8")}\nStale local marker\n`);
  succeeded(run(["--harness", "pi", "--skill", "meta-mode", "--replace"], env));
  assert.equal(readFileSync(canonical, "utf8"), expected);
  for (const directory of [".agents/skills", ".claude/skills", ".gemini/antigravity-cli/skills", ".pi/agent/skills", ".config/opencode/skills", ".grok/skills"]) {
    const installed = [".agents", ".claude", ".gemini"].some((prefix) => directory.startsWith(prefix));
    assert.deepEqual(skillFiles(join(root, directory)), installed ? ["meta-mode/SKILL.md"] : []);
  }
});

test("artifact-only installation preserves native harness roots", (t) => {
  const { root, env } = fixture(t);
  succeeded(run(["--harness", "all", "--no-skills", "--artifact", "agents"], env));
  for (const file of [
    ".codex/agents/meta-agent.toml",
    ".claude/agents/meta-agent.md",
    ".config/opencode/agents/meta-agent.md",
    ".pi/agent/agents/meta-agent.md",
    ".gemini/antigravity-cli/agents/meta-agent.md",
    ".grok/agents/meta-agent.md",
  ]) assert.equal(existsSync(join(root, file)), true, file);
  assert.equal(existsSync(join(root, ".agents")), false);
});

test("equal explicit Codex and pi roots install one usable skill", (t) => {
  const { root, env } = fixture(t);
  env.HARNESS_SKILLS_CODEX_DIR = join(root, "custom/skills");
  env.HARNESS_SKILLS_PI_DIR = join(root, "custom/skills");
  succeeded(run(["--harness", "codex,pi", "--skill", "meta-mode"], env));
  assert.deepEqual(skillFiles(root), ["custom/skills/meta-mode/SKILL.md"]);
  assert.match(installedText(root, "custom/skills", "meta-mode"), /^name: meta-mode\r?$/m);
});

test("incompatible Claude and canonical output at one root fails before writes", (t) => {
  const { root, env } = fixture(t);
  env.HARNESS_SKILLS_CODEX_DIR = join(root, "custom/skills");
  env.HARNESS_SKILLS_CLAUDE_DIR = join(root, "custom/skills");
  const result = run(["--harness", "codex,claude", "--skill", "meta-mode"], env);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /incompatible|overlap|conflict/i);
  assert.deepEqual(readdirSync(root), []);
});

test("dry run reports shared destinations without creating files", (t) => {
  const { root, env } = fixture(t);
  const result = run(["--harness", "all", "--skill", "meta-mode", "--dry-run"], env);
  succeeded(result);
  assert.ok(result.stdout.includes(join(root, ".agents/skills/meta-mode")), result.stdout);
  assert.ok(result.stdout.includes(join(root, ".claude/skills/meta-mode")), result.stdout);
  assert.ok(result.stdout.includes(join(root, ".gemini/antigravity-cli/skills/meta-mode")), result.stdout);
  assert.deepEqual(readdirSync(root), []);
});

test("optional tools coalesce for all harnesses and resolve relative to a pi skill", (t) => {
  const { root, env } = fixture(t);
  const result = run(["--harness", "all", "--no-skills", "--artifact", "meta-mode-tools"], env);
  succeeded(result);
  assert.match(result.stdout, /Installed 0 skill copies and 3 artifact copies/);
  const expected = readFileSync(resolve("tools/meta-mode/package.json"), "utf8");
  for (const directory of [".agents/tools/meta-mode", ".claude/tools/meta-mode", ".gemini/antigravity-cli/tools/meta-mode"]) {
    assert.equal(readFileSync(join(root, directory, "package.json"), "utf8"), expected);
  }
  for (const directory of [".pi/agent/tools", ".config/opencode/tools", ".grok/tools"]) {
    assert.equal(existsSync(join(root, directory)), false, directory);
  }
  succeeded(run(["--harness", "pi", "--skill", "meta-mode", "--artifact", "meta-mode-tools", "--replace"], env));
  const skillDirectory = join(root, ".agents/skills/meta-mode");
  assert.match(readFileSync(join(skillDirectory, "SKILL.md"), "utf8"), /\.\.\/\.\.\/tools\/meta-mode/);
  const relativeTools = resolve(skillDirectory, "../../tools/meta-mode/package.json");
  assert.equal(relativeTools, join(root, ".agents/tools/meta-mode/package.json"));
  assert.equal(readFileSync(relativeTools, "utf8"), expected);
});

test("shared migration leaves an unrecognized explicit pi install override untouched", (t) => {
  const { root, env } = fixture(t);
  env.HARNESS_SKILLS_PI_DIR = join(root, "custom-pi/skills");
  const custom = join(root, "custom-pi/skills/meta-mode");
  mkdirSync(custom, { recursive: true });
  const original = "---\nname: meta-mode\ndescription: My unrelated workflow\n---\nKeep this custom skill.\n";
  writeFileSync(join(custom, "SKILL.md"), original);
  writeFileSync(join(custom, "notes.txt"), "Keep supporting files.");
  succeeded(run(["--harness", "codex", "--skill", "meta-mode", "--migrate", "--replace"], env));
  assert.equal(readFileSync(join(custom, "SKILL.md"), "utf8"), original);
  assert.equal(readFileSync(join(custom, "notes.txt"), "utf8"), "Keep supporting files.");
  assert.deepEqual(readdirSync(custom).sort(), ["SKILL.md", "notes.txt"]);
  assert.equal(installedText(root, ".agents/skills", "meta-mode"), readFileSync(resolve("skills/meta-mode/SKILL.md"), "utf8"));
});
