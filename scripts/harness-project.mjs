import {
  existsSync, readFileSync, writeFileSync, mkdirSync, realpathSync, lstatSync,
  openSync, closeSync, rmSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { validateHarnessPolicy, checkProject, wrapperText, wrapperPaths, safeProjectPath as projectPath } from "./harness-policy-lib.mjs";

export { projectPath };

const packageRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const version = JSON.parse(readFileSync(join(packageRoot, "package.json"), "utf8")).version;
const allHarnesses = ["cursor", "grokbot", "codex", "claude", "opencode", "pi"];
const jsonText = (value) => JSON.stringify(value, null, 2) + "\n";
const digest = (value) => createHash("sha256").update(value).digest("hex");
const normalized = (value) => value.replaceAll("\r\n", "\n");

export function readPolicy(root) {
  const policy = JSON.parse(readFileSync(projectPath(root, ".harness/policy.json"), "utf8"));
  const errors = validateHarnessPolicy(policy);
  if (errors.length) throw new Error(errors.join("\n"));
  return policy;
}

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], {
    encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"],
  }).trim();
}

function requireRepositoryRoot(root) {
  const top = realpathSync.native(git(root, "rev-parse", "--show-toplevel"));
  if (relative(realpathSync.native(root), top) !== "") throw new Error("--root must be the Git worktree root");
}

function writePlan(root, files) {
  const pending = [];
  for (const [path, content] of files) {
    const absolute = projectPath(root, path);
    if (existsSync(absolute)) {
      if (normalized(readFileSync(absolute, "utf8")) !== normalized(content)) throw new Error("Existing file differs; reconcile it before retrying: " + path);
    } else pending.push([absolute, content, path]);
  }
  for (const [absolute, content] of pending) {
    mkdirSync(dirname(absolute), { recursive: true });
    writeFileSync(absolute, content, { flag: "wx" });
  }
  return pending.map(([, , path]) => path);
}

function pointerFile(root, path, marker, block) {
  const absolute = projectPath(root, path);
  const before = existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
  if (before.includes(marker)) {
    if (!normalized(before).includes(normalized(block))) throw new Error("Existing project pointer differs: " + path);
    return { path, before, after: before };
  }
  return { path, before, after: before + (before.endsWith("\n") || !before ? "" : "\n") + "\n" + block + "\n" };
}

export function initProject(root, options) {
  requireRepositoryRoot(root);
  const harnesses = options.harness ?? allHarnesses;
  const apps = options.app ?? [];
  if (!apps.length || !options.check?.length) throw new Error("init requires --app and at least one --check command");
  const policy = {
    schemaVersion: 1,
    baseBranch: options.base ?? "main",
    allowedHarnesses: harnesses,
    workflows: { ...(options.pstack ? { pstack: { revision: options.pstack } } : {}), mstack: { revision: version } },
    worktrees: { required: true, sharedCheckout: false },
    verification: { canonicalRoot: ".harness/verify", apps, requiredCommands: options.check },
    integration: { mode: "pull-request", protectedBranches: [options.base ?? "main"], requireRebase: true },
  };
  const errors = validateHarnessPolicy(policy);
  if (errors.length) throw new Error(errors.join("\n"));
  const workflow = readFileSync(join(packageRoot, "scripts", "harness-workflow.md"), "utf8");
  const files = [
    [".harness/policy.json", jsonText(policy)],
    [".harness/workflow.md", workflow],
    [".harness/check.mjs", readFileSync(join(packageRoot, "scripts/harness-check.mjs"), "utf8")],
    [".harness/harness-policy-lib.mjs", readFileSync(join(packageRoot, "scripts/harness-policy-lib.mjs"), "utf8")],
  ];
  const marker = "<!-- mstack-project-contract -->";
  const block = marker + "\nBefore development or verification, read [.harness/workflow.md](.harness/workflow.md) and follow the shared project contract.";
  const pointers = [pointerFile(root, "AGENTS.md", marker, block)];
  if (harnesses.includes("claude")) pointers.push(pointerFile(root, "CLAUDE.md", marker, block));
  if (harnesses.includes("cursor") || harnesses.includes("grokbot")) {
    files.push([".cursor/rules/shared-verification.mdc",
      "---\ndescription: Shared project verification and ownership rules\nalwaysApply: true\n---\n\nRead .harness/workflow.md before development or verification. It defines this project's canonical verification target, evidence, and handoff rules for native pstack and mstack.\n"]);
  }
  pointers.push(pointerFile(root, ".gitignore", "# mstack local runs",
    "# mstack local runs\n.harness/runs/\n.harness/scratch/"));
  for (const app of apps) projectPath(root, ".harness/verify/" + app);
  const created = writePlan(root, files);
  for (const { path, before, after } of pointers) {
    if (after === before) continue;
    const absolute = projectPath(root, path);
    const current = existsSync(absolute) ? readFileSync(absolute, "utf8") : "";
    if (current !== before) throw new Error("Instruction file changed during init: " + path);
    writeFileSync(absolute, after, existsSync(absolute) ? {} : { flag: "wx" });
    created.push(path);
  }
  for (const app of apps) mkdirSync(projectPath(root, ".harness/verify/" + app), { recursive: true });
  return { status: "needs-contract", created, apps, next: "Write and prove each contract and feature map, then run wrappers and check." };
}

