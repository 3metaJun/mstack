import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const cli = join(repo, "scripts/check-harness-policy.mjs");
const version = JSON.parse(readFileSync(join(repo, "package.json"), "utf8")).version;
const pstack = "7366ac128bdf95f45e6734f412b49a4031800169";

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true }).trim();
}

function fixture(t) {
  const scratch = existsSync("G:/agents_temp") ? "G:/agents_temp" : tmpdir();
  const temporary = mkdtempSync(join(scratch, "mstack-project-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const root = join(temporary, "repo");
  mkdirSync(root);
  git(root, "init", "-b", "main");
  git(root, "config", "user.name", "Fixture");
  git(root, "config", "user.email", "fixture@example.invalid");
  git(root, "config", "core.autocrlf", "false");
  writeFileSync(join(root, "README.md"), "Fixture app\n");
  writeFileSync(join(root, "AGENTS.md"), "Keep existing project instructions.\n");
  git(root, "add", ".");
  git(root, "commit", "-m", "Initial application");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  return { root, temporary };
}

function run(root, args, expected = 0) {
  const result = spawnSync(process.execPath, [cli, ...args, "--root", root], { encoding: "utf8", windowsHide: true });
  assert.equal(result.status, expected, result.stdout + result.stderr);
  return result;
}

function init(root, checks = ["node verify.mjs"]) {
  return run(root, ["init", "--app", "web", "--pstack", pstack, ...checks.flatMap((command) => ["--check", command])]);
}

function contracts(root) {
  const app = join(root, ".harness/verify/web");
  mkdirSync(join(app, "features"), { recursive: true });
  writeFileSync(join(app, "contract.md"), "# Web verification\n\n" +
    "## Launch\nRun node verify.mjs in this worktree.\n\n" +
    "## Doctor\nCheck this process exits successfully.\n\n" +
    "## Drive\nCreate a note through the repository CLI.\n\n" +
    "## Evidence\nRecord the action and read the saved note from disk.\n\n" +
    "## Cleanup\nDelete only the fixture's temporary note directory.\n\n" +
    "## Isolation\nEach process uses its own temporary directory.\n");
  writeFileSync(join(app, "features/README.md"), "# Features\n\n[Create a note](create-note.md)\n");
  writeFileSync(join(app, "features/create-note.md"), "# Create a note\n\nA user saves a note and reads it back.\n\n" +
    "## Sub-features\nCreate and persist a note.\n\n" +
    "## How to get to it (user POV)\nRun the note command from a terminal.\n\n" +
    "## Driving it with Node\nRun node verify.mjs and inspect the saved text.\n\n" +
    "## Gotchas\nUse a fresh temporary directory on each run.\n");
  writeFileSync(join(root, "verify.mjs"),
    "import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';\n" +
    "import {tmpdir} from 'node:os'; import {join} from 'node:path'; import assert from 'node:assert/strict';\n" +
    "const dir=mkdtempSync(join(tmpdir(),'note-')); try { const file=join(dir,'note.txt'); writeFileSync(file,'hello'); " +
    "assert.equal(readFileSync(file,'utf8'),'hello'); console.log('note saved and read back'); } finally {rmSync(dir,{recursive:true});}\n");
}

function ready(t, checks) {
  const fixtureState = fixture(t);
  init(fixtureState.root, checks);
  contracts(fixtureState.root);
  run(fixtureState.root, ["wrappers"]);
  run(fixtureState.root, ["check"]);
  git(fixtureState.root, "add", ".");
  git(fixtureState.root, "commit", "-m", "Adopt shared contract");
  git(fixtureState.root, "update-ref", "refs/remotes/origin/main", "HEAD");
  const worktree = join(fixtureState.temporary, "worktree");
  git(fixtureState.root, "worktree", "add", "-b", "task/verify", worktree);
  return { ...fixtureState, worktree };
}

function declaration(workflow = "mstack", baseRef = "origin/main") {
  return ["--harness", workflow === "pstack" ? "cursor" : "codex", "--workflow", workflow,
    "--revision", workflow === "pstack" ? pstack : version, "--base-ref", baseRef];
}

function record(root, expected = 0) {
  const evidencePath = ".harness/runs/action.txt";
  mkdirSync(join(root, ".harness/runs"), { recursive: true });
  writeFileSync(join(root, evidencePath), "Observed note creation and disk readback.\n");
  return JSON.parse(run(root, ["record", ...declaration(), "--feature", "web/create-note", "--evidence", evidencePath], expected).stdout);
}

test("init preserves user instructions, repeats safely, and leaves unfinished contracts failing", (t) => {
  const { root } = fixture(t);
  const first = JSON.parse(init(root).stdout);
  assert.equal(first.status, "needs-contract");
  assert.ok(readFileSync(join(root, "AGENTS.md"), "utf8").startsWith("Keep existing project instructions.\n"));
  assert.ok(existsSync(join(root, ".cursor/rules/shared-verification.mdc")));
  const before = readFileSync(join(root, "AGENTS.md"), "utf8");
  assert.deepEqual(JSON.parse(init(root).stdout).created, []);
  assert.equal(readFileSync(join(root, "AGENTS.md"), "utf8"), before);
  const missing = run(root, ["check"], 1);
  assert.match(missing.stderr, /contract\.md/);
});

test("wrappers converge to shared facts and preserve conflicting legacy instructions", (t) => {
  const { root } = fixture(t);
  init(root);
  contracts(root);
  run(root, ["wrappers"]);
  assert.equal(existsSync(join(root, ".cursor/skills/verify-web")), false);
  assert.ok(existsSync(join(root, ".agents/skills/verify-web/SKILL.md")));
  assert.deepEqual(JSON.parse(run(root, ["wrappers"]).stdout).created, []);
  const wrapper = join(root, ".agents/skills/verify-web/SKILL.md");
  writeFileSync(wrapper, "Existing user verification; do not replace.\n");
  run(root, ["wrappers"], 1);
  assert.equal(readFileSync(wrapper, "utf8"), "Existing user verification; do not replace.\n");
  run(root, ["check"], 1);
});

test("Cursor can adopt mstack without declaring native pstack", (t) => {
  const { root } = fixture(t);
  run(root, ["init", "--harness", "cursor", "--app", "web", "--check", "node verify.mjs"]);
  contracts(root);
  run(root, ["wrappers"]);
  run(root, ["check"]);
  assert.deepEqual(JSON.parse(readFileSync(join(root, ".harness/policy.json"), "utf8")).workflows,
    { mstack: { revision: version } });
  assert.ok(existsSync(join(root, ".cursor/skills/verify-web/SKILL.md")));
});

test("CLI rejects missing, duplicate, and unknown arguments without writes", (t) => {
  const { root } = fixture(t);
  for (const args of [["init", "--app"], ["init", "--app", "web", "--bogus", "value"], ["check", "--root", root]]) {
    run(root, args, 1);
    assert.equal(existsSync(join(root, ".harness")), false);
  }
});

test("preflight accepts either workflow on one branch and rejects stale base, dirty source, and primary checkout", (t) => {
  const { root, worktree } = ready(t);
  run(worktree, ["preflight", ...declaration()]);
  run(worktree, ["preflight", ...declaration("pstack")]);
  run(root, ["preflight", ...declaration()], 1);
  writeFileSync(join(worktree, "README.md"), "uncommitted work");
  assert.match(run(worktree, ["preflight", ...declaration()], 1).stderr, /dirty/);
  git(worktree, "restore", "README.md");
  writeFileSync(join(root, "README.md"), "target changed");
  git(root, "add", ".");
  git(root, "commit", "-m", "Advance target");
  git(root, "update-ref", "refs/remotes/origin/main", "HEAD");
  assert.match(run(worktree, ["preflight", ...declaration()], 1).stderr, /target branch/);
});

test("record runs actual commands, binds evidence and SHAs, and rejects stale or altered receipts", (t) => {
  const { worktree } = ready(t);
  const evidencePath = ".harness/runs/action.txt";
  mkdirSync(join(worktree, ".harness/runs"));
  writeFileSync(join(worktree, evidencePath), "Observed note creation and disk readback.\n");
  const result = JSON.parse(run(worktree, ["record", ...declaration(), "--feature", "web/create-note", "--evidence", evidencePath]).stdout);
  assert.equal(result.status, "PASS");
  assert.equal(result.runtimeReview, "required");
  const receipt = JSON.parse(readFileSync(join(worktree, result.receipt), "utf8"));
  assert.equal(receipt.commands[0].command, "node verify.mjs");
  assert.equal(receipt.commands[0].exitCode, 0);
  assert.match(readFileSync(join(worktree, receipt.commands[0].log), "utf8"), /note saved and read back/);
  run(worktree, ["check", "--receipt", result.receipt]);
  const policyFile = join(worktree, ".harness/policy.json");
  const policyText = readFileSync(policyFile, "utf8");
  git(worktree, "config", "core.autocrlf", "true");
  rmSync(policyFile);
  // Update the index stat cache with the checkout so newline conversion leaves a clean worktree.
  git(worktree, "checkout-index", "--force", "--index", "--", ".harness/policy.json");
  assert.equal(readFileSync(policyFile, "utf8"), policyText.replaceAll("\r\n", "\n").replaceAll("\n", "\r\n"));
  assert.equal(git(worktree, "diff", "--cached", "--", ".harness/policy.json"), "");
  assert.equal(git(worktree, "status", "--porcelain=v1", "--untracked-files=all"), "");
  run(worktree, ["check", "--receipt", result.receipt]);
  writeFileSync(join(worktree, evidencePath), "different claim");
  assert.match(run(worktree, ["check", "--receipt", result.receipt], 1).stderr, /Evidence changed/);
  git(worktree, "commit", "--allow-empty", "-m", "New revision");
  assert.match(run(worktree, ["check", "--receipt", result.receipt], 1).stderr, /stale/);
});

test("failed commands produce a failing receipt and cannot satisfy handoff", (t) => {
  const { worktree } = ready(t, ["node -e \"process.exit(7)\""]);
  mkdirSync(join(worktree, ".harness/runs"));
  writeFileSync(join(worktree, ".harness/runs/action.txt"), "attempt");
  const result = JSON.parse(run(worktree, ["record", ...declaration(), "--feature", "web/create-note",
    "--evidence", ".harness/runs/action.txt"], 1).stdout);
  assert.equal(result.status, "FAIL");
  const receipt = JSON.parse(readFileSync(join(worktree, result.receipt), "utf8"));
  assert.equal(receipt.commands[0].exitCode, 7);
  run(worktree, ["check", "--receipt", result.receipt], 1);
});

test("local branches cannot substitute for a fetched base in preflight or a receipt", (t) => {
  const { worktree } = ready(t);
  git(worktree, "branch", "pretend/main");
  const rejected = run(worktree, ["preflight", ...declaration("mstack", "pretend/main")], 1);
  assert.match(rejected.stderr, /remote|fetched|target branch/i);
  const result = record(worktree);
  const receiptPath = join(worktree, result.receipt);
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  receipt.baseRef = "pretend/main";
  writeFileSync(receiptPath, JSON.stringify(receipt));
  assert.match(run(worktree, ["check", "--receipt", result.receipt], 1).stderr, /remote|fetched|base|target branch/i);
  run(worktree, ["preflight", ...declaration("mstack", "refs/remotes/origin/main")]);
});

test("receipt validation rejects missing and inconsistent handoff metadata", (t) => {
  const { worktree } = ready(t);
  const result = record(worktree);
  const receiptPath = join(worktree, result.receipt);
  const receipt = JSON.parse(readFileSync(receiptPath, "utf8"));
  for (const [field, pattern] of [["feature", /feature/i], ["branch", /branch/i], ["base", /base/i], ["baseRef", /base|target branch/i], ["recordedAt", /recordedAt/i]]) {
    const missing = { ...receipt };
    delete missing[field];
    writeFileSync(receiptPath, JSON.stringify(missing));
    assert.match(run(worktree, ["check", "--receipt", result.receipt], 1).stderr, pattern, field);
  }
  for (const [field, value, pattern] of [
    ["feature", "web/missing", /feature/i], ["branch", "main", /branch/i],
    ["baseRef", "HEAD", /base|target branch/i], ["recordedAt", "not a date", /recordedAt/i],
  ]) {
    writeFileSync(receiptPath, JSON.stringify({ ...receipt, [field]: value }));
    assert.match(run(worktree, ["check", "--receipt", result.receipt], 1).stderr, pattern, field);
  }
  writeFileSync(receiptPath, JSON.stringify(receipt));
  const checked = JSON.parse(run(worktree, ["check", "--receipt", result.receipt]).stdout);
  assert.equal(checked.runtimeReview, "required");
});

test("init and wrapper retries preserve valid CRLF files without reporting conflicts", (t) => {
  const { root } = fixture(t);
  const created = JSON.parse(init(root).stdout).created;
  const snapshots = new Map();
  for (const path of created) {
    const content = readFileSync(join(root, path), "utf8").replaceAll("\r\n", "\n").replaceAll("\n", "\r\n");
    writeFileSync(join(root, path), content);
    snapshots.set(path, content);
  }
  assert.deepEqual(JSON.parse(init(root).stdout).created, []);
  for (const [path, content] of snapshots) assert.equal(readFileSync(join(root, path), "utf8"), content, path);
  contracts(root);
  const wrappers = JSON.parse(run(root, ["wrappers"]).stdout).created;
  for (const path of wrappers) {
    const content = readFileSync(join(root, path), "utf8").replaceAll("\n", "\r\n");
    writeFileSync(join(root, path), content);
    snapshots.set(path, content);
  }
  assert.deepEqual(JSON.parse(run(root, ["wrappers"]).stdout).created, []);
  for (const [path, content] of snapshots) assert.equal(readFileSync(join(root, path), "utf8"), content, path);
  run(root, ["check"]);
});

test("a successful command that changes captured evidence produces a failing receipt", (t) => {
  const { worktree } = ready(t);
  writeFileSync(join(worktree, "verify.mjs"),
    "import {writeFileSync} from 'node:fs';\n" +
    "writeFileSync('.harness/runs/action.txt', 'New evidence from this command.\\n');\n" +
    "console.log('Evidence was replaced.');\n");
  git(worktree, "add", "verify.mjs");
  git(worktree, "commit", "-m", "Regenerate evidence during verification");
  const result = record(worktree, 1);
  assert.equal(result.status, "FAIL");
  const receipt = JSON.parse(readFileSync(join(worktree, result.receipt), "utf8"));
  assert.equal(receipt.commands[0].exitCode, 0);
  assert.equal(readFileSync(join(worktree, ".harness/runs/action.txt"), "utf8"), "New evidence from this command.\n");
  assert.match(run(worktree, ["check", "--receipt", result.receipt], 1).stderr, /passing commands/);
});

test("the exported checker runs independently and rejects broken project structure", (t) => {
  const { root } = fixture(t);
  init(root);
  contracts(root);
  run(root, ["wrappers"]);
  const exported = () => spawnSync(process.execPath, [".harness/check.mjs"], { cwd: root, encoding: "utf8", windowsHide: true });
  const passing = exported();
  assert.equal(passing.status, 0, passing.stderr);
  assert.match(passing.stdout, /structure passed/);
  writeFileSync(join(root, "AGENTS.md"), "Project rules without the shared workflow pointer.\n");
  const rejected = exported();
  assert.equal(rejected.status, 1, rejected.stdout);
  assert.match(rejected.stderr, /AGENTS.md: must reference .harness\/workflow.md/);
});

test("an existing worktree verification lock is preserved until its owner is inspected and released", (t) => {
  const { worktree } = ready(t);
  const lockDir = join(git(worktree, "rev-parse", "--absolute-git-dir"), "mstack-verification.lock");
  mkdirSync(lockDir);
  const owner = JSON.stringify({ pid: 2147483647, host: "previous-verifier", runPath: ".harness/runs/prior-run" });
  writeFileSync(join(lockDir, "owner.json"), owner);
  mkdirSync(join(worktree, ".harness/runs"));
  writeFileSync(join(worktree, ".harness/runs/action.txt"), "Observed action.\n");
  const rejected = run(worktree, ["record", ...declaration(), "--feature", "web/create-note", "--evidence", ".harness/runs/action.txt"], 1);
  assert.match(rejected.stderr, /Another verification owns this worktree; inspect/);
  assert.equal(readFileSync(join(lockDir, "owner.json"), "utf8"), owner);
  assert.equal(existsSync(lockDir), true);
  rmSync(join(lockDir, "owner.json"));
  rmSync(lockDir, { recursive: true });
  const result = record(worktree);
  assert.equal(result.status, "PASS");
  assert.equal(existsSync(lockDir), false);
});
