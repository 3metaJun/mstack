import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { readModelConfig, resolveModels, validateModelConfig } from "./model-config-lib.mjs";

const harnesses = ["codex", "claude", "opencode", "pi", "antigravity", "grok"];
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

test("structured and provider/model entries validate, and a host layer is not a harness", () => {
  const valid = [
    { roles: { reviewer: "auto" }, overrides: { t3code: { reviewer: ["codex/gpt-5.6-sol (xhigh)", "claude_work/claude-opus-5-5", "inherit-parent", "auto"] } } },
    { roles: { reviewer: "auto" }, overrides: { t3code: { reviewer: "opencode/anthropic/claude-sonnet-4 (low)" } } },
    { roles: { reviewer: "auto" }, overrides: { t3code: { reviewer: [{ provider: "codex", model: "a", effort: "high" }, { provider: "codex", model: "a" }] } } },
    // The same model at two efforts is two entries.
    { roles: { reviewer: "auto" }, overrides: { t3code: { reviewer: ["codex/a (high)", "codex/a (low)", { provider: "codex", model: "a" }] } } },
    { roles: { implementer: "auto" }, overrides: { t3code: { implementer: { provider: "codex", model: "a", effort: "low" } } }, budgets: { t3code: "small" } },
    // Harness strings are opaque: slashes and effort-looking suffixes stay part of the name.
    { roles: { implementer: "anthropic/claude-sonnet-4" }, overrides: { opencode: { implementer: "anthropic/claude-sonnet-4 (high)" } } },
    { roles: { reviewer: ["gpt-5 (high)", "gpt-5 (low)", "gpt-5", "claude-x (max)"] } },
  ];
  for (const config of valid) assert.deepEqual(validateModelConfig(config, harnesses), [], JSON.stringify(config));
  const invalid = [
    // Structured entries exist only under the host layer.
    { roles: { implementer: { model: "gpt-5.6-sol" } } },
    { roles: { reviewer: [{ provider: "codex", model: "a", effort: "high" }] } },
    { roles: { reviewer: "auto" }, overrides: { pi: { reviewer: { provider: "codex", model: "a" } } } },
    { roles: { reviewer: "auto" }, overrides: { codex: { reviewer: ["a", { model: "b" }] } } },
    // Opaque strings dedupe as themselves, so an identical pair is still a duplicate.
    { roles: { reviewer: ["gpt-5 (high)", "gpt-5 (high)"] } },
    { roles: { reviewer: "auto" }, overrides: { t3code: { reviewer: { model: "a", extra: 1 } } } },
    { roles: { reviewer: "auto" }, overrides: { t3code: { reviewer: { provider: "codex", model: "a", effort: "ultra" } } } },
    { roles: { reviewer: "auto" }, overrides: { t3code: { reviewer: { provider: "codex", model: "a", effort: "inherit-parent" } } } },
    { roles: { reviewer: "auto" }, overrides: { t3code: { reviewer: { provider: "codex", model: "" } } } },
    { roles: { reviewer: "auto" }, overrides: { t3code: { reviewer: { provider: "codex" } } } },
    { roles: { reviewer: "auto" }, overrides: { t3code: { reviewer: { provider: "codex", model: " a" } } } },
    { roles: { reviewer: "auto" }, overrides: { t3code: { reviewer: { provider: "codex", model: "inherit-parent" } } } },
    { roles: { reviewer: "auto" }, overrides: { t3code: { reviewer: { provider: "codex", model: "auto" } } } },
    { roles: { reviewer: "auto" }, overrides: { t3code: { reviewer: [] } } },
    { roles: { implementer: "auto" }, overrides: { t3code: { implementer: [{ provider: "codex", model: "a" }] } } },
    { roles: { reviewer: "auto" }, overrides: { t3code: { reviewer: [{ provider: "codex", model: "a" }, { provider: "codex", model: "a" }] } } },
    { roles: { reviewer: "auto" }, overrides: { t3code: { reviewer: [{ provider: "codex", model: "a", effort: "high" }, "codex/a (high)"] } } },
    { roles: { reviewer: "auto" }, overrides: { t3code: { reviewer: ["codex/a (high)", "codex/a (high)"] } } },
    { roles: { reviewer: "auto" }, overrides: { t3code: { reviewer: "gpt-5.6-sol" } } },
    { roles: { reviewer: "auto" }, overrides: { t3code: { reviewer: ["codex/", "/a"] } } },
    // The model part is validated on its own, with or without an effort suffix.
    ...["codex/ gpt-5", "codex/gpt-5 ", "codex/", "/m", "codex/ gpt-5 (high)", "codex/\tgpt-5", "codex/gpt\u00005"]
      .map((reviewer) => ({ roles: { reviewer: "auto" }, overrides: { t3code: { reviewer } } })),
    { roles: { reviewer: "auto" }, overrides: { t3code: { reviewer: "codex/a (ultra)" } } },
    { roles: { reviewer: "auto" }, overrides: { t3code: { reviewer: { model: "a" } } } },
    { roles: { reviewer: "auto" }, overrides: { t3code: { reviewer: { provider: "codex", model: "a", effort: "" } } } },
    { roles: { reviewer: "auto" }, overrides: { t3code: { missing: "codex/a" } } },
    { roles: { reviewer: "auto" }, overrides: { t3: { reviewer: "codex/a" } } },
    { roles: { reviewer: "auto" }, budgets: { t3: "small" } },
  ];
  for (const config of invalid) assert.ok(validateModelConfig(config, harnesses).length, JSON.stringify(config));
  assert.ok(!harnesses.includes("t3code"));
});