export function installWrappers(root, options) {
  let policy;
  if (existsSync(projectPath(root, ".harness/policy.json"))) {
    if (options.app || options.harness) throw new Error("wrappers uses the existing policy; change it before overriding apps or harnesses");
    policy = readPolicy(root);
  } else {
    if (!options.app?.length || !options.harness?.length) throw new Error("Without a policy, wrappers requires --app and --harness");
    policy = {
      schemaVersion: 1, baseBranch: "main", allowedHarnesses: options.harness,
      workflows: { mstack: { revision: version } }, worktrees: { required: true, sharedCheckout: false },
      verification: { canonicalRoot: ".harness/verify", apps: options.app, requiredCommands: ["true"] },
      integration: { mode: "pull-request", protectedBranches: ["main"], requireRebase: true },
    };
    const errors = validateHarnessPolicy(policy);
    if (errors.length) throw new Error(errors.join("\n"));
  }
  const files = policy.verification.apps.flatMap((app) => {
    const contract = policy.verification.canonicalRoot + "/" + app + "/contract.md";
    if (!existsSync(projectPath(root, contract))) throw new Error("Write the canonical contract first: " + contract);
    return wrapperPaths(app, policy.allowedHarnesses).map((path) => [path, wrapperText(app, contract)]);
  });
  return { created: writePlan(root, files) };
}

function fetchedBase(root, policy, baseRef) {
  const suffix = "/" + policy.baseBranch;
  if (typeof baseRef !== "string" || !baseRef.endsWith(suffix) || baseRef.startsWith("-")) {
    throw new Error("--base-ref must name the fetched target branch, such as origin/" + policy.baseBranch);
  }
  const fullRef = git(root, "rev-parse", "--symbolic-full-name", baseRef);
  if (!fullRef.startsWith("refs/remotes/") || !fullRef.endsWith(suffix) ||
      fullRef.slice("refs/remotes/".length, -suffix.length).length === 0) {
    throw new Error("--base-ref must resolve to a remote-tracking target branch");
  }
  return git(root, "rev-parse", "--verify", fullRef + "^{commit}");
}

