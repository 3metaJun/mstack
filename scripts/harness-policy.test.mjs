import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import test from "node:test";
import { checkProject, safeProjectPath, validateHarnessPolicy, wrapperPaths, wrapperText } from "./harness-policy-lib.mjs";

const WEB_WRAPPER = `---
name: verify-web
description: Verify web through the shared repository contract.
metadata:
  verification-contract: .harness/verify/web/contract.md
---

# Verify web

Read \`.harness/workflow.md\` from the repository root when present before the contract.
Resolve \`.harness/verify/web/contract.md\` from the repository root, read it and its feature map,
and follow the shared contract. Choose the available capability that can drive
the documented user path. Report an unavailable capability as a blocked step;
never replace required application evidence with a weaker check.

Keep project facts in the canonical contract and feature map. This wrapper
contains no separate launch, driving, or evidence instructions.
`;

const CONTRACT = `# Web verification

## Launch

Run \`node app.mjs --port 4182 --data ./scratch/run-12\` and record the child PID.

## Doctor

GET /health must identify the current commit and run-12 data directory.

## Drive

Use the feature map to create a note through the browser.

## Evidence

Capture the action and resulting page, then read the note through GET /notes.

## Cleanup

Stop the recorded child PID and remove this run's data after retaining evidence.

## Isolation

Allocate a distinct port and data directory per run. Never reuse another run's server.
`;

const FEATURE = `# Create a note

Save a note and reopen the saved result.

## Sub-features

Create and reopen a saved note.

## How to get to it (user POV)

Open /notes and choose New note.

## Driving it with Playwright

Fill Title with Release checklist, choose Save, and reopen the note. Confirm GET /notes contains Release checklist.

## Gotchas

The save notification appears before persistence completes. Wait for the note in the list.
`;

function policy() {
  return {
    schemaVersion: 1,
    baseBranch: "main",
    allowedHarnesses: ["cursor", "grokbot", "codex", "claude", "opencode", "pi"],
    workflows: { pstack: { revision: "a".repeat(40) }, mstack: { revision: "0.3.0" } },
    worktrees: { required: true, sharedCheckout: false },
    verification: { canonicalRoot: ".harness/verify", apps: ["web"], requiredCommands: ["node --test"] },
    integration: { mode: "pull-request", protectedBranches: ["main"], requireRebase: true },
  };
}

