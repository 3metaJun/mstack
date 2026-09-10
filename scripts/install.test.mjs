import assert from "node:assert/strict";
import {
  cpSync,
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
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { localPathKey, stagingPath, targetPathsOverlap } from "./install-paths.mjs";

const installer = resolve("scripts", "install.mjs");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "harness skills 测试-"));
  return {
    root,
    env: {
      ...process.env,
      HARNESS_SKILLS_CODEX_DIR: join(root, "codex skills"),
      HARNESS_SKILLS_CLAUDE_DIR: join(root, "claude skills"),
      HARNESS_SKILLS_OPENCODE_DIR: join(root, "opencode skills"),
      HARNESS_SKILLS_PI_DIR: join(root, "pi skills"),
    },
  };
}

function run(arguments_, env) {
  return spawnSync(process.execPath, [installer, ...arguments_], {
    cwd: resolve("."),
    env,
    encoding: "utf8",
  });
}

function copiedInstallerFixture() {
  const root = mkdtempSync(join(tmpdir(), "mstack-copied-installer-test-"));
  const repository = join(root, "repository");
  mkdirSync(repository);
  for (const directory of ["scripts", "profiles", "adapters", "agents"]) {
    cpSync(resolve(directory), join(repository, directory), { recursive: true });
  }
  mkdirSync(join(repository, "skills"));
  return {
    root,
    repository,
    installer: join(repository, "scripts", "install.mjs"),
    remoteInstaller: join(repository, "scripts", "remote-install.mjs"),
    env: {
      ...process.env,
      HARNESS_SKILLS_CODEX_DIR: join(root, "install", "skills"),
    },
  };
}

function runCopied(script, arguments_, env, cwd) {
  return spawnSync(process.execPath, [script, ...arguments_], {
    cwd,
    env,
    encoding: "utf8",
  });
}

test("stages each item beside its final target", () => {
  const target = join("custom-volume", "shared", "agents");
  const staged = stagingPath(target, "2026-09-10-1234", 2);
  assert.equal(dirname(staged), dirname(target));
  assert.match(staged, /\.harness-skills-stage-2026-09-10-1234-2$/);
});

test("detects overlapping install targets", () => {
  assert.equal(targetPathsOverlap(join("root", "skills", "meta-mode"), join("root", "skills", "meta-mode", "agents")), true);
  assert.equal(targetPathsOverlap(join("root", "skills", "meta-mode"), join("root", "skills", "setup-mstack")), false);
});

test("treats local macOS targets as case-insensitive", () => {
  const upper = join("root", "Skills", "Meta-Mode");
  const lower = join("root", "skills", "meta-mode");
  assert.equal(localPathKey(upper, "darwin"), localPathKey(lower, "darwin"));
  assert.equal(targetPathsOverlap(upper, join(lower, "agents"), "darwin"), true);
  assert.notEqual(localPathKey(upper, "linux"), localPathKey(lower, "linux"));
});