export function preflight(root, policy, options) {
  requireRepositoryRoot(root);
  const errors = checkProject(root, policy);
  if (errors.length) throw new Error(errors.join("\n"));
  if (!policy.allowedHarnesses.includes(options.harness)) throw new Error("Declare an allowed --harness");
  if (!Object.hasOwn(policy.workflows, options.workflow ?? "")) throw new Error("Declare a configured --workflow");
  if (options.revision !== policy.workflows[options.workflow].revision) throw new Error("Declared --revision differs from the pinned workflow revision");
  const branch = git(root, "branch", "--show-current");
  if (!branch || policy.integration.protectedBranches.includes(branch)) throw new Error("Use a dedicated task branch, not a protected or detached HEAD");
  const gitDir = realpathSync.native(git(root, "rev-parse", "--absolute-git-dir"));
  const common = realpathSync.native(resolve(root, git(root, "rev-parse", "--git-common-dir")));
  if (relative(common, gitDir) === "") throw new Error("Use a dedicated linked worktree for development");
  if (git(root, "status", "--porcelain=v1", "--untracked-files=all")) throw new Error("Commit or preserve changes before preflight; the worktree is dirty");
  const baseRef = options["base-ref"];
  const base = fetchedBase(root, policy, baseRef);
  const head = git(root, "rev-parse", "HEAD");
  try { git(root, "merge-base", "--is-ancestor", base, head); }
  catch { throw new Error("Rebase or integrate the current target branch before verification"); }
  return { branch, head, base, baseRef, harness: options.harness, workflow: options.workflow, revision: options.revision };
}

function mappedFeature(policy, featureId) {
  if (typeof featureId !== "string") throw new Error("Declare a mapped app/feature");
  const [app, feature, extra] = featureId.split("/");
  if (extra !== undefined || !policy.verification.apps.includes(app) || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(feature)) {
    throw new Error("Feature must identify a mapped app/feature");
  }
  return policy.verification.canonicalRoot + "/" + app + "/features/" + feature + ".md";
}

function artifact(root, path) {
  const absolute = projectPath(root, path);
  if (!lstatSync(absolute).isFile()) throw new Error("Evidence must be a regular file: " + path);
  const content = readFileSync(absolute);
  if (!content.length) throw new Error("Evidence is empty: " + path);
  return { path, sha256: digest(content) };
}

function shellCommand(command) {
  if (process.platform !== "win32") return { command: "/bin/sh", args: ["-c", command] };
  const script = "$ErrorActionPreference = 'Stop'\n" + command +
    "\nif (-not $?) { if ($LASTEXITCODE) { exit $LASTEXITCODE }; exit 1 }\n";
  return {
    command: "powershell.exe",
    args: ["-NoLogo", "-NoProfile", "-NonInteractive", "-ExecutionPolicy", "Bypass",
      "-EncodedCommand", Buffer.from(script, "utf16le").toString("base64")],
  };
}

export function recordVerification(root, policy, options) {
  const snapshot = preflight(root, policy, options);
  if (!options.feature || !options.evidence?.length) throw new Error("record requires --feature app/feature and --evidence");
  const mappedPath = mappedFeature(policy, options.feature);
  if (!existsSync(projectPath(root, mappedPath))) throw new Error("Unknown mapped feature: " + mappedPath);
  const evidence = options.evidence.map((path) => artifact(root, path));
  const runPath = ".harness/runs/" + randomUUID();
  const runDir = projectPath(root, runPath);
  mkdirSync(runDir, { recursive: true });
  const lockDir = join(git(root, "rev-parse", "--absolute-git-dir"), "mstack-verification.lock");
  try { mkdirSync(lockDir); }
  catch { throw new Error("Another verification owns this worktree; inspect " + lockDir); }
  const commands = [];
  try {
    writeFileSync(join(lockDir, "owner.json"), jsonText({ pid: process.pid, host: hostname(), runPath }));
    for (const [index, command] of policy.verification.requiredCommands.entries()) {
      const logPath = runPath + "/" + (index + 1) + ".log";
      const log = openSync(projectPath(root, logPath), "wx");
      let result;
      try {
        const invocation = shellCommand(command);
        result = spawnSync(invocation.command, invocation.args, {
          cwd: root, stdio: ["ignore", log, log], windowsHide: true,
        });
      } finally { closeSync(log); }
      commands.push({ command, exitCode: result.status, signal: result.signal,
        error: result.error?.message ?? null, log: logPath, sha256: digest(readFileSync(projectPath(root, logPath))) });
      if (result.status !== 0 || result.error || result.signal) break;
    }
    const unchanged = git(root, "branch", "--show-current") === snapshot.branch &&
      git(root, "rev-parse", "HEAD") === snapshot.head &&
      git(root, "rev-parse", "--verify", snapshot.baseRef + "^{commit}") === snapshot.base &&
      git(root, "status", "--porcelain=v1", "--untracked-files=all") === "";
    const evidenceUnchanged = evidence.every((item) => {
      try { return artifact(root, item.path).sha256 === item.sha256; } catch { return false; }
    });
    const receipt = {
      schemaVersion: 1, ...snapshot, recordedAt: new Date().toISOString(),
      policyDigest: digest(normalized(readFileSync(projectPath(root, ".harness/policy.json"), "utf8"))),
      feature: options.feature, evidence, commands, runtimeReview: "required",
      status: unchanged && evidenceUnchanged && commands.length === policy.verification.requiredCommands.length &&
        commands.every((item) => item.exitCode === 0 && !item.error && !item.signal) ? "PASS" : "FAIL",
    };
    const receiptPath = runPath + "/receipt.json";
    writeFileSync(projectPath(root, receiptPath), jsonText(receipt), { flag: "wx" });
    return { status: receipt.status, receipt: receiptPath, runtimeReview: receipt.runtimeReview };
  } finally {
    rmSync(join(lockDir, "owner.json"), { force: true });
    rmSync(lockDir, { recursive: true });
  }
}

