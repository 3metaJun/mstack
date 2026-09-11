import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { buildRemoteCommand, buildSshInvocation, parseRemoteStage } from "./environment-lib.mjs";

const runRole = resolve("scripts", "run-role.mjs");
const installer = resolve("scripts", "install.mjs");
const remoteInstaller = resolve("scripts", "remote-install.mjs");

test("POSIX remote commands quote prompt and cwd as one invocation", () => {
  const command = buildRemoteCommand({
    shell: "posix",
    command: "pi",
    args: ["-p", "say 'hello'; do not edit"],
    cwd: "/srv/work tree",
  });
  assert.equal(command, "cd -- '/srv/work tree' && 'pi' '-p' 'say '\"'\"'hello'\"'\"'; do not edit'");
});

test("PowerShell remote commands use an encoded script", () => {
  const command = buildRemoteCommand({
    shell: "powershell",
    command: "codex",
    args: ["exec", "say 'hello'"],
    cwd: "C:\\work tree",
  });
  const encoded = command.split(" ").at(-1);
  const decoded = Buffer.from(encoded, "base64").toString("utf16le");
  assert.match(decoded, /Set-Location -LiteralPath 'C:\\work tree'/);
  assert.match(decoded, /say ''hello''/);
});

test("remote stage paths must stay under the requested parent", () => {
  assert.equal(
    parseRemoteStage("banner\n/srv/project/.mstack-stage.a1B2c3", "/srv/project"),
    "/srv/project/.mstack-stage.a1B2c3",
  );
  assert.throws(() => parseRemoteStage("/srv/other/.mstack-stage.a1B2c3", "/srv/project"), /invalid/);
  assert.throws(() => parseRemoteStage("/srv/project", "/srv/project"), /invalid/);
});

