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

const ladder = ["low", "medium", "high", "xhigh", "max"];
const entry = (provider, model, efforts) => ({ provider, model, ...(efforts ? { efforts } : {}) });
function hostFixture(t, config, models) {
  const f = fixture(t, config, models);
  const run = (budget, ...flags) => spawnSync(process.execPath, [script, "--file", f.file, "--catalog", f.catalog, "--harness", "t3code", "--budget", budget, ...flags], { encoding: "utf8" });
  return { ...f, run };
}

test("explicit effort options set the entry's effort instead of rewriting names", (t) => {
  const rows = [
    // [budget, exposed efforts, implementer (object form), reviewer (string form)]
    ["unlimited", ladder, "high", "max"],
    ["large", ladder, "xhigh", "xhigh"],
    ["medium", ladder, "high", "high"],
    ["small", ladder, "medium", "medium"],
    ["large", ["low", "medium", "high", "max"], "high", "high"],
    ["medium", ["low", "max"], "low", "low"],
    ["small", ["off", "minimal", "low", "medium", "ultracode"], "medium", "medium"],
    ["small", ["off", "low", "ultracode"], "low", "low"],
  ];
  for (const [budget, efforts, implementer, reviewer] of rows) {
    const f = hostFixture(t, {
      roles: { implementer: "inherit-parent", reviewer: "inherit-parent" },
      overrides: { t3code: { implementer: { provider: "codex", model: "gpt-5.6-sol", effort: "high" }, reviewer: "claude_work/claude-opus-5-5 (max)" } },
      extra: { keep: true },
    }, [entry("codex", "gpt-5.6-sol", efforts), entry("claude_work", "claude-opus-5-5", efforts)]);
    const label = `${budget} ${efforts}`;
    const result = f.run(budget, "--apply");
    assert.equal(result.status, 0, `${label}: ${result.stdout}${result.stderr}`);
    const saved = JSON.parse(readFileSync(f.file, "utf8"));
    // The object form stays an object and the string form stays a string.
    assert.deepEqual(saved.overrides.t3code.implementer, { provider: "codex", model: "gpt-5.6-sol", effort: implementer }, label);
    assert.equal(saved.overrides.t3code.reviewer, `claude_work/claude-opus-5-5 (${reviewer})`, label);
    assert.equal(saved.budgets.t3code, budget);
    assert.equal(saved.extra.keep, true);
    assert.deepEqual(saved.roles, { implementer: "inherit-parent", reviewer: "inherit-parent" });
  }
});

test("effort budgets leave aliases and other scopes alone, and a repeat apply is a no-op", (t) => {
  const f = hostFixture(t, {
    roles: { implementer: "worker-high", judge: "inherit-parent", explorer: "auto" },
    overrides: { codex: { implementer: "codex-custom" }, t3code: { judge: "inherit-parent", explorer: "auto", implementer: "codex/gpt-5.6-sol (low)" } },
  }, [entry("codex", "gpt-5.6-sol", ladder)]);
  assert.equal(f.run("small", "--apply").status, 0);
  const saved = JSON.parse(readFileSync(f.file, "utf8"));
  assert.deepEqual(saved.overrides.t3code, { judge: "inherit-parent", explorer: "auto", implementer: "codex/gpt-5.6-sol (medium)" });
  assert.deepEqual(saved.overrides.codex, { implementer: "codex-custom" });
  assert.equal(saved.roles.implementer, "worker-high");
  const mtime = statSync(f.file).mtimeMs;
  assert.equal(f.run("small", "--apply").status, 0);
  assert.equal(statSync(f.file).mtimeMs, mtime);
});

test("a host role that falls back to a provider-less default is refused until it is set", (t) => {
  const f = hostFixture(t, { roles: { implementer: "worker-high" } }, [entry("codex", "gpt-5.6-sol", ladder)]);
  const before = readFileSync(f.file, "utf8");
  const result = f.run("small", "--apply");
  assert.equal(result.status, 1);
  assert.match(JSON.parse(result.stdout).unresolved[0].reason, /overrides\.t3code\.implementer/);
  assert.equal(readFileSync(f.file, "utf8"), before);
});