test("provider ids follow the T3 instance id rule in objects and in provider/model strings", () => {
  const longest = `a${"b".repeat(63)}`;
  for (const provider of ["codex", "claude_work", "a-1", "A", longest]) {
    for (const config of [
      { roles: { reviewer: "auto" }, overrides: { t3code: { reviewer: { provider, model: "m" } } } },
      { roles: { reviewer: "auto" }, overrides: { t3code: { reviewer: `${provider}/m (high)` } } },
    ]) assert.deepEqual(validateModelConfig(config, harnesses), [], `${provider}: ${JSON.stringify(config)}`);
  }
  for (const provider of ["1bad", "a.b", "__proto__", "_a", "-a", "a b", "a/b", "", `a${"b".repeat(64)}`]) {
    const configs = [{ roles: { reviewer: "auto" }, overrides: { t3code: { reviewer: { provider, model: "m" } } } }];
    // A slash in the provider would just move the split point, so only test the other prefixes.
    if (!provider.includes("/")) configs.push({ roles: { reviewer: "auto" }, overrides: { t3code: { reviewer: `${provider}/m` } } });
    for (const config of configs) assert.ok(validateModelConfig(config, harnesses).length, `${provider}: ${JSON.stringify(config)}`);
  }
});

test("reserved names cannot become role, scope or budget keys, and lookups read own properties only", () => {
  for (const reserved of ["__proto__", "constructor", "prototype"]) {
    for (const text of [
      `{"roles":{"reviewer":"auto","${reserved}":"x"}}`,
      `{"roles":{"reviewer":"auto"},"overrides":{"pi":{"${reserved}":"x"}}}`,
      `{"roles":{"reviewer":"auto"},"overrides":{"${reserved}":{"reviewer":"x"}}}`,
      `{"roles":{"reviewer":"auto"},"budgets":{"${reserved}":"small"}}`,
    ]) assert.ok(validateModelConfig(JSON.parse(text), harnesses).length, text);
  }
  // A role named like an inherited member keeps its default; a harness named like one has no overrides.
  assert.deepEqual(resolveModels({ roles: { toString: "x", reviewer: "y" }, overrides: { pi: {} } }, "pi"), { toString: "x", reviewer: "y" });
  assert.deepEqual(resolveModels({ roles: { reviewer: "y" }, overrides: {} }, "constructor"), { reviewer: "y" });
});

test("model-config lists a host layer on request and when the file configures it", (t) => {
  const { file, run } = fixture(t, {
    roles: { reviewer: "auto" },
    overrides: { t3code: { reviewer: ["codex/gpt-5.6-sol (high)", { provider: "claude_work", model: "claude-opus-5-5" }] } },
  });
  const one = run(["--file", file, "--harness", "t3code", "--role", "reviewer", "--format", "json"], checkModels);
  assert.equal(one.status, 0, one.stderr);
  assert.deepEqual(JSON.parse(one.stdout).models, { reviewer: ["codex/gpt-5.6-sol (high)", { provider: "claude_work", model: "claude-opus-5-5" }] });
  const all = run(["--file", file, "--format", "json"], checkModels);
  assert.deepEqual(all.stdout.trim().split("\n").map((line) => JSON.parse(line).harness).slice(-1), ["t3code"]);
  assert.notEqual(run(["--file", file, "--harness", "t3"], checkModels).status, 0);
});

