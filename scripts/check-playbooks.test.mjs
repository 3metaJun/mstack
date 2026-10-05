import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";
import { checkPlaybooks } from "../tools/meta-mode/check-playbooks.mjs";

const script = resolve("tools/meta-mode/check-playbooks.mjs");

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

test("runs through a symlink and rejects unknown options", (t) => {
  const { root, bundledRoot } = fixture(t, {
    "ship.md": "---\nextends: shipping-v2\nwhen: Use it to ship.\n---\n",
  });
  const entry = join(root, "check-playbooks.mjs");
  symlinkSync(script, entry);
  const symlinkResult = spawnSync(process.execPath, [entry, root, "--bundled", bundledRoot], { encoding: "utf8" });
  assert.equal(symlinkResult.status, 1);
  assert.match(symlinkResult.stderr, /shipping-v2.*no playbook/);

  const unknown = run(root, bundledRoot, "--unknown");
  assert.equal(unknown.status, 1);
  assert.match(unknown.stderr, /Unknown option: --unknown/);
});

test("leaves a repository without project playbooks valid", (t) => {
  const root = mkdtempSync(join(tmpdir(), "mstack-check-playbooks-empty-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  assert.deepEqual(checkPlaybooks(root, join(root, "missing-bundled")), []);
  execFileSync(process.execPath, [script, "--root", root], { encoding: "utf8" });
});
