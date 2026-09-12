#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { checkProject, safeProjectPath } from "./harness-policy-lib.mjs";

try {
  if (process.argv.length !== 2) throw new Error("Run node .harness/check.mjs from the repository root");
  const root = resolve(process.cwd());
  const policy = JSON.parse(readFileSync(safeProjectPath(root, ".harness/policy.json"), "utf8"));
  const errors = checkProject(root, policy);
  if (errors.length) throw new Error(errors.join("\n"));
  console.log("Shared verification structure passed; run the project's behavior checks separately.");
} catch (error) {
  console.error("harness-check: " + error.message);
  process.exitCode = 1;
}
