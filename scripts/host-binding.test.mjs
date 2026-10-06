import assert from "node:assert/strict";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { hostBindingProblems, hostToolPatterns, isHostReference } from "./host-binding-lib.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = join(repoRoot, "skills");

const leaks = [
  ["delegate_task", "Call delegate_task for each worker."],
  ["task_status", "Drain with `task_status`."],
  ["task_cancel", "Stop it with task_cancel."],
  ["orchestrator_capabilities", "Probe orchestrator_capabilities once."],
  ["watch_pull_request", "Use watch_pull_request, then end the turn."],
  ["unwatch_pull_request", "Call unwatch_pull_request first."],
  ["link_pull_request", "Run link_pull_request for every layer."],
  ["list_thread_pull_requests", "Check list_thread_pull_requests."],
  ["schedule_task", "Arm schedule_task hourly."],
  ["run_scheduled_task_now", "Run run_scheduled_task_now."],
  ["update_scheduled_task", "update_scheduled_task enabled=false"],
  ["delete_scheduled_task", "Then delete_scheduled_task."],
  ["list_scheduled_tasks", "Check list_scheduled_tasks first."],
  ["t3_thread_wait", "t3_thread_wait for the run."],
  ["request_secret", "Ask with request_secret."],
  ["create_threads", "create_threads for a batch."],
  ["t3_thread_launch", "t3_thread_launch with a worktree."],
  ["t3_thread_search", "t3_thread_search the topic."],
  ["t3_pending_request_respond", "t3_pending_request_respond answers it."],
  ["t3_worktree_list", "t3_worktree_list shows paths."],
  ["preview_open", "preview_open before navigating."],
  ["preview_recording_stop", "Finish with preview_recording_stop."],
  ["device_open", "device_open boots the simulator."],
  ["device_screenshot", "Use device_screenshot."],
  ["server name", "The t3-code server provides it."],
  ["harness prefix", "Call mcp__t3_code__delegate_task."],
];

const neutral = [
  ["pointer sentence", "On a host with native delegation, read its file under `references/hosts/` first."],
  ["product name in prose", "T3 Code lists skills for each provider."],
  ["ordinary identifiers", "Set preview mode and device id in the config; run the task status report."],
  ["scheduled wording", "Arm a scheduled task, then watch the pull request."],
  ["unrelated snake case", "Read task_list and thread_id from the response."],
];

const locations = [
  ["skill body", "skills/meta-mode/SKILL.md", true],
  ["playbook", "skills/meta-mode/playbooks/babysit.md", true],
  ["generic reference", "skills/meta-mode/references/capability-matrix.md", true],
  ["script", "skills/recall/scripts/history.mjs", true],
  ["host reference", "skills/meta-mode/references/hosts/t3code.md", false],
  ["host reference, Windows separators", "skills\\recall\\references\\hosts\\t3code.md", false],
  ["host directory without a skill", "references/hosts/t3code.md", true],
  ["nested below hosts", "skills/meta-mode/references/hosts/extra/t3code.md", true],
  ["hosts under a playbook directory", "skills/meta-mode/playbooks/hosts/t3code.md", true],
];

for (const [name, text] of leaks) {
  for (const [place, path, flagged] of locations) {
    test(`${name} in ${place} is ${flagged ? "reported" : "allowed"}`, () => {
      const problems = hostBindingProblems(path, text);
      assert.equal(problems.length > 0, flagged, problems.join("\n"));
      if (flagged) assert.match(problems[0], new RegExp(path.replaceAll("\\", "\\\\")));
    });
  }
}

for (const [name, text] of neutral) {
  test(`neutral wording passes: ${name}`, () => {
    assert.deepEqual(hostBindingProblems("skills/meta-mode/playbooks/babysit.md", text), []);
  });
}

test("host reference path recognition", () => {
  assert.equal(isHostReference("skills/x/references/hosts/y.md"), true);
  assert.equal(isHostReference("skills/x/references/hosts/"), false);
  assert.equal(isHostReference("skills/x/hosts/y.md"), false);
});

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    if (name === "node_modules") return [];
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

const files = walk(skillsRoot).map((path) => ({
  path,
  relative: relative(repoRoot, path).replaceAll("\\", "/"),
  content: readFileSync(path, "utf8"),
}));

