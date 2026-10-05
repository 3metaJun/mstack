import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { checkPlaybooks, checkPlaybooksDetailed } from "../tools/meta-mode/check-playbooks.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const script = join(repoRoot, "tools", "meta-mode", "check-playbooks.mjs");

function fixture(t, playbooks, bundled = { "bug-fix.md": "Binary-search the cause.\n" }) {
  const root = mkdtempSync(join(tmpdir(), "mstack-check-playbooks-"));
  const bundledRoot = join(root, "bundled");
  mkdirSync(join(root, ".agents", "playbooks"), { recursive: true });
  mkdirSync(bundledRoot, { recursive: true });
  for (const [name, content] of Object.entries(playbooks)) writeFileSync(join(root, ".agents", "playbooks", name), content);
  for (const [name, content] of Object.entries(bundled)) writeFileSync(join(bundledRoot, name), content);
  t.after(() => rmSync(root, { recursive: true, force: true }));
  return { root, bundledRoot };
}

function run(root, bundledRoot, ...args) {
  return spawnSync(process.execPath, [script, "--root", root, "--bundled", bundledRoot, ...args], { encoding: "utf8" });
}

test("accepts an anchored project playbook and normalizes CRLF", (t) => {
  const { root, bundledRoot } = fixture(t, {
    "bug-fix.md": "---\r\nextends: bug-fix\r\nwhen: Use it for bug reports.\r\n---\r\n- **In** \"Binary-search the cause\": compare with main.\r\n",
  });
  assert.deepEqual(checkPlaybooks(root, bundledRoot), []);
  const result = run(root, bundledRoot);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.stdout, "Every project playbook matches this mstack's playbooks.\n");
});

test("reports missing bases, stale anchors, missing when fields, and unquoted changes", (t) => {
  const { root, bundledRoot } = fixture(t, {
    "bug-fix.md": "---\nextends: bug-fix\nwhen: Use it for bugs.\n---\n- **After** \"Ask the user to reproduce it\": compare with main.\n",
    "ship.md": "---\nextends: shipping-v2\nwhen: Use it to ship.\n---\n",
    "broken.md": "---\nextends: bug-fix\n---\n- **Before** Binary-search the cause: compare with main.\n",
  });
  const result = run(root, bundledRoot);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /Ask the user to reproduce it.*not in any playbook/);
  assert.match(result.stderr, /shipping-v2.*no playbook/);
  assert.match(result.stderr, /broken\.md: its frontmatter needs a \"when:\" line/);
  assert.match(result.stderr, /broken\.md: a change has no straight-quoted step text/);
});

test("runs through a symlink", (t) => {
  const { root, bundledRoot } = fixture(t, {
    "ship.md": "---\nextends: shipping-v2\nwhen: Use it to ship.\n---\n",
  });
  const entry = join(root, "check-playbooks.mjs");
  try {
    symlinkSync(script, entry);
  } catch (error) {
    if (error.code === "EPERM") return t.skip("creating symlinks needs privileges on this system");
    throw error;
  }
  const result = spawnSync(process.execPath, [entry, root, "--bundled", bundledRoot], { encoding: "utf8" });
  assert.equal(result.status, 1);
  assert.match(result.stderr, /shipping-v2.*no playbook/);
});

test("rejects unknown options and a missing project root", (t) => {
  const { root, bundledRoot } = fixture(t, {});
  const unknown = run(root, bundledRoot, "--unknown");
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown option: --unknown/);

  const missing = run(join(root, "typo"), bundledRoot);
  assert.equal(missing.status, 1);
  assert.match(missing.stderr, /Project root is not a directory/);
});

test("parses BOM and unterminated frontmatter and keeps bases inside the bundled directory", (t) => {
  const { root, bundledRoot } = fixture(t, {
    "bom.md": "﻿---\nwhen: Use it.\n---\nbody\n",
    "bare.md": "---\nwhen: Use it.\n---",
    "case.md": "---\nextends: Bug-Fix\nwhen: Use it.\n---\n",
    "escape.md": "---\nextends: ../.agents/playbooks/bom\nwhen: Use it.\n---\n",
  });
  assert.deepEqual(checkPlaybooks(root, bundledRoot), [
    ".agents/playbooks/case.md: extends `Bug-Fix`, which this mstack has no playbook for",
    ".agents/playbooks/escape.md: extends `../.agents/playbooks/bom`, which this mstack has no playbook for",
  ]);
});

test("validates against the playbooks bundled with this checkout by default", (t) => {
  const root = mkdtempSync(join(tmpdir(), "mstack-check-playbooks-bundled-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(join(root, ".agents", "playbooks"), { recursive: true });
  writeFileSync(
    join(root, ".agents", "playbooks", "bug-fix.md"),
    '---\nextends: bug-fix\nwhen: Use it for bugs.\n---\n- **After** "Binary-search the cause." run the profiler.\n',
  );
  const result = spawnSync(process.execPath, [script, root], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
});

test("leaves a repository without project playbooks valid", (t) => {
  const root = mkdtempSync(join(tmpdir(), "mstack-check-playbooks-empty-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(checkPlaybooks(root, join(root, "missing-bundled")), []);
  execFileSync(process.execPath, [script, "--root", root], { encoding: "utf8" });
});

test("classifies duplicate extends and anchors as warnings, with strict mode failing", (t) => {
  const { root, bundledRoot } = fixture(t, {
    "bug-fix.md": "---\nextends: bug-fix, bug-fix\nwhen: Use it for bugs.\n---\n- **In** \"Binary-search the cause.\": first.\n- **In** \"Binary-search the cause.\": second.\n",
  }, { "bug-fix.md": "Binary-search the cause.\n" });
  const detailed = checkPlaybooksDetailed(root, bundledRoot);
  assert.deepEqual(detailed.errors, []);
  assert.equal(detailed.warnings.length, 2);
  assert.equal(checkPlaybooks(root, bundledRoot).length, 2);
  const normal = run(root, bundledRoot);
  assert.equal(normal.status, 0);
  assert.match(normal.stderr, /warning:.*extends/);
  const strict = run(root, bundledRoot, "--strict");
  assert.equal(strict.status, 1);
  const json = run(root, bundledRoot, "--json");
  assert.equal(json.status, 0);
  const output = JSON.parse(json.stdout);
  assert.equal(output.ok, true);
  assert.equal(output.errors.length, 0);
  assert.equal(output.warnings.length, 2);
});

test("rejects an anchor found in more than one base playbook", (t) => {
  const { root, bundledRoot } = fixture(t, {
    "combined.md": "---\nextends: first, second\nwhen: Use it.\n---\n- **After** \"Shared step\": adjust.\n",
  }, { "first.md": "Shared step\n", "second.md": "Shared step\n" });
  const result = run(root, bundledRoot, "--json");
  assert.equal(result.status, 1);
  const output = JSON.parse(result.stdout);
  assert.equal(output.errors[0].code, "ambiguous-anchor");
  assert.match(output.errors[0].message, /ambiguous/);
});
