import assert from "node:assert/strict";
import test from "node:test";
import { buildWindowsInvocation, processInvocation } from "./runtime-lib.mjs";

test("Windows invocation preserves shell metacharacters as arguments", () => {
  const invocation = buildWindowsInvocation("codex", ["exec", "say 'hello' & print %PATH%"]);
  assert.equal(invocation.command, "powershell.exe");
  const script = Buffer.from(invocation.args.at(-1), "base64").toString("utf16le");
  assert.match(script, /\$mstackArgs = @\('exec', 'say ''hello'' & print %PATH%'\)/);
  assert.match(script, /& 'codex' @mstackArgs/);
});

test("non-Windows invocation stays a direct argument-array spawn", () => {
  assert.deepEqual(processInvocation("pi", ["-p", "inspect & report"], "linux"), {
    command: "pi",
    args: ["-p", "inspect & report"],
  });
});
