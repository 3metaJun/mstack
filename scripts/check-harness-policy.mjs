#!/usr/bin/env node
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import { initProject, installWrappers, readPolicy, preflight, recordVerification, checkReceipt } from "./harness-project.mjs";
import { checkProject } from "./harness-policy-lib.mjs";

const commands = {
  check: ["root", "receipt"],
  init: ["root", "app", "check", "pstack", "harness", "base"],
  wrappers: ["root", "app", "harness"],
  preflight: ["root", "harness", "workflow", "revision", "base-ref"],
  record: ["root", "harness", "workflow", "revision", "base-ref", "feature", "evidence"],
};

function argumentsFor(argv) {
  const args = [...argv];
  const command = args[0] && !args[0].startsWith("--") ? args.shift() : "check";
  if (!Object.hasOwn(commands, command)) throw new Error("Unknown command: " + command);
  const repeated = command === "init" || command === "wrappers" ? ["app", "check", "harness"] : ["evidence"];
  const options = {};
  while (args.length) {
    const flag = args.shift();
    const key = flag?.slice(2);
    if (!flag?.startsWith("--") || !commands[command].includes(key)) throw new Error("Unknown option: " + flag);
    const value = args.shift();
    if (!value?.trim() || value.startsWith("--")) throw new Error(flag + " requires a value");
    if (repeated.includes(key)) (options[key] ??= []).push(value);
    else {
      if (Object.hasOwn(options, key)) throw new Error("Duplicate option: " + flag);
      options[key] = value;
    }
  }
  return { command, options };
}

export function main(argv) {
  if (argv.length === 1 && argv[0] === "--help") {
    console.log("Usage: mstack-policy [check|init|wrappers|preflight|record] --root <repository>\n" +
      "init: --app <slug> --check <command> [--pstack <exact revision>] [--base main] [--harness <name>]\n" +
      "wrappers: uses policy, or --app <slug> --harness <name> without one\n" +
      "preflight: --harness <name> --workflow <pstack|mstack> --revision <pin> --base-ref <origin/main>\n" +
      "record: preflight flags, --feature <app/feature> --evidence <relative file>\n" +
      "check: optional --receipt <relative receipt.json>\n" +
      "Repeat --app, --check, --harness during init; repeat --evidence during record.\n" +
      "check validates files. preflight observes Git state. record runs repository commands.");
    return 0;
  }
  const { command, options } = argumentsFor(argv);
  const root = resolve(options.root ?? process.cwd());
  let result;
  if (command === "init") result = initProject(root, options);
  else if (command === "wrappers") result = installWrappers(root, options);
  else {
    const policy = readPolicy(root);
    if (command === "preflight") result = preflight(root, policy, options);
    else if (command === "record") result = recordVerification(root, policy, options);
    else {
      const errors = checkProject(root, policy);
      if (errors.length) throw new Error(errors.join("\n"));
      result = options.receipt ? checkReceipt(root, policy, options.receipt) : { status: "PASS", scope: "project contract structure" };
    }
  }
  console.log(JSON.stringify(result));
  return result.status === "FAIL" ? 1 : 0;
}

if (process.argv[1] && existsSync(process.argv[1]) && realpathSync.native(process.argv[1]) === realpathSync.native(new URL(import.meta.url))) {
  try { process.exitCode = main(process.argv.slice(2)); }
  catch (error) { console.error("mstack-policy: " + error.message); process.exitCode = 1; }
}
