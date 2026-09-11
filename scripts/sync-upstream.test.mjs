import assert from "node:assert/strict";
import {
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
  realpathSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { hostname, tmpdir } from "node:os";
import { join, relative, resolve } from "node:path";
import test from "node:test";

const synchronizer = resolve("scripts", "sync-upstream.mjs");
const checker = resolve("scripts", "check-upstream.mjs");

test("strict upstream checks require a source checkout", () => {
  const checked = run(checker, ["--strict"]);
  assert.notEqual(checked.status, 0);
  assert.match(checked.stderr, /Pass --source <pstack checkout>/);
});

function write(path, content) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function run(script, arguments_) {
  return spawnSync(process.execPath, [script, ...arguments_], {
    cwd: resolve("."),
    encoding: "utf8",
  });
}

const faultPreload = String.raw`
const fs = require("node:fs");
const { syncBuiltinESMExports } = require("node:module");

const plan = JSON.parse(fs.readFileSync(process.env.MSTACK_SYNC_TEST_FAULT_PLAN, "utf8"));
const originals = Object.fromEntries(
  ["closeSync", "copyFileSync", "existsSync", "linkSync", "mkdirSync", "openSync", "renameSync", "rmSync", "unlinkSync", "writeFileSync"]
    .map((name) => [name, fs[name].bind(fs)]),
);
const descriptorPaths = new Map();
const hits = new Map();

function normalized(value) {
  if (typeof value === "number") return descriptorPaths.get(value) ?? String(value);
  return String(value).replaceAll("\\", "/");
}

function ruleMatches(rule, paths) {
  const [path, destination] = paths.map(normalized);
  return (!rule.pathEndsWith || path.endsWith(rule.pathEndsWith)) &&
    (!rule.pathIncludes || path.includes(rule.pathIncludes)) &&
    (!rule.fromEndsWith || path.endsWith(rule.fromEndsWith)) &&
    (!rule.fromIncludes || path.includes(rule.fromIncludes)) &&
    (!rule.toEndsWith || destination?.endsWith(rule.toEndsWith)) &&
    (!rule.toIncludes || destination?.includes(rule.toIncludes));
}

function trigger(method, phase, paths) {
  for (const [index, rule] of plan.rules.entries()) {
    if (rule.method !== method || rule.phase !== phase || !ruleMatches(rule, paths)) continue;
    const count = (hits.get(index) ?? 0) + 1;
    hits.set(index, count);
    if (count !== (rule.occurrence ?? 1)) continue;

    if (rule.action === "exit") process.exit(rule.exitCode ?? 86);
    if (rule.action === "gate") {
      originals.writeFileSync(rule.ready, "ready\n", "utf8");
      const deadline = Date.now() + (rule.timeoutMs ?? 10000);
      const sleeper = new Int32Array(new SharedArrayBuffer(4));
      while (!originals.existsSync(rule.release)) {
        if (Date.now() >= deadline) process.exit(87);
        Atomics.wait(sleeper, 0, 0, 20);
      }
      return;
    }

    const error = new Error(rule.message ?? "injected filesystem failure");
    error.code = rule.code ?? "EIO";
    throw error;
  }
}

for (const method of ["copyFileSync", "linkSync", "mkdirSync", "renameSync", "rmSync", "unlinkSync"]) {
  fs[method] = (...args) => {
    trigger(method, "before", args);
    const result = originals[method](...args);
    trigger(method, "after", args);
    return result;
  };
}

fs.openSync = (...args) => {
  trigger("openSync", "before", args);
  const descriptor = originals.openSync(...args);
  descriptorPaths.set(descriptor, normalized(args[0]));
  trigger("openSync", "after", args);
  return descriptor;
};

fs.writeFileSync = (...args) => {
  trigger("writeFileSync", "before", args);
  const result = originals.writeFileSync(...args);
  trigger("writeFileSync", "after", args);
  return result;
};

fs.closeSync = (descriptor) => {
  try {
    return originals.closeSync(descriptor);
  } finally {
    descriptorPaths.delete(descriptor);
  }
};

syncBuiltinESMExports();
`;

function writeFaultPlan(root, rules) {
  const preloadPath = join(root, "sync-upstream-fault-preload.cjs");
  const planPath = join(root, "sync-upstream-fault-plan.json");
  write(preloadPath, faultPreload);
  write(planPath, JSON.stringify({ rules }));
  return {
    preloadPath,
    env: { ...process.env, MSTACK_SYNC_TEST_FAULT_PLAN: planPath },
  };
}

function runWithFaults(script, arguments_, root, rules, options = {}) {
  const fault = writeFaultPlan(root, rules);
  return spawnSync(process.execPath, ["--require", fault.preloadPath, script, ...arguments_], {
    cwd: resolve("."),
    encoding: "utf8",
    env: fault.env,
    timeout: options.timeout ?? 10000,
  });
}

function spawnWithFaults(script, arguments_, root, rules) {
  const fault = writeFaultPlan(root, rules);
  const child = spawn(process.execPath, ["--require", fault.preloadPath, script, ...arguments_], {
    cwd: resolve("."),
    env: fault.env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  let stdout = "";
  let stderr = "";
  child.stdout.on("data", (chunk) => { stdout += chunk; });
  child.stderr.on("data", (chunk) => { stderr += chunk; });
  const completed = new Promise((resolveResult, reject) => {
    child.once("error", reject);
    child.once("close", (status, signal) => resolveResult({ status, signal, stdout, stderr }));
  });
  return { child, completed };
}

async function waitForPath(path, timeout = 5000) {
  const deadline = Date.now() + timeout;
  while (!existsSync(path)) {
    if (Date.now() >= deadline) throw new Error(`Timed out waiting for ${path}`);
    await new Promise((resolveWait) => setTimeout(resolveWait, 20));
  }
}

function snapshotTree(root, { excludeTransactionState = false } = {}) {
  const snapshot = [];
  function visit(directory) {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = join(directory, entry.name);
      const relativePath = relative(root, path).replaceAll("\\", "/");
      if (
        excludeTransactionState &&
        (relativePath.startsWith(".mstack-sync-upstream.lock") ||
          relativePath === ".mstack-sync-upstream" ||
          relativePath.startsWith(".mstack-sync-upstream/") ||
          relativePath === ".mstack-sync-upstream-tx" ||
          relativePath.includes("/.mstack-sync-upstream-tx"))
      ) continue;
      if (entry.isDirectory()) {
        snapshot.push(["directory", relativePath]);
        visit(path);
      } else {
        const status = lstatSync(path);
        snapshot.push([
          status.isSymbolicLink() ? "symlink" : "file",
          relativePath,
          status.isSymbolicLink() ? undefined : readFileSync(path).toString("base64"),
        ]);
      }
    }
  }
  visit(root);
  return snapshot;
}

function assertNoTransactionState(target) {
  const leftovers = snapshotTree(target)
    .map(([, path]) => path)
    .filter((path) =>
      path === ".mstack-sync-upstream.lock" ||
      path === ".mstack-sync-upstream" ||
      path.startsWith(".mstack-sync-upstream/") ||
      path === ".mstack-sync-upstream-tx" ||
      path.includes("/.mstack-sync-upstream-tx"),
    );
  assert.deepEqual(leftovers, [], `transaction state was not removed: ${leftovers.join(", ")}`);
}

function applyBaseline(source, target) {
  const result = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
  assert.equal(result.status, 0, result.stderr);
}

function advanceSource(source, target, update, message) {
  update();
  const commit = commitSourceChange(source, message);
  updateProfile(target, (pstack) => { pstack.commit = commit; });
}

function transactionDirectory(target, id) {
  return join(target, ".mstack-sync-upstream", "transactions", id);
}

function sha256(content) {
  return createHash("sha256").update(content).digest("hex");
}

function runGit(directory, arguments_) {
  const result = spawnSync("git", ["-C", directory, ...arguments_], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function updateProfile(target, update) {
  const path = join(target, "profiles", "upstreams.json");
  const profile = JSON.parse(readFileSync(path, "utf8"));
  update(profile.pstack);
  write(path, `${JSON.stringify(profile, null, 2)}\n`);
}

function commitSourceChange(source, message) {
  runGit(source, ["add", "-A"]);
  runGit(source, [
    "-c", "user.name=mstack test",
    "-c", "user.email=mstack@example.test",
    "commit", "--quiet", "-m", message,
  ]);
  return runGit(source, ["rev-parse", "HEAD"]);
}

function fixture({ initializeGit = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "mstack-upstream-test-"));
  const source = join(root, "pstack");
  const target = join(root, "mstack");
  write(join(source, "agents", "poteto-agent.md"), "---\nname: poteto-agent\n---\n");
  write(join(source, "automations", "benny", "README.md"), "pstack uses poteto-mode.\n");
  write(join(source, "docs", "guide", "02-poteto-mode.md"), "Use /poteto-mode with pstack.\nCursor confirms.\n");
  write(join(source, "skills", "poteto-mode", "scripts", "tool.mjs"), "const mode = 'poteto-mode';\n");
  write(join(source, "skills", "sample", "SKILL.md"), "---\nname: sample\ndescription: fixture\n---\n");
  let commit = "0".repeat(40);
  if (initializeGit) {
    runGit(source, ["init", "--quiet"]);
    runGit(source, ["add", "."]);
    runGit(source, [
      "-c", "user.name=mstack test",
      "-c", "user.email=mstack@example.test",
      "commit", "--quiet", "-m", "fixture",
    ]);
    commit = runGit(source, ["rev-parse", "HEAD"]);
  }
  write(join(target, "skills", "meta-mode", "SKILL.md"), "---\nname: meta-mode\ndescription: fixture\n---\n");
  write(join(target, "skills", "sample", "SKILL.md"), "---\nname: sample\ndescription: fixture\n---\n");
  write(join(target, "profiles", "upstreams.json"), JSON.stringify({
    pstack: {
      repository: "https://example.test/pstack",
      commit,
      renames: { "poteto-mode": "meta-mode" },
      artifacts: {
        guide: {
          source: "docs/guide",
          target: "docs/guide",
          compareContent: true,
          renameFiles: { "02-poteto-mode.md": "02-meta-mode.md" },
          replacements: [{ from: "Cursor confirms.", to: "Harness confirms." }],
        },
      },
    },
  }, null, 2));
  return { root, source, target };
}

test("upstream sync previews, transforms, and protects changed files", () => {
  const { root, source, target } = fixture();
  try {
    const dryRun = run(synchronizer, ["--source", source, "--target", target]);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /Dry run: 4 file\(s\) would be written/);
    assert.equal(existsSync(join(target, "automations")), false);

    const applied = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(
      readFileSync(join(target, "automations", "benny", "README.md"), "utf8"),
      "mstack uses meta-mode.\n",
    );
    assert.equal(
      readFileSync(join(target, "docs", "guide", "02-meta-mode.md"), "utf8"),
      "Use /meta-mode with mstack.\nHarness confirms.\n",
    );
    assert.equal(
      readFileSync(join(target, "tools", "meta-mode", "tool.mjs"), "utf8"),
      "const mode = 'meta-mode';\n",
    );
    assert.ok(existsSync(join(target, "agents", "meta-agent.md")));
    assert.ok(existsSync(join(target, "profiles", "upstream-manifest.json")));

    const checked = run(checker, ["--source", source, "--target", target, "--strict"]);
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stdout, /artifact guide: 1 present, 0 missing, 0 changed/);

    write(join(target, "automations", "benny", "README.md"), "local edit\n");
    const refused = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /Refusing to replace or remove changed upstream artifacts/);

    const forced = run(synchronizer, ["--source", source, "--target", target, "--apply", "--force"]);
    assert.equal(forced.status, 0, forced.stderr);
    assert.equal(
      readFileSync(join(target, "automations", "benny", "README.md"), "utf8"),
      "mstack uses meta-mode.\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("apply and strict checks reject tracked and untracked source changes", () => {
  const { root, source, target } = fixture();
  try {
    write(join(source, "skills", "sample", "SKILL.md"), "modified\n");
    write(join(source, "untracked.txt"), "untracked\n");

    const preview = run(synchronizer, ["--source", source, "--target", target]);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stderr, /Warning: Source subtree has tracked or untracked changes/);
    assert.match(preview.stderr, /skills\/sample\/SKILL\.md/);
    assert.match(preview.stderr, /untracked\.txt/);

    const applied = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
    assert.notEqual(applied.status, 0);
    assert.match(applied.stderr, /Upstream source provenance check failed/);
    assert.equal(existsSync(join(target, "automations")), false);

    const checked = run(checker, ["--source", source, "--target", target, "--strict"]);
    assert.notEqual(checked.status, 0);
    assert.match(checked.stderr, /Upstream source provenance check failed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("strict operations reject a non-Git source while previews warn", () => {
  const { root, source, target } = fixture({ initializeGit: false });
  try {
    const preview = run(synchronizer, ["--source", source, "--target", target]);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stderr, /Warning: Source is not inside a Git checkout/);

    const nonStrictCheck = run(checker, ["--source", source, "--target", target]);
    assert.equal(nonStrictCheck.status, 0, nonStrictCheck.stderr);
    assert.match(nonStrictCheck.stderr, /Warning: Source is not inside a Git checkout/);

    const applied = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
    assert.notEqual(applied.status, 0);
    assert.match(applied.stderr, /Source is not inside a Git checkout/);

    const checked = run(checker, ["--source", source, "--target", target, "--strict"]);
    assert.notEqual(checked.status, 0);
    assert.match(checked.stderr, /Source is not inside a Git checkout/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("strict operations reject a clean source at a different commit", () => {
  const { root, source, target } = fixture();
  try {
    write(join(source, "CHANGELOG.md"), "new commit\n");
    runGit(source, ["add", "CHANGELOG.md"]);
    runGit(source, [
      "-c", "user.name=mstack test",
      "-c", "user.email=mstack@example.test",
      "commit", "--quiet", "-m", "advance source",
    ]);

    const preview = run(synchronizer, ["--source", source, "--target", target]);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stderr, /Warning: Source checkout is at [0-9a-f]+, profile pins [0-9a-f]+/);

    const applied = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
    assert.notEqual(applied.status, 0);
    assert.match(applied.stderr, /Upstream source provenance check failed/);

    const checked = run(checker, ["--source", source, "--target", target, "--strict"]);
    assert.notEqual(checked.status, 0);
    assert.match(checked.stderr, /Source checkout is at [0-9a-f]+, profile pins [0-9a-f]+/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("artifact paths cannot escape the source or target checkout", () => {
  const cases = [
    {
      configure(pstack) { pstack.artifacts.guide.source = "../outside-source"; },
      expected: /artifact guide source must stay inside its checkout; parent traversal is not allowed/,
    },
    {
      configure(pstack) { pstack.artifacts.guide.target = "../outside-target"; },
      expected: /artifact guide target must stay inside its checkout; parent traversal is not allowed/,
    },
    {
      configure(pstack, root) { pstack.artifacts.guide.target = join(root, "outside-target"); },
      expected: /artifact guide target must stay inside its checkout; absolute paths are not allowed/,
    },
    {
      configure(pstack) { pstack.artifacts.guide.renameFiles["02-poteto-mode.md"] = "../../outside.md"; },
      expected: /artifact guide rename .* parent traversal is not allowed/,
    },
  ];

  for (const testCase of cases) {
    const { root, source, target } = fixture();
    try {
      updateProfile(target, (pstack) => testCase.configure(pstack, root));
      for (const script of [synchronizer, checker]) {
        const result = run(script, ["--source", source, "--target", target]);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, testCase.expected);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("manifest paths cannot escape the target checkout", () => {
  const { root, source, target } = fixture();
  try {
    write(join(target, "profiles", "upstream-manifest.json"), JSON.stringify({
      artifacts: { guide: { "../outside.md": "0".repeat(64) } },
    }));

    for (const script of [synchronizer, checker]) {
      const result = run(script, ["--source", source, "--target", target]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /upstream manifest artifact guide must stay inside its checkout/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("artifact target collisions are rejected", () => {
  const { root, source, target } = fixture();
  try {
    updateProfile(target, (pstack) => {
      pstack.artifacts.agents = {
        source: "agents",
        target: "docs/guide",
        compareContent: false,
        renameFiles: { "poteto-agent.md": "02-meta-mode.md" },
      };
    });

    for (const script of [synchronizer, checker]) {
      const result = run(script, ["--source", source, "--target", target]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /resolve to the same target: docs\/guide\/02-meta-mode\.md/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("removed upstream artifacts are reported and safely deleted", () => {
  const { root, source, target } = fixture();
  try {
    const initial = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
    assert.equal(initial.status, 0, initial.stderr);
    const removedPath = join(target, "automations", "benny", "README.md");
    assert.ok(existsSync(removedPath));

    unlinkSync(join(source, "automations", "benny", "README.md"));
    const commit = commitSourceChange(source, "remove automation readme");
    updateProfile(target, (pstack) => { pstack.commit = commit; });

    const preview = run(synchronizer, ["--source", source, "--target", target]);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /removed=1/);
    assert.match(preview.stdout, /Files removed upstream:\r?\n  automations\/benny\/README\.md/);
    assert.ok(existsSync(removedPath));

    const checked = run(checker, ["--source", source, "--target", target, "--strict"]);
    assert.notEqual(checked.status, 0);
    assert.match(checked.stderr, /removed upstream: automations\/benny\/README\.md/);

    const applied = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
    assert.equal(applied.status, 0, applied.stderr);
    assert.match(applied.stdout, /Removed 1 file\(s\)/);
    assert.equal(existsSync(removedPath), false);

    const manifest = JSON.parse(readFileSync(join(target, "profiles", "upstream-manifest.json"), "utf8"));
    assert.deepEqual(manifest.artifacts.automations, {});
    const rechecked = run(checker, ["--source", source, "--target", target, "--strict"]);
    assert.equal(rechecked.status, 0, rechecked.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("locally adapted removed artifacts require force before deletion", () => {
  const { root, source, target } = fixture();
  try {
    const initial = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
    assert.equal(initial.status, 0, initial.stderr);
    const removedPath = join(target, "agents", "meta-agent.md");
    write(removedPath, "local adaptation\n");

    const adaptedCheck = run(checker, ["--source", source, "--target", target, "--strict"]);
    assert.equal(adaptedCheck.status, 0, adaptedCheck.stderr);

    unlinkSync(join(source, "agents", "poteto-agent.md"));
    const commit = commitSourceChange(source, "remove agent");
    updateProfile(target, (pstack) => { pstack.commit = commit; });

    const preview = run(synchronizer, ["--source", source, "--target", target]);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /agents\/meta-agent\.md \(locally changed\)/);

    const refused = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /Refusing to replace or remove changed upstream artifacts/);
    assert.match(refused.stderr, /remove: agents\/meta-agent\.md/);
    assert.equal(readFileSync(removedPath, "utf8"), "local adaptation\n");

    const forced = run(synchronizer, ["--source", source, "--target", target, "--apply", "--force"]);
    assert.equal(forced.status, 0, forced.stderr);
    assert.equal(existsSync(removedPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rolls back every target when a file replacement fails during commit", () => {
  const { root, source, target } = fixture();
  try {
    applyBaseline(source, target);
    advanceSource(source, target, () => {
      write(join(source, "automations", "benny", "README.md"), "changed pstack automation\n");
      write(
        join(source, "docs", "guide", "02-poteto-mode.md"),
        "Changed /poteto-mode guide for pstack.\nCursor confirms.\n",
      );
    }, "change two managed files");
    const before = snapshotTree(target);

    const failed = runWithFaults(
      synchronizer,
      ["--source", source, "--target", target, "--apply", "--force"],
      root,
      [{
        method: "renameSync",
        phase: "before",
        fromIncludes: "/.mstack-sync-upstream-tx/",
        toEndsWith: "/docs/guide/02-meta-mode.md",
        message: "injected target replacement failure",
      }],
    );

    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /injected target replacement failure/);
    assert.deepEqual(snapshotTree(target), before);
    assertNoTransactionState(target);

    const retried = run(synchronizer, ["--source", source, "--target", target, "--apply", "--force"]);
    assert.equal(retried.status, 0, retried.stderr);
    const checked = run(checker, ["--source", source, "--target", target, "--strict"]);
    assert.equal(checked.status, 0, checked.stderr);
    assertNoTransactionState(target);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rolls back file writes and removals when manifest replacement fails", () => {
  const { root, source, target } = fixture();
  try {
    applyBaseline(source, target);
    advanceSource(source, target, () => {
      unlinkSync(join(source, "automations", "benny", "README.md"));
      write(
        join(source, "docs", "guide", "02-poteto-mode.md"),
        "Changed /poteto-mode guide for pstack.\nCursor confirms.\n",
      );
    }, "change and remove managed files");
    const before = snapshotTree(target);

    const failed = runWithFaults(
      synchronizer,
      ["--source", source, "--target", target, "--apply", "--force"],
      root,
      [{
        method: "renameSync",
        phase: "before",
        fromIncludes: "/.mstack-sync-upstream-tx/",
        toEndsWith: "/profiles/upstream-manifest.json",
        message: "injected manifest replacement failure",
      }],
    );

    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /injected manifest replacement failure/);
    assert.deepEqual(snapshotTree(target), before);
    assertNoTransactionState(target);

    const retried = run(synchronizer, ["--source", source, "--target", target, "--apply", "--force"]);
    assert.equal(retried.status, 0, retried.stderr);
    assert.equal(existsSync(join(target, "automations", "benny", "README.md")), false);
    const checked = run(checker, ["--source", source, "--target", target, "--strict"]);
    assert.equal(checked.status, 0, checked.stderr);
    assertNoTransactionState(target);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("retains recoverable state when rollback fails after a primary commit failure", () => {
  const { root, source, target } = fixture();
  try {
    applyBaseline(source, target);
    advanceSource(source, target, () => {
      write(join(source, "automations", "benny", "README.md"), "recovery pstack automation\n");
      write(
        join(source, "docs", "guide", "02-poteto-mode.md"),
        "Recovery /poteto-mode guide for pstack.\nCursor confirms.\n",
      );
    }, "prepare rollback failure recovery");

    const failed = runWithFaults(
      synchronizer,
      ["--source", source, "--target", target, "--apply", "--force"],
      root,
      [
        {
          method: "renameSync",
          phase: "before",
          fromIncludes: "/.mstack-sync-upstream-tx/",
          toEndsWith: "/profiles/upstream-manifest.json",
          message: "injected primary manifest failure",
        },
        {
          method: "renameSync",
          phase: "before",
          fromIncludes: "/.mstack-sync-upstream-tx/",
          fromEndsWith: ".old",
          toEndsWith: "/automations/benny/README.md",
          message: "injected rollback restore failure",
        },
      ],
    );

    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /injected primary manifest failure/);
    assert.match(failed.stderr, /Rollback failed; transaction state was retained for recovery/);
    assert.match(failed.stderr, /injected rollback restore failure/);
    assert.equal(existsSync(join(target, ".mstack-sync-upstream.lock")), false);

    const transactionsRoot = join(target, ".mstack-sync-upstream", "transactions");
    const transactionIds = readdirSync(transactionsRoot);
    assert.equal(transactionIds.length, 1);
    const transaction = join(transactionsRoot, transactionIds[0]);
    const journalPath = join(transaction, "journal.json");
    assert.equal(existsSync(journalPath), true);
    const journal = JSON.parse(readFileSync(journalPath, "utf8"));
    const automation = journal.operations.find(
      (operation) => operation.target === "automations/benny/README.md",
    );
    assert.ok(automation, "journal did not retain the failed rollback operation");
    const backupPath = resolve(target, ...automation.backup.split("/"));
    assert.equal(existsSync(backupPath), true, "rollback removed the only recoverable backup");

    const recovered = run(synchronizer, ["--source", source, "--target", target, "--apply", "--force"]);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(
      readFileSync(join(target, "automations", "benny", "README.md"), "utf8"),
      "recovery mstack automation\n",
    );
    assert.equal(
      readFileSync(join(target, "docs", "guide", "02-meta-mode.md"), "utf8"),
      "Recovery /meta-mode guide for mstack.\nHarness confirms.\n",
    );
    const checked = run(checker, ["--source", source, "--target", target, "--strict"]);
    assert.equal(checked.status, 0, checked.stderr);
    assertNoTransactionState(target);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("recovers a stale transaction after the process exits between a rename and journal progress", () => {
  const { root, source, target } = fixture();
  try {
    applyBaseline(source, target);
    advanceSource(source, target, () => {
      write(join(source, "automations", "benny", "README.md"), "changed pstack automation\n");
      write(
        join(source, "docs", "guide", "02-poteto-mode.md"),
        "Changed /poteto-mode guide for pstack.\nCursor confirms.\n",
      );
    }, "prepare interrupted sync");

    const interrupted = runWithFaults(
      synchronizer,
      ["--source", source, "--target", target, "--apply", "--force"],
      root,
      [{
        method: "renameSync",
        phase: "after",
        fromIncludes: "/.mstack-sync-upstream-tx/",
        toEndsWith: "/automations/benny/README.md",
        action: "exit",
        exitCode: 86,
      }],
    );

    assert.equal(interrupted.status, 86, interrupted.stderr);
    assert.equal(existsSync(join(target, ".mstack-sync-upstream.lock")), true);
    const transactionsRoot = join(target, ".mstack-sync-upstream", "transactions");
    const transactionIds = readdirSync(transactionsRoot);
    assert.equal(transactionIds.length, 1);
    assert.equal(existsSync(join(transactionsRoot, transactionIds[0], "journal.json")), true);

    const recovered = run(synchronizer, ["--source", source, "--target", target, "--apply", "--force"]);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(
      readFileSync(join(target, "automations", "benny", "README.md"), "utf8"),
      "changed mstack automation\n",
    );
    assert.equal(
      readFileSync(join(target, "docs", "guide", "02-meta-mode.md"), "utf8"),
      "Changed /meta-mode guide for mstack.\nHarness confirms.\n",
    );
    const checked = run(checker, ["--source", source, "--target", target, "--strict"]);
    assert.equal(checked.status, 0, checked.stderr);
    assertNoTransactionState(target);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("quarantines user edits before rolling back an interrupted transaction", () => {
  const { root, source, target } = fixture();
  try {
    applyBaseline(source, target);
    advanceSource(source, target, () => {
      write(join(source, "automations", "benny", "README.md"), "changed pstack automation\n");
    }, "prepare interrupted sync with user edit");

    const interrupted = runWithFaults(
      synchronizer,
      ["--source", source, "--target", target, "--apply", "--force"],
      root,
      [{
        method: "renameSync",
        phase: "after",
        fromIncludes: "/.mstack-sync-upstream-tx/",
        toEndsWith: "/automations/benny/README.md",
        action: "exit",
        exitCode: 86,
      }],
    );
    assert.equal(interrupted.status, 86, interrupted.stderr);

    const transactionsRoot = join(target, ".mstack-sync-upstream", "transactions");
    const [transactionId] = readdirSync(transactionsRoot);
    write(join(target, "automations", "benny", "README.md"), "user edit during recovery\n");

    const recovered = run(synchronizer, ["--source", source, "--target", target, "--apply", "--force"]);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.match(recovered.stderr, new RegExp(`automations/benny/README\\.md.*${transactionId}.*recovery`));
    assert.equal(
      readFileSync(join(target, "automations", "benny", "README.md"), "utf8"),
      "changed mstack automation\n",
    );
    assert.equal(
      readFileSync(join(target, ".mstack-sync-upstream", "recovery", transactionId, "0.user"), "utf8"),
      "user edit during recovery\n",
    );
    assert.equal(existsSync(transactionsRoot) ? readdirSync(transactionsRoot).length : 0, 0);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("cleans up a committed transaction without rolling it back after the committed marker rename", () => {
  const { root, source, target } = fixture();
  try {
    applyBaseline(source, target);
    advanceSource(source, target, () => {
      write(join(source, "automations", "benny", "README.md"), "committed pstack automation\n");
      write(
        join(source, "docs", "guide", "02-poteto-mode.md"),
        "Committed /poteto-mode guide for pstack.\nCursor confirms.\n",
      );
    }, "prepare committed sync cleanup");

    const interrupted = runWithFaults(
      synchronizer,
      ["--source", source, "--target", target, "--apply", "--force"],
      root,
      [{
        method: "renameSync",
        phase: "after",
        fromEndsWith: "/COMMITTED.tmp",
        toEndsWith: "/COMMITTED",
        action: "exit",
        exitCode: 86,
      }],
    );

    assert.equal(interrupted.status, 86, interrupted.stderr);
    const transactionsRoot = join(target, ".mstack-sync-upstream", "transactions");
    const transactionIds = readdirSync(transactionsRoot);
    assert.equal(transactionIds.length, 1);
    assert.equal(existsSync(join(transactionsRoot, transactionIds[0], "COMMITTED")), true);
    assert.equal(
      readFileSync(join(target, "automations", "benny", "README.md"), "utf8"),
      "committed mstack automation\n",
    );

    write(join(target, "automations", "benny", "README.md"), "user edit after commit\n");

    const recovered = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
    assert.notEqual(recovered.status, 0);
    assert.doesNotMatch(recovered.stderr, /committed transaction attempted rollback/);
    assert.equal(
      readFileSync(join(target, "automations", "benny", "README.md"), "utf8"),
      "user edit after commit\n",
    );
    assert.equal(
      readFileSync(join(target, "docs", "guide", "02-meta-mode.md"), "utf8"),
      "Committed /meta-mode guide for mstack.\nHarness confirms.\n",
    );
    const checked = run(checker, ["--source", source, "--target", target, "--strict"]);
    assert.notEqual(checked.status, 0);
    assert.match(checked.stderr, /automations\/benny\/README\.md/);
    assertNoTransactionState(target);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("removes newly created nested target directories and sidecars after a first apply fails", () => {
  const { root, source, target } = fixture();
  try {
    updateProfile(target, (pstack) => {
      pstack.artifacts.guide.target = "generated/deep/guide";
    });
    const before = snapshotTree(target);

    const failed = runWithFaults(
      synchronizer,
      ["--source", source, "--target", target, "--apply"],
      root,
      [{
        method: "renameSync",
        phase: "before",
        fromIncludes: "/.mstack-sync-upstream-tx/",
        toEndsWith: "/profiles/upstream-manifest.json",
        message: "injected first apply commit failure",
      }],
    );

    assert.notEqual(failed.status, 0);
    assert.match(failed.stderr, /injected first apply commit failure/);
    assert.deepEqual(snapshotTree(target), before);
    assert.equal(existsSync(join(target, "generated")), false);
    assertNoTransactionState(target);

    const retried = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
    assert.equal(retried.status, 0, retried.stderr);
    assert.equal(
      readFileSync(join(target, "generated", "deep", "guide", "02-meta-mode.md"), "utf8"),
      "Use /meta-mode with mstack.\nHarness confirms.\n",
    );
    const checked = run(checker, ["--source", source, "--target", target, "--strict"]);
    assert.equal(checked.status, 0, checked.stderr);
    assertNoTransactionState(target);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("dry-run and upstream checks refuse stale state without recovering it", () => {
  const { root, source, target } = fixture();
  try {
    applyBaseline(source, target);
    advanceSource(source, target, () => {
      write(join(source, "automations", "benny", "README.md"), "stale pstack automation\n");
    }, "prepare stale read-only checks");

    const interrupted = runWithFaults(
      synchronizer,
      ["--source", source, "--target", target, "--apply", "--force"],
      root,
      [{
        method: "renameSync",
        phase: "after",
        fromIncludes: "/.mstack-sync-upstream-tx/",
        toEndsWith: "/automations/benny/README.md",
        action: "exit",
        exitCode: 86,
      }],
    );
    assert.equal(interrupted.status, 86, interrupted.stderr);
    const stale = snapshotTree(target);

    const dryRun = run(synchronizer, ["--source", source, "--target", target]);
    assert.notEqual(dryRun.status, 0);
    assert.match(dryRun.stderr, /active or interrupted upstream sync/i);
    assert.deepEqual(snapshotTree(target), stale);

    const checkedWhileStale = run(checker, ["--source", source, "--target", target, "--strict"]);
    assert.notEqual(checkedWhileStale.status, 0);
    assert.match(checkedWhileStale.stderr, /active or interrupted upstream sync/i);
    assert.deepEqual(snapshotTree(target), stale);

    const recovered = run(synchronizer, ["--source", source, "--target", target, "--apply", "--force"]);
    assert.equal(recovered.status, 0, recovered.stderr);
    assert.equal(
      readFileSync(join(target, "automations", "benny", "README.md"), "utf8"),
      "stale mstack automation\n",
    );
    const checked = run(checker, ["--source", source, "--target", target, "--strict"]);
    assert.equal(checked.status, 0, checked.stderr);
    assertNoTransactionState(target);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects a concurrent apply while a live process owns the sync lock", async () => {
  const { root, source, target } = fixture();
  const ready = join(root, "lock-ready");
  const release = join(root, "lock-release");
  let first;
  try {
    const before = snapshotTree(target, { excludeTransactionState: true });
    first = spawnWithFaults(
      synchronizer,
      ["--source", source, "--target", target, "--apply"],
      root,
      [{
        method: "linkSync",
        phase: "after",
        toEndsWith: "/.mstack-sync-upstream.lock",
        action: "gate",
        ready,
        release,
      }],
    );
    await waitForPath(ready);

    const concurrent = runWithFaults(
      synchronizer,
      ["--source", source, "--target", target, "--apply"],
      root,
      [],
      { timeout: 5000 },
    );
    assert.equal(concurrent.error, undefined, concurrent.error?.message);
    assert.notEqual(concurrent.status, 0);
    assert.match(concurrent.stderr, /(?:another|active|live).*sync|sync.*(?:lock|active)/i);
    assert.deepEqual(snapshotTree(target, { excludeTransactionState: true }), before);

    write(release, "release\n");
    const completed = await first.completed;
    assert.equal(completed.status, 0, completed.stderr);
    const checked = run(checker, ["--source", source, "--target", target, "--strict"]);
    assert.equal(checked.status, 0, checked.stderr);
    assertNoTransactionState(target);
  } finally {
    if (!existsSync(release)) write(release, "release\n");
    if (first?.child.exitCode === null && first?.child.signalCode === null) {
      const result = await Promise.race([
        first.completed,
        new Promise((resolveWait) => setTimeout(() => resolveWait(undefined), 5000)),
      ]);
      if (!result) {
        first.child.kill();
        await first.completed.catch(() => undefined);
      }
    }
    rmSync(root, { recursive: true, force: true });
  }
});

test("takes over dead sync locks and stale takeover guards", () => {
  const { root, source, target } = fixture();
  try {
    write(join(target, ".mstack-sync-upstream.lock"), `${JSON.stringify({
      version: 1,
      pid: 2147483647,
      token: "dead-owner",
    })}\n`);
    write(join(target, ".mstack-sync-upstream.lock.takeover"), `${JSON.stringify({
      version: 1,
      pid: 2147483646,
      token: "dead-takeover-owner",
    })}\n`);
    const result = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
    assert.equal(result.status, 0, result.stderr);
    assertNoTransactionState(target);
    const checked = run(checker, ["--source", source, "--target", target, "--strict"]);
    assert.equal(checked.status, 0, checked.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("takes over a lock whose PID was reused by a different process instance", () => {
  const { root, source, target } = fixture();
  try {
    write(join(target, ".mstack-sync-upstream.lock"), `${JSON.stringify({
      version: 2,
      pid: process.pid,
      token: "reused-pid-owner",
      host: hostname(),
      platform: process.platform,
      start: "different-process-start",
    })}\n`);
    const result = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
    assert.equal(result.status, 0, result.stderr);
    assertNoTransactionState(target);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

for (const [kind, description] of [["malformed", "malformed"], ["escaping", "path-escaping"]]) {
  test(`refuses a ${description} interrupted transaction journal without mutating files`, () => {
    const { root, source, target } = fixture();
    try {
      applyBaseline(source, target);
      const transactionId = `invalid-${kind}`;
      const transaction = transactionDirectory(target, transactionId);
      mkdirSync(transaction, { recursive: true });
      write(join(transaction, "COMMITTING"), "\n");
      const outside = join(root, "outside.txt");
      write(outside, "outside remains unchanged\n");

      if (kind === "malformed") {
        write(join(transaction, "journal.json"), "{not json\n");
      } else {
        const staged = join(target, ".mstack-sync-upstream-tx", transactionId, "0.new");
        const backup = join(target, ".mstack-sync-upstream-tx", transactionId, "0.old");
        write(staged, "outside replacement\n");
        write(backup, "outside backup\n");
        write(join(transaction, "journal.json"), `${JSON.stringify({
          version: 1,
          id: transactionId,
          owner: { pid: 2147483647, token: "interrupted-test-owner" },
          targetRoot: target,
          createdDirectories: [],
          operations: [{
            kind: "write",
            target: "../outside.txt",
            stage: staged,
            backup,
            before: {
              kind: "file",
              sha256: sha256("outside backup\n"),
              mode: 0o600,
            },
            after: {
              kind: "file",
              sha256: sha256("outside replacement\n"),
              mode: 0o600,
            },
          }],
        }, null, 2)}\n`);
      }

      const before = snapshotTree(target);
      const result = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
      assert.notEqual(result.status, 0, `${kind} journal was accepted`);
      assert.match(result.stderr, /journal|transaction|path|checkout|invalid/i);
      assert.deepEqual(snapshotTree(target), before);
      assert.equal(readFileSync(outside, "utf8"), "outside remains unchanged\n");
      assert.equal(existsSync(join(target, ".mstack-sync-upstream.lock")), false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
}

test("rejects a journal operation that targets reserved transaction state", () => {
  const { root, source, target } = fixture();
  try {
    applyBaseline(source, target);
    const transactionId = "invalid-reserved";
    const transaction = transactionDirectory(target, transactionId);
    mkdirSync(transaction, { recursive: true });
    write(join(transaction, "COMMITTING"), "\n");
    write(join(transaction, "journal.json"), `${JSON.stringify({
      version: 1,
      id: transactionId,
      owner: { pid: 2147483647, token: "reserved-test-owner" },
      targetRoot: realpathSync(target),
      createdDirectories: [],
      operations: [{
        kind: "write",
        target: ".mstack-sync-upstream.lock",
        stage: ".mstack-sync-upstream-tx/invalid-reserved/0.new",
        backup: ".mstack-sync-upstream-tx/invalid-reserved/0.old",
        before: { kind: "absent" },
        after: { kind: "file", sha256: sha256("reserved replacement\n"), mode: 0o600 },
      }],
    }, null, 2)}\n`);

    const before = snapshotTree(target);
    const result = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /reserved transaction path/i);
    assert.deepEqual(snapshotTree(target), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("rejects a transaction journal copied from a different checkout", () => {
  const { root, source, target } = fixture();
  try {
    applyBaseline(source, target);
    const transactionId = "invalid-other-target";
    const transaction = transactionDirectory(target, transactionId);
    mkdirSync(transaction, { recursive: true });
    write(join(transaction, "COMMITTING"), "\n");
    write(join(transaction, "journal.json"), `${JSON.stringify({
      version: 1,
      id: transactionId,
      owner: { pid: 2147483647, token: "other-target-owner" },
      targetRoot: join(root, "other-checkout"),
      createdDirectories: [],
      operations: [{
        kind: "manifest",
        target: "profiles/upstream-manifest.json",
        stage: `.mstack-sync-upstream-tx/${transactionId}/0.new`,
        backup: `.mstack-sync-upstream-tx/${transactionId}/0.old`,
        before: { kind: "absent" },
        after: { kind: "file", sha256: sha256("other checkout\n"), mode: 0o600 },
      }],
    }, null, 2)}\n`);

    const before = snapshotTree(target);
    const result = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /target root|different checkout/i);
    assert.deepEqual(snapshotTree(target), before);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