export function checkReceipt(root, policy, path) {
  const receipt = JSON.parse(readFileSync(projectPath(root, path), "utf8"));
  if (!receipt || receipt.schemaVersion !== 1 || receipt.status !== "PASS" || receipt.runtimeReview !== "required") {
    throw new Error("Receipt must record passing commands and require runtime review");
  }
  if (typeof receipt.recordedAt !== "string" || !Number.isFinite(Date.parse(receipt.recordedAt))) throw new Error("Receipt recordedAt is invalid");
  if (!existsSync(projectPath(root, mappedFeature(policy, receipt.feature)))) throw new Error("Receipt feature is not mapped");
  if (receipt.branch !== git(root, "branch", "--show-current") || !receipt.branch ||
      policy.integration.protectedBranches.includes(receipt.branch)) throw new Error("Receipt branch differs from the current task branch");
  if (receipt.head !== git(root, "rev-parse", "HEAD")) throw new Error("Receipt is stale for this HEAD");
  if (receipt.policyDigest !== digest(normalized(readFileSync(projectPath(root, ".harness/policy.json"), "utf8")))) throw new Error("Receipt policy changed");
  if (receipt.base !== fetchedBase(root, policy, receipt.baseRef)) throw new Error("Receipt base changed");
  try { git(root, "merge-base", "--is-ancestor", receipt.base, receipt.head); }
  catch { throw new Error("Receipt head does not include the target base"); }
  if (git(root, "status", "--porcelain=v1", "--untracked-files=all")) throw new Error("Receipt cannot describe a dirty worktree");
  if (!policy.allowedHarnesses.includes(receipt.harness) ||
      !Object.hasOwn(policy.workflows, receipt.workflow ?? "") ||
      receipt.revision !== policy.workflows[receipt.workflow].revision) throw new Error("Receipt workflow declaration differs from policy");
  if (!Array.isArray(receipt.commands) || receipt.commands.length !== policy.verification.requiredCommands.length) {
    throw new Error("Receipt does not cover all required commands");
  }
  for (const [index, command] of receipt.commands.entries()) {
    if (command?.command !== policy.verification.requiredCommands[index] || command.exitCode !== 0 || command.signal || command.error) {
      throw new Error("Receipt command failed or differs from policy");
    }
    if (digest(readFileSync(projectPath(root, command.log))) !== command.sha256) throw new Error("Command log changed: " + command.log);
  }
  if (!Array.isArray(receipt.evidence) || !receipt.evidence.length) throw new Error("Receipt evidence is missing");
  for (const item of receipt.evidence) {
    if (!item || typeof item !== "object") throw new Error("Invalid evidence record");
    if (artifact(root, item.path).sha256 !== item.sha256) throw new Error("Evidence changed: " + item.path);
  }
  return { status: "PASS", runtimeReview: "required", receipt: path };
}
