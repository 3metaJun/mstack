import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const optimizer = resolve("scripts", "optimize-context.mjs");
const reconciler = resolve("scripts", "reconcile-context.mjs");
const modelConfig = resolve("scripts", "model-config.mjs");
const runRole = resolve("scripts", "run-role.mjs");

function fixture(prefix) {
  return mkdtempSync(join(tmpdir(), `${prefix} 测试-`));
}

function run(script, arguments_, env) {
  return spawnSync(process.execPath, [script, ...arguments_], {
    cwd: resolve("."),
    env: { ...process.env, ...env },
    encoding: "utf8",
  });
}

function write(path, content) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

test("context profile preserves metadata and converges", () => {
  const root = fixture("context-profile");
  try {
    const skillsRoot = join(root, "agent skills");
    const skillRoot = join(skillsRoot, "router");
    const skillPath = join(skillRoot, "SKILL.md");
    const metadataPath = join(skillRoot, "agents", "openai.yaml");
    const profilePath = join(root, "profile.json");
    write(
      skillPath,
      `---\nname: router\ndescription: >\n  A long routing description.\nmetadata:\n  owner: upstream\n---\n\n# Router\n`,
    );
    write(metadataPath, "interface:\n  display_name: Router\n");
    writeFileSync(
      profilePath,
      `${JSON.stringify({ explicitOnly: ["router"], descriptionOverrides: { router: "Short boundary." } }, null, 2)}\n`,
      "utf8",
    );

    const applied = run(optimizer, ["--profile", profilePath, "--apply"], {
      HARNESS_SKILLS_AGENT_DIR: skillsRoot,
    });
    assert.equal(applied.status, 0, applied.stderr);
    assert.match(readFileSync(skillPath, "utf8"), /description: "Short boundary\."/);
    assert.match(readFileSync(skillPath, "utf8"), /^metadata:\n  owner: upstream$/m);
    const metadata = readFileSync(metadataPath, "utf8");
    assert.match(metadata, /^interface:\n  display_name: Router$/m);
    assert.match(metadata, /^policy:\n  allow_implicit_invocation: false$/m);

    const repeated = run(optimizer, ["--profile", profilePath, "--apply"], {
      HARNESS_SKILLS_AGENT_DIR: skillsRoot,
    });
    assert.equal(repeated.status, 0, repeated.stderr);
    assert.match(repeated.stdout, /already applied/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reconciliation moves only equivalent bundles into a backup", () => {
  const root = fixture("context-reconcile");
  try {
    const agentsRoot = join(root, "agent skills");
    const codexHome = join(root, "codex home");
    const codexRoot = join(codexHome, "skills");
    const skill = "---\nname: alpha\ndescription: Alpha.\n---\n\n# Alpha\n";
    write(join(agentsRoot, "alpha", "SKILL.md"), skill);
    write(join(codexRoot, "alpha", "SKILL.md"), skill.replaceAll("\n", "\r\n"));
    write(join(agentsRoot, "beta", "SKILL.md"), skill.replace("alpha", "beta"));
    write(join(codexRoot, "beta", "SKILL.md"), skill.replace("alpha", "different"));

    const applied = run(reconciler, ["--apply"], {
      CODEX_HOME: codexHome,
      HARNESS_SKILLS_AGENT_DIR: agentsRoot,
    });
    assert.equal(applied.status, 0, applied.stderr);
    assert.match(applied.stdout, /Skipped different same-name bundles: beta/);
    assert.equal(existsSync(join(codexRoot, "alpha")), false);
    assert.equal(existsSync(join(codexRoot, "beta", "SKILL.md")), true);
    assert.equal(existsSync(join(agentsRoot, "alpha", "SKILL.md")), true);
    const backups = readdirSync(join(codexHome, ".skill-context-backups"));
    assert.equal(backups.length, 1);
    assert.equal(existsSync(join(codexHome, ".skill-context-backups", backups[0], "alpha", "SKILL.md")), true);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("reconciliation preserves bundles containing directory links", () => {
  const root = fixture("context-reconcile-link");
  try {
    const agentsRoot = join(root, "agent skills");
    const codexHome = join(root, "codex home");
    const codexRoot = join(codexHome, "skills");
    const sharedRoot = join(root, "shared assets");
    const skill = "---\nname: linked\ndescription: Linked.\n---\n\n# Linked\n";
    write(join(agentsRoot, "linked", "SKILL.md"), skill);
    write(join(codexRoot, "linked", "SKILL.md"), skill);
    write(join(sharedRoot, "reference.txt"), "shared\n");
    symlinkSync(sharedRoot, join(agentsRoot, "linked", "reference"), process.platform === "win32" ? "junction" : "dir");
    symlinkSync(sharedRoot, join(codexRoot, "linked", "reference"), process.platform === "win32" ? "junction" : "dir");

    const applied = run(reconciler, ["--apply"], {
      CODEX_HOME: codexHome,
      HARNESS_SKILLS_AGENT_DIR: agentsRoot,
    });
    assert.equal(applied.status, 0, applied.stderr);
    assert.match(applied.stdout, /Skipped different same-name bundles: linked/);
    assert.equal(existsSync(join(codexRoot, "linked", "SKILL.md")), true);
    assert.equal(existsSync(join(codexHome, ".skill-context-backups")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("model configuration resolves harness overrides and rejects unknown roles", () => {
  const root = fixture("model-config");
  const configPath = join(root, "models.json");
  try {
    writeFileSync(
      configPath,
      `${JSON.stringify({
        roles: { implementer: "parent-model", reviewer: "review-model" },
        overrides: { opencode: { implementer: "remote-model" } },
      })}\n`,
      "utf8",
    );
    const resolved = run(modelConfig, ["--file", configPath, "--harness", "opencode"]);
    assert.equal(resolved.status, 0, resolved.stderr);
    assert.match(resolved.stdout, /opencode:.*remote-model/);
    assert.match(resolved.stdout, /reviewer.*review-model/);

    writeFileSync(
      configPath,
      `${JSON.stringify({ roles: { implementer: "parent-model" }, overrides: { pi: { reviewer: "missing" } } })}\n`,
      "utf8",
    );
    const invalid = run(modelConfig, ["--file", configPath]);
    assert.notEqual(invalid.status, 0);
    assert.match(invalid.stderr, /has no role default/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("run-role emits a harness command and omits inherited model flags", () => {
  const result = run(runRole, [
    "--harness",
    "pi",
    "--role",
    "implementer",
    "--prompt",
    "inspect the repository",
  ]);
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.equal(plan.harness, "pi");
  assert.equal(plan.model, "inherit-parent");
  assert.equal(plan.command, "pi");
  assert.deepEqual(plan.args, ["-p", "--no-session", "inspect the repository"]);
});

test("run-role resolves a configured model override", () => {
  const root = fixture("run-role");
  const configPath = join(root, "models.json");
  try {
    writeFileSync(
      configPath,
      `${JSON.stringify({ roles: { implementer: "parent-model" }, overrides: { opencode: { implementer: "remote-model" } } })}\n`,
      "utf8",
    );
    const result = run(runRole, [
      "--harness",
      "opencode",
      "--role",
      "implementer",
      "--prompt",
      "inspect the repository",
      "--file",
      configPath,
    ]);
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.model, "remote-model");
    assert.deepEqual(plan.args, ["run", "--pure", "--model", "remote-model", "inspect the repository"]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