test("effort-looking and provider-looking Harness strings reach the CLI unchanged, and run-role never accepts a host layer", (t) => {
  const { file, run } = fixture(t, {
    roles: {
      reviewer: ["gpt-5 (high)", "claude-x (max)", "anthropic/claude-sonnet-4", "gpt-5 (low)"],
      implementer: "claude-x (max)",
      judge: "inherit-parent",
    },
    overrides: { t3code: { implementer: "codex/gpt-5.6-sol (xhigh)" } },
  });
  for (const harness of ["pi", "claude", "opencode"]) {
    const all = run(["--harness", harness, "--role", "reviewer", "--prompt", "inspect", "--file", file, "--all-models", "--read-only"]);
    assert.equal(all.status, 0, all.stderr);
    const plans = JSON.parse(all.stdout);
    assert.deepEqual(plans.map((plan) => plan.model), ["gpt-5 (high)", "claude-x (max)", "anthropic/claude-sonnet-4", "gpt-5 (low)"]);
    for (const plan of plans) assert.equal(plan.args[plan.args.indexOf("--model") + 1], plan.model);
    assert.equal(all.stderr, "");
    const indexed = JSON.parse(run(["--harness", harness, "--role", "reviewer", "--prompt", "inspect", "--file", file, "--model-index", "1"]).stdout);
    assert.equal(indexed.args[indexed.args.indexOf("--model") + 1], "claude-x (max)");
  }
  const one = JSON.parse(run(["--harness", "claude", "--role", "implementer", "--prompt", "inspect", "--file", file]).stdout);
  assert.equal(one.args[one.args.indexOf("--model") + 1], "claude-x (max)");
  const inherited = run(["--harness", "pi", "--role", "judge", "--prompt", "inspect", "--file", file, "--parent-model", "known-parent"]);
  assert.equal(JSON.parse(inherited.stdout).model, "known-parent");
  const host = run(["--harness", "t3code", "--role", "implementer", "--prompt", "inspect", "--file", file]);
  assert.notEqual(host.status, 0);
  assert.match(host.stderr, /Unsupported harness/);
  // A structured entry in a Harness scope is refused with a message that names the host layer.
  const structured = fixture(t, { roles: { implementer: { provider: "codex", model: "a" } } });
  const refused = structured.run(["--harness", "pi", "--role", "implementer", "--prompt", "inspect", "--file", structured.file]);
  assert.notEqual(refused.status, 0);
  assert.match(refused.stderr, /overrides\.t3code/);
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

test("prompt-valued flags sit directly before the prompt so model and read-only flags cannot be swallowed", (t) => {
  const { file, run } = fixture(t, { roles: { reviewer: "review-a" } });
  const plan = (harness, ...extra) => JSON.parse(run([
    "--harness", harness, "--role", "reviewer", "--prompt", "inspect", "--file", file, ...extra,
  ]).stdout);
  assert.deepEqual(plan("antigravity", "--read-only").args,
    ["--output-format", "text", "--model", "review-a", "--print", "inspect", "--mode", "plan"]);
  assert.deepEqual(plan("grok", "--read-only").args, [
    "--output-format", "plain", "--model", "review-a", "--single", "inspect",
    "--tools", "read_file,list_dir,grep", "--disallowed-tools", "search_tool,use_tool",
  ]);
  assert.deepEqual(plan("grok", "--model", "auto").args, ["--output-format", "plain", "--single", "inspect"]);
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

test("readModelConfig accepts the BOM and UTF-16 LE files that Windows tools write", (t) => {
  const dir = mkdtempSync(join(tmpdir(), "mstack-config-"));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const json = '{"roles":{"reviewer":"m1"},"overrides":{}}';
  for (const [name, bytes] of [["utf8-bom", Buffer.from(`\uFEFF${json}`, "utf8")], ["utf16", Buffer.from(`\uFEFF${json}`, "utf16le")]]) {
    const file = join(dir, `${name}.json`);
    writeFileSync(file, bytes);
    assert.equal(readModelConfig(file).roles.reviewer, "m1", name);
  }
});
