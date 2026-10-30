import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "bun:test";

const checker = join(import.meta.dir, "check-plan.mjs");
const playbook = readFileSync(join(import.meta.dir, "../../skills/meta-mode/playbooks/multi-phase-plan.md"), "utf8").replaceAll("\r\n", "\n");
const skeleton = playbook.match(/^````markdown\n([\s\S]*?)^````$/m)?.[1];
if (!skeleton) throw new Error("multi-phase playbook has no plan skeleton");

test("the bundled mstack plan skeleton passes the checker", () => {
  const directory = mkdtempSync(join(tmpdir(), "check-plan-test-"));
  const file = join(directory, "plan.md");
  try {
    writeFileSync(file, skeleton);
    const result = spawnSync(process.execPath, [checker, file], { encoding: "utf8" });
    if (result.status !== 0) throw new Error(`${result.stdout}${result.stderr}`);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
