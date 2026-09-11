import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { validateModelConfig } from "./model-config-lib.mjs";

const harnesses = ["codex", "claude", "opencode", "pi"];
const runRole = resolve("scripts/run-role.mjs");
const checkModels = resolve("scripts/model-config.mjs");

function fixture(t, config = { roles: { reviewer: ["review-a", "review-b"] } }) {
  const root = mkdtempSync(join(tmpdir(), "mstack-models 测试-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "models.json");
  writeFileSync(file, JSON.stringify(config));
  const env = { ...process.env, HOME: root, USERPROFILE: root };
  const run = (args, script = runRole, extraEnv = {}) => spawnSync(process.execPath, [script, ...args], {
    cwd: root, env: { ...env, ...extraEnv }, encoding: "utf8", timeout: 15000,
  });
  return { root, file, run };
}

test("reviewer lists resolve as a whole Harness override", (t) => {
  const { file, run } = fixture(t, {
    roles: { reviewer: ["review-a", "review-b"], implementer: "auto" },
    overrides: { pi: { reviewer: ["pi-review-a", "pi-review-b"] } },
  });
  const result = run(["--file", file, "--harness", "pi", "--role", "reviewer", "--format", "json"], checkModels);
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(result.stdout).models, { reviewer: ["pi-review-a", "pi-review-b"] });
});

test("model configuration rejects empty, duplicate and non-reviewer lists", () => {
  for (const value of [[], [""], ["  "], ["review-a", "review-a"], ["review-a", null]]) {
    assert.ok(validateModelConfig({ roles: { reviewer: value } }, harnesses).length, JSON.stringify(value));
    assert.ok(validateModelConfig({ roles: { reviewer: "auto" }, overrides: { pi: { reviewer: value } } }, harnesses).length);
  }
  assert.ok(validateModelConfig({ roles: { implementer: ["worker-a"] } }, harnesses).length);
  assert.ok(validateModelConfig({ roles: { reviewer: " " } }, harnesses).length);
  assert.deepEqual(validateModelConfig({ roles: { reviewer: "auto" } }, harnesses), []);
});

test("model configuration rejects padded names in defaults, lists and overrides", (t) => {
  for (const config of [
    { roles: { reviewer: " review-a" } },
    { roles: { reviewer: ["review-a", "review-b "] } },
    { roles: { reviewer: "auto" }, overrides: { pi: { reviewer: "\treview-a" } } },
  ]) {
    const { file, run } = fixture(t, config);
    const result = run(["--file", file, "--harness", "pi"], checkModels);
    assert.notEqual(result.status, 0, JSON.stringify(config));
    assert.match(result.stderr, /whitespace/);
  }
});

test("explicit CLI model selections reject padded names before planning a worker", (t) => {
  const { file, run } = fixture(t, { roles: { reviewer: "inherit-parent" } });
  const args = ["--harness", "pi", "--role", "reviewer", "--prompt", "inspect", "--file", file];
  for (const flag of ["--model", "--parent-model"]) {
    for (const value of [" review-a", "review-a ", "\treview-a"]) {
      const result = run([...args, flag, value]);
      assert.notEqual(result.status, 0, `${flag}: ${JSON.stringify(value)}`);
      assert.match(result.stderr, /whitespace/);
    }
  }
});

test("list execution requires explicit selection and preserves model arguments for every Harness", (t) => {
  const { file, run } = fixture(t);
  for (const harness of harnesses) {
    const args = ["--harness", harness, "--role", "reviewer", "--prompt", "review this", "--file", file];
    const ambiguous = run(args);
    assert.notEqual(ambiguous.status, 0);
    assert.match(ambiguous.stderr, /--all-models.*--model-index/);
    const selected = run([...args, "--model-index", "1"]);
    assert.equal(selected.status, 0, selected.stderr);
    const plan = JSON.parse(selected.stdout);
    assert.equal(plan.model, "review-b");
    assert.equal(plan.args[plan.args.indexOf("--model") + 1], "review-b");
    const all = run([...args, "--all-models", "--read-only"]);
    assert.equal(all.status, 0, all.stderr);
    assert.deepEqual(JSON.parse(all.stdout).map((entry) => entry.model), ["review-a", "review-b"]);
  }
});

test("inherit-parent requires the parent model while auto selects the CLI default", (t) => {
  const { file, run } = fixture(t, { roles: { reviewer: "inherit-parent" } });
  const args = ["--harness", "pi", "--role", "reviewer", "--prompt", "inspect", "--file", file];
  const missing = run(args);
  assert.notEqual(missing.status, 0);
  assert.match(missing.stderr, /--parent-model/);
  const inherited = run([...args, "--parent-model", "known-parent"]);
  assert.equal(inherited.status, 0, inherited.stderr);
  assert.equal(JSON.parse(inherited.stdout).model, "known-parent");
  assert.deepEqual(JSON.parse(inherited.stdout).args, ["-p", "--no-session", "--model", "known-parent", "inspect"]);
  const automatic = run([...args, "--model", "auto"]);
  assert.equal(automatic.status, 0, automatic.stderr);
  assert.deepEqual(JSON.parse(automatic.stdout).args, ["-p", "--no-session", "inspect"]);
  for (const parent of ["auto", "inherit-parent"]) {
    assert.notEqual(run([...args, "--parent-model", parent]).status, 0);
  }
});

test("model CLIs reject missing optional flag values before fallback or file reads", (t) => {
  const { file, run } = fixture(t, { roles: { reviewer: "auto" } });
  for (const flag of ["--file", "--harness", "--role", "--format"]) {
    for (const suffix of [[flag], [flag, "--unknown"]]) {
      const result = run(suffix, checkModels);
      assert.notEqual(result.status, 0, `${flag}: ${result.stdout}`);
      assert.match(result.stderr, new RegExp(`${flag} requires a value`));
    }
  }
  for (const flag of ["--file", "--model", "--parent-model", "--model-index", "--environment", "--cwd"]) {
    const base = ["--harness", "pi", "--role", "reviewer", "--prompt", "inspect"];
    if (flag !== "--file") base.push("--file", file);
    for (const suffix of [[flag], [flag, "--execute"]]) {
      const result = run([...base, ...suffix]);
      assert.notEqual(result.status, 0, flag);
      assert.match(result.stderr, new RegExp(`${flag} requires a value`));
    }
  }
});

test("selection flags reject conflicts, invalid indexes and writable fanout", (t) => {
  const { file, run } = fixture(t);
  const args = ["--harness", "pi", "--role", "reviewer", "--prompt", "review", "--file", file];
  for (const flags of [
    ["--model-index", "-1"], ["--model-index", "2"], ["--model-index", "1.5"],
    ["--model-index", "0", "--all-models", "--read-only"],
    ["--model", "explicit", "--all-models", "--read-only"],
    ["--model", "explicit", "--model-index", "0"], ["--all-models"],
  ]) assert.notEqual(run([...args, ...flags]).status, 0, flags.join(" "));
});

test("fanout executes every configured model and retains attributed output after one fails", (t) => {
  const { root, file, run } = fixture(t);
  const bin = join(root, "bin");
  mkdirSync(bin);
  const helper = join(bin, "fake-cli.mjs");
  writeFileSync(helper, [
    'import { appendFileSync, readFileSync } from "node:fs";',
    'import { setTimeout } from "node:timers/promises";',
    'const args = process.argv.slice(2);',
    'const model = args[args.indexOf("--model") + 1];',
    'appendFileSync(process.env.MSTACK_MODEL_TEST_LOG, model + "\\n");',
    'const deadline = Date.now() + 5000;',
    'while (readFileSync(process.env.MSTACK_MODEL_TEST_LOG, "utf8").trim().split("\\n").length < 2) {',
    '  if (Date.now() > deadline) process.exit(91);',
    '  await setTimeout(10);',
    '}',
    'console.log(JSON.stringify({ args, proof: "x".repeat(128 * 1024) }));',
    'console.error("stderr:" + model);',
    'process.exitCode = process.env.MSTACK_MODEL_TEST_FAIL === "yes" && model === "review-b" ? 7 : 0;',
  ].join("\n"));
  if (process.platform === "win32") {
    const quote = (value) => `'${value.replaceAll("'", "''")}'`;
    writeFileSync(join(bin, "pi.ps1"), `\uFEFF& ${quote(process.execPath)} ${quote(helper)} @args\nexit $LASTEXITCODE\n`);
  } else {
    writeFileSync(join(bin, "pi"), `#!/usr/bin/env node\nimport(${JSON.stringify(helper)});\n`);
    chmodSync(join(bin, "pi"), 0o755);
  }
  const log = join(root, "models.log");
  const pathKey = Object.keys(process.env).find((key) => key.toLowerCase() === "path") ?? "PATH";
  const args = [
    "--harness", "pi", "--role", "reviewer", "--prompt", "same prompt",
    "--file", file, "--all-models", "--read-only", "--execute",
  ];
  const env = { [pathKey]: `${bin}${process.platform === "win32" ? ";" : ":"}${process.env[pathKey]}`, MSTACK_MODEL_TEST_LOG: log };
  const result = run(args, runRole, { ...env, MSTACK_MODEL_TEST_FAIL: "yes" });
  assert.equal(result.status, 1, result.stderr);
  const results = JSON.parse(result.stdout);
  assert.deepEqual(results.map(({ model, status }) => ({ model, status })), [
    { model: "review-a", status: 0 }, { model: "review-b", status: 7 },
  ], result.stdout);
  assert.deepEqual(readFileSync(log, "utf8").trim().split("\n").sort(), ["review-a", "review-b"]);
  for (const entry of results) {
    const output = JSON.parse(entry.stdout);
    assert.deepEqual(output.args, ["-p", "--no-session", "--model", entry.model, "same prompt", "--tools", "read,grep,find,ls"]);
    assert.equal(output.proof, "x".repeat(128 * 1024));
    assert.equal(entry.stderr.trim(), `stderr:${entry.model}`);
  }
  writeFileSync(log, "");
  const success = run(args, runRole, { ...env, MSTACK_MODEL_TEST_FAIL: "no" });
  assert.equal(success.status, 0, success.stderr);
  assert.deepEqual(JSON.parse(success.stdout).map((entry) => entry.status), [0, 0]);
});
