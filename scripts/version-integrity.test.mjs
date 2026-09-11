import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

test("package and Codex plugin versions stay synchronized", () => {
  const packageManifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
  const pluginManifest = JSON.parse(readFileSync(join(repoRoot, ".codex-plugin", "plugin.json"), "utf8"));
  assert.equal(pluginManifest.version, packageManifest.version);
});
