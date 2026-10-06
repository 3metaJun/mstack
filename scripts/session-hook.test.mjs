import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { validatePluginAgents, validatePluginHooks } from "./claude-package-lib.mjs";
import { validateModelConfig } from "./model-config-lib.mjs";
import { run, sessionHookEnabled } from "./session-hook.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "scripts", "session-hook.mjs");
const context = readFileSync(join(repoRoot, "hooks", "session-start-context.md"), "utf8").trim();

function sandbox(t, prefix = "mstack-hook 测试-") {
  const root = mkdtempSync(join(tmpdir(), prefix));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

// Runs the real script as Claude Code does, with the user's home pointed at the sandbox.
function runHook(root) {
  const result = spawnSync(process.execPath, [script], {
    cwd: root, env: { ...process.env, HOME: root, USERPROFILE: root }, encoding: "utf8", timeout: 15000,
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout;
}

function writeConfig(root, content) {
  const directory = join(root, ".config", "mstack");
  mkdirSync(directory, { recursive: true });
  writeFileSync(join(directory, "models.json"), content);
}

test("the hook prints SessionStart additionalContext JSON and exits 0 when no config exists", (t) => {
  const root = sandbox(t);
  const output = JSON.parse(runHook(root));
  assert.deepEqual(output, { hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context } });
});

test("the context names only skills the plugin ships", () => {
  const skills = JSON.parse(readFileSync(join(repoRoot, "profiles", "skills.json"), "utf8")).skills;
  const named = [...context.matchAll(/`mstack:([a-z0-9-]+)`/g)].map((match) => match[1]);
  assert.ok(named.includes("meta-mode"));
  assert.deepEqual(named.filter((name) => !skills.includes(name)), []);
});

test("sessionHook false turns the hook off, and nothing else does", (t) => {
  const root = sandbox(t);
  const configs = [
    { name: "plain false", text: '{"roles":{},"sessionHook":false}', off: true },
    { name: "false with CRLF endings", text: '{\r\n  "sessionHook": false\r\n}\r\n', off: true },
    { name: "false after a UTF-8 byte-order mark", text: '﻿{"sessionHook":false}', off: true },
    { name: "false in UTF-16 LE with a byte-order mark", text: Buffer.from('﻿{"sessionHook":false}', "utf16le"), off: true },
    { name: "true", text: '{"sessionHook":true}', off: false },
    { name: "key absent", text: '{"roles":{}}', off: false },
    { name: "string off is not the switch", text: '{"sessionHook":"off"}', off: false },
    { name: "null", text: '{"sessionHook":null}', off: false },
    { name: "malformed JSON", text: '{"sessionHook":false', off: false },
    { name: "an array", text: "[false]", off: false },
    { name: "empty file", text: "", off: false },
  ];
  for (const { name, text, off } of configs) {
    writeConfig(root, text);
    const output = runHook(root);
    assert.equal(output === "", off, name);
    if (!off) assert.equal(JSON.parse(output).hookSpecificOutput.additionalContext, context, name);
  }
});

test("a missing or unreadable config leaves the hook on", (t) => {
  const root = sandbox(t);
  assert.equal(sessionHookEnabled(join(root, "absent.json")), true);
  // A directory in place of the file fails the read on every platform.
  mkdirSync(join(root, "models.json"));
  assert.equal(sessionHookEnabled(join(root, "models.json")), true);
  assert.notEqual(run({ configPath: join(root, "models.json") }), "");
});

test("an unreadable context file still fails open with no output", (t) => {
  const root = sandbox(t);
  assert.equal(run({ configPath: join(root, "absent.json"), contextFile: join(root, "absent.md") }), "");
  const crlf = join(root, "context.md");
  writeFileSync(crlf, "﻿line one\r\nline two\r\n");
  const { hookSpecificOutput } = JSON.parse(run({ configPath: join(root, "absent.json"), contextFile: crlf }));
  assert.equal(hookSpecificOutput.additionalContext, "line one\nline two");
});

test("model configuration validation accepts a boolean sessionHook only", () => {
  const harnesses = ["codex", "claude", "opencode", "pi"];
  assert.deepEqual(validateModelConfig({ roles: {}, sessionHook: false }, harnesses), []);
  assert.deepEqual(validateModelConfig({ roles: {}, sessionHook: true }, harnesses), []);
  for (const value of ["off", 0, null, {}]) {
    assert.deepEqual(validateModelConfig({ roles: {}, sessionHook: value }, harnesses), ["sessionHook must be true or false"], String(value));
  }
});

test("the shipped plugin hook and agents validate", () => {
  assert.deepEqual(validatePluginHooks(repoRoot), []);
  assert.deepEqual(validatePluginAgents(repoRoot), []);
});

test("plugin hook validation rejects broken references", (t) => {
  const root = sandbox(t, "mstack-validate-");
  for (const path of [".claude-plugin", "hooks", "agents", "scripts"]) cpSync(join(repoRoot, path), join(root, path), { recursive: true });
  const hooksPath = join(root, "hooks", "hooks.json");
  const original = JSON.parse(readFileSync(hooksPath, "utf8"));
  const withCommand = (command) => {
    const next = structuredClone(original);
    next.hooks.SessionStart[0].hooks[0].command = command;
    writeFileSync(hooksPath, JSON.stringify(next));
    return validatePluginHooks(root).join("\n");
  };
  assert.match(withCommand('node "${CLAUDE_PLUGIN_ROOT}/scripts/missing.mjs"'), /missing script/);
  assert.match(withCommand('node "${CLAUDE_PLUGIN_ROOT}/../outside.mjs"'), /escapes the plugin root/);
  assert.match(withCommand("sh session-start.sh"), /must be node/);
  assert.match(withCommand('node "${CLAUDE_PLUGIN_ROOT}/scripts/session-hook.mjs" extra'), /must be node/);

  const wrongMatcher = structuredClone(original);
  wrongMatcher.hooks.SessionStart[0].matcher = "startup";
  writeFileSync(hooksPath, JSON.stringify(wrongMatcher));
  assert.match(validatePluginHooks(root).join("\n"), /matcher/);

  writeFileSync(hooksPath, JSON.stringify(original));
  const manifestPath = join(root, ".claude-plugin", "plugin.json");
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, hooks: "./hooks/hooks.json" }));
  assert.match(validatePluginHooks(root).join("\n"), /duplicate/);
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, agents: ["../shared-agent.md"] }));
  assert.match(validatePluginAgents(root).join("\n"), /must stay inside the plugin/);
  writeFileSync(manifestPath, JSON.stringify({ ...manifest, agents: ["./agents/nope.md"] }));
  assert.match(validatePluginAgents(root).join("\n"), /does not exist/);

  writeFileSync(manifestPath, JSON.stringify(manifest));
  const contextPath = join(root, "hooks", "session-start-context.md");
  rmSync(contextPath);
  mkdirSync(contextPath);
  assert.match(validatePluginHooks(root).join("\n"), /readable, non-empty file/);

  writeFileSync(join(root, "agents", "wrong.md"), "---\nname: other\ndescription: x\n---\nbody\n");
  assert.match(validatePluginAgents(root).join("\n"), /name must equal the file name/);
});