test("run-role emits an SSH plan for a named environment", () => {
  const root = mkdtempSync(join(tmpdir(), "mstack-environment-test-"));
  const configPath = join(root, "environments.json");
  writeFileSync(configPath, JSON.stringify({
    fleet: {
      transport: "ssh",
      host: "dev@tailnet-host",
      shell: "posix",
      cwd: "/srv/project",
      targets: { pi: "/home/dev/.pi/agent/skills" },
      sshArgs: ["-o", "BatchMode=yes"],
    },
  }), "utf8");
  try {
    const result = spawnSync(process.execPath, [runRole,
      "--harness", "pi",
      "--role", "explorer",
      "--prompt", "say 'hello'; do not edit",
      "--environment", "fleet",
      "--file", join(root, "missing-models.json"),
    ], { cwd: resolve("."), env: { ...process.env, MSTACK_ENVIRONMENTS_FILE: configPath }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    const plan = JSON.parse(result.stdout);
    assert.equal(plan.environment, "fleet");
    assert.equal(plan.transport, "ssh");
    assert.equal(plan.command, "ssh");
    assert.deepEqual(plan.args.slice(0, 3), ["-o", "BatchMode=yes", "dev@tailnet-host"]);
    assert.match(plan.args.at(-1), /cd -- '\/srv\/project'/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("environment consumers reject a relative MSTACK_ENVIRONMENTS_FILE", () => {
  const root = mkdtempSync(join(tmpdir(), "mstack-relative-environment-test-"));
  const configPath = join(root, "environments.json");
  writeFileSync(configPath, JSON.stringify({
    fleet: {
      targets: { codex: join(root, "codex", "skills") },
    },
  }), "utf8");
  const env = { ...process.env, MSTACK_ENVIRONMENTS_FILE: "environments.json" };
  try {
    const installResult = spawnSync(process.execPath, [installer,
      "--harness", "codex",
      "--environment", "fleet",
      "--skill", "meta-mode",
      "--dry-run",
    ], { cwd: root, env, encoding: "utf8" });
    const roleResult = spawnSync(process.execPath, [runRole,
      "--harness", "codex",
      "--role", "explorer",
      "--prompt", "inspect",
      "--environment", "fleet",
      "--file", join(root, "missing-models.json"),
    ], { cwd: root, env, encoding: "utf8" });

    for (const result of [installResult, roleResult]) {
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /MSTACK_ENVIRONMENTS_FILE must be an absolute path or start with ~\//);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("Codex runtime uses flags supported by the current exec CLI", () => {
  const result = spawnSync(process.execPath, [runRole,
    "--harness", "codex",
    "--role", "explorer",
    "--prompt", "inspect the repository",
  ], { cwd: resolve("."), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.deepEqual(plan.args.slice(0, 3), ["exec", "--sandbox", "read-only"]);
  assert.doesNotMatch(result.stdout, /ask-for-approval/);
});

test("OpenCode read-only plans select the built-in plan agent", () => {
  const result = spawnSync(process.execPath, [runRole,
    "--harness", "opencode",
    "--role", "explorer",
    "--prompt", "inspect the repository",
    "--read-only",
  ], { cwd: resolve("."), encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const plan = JSON.parse(result.stdout);
  assert.deepEqual(plan.args, ["run", "--pure", "inspect the repository", "--agent", "plan"]);
});

test("SSH invocation rejects an unsafe host before spawning", () => {
  assert.throws(
    () => buildSshInvocation({ transport: "ssh", host: "dev;touch", shell: "posix" }, "pi", [], undefined),
    /host/,
  );
});

test("installer delegates an SSH environment to a no-connect dry run", () => {
  const root = mkdtempSync(join(tmpdir(), "mstack-remote-install-test-"));
  const configPath = join(root, "environments.json");
  writeFileSync(configPath, JSON.stringify({
    fleet: {
      transport: "ssh",
      host: "dev@tailnet-host",
      targets: { pi: "/home/dev/.pi/agent/skills" },
    },
  }), "utf8");
  try {
    const result = spawnSync(process.execPath, [installer,
      "--harness", "pi",
      "--environment", "fleet",
      "--skill", "meta-mode",
      "--dry-run",
    ], { cwd: resolve("."), env: { ...process.env, MSTACK_ENVIRONMENTS_FILE: configPath }, encoding: "utf8" });
    assert.equal(result.status, 0, result.stderr);
    assert.match(result.stdout, /ssh environment fleet: dev@tailnet-host/);
    assert.match(result.stdout, /meta-mode -> \/home\/dev\/\.pi\/agent\/skills\/meta-mode/);
    assert.match(result.stdout, /No remote connection was opened/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("remote Codex agents use the official directory from either standard skill path", () => {
  const root = mkdtempSync(join(tmpdir(), "mstack-remote-codex-agents-test-"));
  const configPath = join(root, "environments.json");
  try {
    for (const target of ["/home/dev/.agents/skills", "/home/dev/.codex/skills"]) {
      writeFileSync(configPath, JSON.stringify({
        fleet: {
          transport: "ssh",
          host: "dev@tailnet-host",
          shell: "posix",
          targets: { codex: target },
        },
      }), "utf8");
      const result = spawnSync(process.execPath, [remoteInstaller,
        "--harness", "codex",
        "--environment", "fleet",
        "--no-skills",
        "--artifact", "agents",
        "--dry-run",
      ], { cwd: resolve("."), env: { ...process.env, MSTACK_ENVIRONMENTS_FILE: configPath }, encoding: "utf8" });
      assert.equal(result.status, 0, result.stderr);
      assert.match(result.stdout, /agents -> \/home\/dev\/\.codex\/agents\r?\n/, target);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("custom remote Codex skill paths require an explicit agent target before connecting", () => {
  const root = mkdtempSync(join(tmpdir(), "mstack-remote-custom-codex-test-"));
  const configPath = join(root, "environments.json");
  const helperPath = join(root, "fake-transport.mjs");
  const logPath = join(root, "transport.log");
  writeFileSync(helperPath, [
    'import { appendFileSync } from "node:fs";',
    'appendFileSync(process.env.MSTACK_FAKE_TRANSPORT_LOG, "connected\\n");',
    'process.exit(91);',
  ].join("\n"), "utf8");
  try {
    for (const target of ["/srv/mstack/skills", "/home/dev/.agents/custom-skills"]) {
      const environment = {
        transport: "ssh",
        host: "dev@tailnet-host",
        targets: { codex: target },
        sshCommand: process.execPath,
        sshArgs: [helperPath],
      };
      const env = {
        ...process.env,
        MSTACK_ENVIRONMENTS_FILE: configPath,
        MSTACK_FAKE_TRANSPORT_LOG: logPath,
      };
      const args = [remoteInstaller,
        "--harness", "codex",
        "--environment", "fleet",
        "--no-skills",
        "--artifact", "agents",
      ];
      writeFileSync(configPath, JSON.stringify({ fleet: environment }), "utf8");
      const missing = spawnSync(process.execPath, args, { cwd: resolve("."), env, encoding: "utf8" });
      assert.notEqual(missing.status, 0);
      assert.match(missing.stderr, /artifacts\.agents\.codex/, target);
      assert.equal(existsSync(logPath), false, "invalid paths must fail before connecting");

      for (const artifacts of [
        { agents: { codex: "/srv/custom-codex/agents" } },
        { codex: { agents: "/srv/custom-codex/agents" } },
      ]) {
        writeFileSync(configPath, JSON.stringify({ fleet: { ...environment, artifacts } }), "utf8");
        const explicit = spawnSync(process.execPath, [...args, "--dry-run"], {
          cwd: resolve("."), env, encoding: "utf8",
        });
        assert.equal(explicit.status, 0, explicit.stderr);
        assert.match(explicit.stdout, /agents -> \/srv\/custom-codex\/agents\r?\n/);
      }
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("SSH environment transport overrides are validated before spawning", () => {
  const root = mkdtempSync(join(tmpdir(), "mstack-remote-config-test-"));
  const configPath = join(root, "environments.json");
  writeFileSync(configPath, JSON.stringify({
    fleet: {
      transport: "ssh",
      host: "dev@tailnet-host",
      targets: { pi: "/home/dev/.pi/agent/skills" },
      rsyncArgs: [true],
    },
  }), "utf8");
  try {
    const result = spawnSync(process.execPath, [remoteInstaller,
      "--harness", "pi",
      "--environment", "fleet",
      "--skill", "meta-mode",
      "--dry-run",
    ], { cwd: resolve("."), env: { ...process.env, MSTACK_ENVIRONMENTS_FILE: configPath }, encoding: "utf8" });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /rsyncArgs must be an array of strings/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("remote installer passes an unquoted rsync destination argument", () => {
  const root = mkdtempSync(join(tmpdir(), "mstack-remote-rsync-test-"));
  const configPath = join(root, "environments.json");
  const helperPath = join(root, "fake-transport.mjs");
  const logPath = join(root, "transport.log");
  writeFileSync(helperPath, [
    'import { appendFileSync } from "node:fs";',
    'const [mode, ...args] = process.argv.slice(2);',
    'appendFileSync(process.env.MSTACK_FAKE_TRANSPORT_LOG, JSON.stringify({ mode, args }) + "\\n");',
    'if (mode === "ssh" && args.at(-1)?.includes("mktemp -d")) { console.log("/srv/mstack remote/pi/skills/.mstack-stage.fake"); console.error("Authorized use only"); }',
  ].join("\n"), "utf8");
  writeFileSync(configPath, JSON.stringify({
    fleet: {
      transport: "ssh",
      host: "dev@tailnet-host",
      shell: "posix",
      targets: { pi: "/srv/mstack remote/pi/skills" },
      sshCommand: process.execPath,
      sshArgs: [helperPath, "ssh"],
      rsyncCommand: process.execPath,
      rsyncArgs: [helperPath, "rsync"],
    },
  }), "utf8");
  try {
    const result = spawnSync(process.execPath, [installer,
      "--harness", "pi",
      "--environment", "fleet",
      "--skill", "meta-mode",
    ], {
      cwd: resolve("."),
      env: {
        ...process.env,
        MSTACK_ENVIRONMENTS_FILE: configPath,
        MSTACK_FAKE_TRANSPORT_LOG: logPath,
      },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const calls = readFileSync(logPath, "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    const rsync = calls.find((call) => call.mode === "rsync");
    assert.ok(rsync, "expected a fake rsync invocation");
    assert.equal(rsync.args.at(-1), "dev@tailnet-host:/srv/mstack remote/pi/skills/.mstack-stage.fake/");
    assert.doesNotMatch(rsync.args.at(-1), /'/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("remote staging ignores inherited local artifact target overrides", () => {
  const root = mkdtempSync(join(tmpdir(), "mstack-remote-artifact-isolation-test-"));
  const configPath = join(root, "environments.json");
  const helperPath = join(root, "fake-transport.mjs");
  const localArtifact = join(root, "real-local-agents");
  mkdirSync(localArtifact, { recursive: true });
  writeFileSync(join(localArtifact, "marker.txt"), "keep local", "utf8");
  writeFileSync(helperPath, [
    'const [mode, ...args] = process.argv.slice(2);',
    'if (mode === "ssh" && args.at(-1)?.includes("mktemp -d")) console.log("/srv/remote/.codex/.mstack-stage.fake");',
  ].join("\n"), "utf8");
  writeFileSync(configPath, JSON.stringify({
    fleet: {
      transport: "ssh",
      host: "dev@tailnet-host",
      shell: "posix",
      targets: { codex: "/srv/remote/skills" },
      artifacts: { agents: { codex: "/srv/remote/.codex/agents" } },
      sshCommand: process.execPath,
      sshArgs: [helperPath, "ssh"],
      rsyncCommand: process.execPath,
      rsyncArgs: [helperPath, "rsync"],
    },
  }), "utf8");
  try {
    const result = spawnSync(process.execPath, [remoteInstaller,
      "--harness", "codex",
      "--environment", "fleet",
      "--no-skills",
      "--artifact", "agents",
    ], {
      cwd: resolve("."),
      env: {
        ...process.env,
        MSTACK_ENVIRONMENTS_FILE: configPath,
        MSTACK_ARTIFACT_AGENTS_CODEX_DIR: localArtifact,
      },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.deepEqual(readdirSync(localArtifact), ["marker.txt"]);
    assert.equal(readFileSync(join(localArtifact, "marker.txt"), "utf8"), "keep local");
    assert.equal(existsSync(join(dirname(localArtifact), ".harness-skills-backups")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("remote installer deduplicates artifacts with matching formats and locks every parent in sorted order", () => {
  const root = mkdtempSync(join(tmpdir(), "mstack-remote-shared-artifact-test-"));
  const configPath = join(root, "environments.json");
  const helperPath = join(root, "fake-transport.mjs");
  const logPath = join(root, "transport.log");
  writeFileSync(helperPath, [
    'import { appendFileSync, readFileSync } from "node:fs";',
    'const [mode, ...args] = process.argv.slice(2);',
    'const script = args.at(-1) ?? "";',
    'appendFileSync(process.env.MSTACK_FAKE_TRANSPORT_LOG, JSON.stringify({ mode, args }) + "\\n");',
    'if (mode === "ssh" && script.includes("mktemp -d")) {',
    '  const count = readFileSync(process.env.MSTACK_FAKE_TRANSPORT_LOG, "utf8").split("\\n").filter((line) => line.includes("mktemp -d")).length;',
    '  const template = script.match(/mktemp -d \'([^\']+)\'/)?.[1];',
    '  console.log(template.replace("XXXXXX", `fake-${count}`));',
    '}',
  ].join("\n"), "utf8");
  writeFileSync(configPath, JSON.stringify({
    fleet: {
      transport: "ssh",
      host: "dev@tailnet-host",
      shell: "posix",
      targets: {
        opencode: "/srv/z/opencode/skills",
        claude: "/srv/y/claude/skills",
      },
      artifacts: {
        agents: {
          opencode: "/srv/z/shared-agents",
          claude: "/srv/z/shared-agents",
        },
        guide: {
          opencode: "/srv/m/docs/guide",
          claude: "/srv/a/docs/guide",
        },
      },
      sshCommand: process.execPath,
      sshArgs: [helperPath, "ssh"],
      rsyncCommand: process.execPath,
      rsyncArgs: [helperPath, "rsync"],
    },
  }), "utf8");
  try {
    const result = spawnSync(process.execPath, [remoteInstaller,
      "--harness", "opencode,claude",
      "--environment", "fleet",
      "--no-skills",
      "--artifact", "agents,guide",
    ], {
      cwd: resolve("."),
      env: {
        ...process.env,
        MSTACK_ENVIRONMENTS_FILE: configPath,
        MSTACK_FAKE_TRANSPORT_LOG: logPath,
      },
      encoding: "utf8",
    });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.match(result.stdout, /Installed 0 skill copies and 3 artifact copies/);

    const calls = readFileSync(logPath, "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    assert.equal(calls.filter((call) => call.mode === "rsync").length, 3);
    const lockCalls = calls
      .filter((call) => call.mode === "ssh" && call.args.at(-1)?.includes("if mkdir \"$lock\""))
      .map((call) => call.args.at(-1).match(/; lock='([^']+\.mstack\.install\.lock)'/)?.[1]);
    assert.deepEqual(lockCalls, [
      "/srv/a/docs/.mstack.install.lock",
      "/srv/m/docs/.mstack.install.lock",
      "/srv/z/.mstack.install.lock",
    ]);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("remote installer rejects conflicting artifact formats in either order before connecting", () => {
  const root = mkdtempSync(join(tmpdir(), "mstack-remote-format-collision-test-"));
  const configPath = join(root, "environments.json");
  const helperPath = join(root, "fake-transport.mjs");
  const logPath = join(root, "transport.log");
  writeFileSync(helperPath, [
    'import { appendFileSync } from "node:fs";',
    'appendFileSync(process.env.MSTACK_FAKE_TRANSPORT_LOG, "connected\\n");',
    'process.exit(91);',
  ].join("\n"), "utf8");
  writeFileSync(configPath, JSON.stringify({
    fleet: {
      transport: "ssh",
      host: "dev@tailnet-host",
      targets: { codex: "/home/dev/.agents/skills", claude: "/home/dev/.claude/skills" },
      artifacts: { agents: { codex: "/srv/shared-agents", claude: "/srv/shared-agents" } },
      sshCommand: process.execPath,
      sshArgs: [helperPath],
    },
  }), "utf8");
  try {
    for (const harnesses of ["codex,claude", "claude,codex"]) {
      const result = spawnSync(process.execPath, [remoteInstaller,
        "--harness", harnesses,
        "--environment", "fleet",
        "--no-skills",
        "--artifact", "agents",
      ], {
        cwd: resolve("."),
        env: { ...process.env, MSTACK_ENVIRONMENTS_FILE: configPath, MSTACK_FAKE_TRANSPORT_LOG: logPath },
        encoding: "utf8",
      });
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /Remote target collision/, harnesses);
      assert.equal(existsSync(logPath), false, "format conflicts must fail before connecting");
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("remote installer rejects non-shareable target collisions before connecting", () => {
  const root = mkdtempSync(join(tmpdir(), "mstack-remote-collision-test-"));
  const configPath = join(root, "environments.json");
  writeFileSync(configPath, JSON.stringify({
    fleet: {
      transport: "ssh",
      host: "dev@tailnet-host",
      targets: { codex: "/srv/codex/skills" },
      artifacts: {
        agents: { codex: "/srv/shared/content" },
        guide: { codex: "/srv/shared/content" },
      },
    },
  }), "utf8");
  try {
    const result = spawnSync(process.execPath, [remoteInstaller,
      "--harness", "codex",
      "--environment", "fleet",
      "--no-skills",
      "--artifact", "agents,guide",
      "--dry-run",
    ], {
      cwd: resolve("."),
      env: { ...process.env, MSTACK_ENVIRONMENTS_FILE: configPath },
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Remote target collision/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("remote installer rejects nested targets before connecting", () => {
  const root = mkdtempSync(join(tmpdir(), "mstack-remote-overlap-test-"));
  const configPath = join(root, "environments.json");
  writeFileSync(configPath, JSON.stringify({
    fleet: {
      transport: "ssh",
      host: "dev@tailnet-host",
      targets: { codex: "/srv/shared/skills" },
      artifacts: { agents: { codex: "/srv/shared/skills/meta-mode/agents" } },
    },
  }), "utf8");
  try {
    const result = spawnSync(process.execPath, [remoteInstaller,
      "--harness", "codex",
      "--environment", "fleet",
      "--skill", "meta-mode",
      "--artifact", "agents",
      "--dry-run",
    ], {
      cwd: resolve("."),
      env: { ...process.env, MSTACK_ENVIRONMENTS_FILE: configPath },
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /Remote targets overlap/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("remote installer uploads everything before commit and rolls back a partial commit", () => {
  const root = mkdtempSync(join(tmpdir(), "mstack-remote-rollback-test-"));
  const configPath = join(root, "environments.json");
  const helperPath = join(root, "fake-transport.mjs");
  const logPath = join(root, "transport.log");
  const statePath = join(root, "remote-state.json");
  const metaTarget = "/srv/rollback/skills/meta-mode";
  const whyTarget = "/srv/rollback/skills/why";
  writeFileSync(statePath, JSON.stringify({
    targets: { [metaTarget]: "old-meta", [whyTarget]: "old-why" },
    backups: {},
    stageCount: 0,
  }), "utf8");
  writeFileSync(helperPath, [
    'import { appendFileSync, readFileSync, writeFileSync } from "node:fs";',
    'const [mode, ...args] = process.argv.slice(2);',
    'const script = args.at(-1) ?? "";',
    'const logPath = process.env.MSTACK_FAKE_TRANSPORT_LOG;',
    'const statePath = process.env.MSTACK_FAKE_TRANSPORT_STATE;',
    'appendFileSync(logPath, JSON.stringify({ mode, args }) + "\\n");',
    'const state = JSON.parse(readFileSync(statePath, "utf8"));',
    'const save = () => writeFileSync(statePath, JSON.stringify(state));',
    'if (mode === "ssh" && script.includes("mktemp -d")) {',
    '  state.stageCount += 1;',
    '  save();',
    '  console.log(`/srv/rollback/skills/.mstack-stage.fake-${state.stageCount}`);',
    '  process.exit(0);',
    '}',
    'const target = script.match(/(?:^|; )target=\'([^\']+)\'/)?.[1];',
    'const backup = script.match(/(?:^|; )backup=\'([^\']+)\'/)?.[1];',
    'if (mode === "ssh" && target && backup && script.includes("; stage=")) {',
    '  if (Object.hasOwn(state.targets, target)) {',
    '    state.backups[backup] = state.targets[target];',
    '    delete state.targets[target];',
    '  }',
    '  if (target.endsWith("/why")) {',
    '    if (script.includes(\'mv -- "$backup" "$target"\') && Object.hasOwn(state.backups, backup)) {',
    '      state.targets[target] = state.backups[backup];',
    '      delete state.backups[backup];',
    '    }',
    '    save();',
    '    process.stderr.write("injected second commit failure\\n");',
    '    process.exit(23);',
    '  }',
    '  state.targets[target] = `new:${target}`;',
    '  save();',
    '  process.exit(0);',
    '}',
    'if (mode === "ssh" && target && backup && script.includes(\'rm -rf -- "$target"\')) {',
    '  delete state.targets[target];',
    '  if (script.includes(\'mv -- "$backup" "$target"\') && Object.hasOwn(state.backups, backup)) {',
    '    state.targets[target] = state.backups[backup];',
    '    delete state.backups[backup];',
    '  }',
    '  save();',
    '}',
  ].join("\n"), "utf8");
  writeFileSync(configPath, JSON.stringify({
    fleet: {
      transport: "ssh",
      host: "dev@tailnet-host",
      shell: "posix",
      targets: { pi: "/srv/rollback/skills" },
      sshCommand: process.execPath,
      sshArgs: [helperPath, "ssh"],
      rsyncCommand: process.execPath,
      rsyncArgs: [helperPath, "rsync"],
    },
  }), "utf8");
  try {
    const result = spawnSync(process.execPath, [remoteInstaller,
      "--harness", "pi",
      "--environment", "fleet",
      "--skill", "meta-mode,why",
      "--replace",
    ], {
      cwd: resolve("."),
      env: {
        ...process.env,
        MSTACK_ENVIRONMENTS_FILE: configPath,
        MSTACK_FAKE_TRANSPORT_LOG: logPath,
        MSTACK_FAKE_TRANSPORT_STATE: statePath,
      },
      encoding: "utf8",
    });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /injected second commit failure/);

    const calls = readFileSync(logPath, "utf8")
      .trim()
      .split(/\r?\n/)
      .map((line) => JSON.parse(line));
    const commitIndexes = calls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => call.mode === "ssh" && call.args.at(-1)?.includes("; stage="))
      .map(({ index }) => index);
    const uploadIndexes = calls
      .map((call, index) => ({ call, index }))
      .filter(({ call }) => call.mode === "rsync")
      .map(({ index }) => index);
    assert.equal(uploadIndexes.length, 2);
    assert.equal(commitIndexes.length, 2);
    assert.ok(Math.max(...uploadIndexes) < Math.min(...commitIndexes));
    const rollbackIndex = calls.findIndex((call, index) =>
      index > commitIndexes[1] &&
      call.mode === "ssh" &&
      call.args.at(-1)?.includes(`target='${metaTarget}'`) &&
      !call.args.at(-1)?.includes("; stage=") &&
      call.args.at(-1)?.includes('rm -rf -- "$target"'),
    );
    assert.ok(rollbackIndex > commitIndexes[1], "expected the first item to roll back after the second commit failed");

    const state = JSON.parse(readFileSync(statePath, "utf8"));
    assert.deepEqual(state.targets, { [metaTarget]: "old-meta", [whyTarget]: "old-why" });
    assert.deepEqual(state.backups, {});
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