test("effort budgets refuse every write when a target is not exposed or the model is unknown", (t) => {
  const rows = [
    ["no option at or below the target", [entry("codex", "gpt-5.6-sol", ["xhigh", "max"])], "small", /no effort option at or below medium/],
    ["only non-ladder options", [entry("codex", "gpt-5.6-sol", ["off", "ultracode"])], "small", /no effort option/],
    ["model exposes no effort", [entry("codex", "gpt-5.6-sol")], "large", /no effort option/],
    ["unknown model", [entry("codex", "other-model", ladder)], "large", /not in the catalog/],
    ["unknown provider instance", [entry("codex_two", "gpt-5.6-sol", ladder)], "large", /not in the catalog/],
    ["unlimited with a stored effort the model lacks", [entry("codex", "gpt-5.6-sol", ["low", "medium"])], "unlimited", /does not expose effort high/],
  ];
  for (const [label, catalog, budget, reason] of rows) {
    const f = hostFixture(t, {
      roles: { implementer: "inherit-parent", reviewer: "inherit-parent" },
      overrides: { t3code: { implementer: "codex/gpt-5.6-sol (high)", reviewer: "inherit-parent" } },
    }, catalog);
    const before = readFileSync(f.file, "utf8");
    const result = f.run(budget, "--apply");
    assert.equal(result.status, 1, label);
    const report = JSON.parse(result.stdout);
    assert.equal(report.applied, false, label);
    assert.match(report.unresolved[0].reason, reason, label);
    assert.equal(readFileSync(f.file, "utf8"), before, label);
  }
});

test("effort mapping that collapses panel entries refuses the write, while distinct models are a valid panel", (t) => {
  const catalog = [entry("codex", "gpt-5.6-sol", ladder), entry("claude_work", "claude-opus-5-5", ladder)];
  const collapsed = hostFixture(t, {
    roles: { reviewer: "inherit-parent" },
    overrides: { t3code: { reviewer: ["codex/gpt-5.6-sol (max)", { provider: "codex", model: "gpt-5.6-sol", effort: "low" }] } },
  }, catalog);
  const before = readFileSync(collapsed.file, "utf8");
  const refused = collapsed.run("medium", "--apply");
  assert.equal(refused.status, 1);
  assert.match(JSON.parse(refused.stdout).unresolved[0].reason, /collapses reviewer entries/);
  assert.equal(readFileSync(collapsed.file, "utf8"), before);
  const distinct = hostFixture(t, {
    roles: { reviewer: "inherit-parent" },
    overrides: { t3code: { reviewer: ["codex/gpt-5.6-sol (max)", "claude_work/claude-opus-5-5 (max)", "inherit-parent"] } },
  }, catalog);
  assert.equal(distinct.run("medium", "--apply").status, 0);
  assert.deepEqual(JSON.parse(readFileSync(distinct.file, "utf8")).overrides.t3code.reviewer,
    ["codex/gpt-5.6-sol (high)", "claude_work/claude-opus-5-5 (high)", "inherit-parent"]);
});

test("name-suffix catalogs keep working beside effort catalogs, and a malformed effort catalog is rejected", (t) => {
  const f = fixture(t, { roles: { implementer: "grok-4.7-max-fast", reviewer: { provider: "p", model: "m" } } }, [
    "grok-4.7-high-fast", entry("p", "m", ladder),
  ]);
  const result = f.run("medium", "--apply");
  assert.equal(result.status, 0, result.stdout + result.stderr);
  assert.deepEqual(JSON.parse(readFileSync(f.file, "utf8")).overrides.pi, { implementer: "grok-4.7-high-fast", reviewer: { provider: "p", model: "m", effort: "high" } });
  const before = readFileSync(f.file, "utf8");
  for (const bad of [
    [{ provider: "p", model: "m", efforts: "high" }], [{ provider: "p", model: "m", efforts: ["high", "high"] }],
    [{ provider: "p", model: "m", extra: 1 }], [{ provider: "p/q", model: "m" }], [{ provider: "p", model: "auto" }], [{ model: "" }],
  ]) {
    writeFileSync(f.catalog, JSON.stringify(bad));
    const rejected = f.run("medium", "--apply");
    assert.notEqual(rejected.status, 0, JSON.stringify(bad));
    assert.match(rejected.stderr, /catalog/);
    assert.equal(readFileSync(f.file, "utf8"), before);
  }
});