test("no shipped skill names a host tool outside a host reference", () => {
  const problems = files.flatMap((file) => hostBindingProblems(file.relative, file.content));
  assert.deepEqual(problems, []);
});

const verifiedTools = new Set([
  "orchestrator_capabilities", "delegate_task", "task_status", "task_cancel", "create_threads", "request_secret",
  "schedule_task", "run_scheduled_task_now", "list_scheduled_tasks", "update_scheduled_task", "delete_scheduled_task",
  "link_pull_request", "unlink_pull_request", "list_thread_pull_requests", "watch_pull_request", "unwatch_pull_request",
  "t3_thread_launch", "t3_thread_list", "t3_thread_read", "t3_thread_wait", "t3_thread_send", "t3_thread_interrupt",
  "t3_thread_search", "t3_worktree_list", "t3_pending_request_list", "t3_pending_request_read", "t3_pending_request_respond",
  "preview_status", "preview_open", "preview_navigate", "preview_snapshot", "preview_click", "preview_type", "preview_press",
  "preview_scroll", "preview_wait_for", "preview_evaluate", "preview_resize", "preview_set_appearance",
  "preview_recording_start", "preview_recording_stop",
  "device_list", "device_open", "device_screenshot", "device_close",
]);

test("every verified tool name is rejected outside a host reference", () => {
  for (const tool of verifiedTools) {
    const problems = hostBindingProblems("skills/meta-mode/playbooks/babysit.md", `Call ${tool} now.`);
    assert.equal(problems.length, 1, `${tool} slips past the gate`);
  }
});

function unverifiedHostTools(content) {
  const identifiers = new Set(content.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? []);
  return [...identifiers].filter(
    (identifier) => hostToolPatterns.some((pattern) => pattern.test(identifier)) && !verifiedTools.has(identifier),
  );
}

const verifiedFixtures = [
  ["a verified tool", "Call `t3_thread_launch` and `delegate_task`.", []],
  ["error codes and fields are ignored", "`model_unavailable` and `fixed_time` and `bindToCurrentThread`", []],
  ["a bogus thread tool", "Call `t3_thread_bogus` first.", ["t3_thread_bogus"]],
  ["a bogus preview tool", "Then preview_teleport.", ["preview_teleport"]],
  ["a bogus device tool", "Then device_reboot_all.", ["device_reboot_all"]],
  ["known limit, an unlisted orchestration-style misspelling is not caught", "Use watch_pull_requests now.", []],
  ["a misspelled thread tool next to a good one", "t3_thread_launch then t3_thread_waait", ["t3_thread_waait"]],
];

for (const [name, text, expected] of verifiedFixtures) {
  test(`verified-tool check: ${name}`, () => {
    assert.deepEqual(unverifiedHostTools(text), expected);
  });
}

test("every bundled host reference uses only verified tool names", () => {
  const references = files.filter((file) => isHostReference(file.relative));
  assert.ok(references.length >= 3, "expected host references for meta-mode, recall, and create-verification-skill");
  for (const file of references) {
    assert.match(file.relative, /\/hosts\/[a-z0-9-]+\.md$/, file.relative);
    assert.deepEqual(unverifiedHostTools(file.content), [], file.relative);
  }
});

test("the verified-tool check sees the tools the host references actually name", () => {
  const named = new Set(
    files
      .filter((file) => isHostReference(file.relative))
      .flatMap((file) => file.content.match(/\b[a-z][a-z0-9]*(?:_[a-z0-9]+)+\b/g) ?? [])
      .filter((identifier) => verifiedTools.has(identifier)),
  );
  assert.ok(named.size >= 30, `expected the references to name many verified tools, found ${named.size}`);
});

test("portable pointers to host references name no host", () => {
  const pointing = files.filter((file) => /references\/hosts\//.test(file.content) && !isHostReference(file.relative));
  assert.ok(pointing.length >= 5, "expected pointers in the meta-mode skill, playbooks, and sibling skills");
  for (const file of pointing) {
    assert.doesNotMatch(file.content, /t3code\.md/i, `${file.relative} names a host file instead of the directory`);
  }
});