function write(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function fixture(t) {
  const scratch = existsSync("G:/agents_temp") ? "G:/agents_temp" : tmpdir();
  const directory = mkdtempSync(join(scratch, "mstack-policy-test-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  const root = join(directory, "project");
  const config = policy();
  write(root, ".harness/workflow.md", "# Shared workflow\n\nRead .harness/policy.json before development and verification.\n");
  write(root, "AGENTS.md", "Read [.harness/workflow.md](.harness/workflow.md) before work.\n");
  write(root, "CLAUDE.md", "Read .harness/workflow.md before work.\n");
  write(root, ".cursor/rules/shared-verification.mdc", "---\nalwaysApply: true\n---\n\nRead .harness/workflow.md before work.\n");
  write(root, ".harness/verify/web/contract.md", CONTRACT);
  write(root, ".harness/verify/web/features/README.md", "# Feature map\n\n- [Create a note](create-note.md)\n");
  write(root, ".harness/verify/web/features/create-note.md", FEATURE);
  for (const skillRoot of [".agents", ".claude", ".opencode", ".pi"]) write(root, `${skillRoot}/skills/verify-web/SKILL.md`, WEB_WRAPPER);
  return { root, directory, config, check: () => checkProject(root, config) };
}

test("a mixed-harness project shares canonical facts and uses one Cursor/Codex wrapper", (t) => {
  const f = fixture(t);
  assert.deepEqual(validateHarnessPolicy(f.config), []);
  assert.deepEqual(f.check(), []);
  assert.deepEqual(wrapperPaths("web", f.config.allowedHarnesses), [
    ".agents/skills/verify-web/SKILL.md", ".claude/skills/verify-web/SKILL.md",
    ".opencode/skills/verify-web/SKILL.md", ".pi/skills/verify-web/SKILL.md",
  ]);
  assert.deepEqual(wrapperPaths("web", ["cursor", "grokbot"]), [".cursor/skills/verify-web/SKILL.md"]);
  assert.deepEqual(wrapperPaths("web", ["grokbot", "codex"]), [".agents/skills/verify-web/SKILL.md"]);
  assert.equal(wrapperText("web", ".harness/verify/web/contract.md"), WEB_WRAPPER);
});

test("workflow choices are independent of harness names and revisions are exact", () => {
  const config = policy();
  config.workflows = { mstack: { revision: "v1.2.3-rc.1+test" } };
  assert.deepEqual(validateHarnessPolicy(config), []);
  config.workflows = { pstack: { revision: "1.0.0" } };
  assert.deepEqual(validateHarnessPolicy(config), []);
  for (const revision of ["latest", "main", "abc1234", "^1.2.3", "1.2", "01.2.3", "1.2.3-01", 123, null]) {
    config.workflows.pstack.revision = revision;
    assert.match(validateHarnessPolicy(config).join("\n"), /revision must pin/, String(revision));
  }
});

test("malformed JSON objects produce diagnostics rather than escaping exceptions", () => {
  for (const value of [null, [], true, 12, "policy"]) assert.ok(validateHarnessPolicy(value).length);
  for (const key of ["workflows", "worktrees", "verification", "integration"]) {
    for (const value of [null, [], false, "value"]) {
      const config = policy();
      config[key] = value;
      assert.ok(validateHarnessPolicy(config).length, `${key}: ${value}`);
      assert.ok(checkProject("missing-root", config).length);
    }
  }
  const config = policy();
  config.workflows.pstack = null;
  config.verification.apps = [null, "web", "web"];
  config.allowedHarnesses = ["cursor", 1, "unsupported"];
  config.integration.protectedBranches = null;
  const errors = validateHarnessPolicy(config).join("\n");
  assert.match(errors, /workflows.pstack must be an object/);
  assert.match(errors, /apps contains a duplicate: web/);
  assert.match(errors, /protectedBranches must be a non-empty array/);
});

test("schema rejects missing and unknown fields and unsafe collaboration modes", () => {
  const config = policy();
  delete config.baseBranch;
  config.workflowAliases = {};
  config.worktrees.required = false;
  config.worktrees.sharedCheckout = true;
  config.integration.mode = "direct-push";
  config.integration.requireRebase = false;
  config.verification.requiredCommands = [];
  config.workflows.mstack.allowLatest = true;
  const errors = validateHarnessPolicy(config).join("\n");
  for (const pattern of [/baseBranch is required/, /workflowAliases is not supported/, /required must be true/, /sharedCheckout must be false/, /mode must be pull-request/, /requireRebase must be true/, /requiredCommands must be a non-empty array/, /allowLatest is not supported/]) assert.match(errors, pattern);
});

test("portable project paths reject Unix escapes, Windows drive paths, UNC and device names on every OS", (t) => {
  const f = fixture(t);
  for (const path of ["../outside", "/tmp/verify", "C:/outside", "C:outside", "\\\\server\\share", "//server/share", ".harness/../outside", ".harness\\verify", "CON", ".harness/NUL.md", "verify.", "verify ", "a\u0000b", ".git/verify", ".Git/config", "vendor/.GIT/verify"]) {
    f.config.verification.canonicalRoot = path;
    assert.match(f.check().join("\n"), /canonicalRoot/, path);
    assert.throws(() => safeProjectPath(f.root, path), /Unsafe project path/, path);
  }
  for (const path of [".agents/skills/verify", ".cursor/skills", ".claude", ".opencode/skills/verify", ".pi/skills", ".AGENTS/skills/verify", ".CURSOR/SKILLS", ".CLAUDE"]) {
    f.config.verification.canonicalRoot = path;
    assert.match(f.check().join("\n"), /outside harness skill roots/, path);
  }
  assert.equal(safeProjectPath(f.root, ".harness/new/contract.md"), join(f.root, ".harness/new/contract.md"));
});

test("required branch protection and valid Git branch names are checked", () => {
  const config = policy();
  config.integration.protectedBranches = ["release"];
  assert.match(validateHarnessPolicy(config).join("\n"), /must include baseBranch/);
  for (const branch of ["../main", "main.lock", "-main", "main..next", "main@{1}", "main~1", "@", "main/", "main next"]) {
    config.baseBranch = branch;
    assert.match(validateHarnessPolicy(config).join("\n"), /valid Git branch name/, branch);
  }
});

test("missing facts, empty sections and explicit placeholders fail validation", (t) => {
  const f = fixture(t);
  write(f.root, ".harness/verify/web/contract.md", CONTRACT.replace("## Isolation", "## Other").replace("GET /health must identify the current commit and run-12 data directory.", "<!-- instructions go here -->").replace("Use the feature map to create a note through the browser.", "TODO"));
  rmSync(join(f.root, ".harness/verify/web/features/create-note.md"));
  const errors = f.check().join("\n");
  assert.match(errors, /requires one ## Isolation section/);
  assert.match(errors, /## Doctor must contain completed instructions/);
  assert.match(errors, /## Drive must contain completed instructions/);
  assert.match(errors, /requires at least one documented feature/);
  assert.match(errors, /broken or unsafe link create-note.md/);
  rmSync(join(f.root, ".harness/verify/web/contract.md"));
  assert.match(f.check().join("\n"), /contract.md:.*ENOENT/);
});

test("feature files require the documented user-facing sections and index coverage", (t) => {
  const f = fixture(t);
  write(f.root, ".harness/verify/web/features/search.md", FEATURE.replace("## Gotchas", "## Internals"));
  let errors = f.check().join("\n");
  assert.match(errors, /search.md: feature must have exactly these four H2 sections/);
  assert.match(errors, /feature is not indexed: .harness\/verify\/web\/features\/search.md/);
  write(f.root, ".harness/verify/web/features/search.md", FEATURE);
  write(f.root, ".harness/verify/web/features/README.md", "# Map\n\n[Create](create-note.md)\n\n[Search][search]\n\n[search]: search.md\n");
  assert.deepEqual(f.check(), []);
});

test("heading examples inside code fences cannot fulfill required sections", (t) => {
  const f = fixture(t);
  write(f.root, ".harness/verify/web/contract.md", `# Contract\n\n\`\`\`md\n${CONTRACT}\n\`\`\`\n`);
  assert.match(f.check().join("\n"), /requires one ## Launch section/);
  write(f.root, ".harness/verify/web/contract.md", CONTRACT.replace("Use the feature map to create a note through the browser.", "```sh\n```"));
  assert.match(f.check().join("\n"), /## Drive must contain completed instructions/);
});

test("unreferenced link definitions and code examples do not count as indexed features", (t) => {
  const f = fixture(t);
  write(f.root, ".harness/verify/web/features/README.md", "# Map\n\n`[Create](create-note.md)`\n\n[unused]: create-note.md\n");
  assert.match(f.check().join("\n"), /feature is not indexed/);
});

test("index links must resolve safely, including encoded traversal and Windows paths", (t) => {
  const f = fixture(t);
  for (const link of ["missing.md", "../../../../../../outside.md", "%2e%2e/%2e%2e/%2e%2e/%2e%2e/%2e%2e/outside.md", "C:/outside.md", "C%3a/outside.md", "\\\\server\\share", "file:///etc/passwd", "%00.md"]) {
    write(f.root, ".harness/verify/web/features/README.md", `# Map\n\n[Create](create-note.md)\n\n[Unsafe](${link})\n`);
    assert.match(f.check().join("\n"), /broken or unsafe link/, link);
  }
  write(f.root, ".harness/verify/web/features/README.md", "# Map\n\n[Create](create-note.md#gotchas)\n\n[Contract](../contract.md)\n\n[External](https://example.org/reference)\n");
  assert.deepEqual(f.check(), []);
});

test("wrapper CRLF is portable but changed instructions or metadata fail", (t) => {
  const f = fixture(t);
  const path = ".agents/skills/verify-web/SKILL.md";
  write(f.root, path, WEB_WRAPPER.replaceAll("\n", "\r\n"));
  assert.deepEqual(f.check(), []);
  write(f.root, path, `${WEB_WRAPPER}\n## Launch\n\nRun an alternate server.\n`);
  assert.match(f.check().join("\n"), /verification wrapper differs/);
  write(f.root, path, WEB_WRAPPER.replace("verification-contract: .harness/verify/web/contract.md", "verification-contract: old/contract.md"));
  assert.match(f.check().join("\n"), /verification wrapper differs/);
  rmSync(join(f.root, path));
  assert.match(f.check().join("\n"), /required verification wrapper is missing/);
});

test("Cursor rejects a duplicate .cursor and .agents discovery even with identical bytes", (t) => {
  const f = fixture(t);
  write(f.root, ".cursor/skills/verify-web/SKILL.md", WEB_WRAPPER);
  const errors = f.check().join("\n");
  assert.match(errors, /duplicate discovered skill name verify-web/);
  assert.match(errors, /legacy or unconfigured verification skill/);
});

test("renaming a legacy directory cannot hide its frontmatter verification name", (t) => {
  const f = fixture(t);
  write(f.root, ".cursor/skills/renamed/SKILL.md", "---\nname: 'verify-web'\ndescription: Legacy workflow.\n---\n\n## Launch\n\nRun the old app.\n");
  write(f.root, ".cursor/skills/renamed/features/old.md", FEATURE);
  const errors = f.check().join("\n");
  assert.match(errors, /renamed\/SKILL.md: legacy or unconfigured verification skill/);
  assert.match(errors, /duplicate discovered skill name verify-web/);
  assert.match(errors, /duplicate feature map outside/);
  write(f.root, ".cursor/skills/renamed/SKILL.md", '---\nname: "verify-\\u0077eb"\n---\n');
  assert.match(f.check().join("\n"), /duplicate discovered skill name verify-web/);
});

test("extra maps beside a valid wrapper and unregistered verification apps fail", (t) => {
  const f = fixture(t);
  write(f.root, ".agents/skills/verify-web/features/old.md", FEATURE);
  write(f.root, ".pi/skills/verify-unused/SKILL.md", "---\nname: verify-unused\n---\n\n## Drive\n\nOld instructions.\n");
  const errors = f.check().join("\n");
  assert.match(errors, /duplicate feature map outside/);
  assert.match(errors, /verify-unused\/SKILL.md: legacy or unconfigured verification skill/);
});

test("symlinks cannot redirect canonical reads, discovery scans or future writes", (t) => {
  const f = fixture(t);
  const outside = join(f.directory, "outside");
  mkdirSync(outside);
  const canonical = join(f.root, ".harness/verify/web");
  renameSync(canonical, join(outside, "web"));
  symlinkSync(join(outside, "web"), canonical, "junction");
  assert.match(f.check().join("\n"), /[Ss]ymlink/);
  assert.throws(() => safeProjectPath(f.root, ".harness/verify/web/new.md"), /Symlink/);
  rmSync(canonical);
  renameSync(join(outside, "web"), canonical);
  mkdirSync(join(outside, "skills"));
  mkdirSync(join(f.root, ".cursor"), { recursive: true });
  symlinkSync(join(outside, "skills"), join(f.root, ".cursor/skills"), "junction");
  assert.match(f.check().join("\n"), /[Ss]ymlink/);
  assert.equal(readFileSync(join(f.root, ".harness/verify/web/contract.md"), "utf8"), CONTRACT);
});

test("standalone checking a missing project reports filesystem diagnostics", () => {
  assert.match(checkProject(join(tmpdir(), "mstack-policy-no-such-project", "missing"), policy()).join("\n"), /ENOENT/);
});

test("shared workflow and each configured harness entry point are required", (t) => {
  const f = fixture(t);
  write(f.root, "AGENTS.md", "<!-- Read .harness/workflow.md -->\n");
  rmSync(join(f.root, "CLAUDE.md"));
  write(f.root, ".cursor/rules/shared-verification.mdc", "---\nalwaysApply: false\n---\n\nRead .harness/workflow.md\n");
  write(f.root, ".harness/workflow.md", "<!-- shared workflow -->\n");
  const errors = f.check().join("\n");
  assert.match(errors, /AGENTS.md: must reference/);
  assert.match(errors, /CLAUDE.md:.*ENOENT/);
  assert.match(errors, /frontmatter must set alwaysApply: true/);
  assert.match(errors, /shared workflow must be non-empty/);
});

test("entry pointers accept project prose and require only configured harnesses", (t) => {
  const f = fixture(t);
  f.config.allowedHarnesses = ["codex"];
  rmSync(join(f.root, "CLAUDE.md"));
  rmSync(join(f.root, ".cursor/rules/shared-verification.mdc"));
  for (const root of [".claude", ".opencode", ".pi"]) rmSync(join(f.root, root), { recursive: true });
  write(f.root, "AGENTS.md", "# Project rules\n\nOur workflow is in `.harness/workflow.md`. Read it first.\n");
  assert.deepEqual(f.check(), []);
});

test("unconfigured canonical apps cannot retain a second feature map", (t) => {
  const f = fixture(t);
  write(f.root, ".harness/verify/old-web/features/create.md", FEATURE);
  assert.match(f.check().join("\n"), /old-web: unconfigured canonical app directory/);
});

test("feature links cannot point at Git internals with any casing", (t) => {
  const f = fixture(t);
  for (const link of ["../../../../.git/config", "../../../../.Git/config"]) {
    write(f.root, ".harness/verify/web/features/README.md", `# Map\n\n[Create](create-note.md)\n\n[Git](${link})\n`);
    assert.match(f.check().join("\n"), /broken or unsafe link.*Unsafe project path/);
  }
});
