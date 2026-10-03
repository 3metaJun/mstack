import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { spawnSync } from "node:child_process";
import test from "node:test";

const script = resolve("scripts/model-budget.mjs");
const check = resolve("scripts/model-config.mjs");
function fixture(t, config, models) {
  const root = mkdtempSync(join(tmpdir(), "mstack-budget-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const file = join(root, "models.json");
  const catalog = join(root, "catalog.json");
  writeFileSync(file, JSON.stringify(config));
  writeFileSync(catalog, JSON.stringify(models));
  const run = (budget, ...flags) => spawnSync(process.execPath, [script, "--file", file, "--catalog", catalog, "--harness", "pi", "--budget", budget, ...flags], { encoding: "utf8" });
  const runAt = (target, budget, ...flags) => spawnSync(process.execPath, [script, "--file", target, "--catalog", catalog, "--harness", "pi", "--budget", budget, ...flags], { encoding: "utf8" });
  return { root, file, catalog, run, runAt };
}

test("budget preview and apply preserve aliases, families and other Harness choices", (t) => {
  const config = {
    roles: { implementer: "grok-4.7-xhigh-fast", reviewer: ["claude-opus-5-5-max", "gpt-5.6-sol-max"], explorer: "inherit-parent", operator: "auto" },
    overrides: { codex: { implementer: "codex-custom" } }, extra: { keep: true },
  };
  const f = fixture(t, config, ["grok-4.7-medium-fast", "claude-opus-5-5-medium", "gpt-5.6-sol-medium"]);
  const before = readFileSync(f.file, "utf8");
  const preview = f.run("small");
  assert.equal(preview.status, 0, preview.stderr);
  assert.equal(readFileSync(f.file, "utf8"), before);
  const result = f.run("small", "--apply");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(f.file, "utf8")), {
    ...config,
    overrides: { codex: { implementer: "codex-custom" }, pi: { implementer: "grok-4.7-medium-fast", reviewer: ["claude-opus-5-5-medium", "gpt-5.6-sol-medium"] } },
    budgets: { pi: "small" },
  });
  const validated = spawnSync(process.execPath, [check, "--file", f.file, "--harness", "pi", "--format", "json"], { encoding: "utf8" });
  assert.equal(validated.status, 0, validated.stderr);
  assert.deepEqual(JSON.parse(validated.stdout).models, { implementer: "grok-4.7-medium-fast", reviewer: ["claude-opus-5-5-medium", "gpt-5.6-sol-medium"], explorer: "inherit-parent", operator: "auto" });
  const mtime = statSync(f.file).mtimeMs;
  assert.equal(f.run("small", "--apply").status, 0);
  assert.equal(statSync(f.file).mtimeMs, mtime, "a repeated apply must not rewrite the file");
});

test("effort mapping chooses the highest detected lower variant of the same stem", (t) => {
  const f = fixture(t, { roles: { implementer: "grok-4.7-max-fast", reviewer: "gpt-5.6-sol-max" } }, ["grok-4.7-low-fast", "grok-4.7-high-fast", "grok-4.6-xhigh-fast", "gpt-5.6-sol-high"]);
  const result = f.run("large", "--apply");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(f.file, "utf8")).overrides.pi, { implementer: "grok-4.7-high-fast", reviewer: "gpt-5.6-sol-high" });
});

test("unlimited keeps the current detected model efforts rather than restoring guessed defaults", (t) => {
  const f = fixture(t, { roles: { implementer: "worker-high" }, budgets: { claude: "small" } }, ["worker-high", "worker-max"]);
  const result = f.run("unlimited", "--apply");
  assert.equal(result.status, 0, result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(f.file, "utf8")), { roles: { implementer: "worker-high" }, budgets: { claude: "small", pi: "unlimited" } });
});

test("unresolvable models and collapsed panels refuse all writes", (t) => {
  for (const [config, models] of [
    [{ roles: { reviewer: "worker-max" } }, ["worker-max"]],
    [{ roles: { reviewer: "no-effort-model" } }, ["no-effort-model"]],
    [{ roles: { reviewer: ["worker-max", "worker-high"] } }, ["worker-medium"]],
  ]) {
    const f = fixture(t, config, models);
    const before = readFileSync(f.file, "utf8");
    const result = f.run("small", "--apply");
    assert.equal(result.status, 1, result.stderr);
    assert.equal(JSON.parse(result.stdout).applied, false);
    assert.equal(readFileSync(f.file, "utf8"), before);
  }
});

test("missing configurations can be created with inherited roles", (t) => {
  const f = fixture(t, { roles: {} }, []);
  rmSync(f.file);
  assert.equal(f.run("medium", "--apply").status, 0);
  assert.deepEqual(JSON.parse(readFileSync(f.file, "utf8")).roles, {
    implementer: "inherit-parent", reviewer: "inherit-parent", judge: "inherit-parent", explorer: "inherit-parent", synthesizer: "inherit-parent", candidate: "inherit-parent", operator: "inherit-parent",
  });
});

test("a failed replacement does not report an applied budget", (t) => {
  const f = fixture(t, { roles: { reviewer: "auto" } }, []);
  const target = join(f.root, "blocked", "models.json");
  writeFileSync(join(f.root, "blocked"), "not a directory");
  const result = f.runAt(target, "small", "--apply");
  assert.notEqual(result.status, 0);
  assert.doesNotMatch(result.stdout, /"applied": true/);
});

test("invalid options, catalogs and budget metadata fail without modifying configuration", (t) => {
  const f = fixture(t, { roles: { reviewer: "auto" } }, []);
  const before = readFileSync(f.file, "utf8");
  for (const budget of ["huge", "--apply"]) assert.notEqual(f.run(budget, "--apply").status, 0);
  for (const models of [null, {}, [" padded"], ["auto"], ["inherit-parent"], [null]]) {
    writeFileSync(f.catalog, JSON.stringify(models));
    assert.notEqual(f.run("small", "--apply").status, 0);
    assert.equal(readFileSync(f.file, "utf8"), before);
  }
  writeFileSync(f.catalog, "[]");
  for (const budgets of [null, [], { pi: "huge" }, { unknown: "small" }]) {
    writeFileSync(f.file, JSON.stringify({ roles: { reviewer: "auto" }, budgets }));
    const invalid = readFileSync(f.file, "utf8");
    const result = f.run("small", "--apply");
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /budgets/);
    assert.equal(readFileSync(f.file, "utf8"), invalid);
  }
});