test("dry-run reports a plan without creating target directories", () => {
  const { root, env } = fixture();
  try {
    const result = run(["--harness", "all", "--dry-run"], env);
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /install: show-me-your-work/);
    assert.equal(existsSync(env.HARNESS_SKILLS_CODEX_DIR), false);
    assert.equal(existsSync(env.HARNESS_SKILLS_CLAUDE_DIR), false);
    assert.equal(existsSync(env.HARNESS_SKILLS_OPENCODE_DIR), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uses pi's agent directory for the default skill target", () => {
  const { env } = fixture();
  env.USERPROFILE = join(env.TEMP ?? tmpdir(), "mstack-pi-home");
  env.HOME = env.USERPROFILE;
  delete env.HARNESS_SKILLS_PI_DIR;

  const result = run(["--harness", "pi", "--skill", "meta-mode", "--dry-run"], env);
  assert.equal(result.status, 0, result.stderr);
  assert.ok(result.stdout.includes(join(env.USERPROFILE, ".pi", "agent", "skills")));
});

test("installs harness-specific frontmatter and preserves conflicts", () => {
  const { root, env } = fixture();
  try {
    const first = run(["--harness", "all"], env);
    assert.equal(first.status, 0, first.stderr);

    const codexPath = join(env.HARNESS_SKILLS_CODEX_DIR, "show-me-your-work", "SKILL.md");
    const claudePath = join(env.HARNESS_SKILLS_CLAUDE_DIR, "show-me-your-work", "SKILL.md");
    const opencodePath = join(env.HARNESS_SKILLS_OPENCODE_DIR, "show-me-your-work", "SKILL.md");
    const piPath = join(env.HARNESS_SKILLS_PI_DIR, "show-me-your-work", "SKILL.md");
    const codex = readFileSync(codexPath, "utf8");
    const claude = readFileSync(claudePath, "utf8");
    const opencode = readFileSync(opencodePath, "utf8");
    const pi = readFileSync(piPath, "utf8");
    assert.match(codex, /^metadata:/m);
    assert.doesNotMatch(codex, /^compatibility:/m);
    for (const adapted of [claude, opencode, pi]) {
      assert.match(adapted, /^compatibility:/m);
      assert.doesNotMatch(adapted, /^metadata:/m);
      assert.doesNotMatch(adapted, /The included logger requires/i);
    }

    const marker = join(env.HARNESS_SKILLS_CODEX_DIR, "blast-radius", "marker.txt");
    writeFileSync(marker, "keep me", "utf8");
    const conflict = run(["--harness", "codex"], env);
    assert.notEqual(conflict.status, 0);
    assert.equal(readFileSync(marker, "utf8"), "keep me");

    const replaced = run(["--harness", "codex", "--replace"], env);
    assert.equal(replaced.status, 0, replaced.stderr);
    assert.equal(existsSync(marker), false);
    const backupRoot = join(env.HARNESS_SKILLS_CODEX_DIR, ".harness-skills-backups");
    const backupMarker = findFile(backupRoot, "marker.txt");
    assert.equal(readFileSync(backupMarker, "utf8"), "keep me");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("keeps skill backups and failed replacements beside their actual targets", () => {
  const { root, env } = fixture();
  const codexTarget = join(env.HARNESS_SKILLS_CODEX_DIR, "meta-mode");
  const claudeTarget = join(env.HARNESS_SKILLS_CLAUDE_DIR, "meta-mode");
  mkdirSync(codexTarget, { recursive: true });
  mkdirSync(claudeTarget, { recursive: true });
  writeFileSync(join(codexTarget, "marker.txt"), "old codex", "utf8");
  writeFileSync(join(claudeTarget, "marker.txt"), "old claude", "utf8");
  writeFileSync(join(env.HARNESS_SKILLS_CLAUDE_DIR, ".harness-skills-backups"), "block", "utf8");

  try {
    const result = run(
      ["--harness", "codex,claude", "--skill", "meta-mode", "--replace"],
      env,
    );
    assert.notEqual(result.status, 0);
    assert.equal(readFileSync(join(codexTarget, "marker.txt"), "utf8"), "old codex");
    assert.equal(readFileSync(join(claudeTarget, "marker.txt"), "utf8"), "old claude");
    assert.ok(
      findFile(join(env.HARNESS_SKILLS_CODEX_DIR, ".harness-skills-failed"), "SKILL.md"),
      "expected the rolled-back replacement beside the Codex skill target",
    );
    assert.equal(existsSync(join(root, ".harness-skills-failed")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("continues rollback after one target cannot be restored", () => {
  const { root, env } = fixture();
  const targets = Object.fromEntries(
    ["codex", "claude", "opencode"].map((harness) => [
      harness,
      join(env[`HARNESS_SKILLS_${harness.toUpperCase()}_DIR`], "meta-mode"),
    ]),
  );
  for (const [harness, target] of Object.entries(targets)) {
    mkdirSync(target, { recursive: true });
    writeFileSync(join(target, "marker.txt"), `old ${harness}`, "utf8");
  }
  writeFileSync(join(env.HARNESS_SKILLS_CLAUDE_DIR, ".harness-skills-failed"), "block rollback", "utf8");
  writeFileSync(join(env.HARNESS_SKILLS_OPENCODE_DIR, ".harness-skills-backups"), "block commit", "utf8");

  try {
    const result = run(
      ["--harness", "codex,claude,opencode", "--skill", "meta-mode", "--replace"],
      env,
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /\.harness-skills-backups/);
    assert.match(result.stderr, /Rollback results:/);
    assert.match(result.stderr, /restored original/);
    assert.match(result.stderr, /rollback failed/);
    assert.match(result.stderr, /backup retained/);
    assert.equal(readFileSync(join(targets.codex, "marker.txt"), "utf8"), "old codex");
    assert.equal(readFileSync(join(targets.opencode, "marker.txt"), "utf8"), "old opencode");
    assert.equal(
      readFileSync(findFile(join(env.HARNESS_SKILLS_CLAUDE_DIR, ".harness-skills-backups"), "marker.txt"), "utf8"),
      "old claude",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects duplicate harnesses and aliased target roots", () => {
  const duplicateFixture = fixture();
  const aliasFixture = fixture();
  try {
    const duplicate = run(["--harness", "codex,codex"], duplicateFixture.env);
    assert.notEqual(duplicate.status, 0);
    assert.match(duplicate.stderr, /Duplicate harness/);

    aliasFixture.env.HARNESS_SKILLS_CLAUDE_DIR = aliasFixture.env.HARNESS_SKILLS_CODEX_DIR;
    const alias = run(["--harness", "codex,claude"], aliasFixture.env);
    assert.notEqual(alias.status, 0);
    assert.match(alias.stderr, /same target directory/);
  } finally {
    rmSync(duplicateFixture.root, { recursive: true, force: true });
    rmSync(aliasFixture.root, { recursive: true, force: true });
  }
});

test("rejects invalid skill filters", () => {
  const { root, env } = fixture();
  try {
    const missing = run(["--harness", "codex", "--skill"], env);
    assert.notEqual(missing.status, 0);
    assert.match(missing.stderr, /requires one or more/);

    const unknown = run(["--harness", "codex", "--skill", "not-a-skill"], env);
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /Unknown skill/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("installs only selected skills", () => {
  const { root, env } = fixture();
  try {
    const result = run(
      ["--harness", "all", "--skill", "writing-for-agents,codebase-design,diagnosing-bugs"],
      env,
    );
    assert.equal(result.status, 0, result.stderr);
    for (const target of [
      env.HARNESS_SKILLS_CODEX_DIR,
      env.HARNESS_SKILLS_CLAUDE_DIR,
      env.HARNESS_SKILLS_OPENCODE_DIR,
      env.HARNESS_SKILLS_PI_DIR,
    ]) {
      assert.deepEqual(readdirSync(target).sort(), [
        "codebase-design",
        "diagnosing-bugs",
        "writing-for-agents",
      ]);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("uses a named environment for selected harness targets", () => {
  const { root, env } = fixture();
  const environmentFile = join(root, "environments.json");
  const target = join(root, "fleet opencode skills");
  writeFileSync(environmentFile, JSON.stringify({ fleet: { targets: { opencode: target } }}), "utf8");
  env.MSTACK_ENVIRONMENTS_FILE = environmentFile;
  try {
    const result = run(["--harness", "opencode", "--environment", "fleet", "--skill", "meta-mode"], env);
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(target, "meta-mode", "SKILL.md")), true);
    assert.match(result.stdout, new RegExp(target.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects empty and whitespace-only environment targets", () => {
  for (const invalidTarget of ["", "   "]) {
    const { root, env } = fixture();
    const environmentFile = join(root, "environments.json");
    writeFileSync(
      environmentFile,
      JSON.stringify({ fleet: { targets: { codex: invalidTarget } } }),
      "utf8",
    );
    env.MSTACK_ENVIRONMENTS_FILE = environmentFile;
    try {
      const result = run(
        ["--harness", "codex", "--environment", "fleet", "--skill", "meta-mode", "--dry-run"],
        env,
      );
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /has no target for: codex/);
      assert.equal(existsSync(env.HARNESS_SKILLS_CODEX_DIR), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("installs selected optional artifacts without skills", () => {
  const { root, env } = fixture();
  try {
    const result = run(
      ["--harness", "codex", "--no-skills", "--artifact", "agents,meta-mode-tools"],
      env,
    );
    assert.equal(result.status, 0, result.stderr);
    const configRoot = join(root, "codex skills", "..");
    assert.equal(existsSync(join(configRoot, "agents", "meta-agent.md")), true);
    assert.equal(existsSync(join(configRoot, "agents", "comment-reviewer.md")), true);
    assert.equal(existsSync(join(configRoot, "tools", "meta-mode", "package.json")), true);
    assert.equal(existsSync(env.HARNESS_SKILLS_CODEX_DIR), false);
    assert.match(result.stdout, /Installed 0 skill copies and 2 artifact copies/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("supports per-artifact environment paths", () => {
  const { root, env } = fixture();
  const environmentFile = join(root, "environments.json");
  const skillTarget = join(root, "fleet", "opencode", "skills");
  const agentTarget = join(root, "fleet", "shared", "agents");
  writeFileSync(
    environmentFile,
    JSON.stringify({
      fleet: {
        targets: { opencode: skillTarget },
        artifacts: { agents: { opencode: agentTarget } },
      },
    }),
    "utf8",
  );
  env.MSTACK_ENVIRONMENTS_FILE = environmentFile;
  try {
    const result = run(
      ["--harness", "opencode", "--environment", "fleet", "--no-skills", "--artifact", "agents"],
      env,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(agentTarget, "meta-agent.md")), true);
    assert.equal(existsSync(join(skillTarget)), false);
    assert.match(result.stdout, new RegExp(agentTarget.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.equal(
      readdirSync(dirname(agentTarget)).some((name) => name.startsWith(".harness-skills-stage-")),
      false,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("replaces a custom artifact with a backup on the artifact target volume", () => {
  const { root, env } = fixture();
  const environmentFile = join(root, "environments.json");
  const skillTarget = join(root, "fleet", "opencode", "skills");
  const agentTarget = join(root, "separate artifact root", "agents");
  writeFileSync(
    environmentFile,
    JSON.stringify({
      fleet: {
        targets: { opencode: skillTarget },
        artifacts: { agents: { opencode: agentTarget } },
      },
    }),
    "utf8",
  );
  mkdirSync(agentTarget, { recursive: true });
  writeFileSync(join(agentTarget, "marker.txt"), "old artifact", { encoding: "utf8", flag: "wx" });
  env.MSTACK_ENVIRONMENTS_FILE = environmentFile;
  try {
    const result = run(
      [
        "--harness", "opencode",
        "--environment", "fleet",
        "--no-skills",
        "--artifact", "agents",
        "--replace",
      ],
      env,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(agentTarget, "meta-agent.md")), true);
    const backupMarker = findFile(join(dirname(agentTarget), ".harness-skills-backups"), "marker.txt");
    assert.equal(readFileSync(backupMarker, "utf8"), "old artifact");
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("deduplicates a shared artifact target across harnesses", () => {
  const { root, env } = fixture();
  const environmentFile = join(root, "environments.json");
  const sharedAgents = join(root, "fleet", "shared", "agents");
  writeFileSync(
    environmentFile,
    JSON.stringify({
      fleet: {
        targets: {
          codex: join(root, "fleet", "codex", "skills"),
          claude: join(root, "fleet", "claude", "skills"),
        },
        artifacts: { agents: { codex: sharedAgents, claude: sharedAgents } },
      },
    }),
    "utf8",
  );
  env.MSTACK_ENVIRONMENTS_FILE = environmentFile;
  try {
    const result = run(
      ["--harness", "codex,claude", "--environment", "fleet", "--no-skills", "--artifact", "agents"],
      env,
    );
    assert.equal(result.status, 0, result.stderr);
    assert.equal(existsSync(join(sharedAgents, "meta-agent.md")), true);
    assert.match(result.stdout, /Installed 0 skill copies and 1 artifact copies/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects unsupported artifacts and invalid artifact filters", () => {
  const { root, env } = fixture();
  try {
    const unsupported = run(["--harness", "codex", "--no-skills", "--artifact", "benny"], env);
    assert.notEqual(unsupported.status, 0);
    assert.match(unsupported.stderr, /Unsupported artifact selection/);

    const unknown = run(["--harness", "codex", "--no-skills", "--artifact", "nope"], env);
    assert.notEqual(unknown.status, 0);
    assert.match(unknown.stderr, /Unknown artifact/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects symlinks in selected source trees", () => {
  const fixture_ = copiedInstallerFixture();
  const outside = join(fixture_.root, "outside");
  mkdirSync(outside);
  writeFileSync(join(outside, "marker.txt"), "outside", "utf8");
  symlinkSync(
    outside,
    join(fixture_.repository, "agents", "linked-outside"),
    process.platform === "win32" ? "junction" : "dir",
  );

  try {
    const result = runCopied(
      fixture_.installer,
      ["--harness", "codex", "--no-skills", "--artifact", "agents", "--dry-run"],
      fixture_.env,
      fixture_.repository,
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /rejects symbolic links/i);
    assert.equal(existsSync(join(fixture_.root, "install", "agents")), false);
  } finally {
    rmSync(fixture_.root, { recursive: true, force: true });
  }
});

test("rejects unsafe artifact paths in local and remote dry runs", () => {
  const fixture_ = copiedInstallerFixture();
  const profilePath = join(fixture_.repository, "profiles", "artifacts.json");
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  profile.artifacts.agents.path = ["..", "escaped-agents"];
  writeFileSync(profilePath, JSON.stringify(profile), "utf8");
  const environmentFile = join(fixture_.root, "environments.json");
  writeFileSync(environmentFile, JSON.stringify({
    fleet: {
      transport: "ssh",
      host: "dev@example",
      targets: { codex: "/srv/codex/skills" },
    },
  }), "utf8");

  try {
    const local = runCopied(
      fixture_.installer,
      ["--harness", "codex", "--no-skills", "--artifact", "agents", "--dry-run"],
      fixture_.env,
      fixture_.repository,
    );
    assert.notEqual(local.status, 0);
    assert.match(local.stderr, /safe non-empty path array/);

    const remote = runCopied(
      fixture_.remoteInstaller,
      ["--harness", "codex", "--environment", "fleet", "--no-skills", "--artifact", "agents", "--dry-run"],
      { ...fixture_.env, MSTACK_ENVIRONMENTS_FILE: environmentFile },
      fixture_.repository,
    );
    assert.notEqual(remote.status, 0);
    assert.match(remote.stderr, /safe non-empty path array/);
    assert.equal(existsSync(join(fixture_.root, "escaped-agents")), false);
  } finally {
    rmSync(fixture_.root, { recursive: true, force: true });
  }
});

test("rejects artifact sources outside the repository", () => {
  const fixture_ = copiedInstallerFixture();
  const profilePath = join(fixture_.repository, "profiles", "artifacts.json");
  const profile = JSON.parse(readFileSync(profilePath, "utf8"));
  profile.artifacts.agents.source = "../outside";
  writeFileSync(profilePath, JSON.stringify(profile), "utf8");
  mkdirSync(join(fixture_.root, "outside"));

  try {
    const result = runCopied(
      fixture_.installer,
      ["--harness", "codex", "--no-skills", "--artifact", "agents", "--dry-run"],
      fixture_.env,
      fixture_.repository,
    );
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /source must stay within the repository/);
  } finally {
    rmSync(fixture_.root, { recursive: true, force: true });
  }
});

function findFile(root, name) {
  const entries = readdirSync(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      const found = findFile(path, name);
      if (found) return found;
    } else if (entry.name === name) {
      return path;
    }
  }
  return undefined;
}
