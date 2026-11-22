// Ensures every scripts/*.test.mjs file on disk is wired into package.json's `test` script
// so new tests are never silently skipped in CI.
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const pkg = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const testScript = pkg.scripts?.test ?? "";

test("every scripts/*.test.mjs file is listed in package.json scripts.test", () => {
  const onDisk = readdirSync(join(repoRoot, "scripts"))
    .filter((name) => name.endsWith(".test.mjs"))
    .sort();
  const missing = onDisk.filter((name) => !testScript.includes(`scripts/${name}`));
  assert.deepEqual(missing, [], `unregistered test file(s): ${missing.join(", ")}`);
});
