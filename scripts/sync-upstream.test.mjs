import assert from "node:assert/strict";
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { spawnSync } from "node:child_process";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import test from "node:test";

const synchronizer = resolve("scripts", "sync-upstream.mjs");
const checker = resolve("scripts", "check-upstream.mjs");

function write(path, content) {
  mkdirSync(resolve(path, ".."), { recursive: true });
  writeFileSync(path, content, "utf8");
}

function run(script, arguments_) {
  return spawnSync(process.execPath, [script, ...arguments_], {
    cwd: resolve("."),
    encoding: "utf8",
  });
}

function runGit(directory, arguments_) {
  const result = spawnSync("git", ["-C", directory, ...arguments_], {
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
  return result.stdout.trim();
}

function updateProfile(target, update) {
  const path = join(target, "profiles", "upstreams.json");
  const profile = JSON.parse(readFileSync(path, "utf8"));
  update(profile.pstack);
  write(path, `${JSON.stringify(profile, null, 2)}\n`);
}

function commitSourceChange(source, message) {
  runGit(source, ["add", "-A"]);
  runGit(source, [
    "-c", "user.name=mstack test",
    "-c", "user.email=mstack@example.test",
    "commit", "--quiet", "-m", message,
  ]);
  return runGit(source, ["rev-parse", "HEAD"]);
}

function fixture({ initializeGit = true } = {}) {
  const root = mkdtempSync(join(tmpdir(), "mstack-upstream-test-"));
  const source = join(root, "pstack");
  const target = join(root, "mstack");
  write(join(source, "agents", "poteto-agent.md"), "---\nname: poteto-agent\n---\n");
  write(join(source, "automations", "benny", "README.md"), "pstack uses poteto-mode.\n");
  write(join(source, "docs", "guide", "02-poteto-mode.md"), "Use /poteto-mode with pstack.\nCursor confirms.\n");
  write(join(source, "skills", "poteto-mode", "scripts", "tool.mjs"), "const mode = 'poteto-mode';\n");
  write(join(source, "skills", "sample", "SKILL.md"), "---\nname: sample\ndescription: fixture\n---\n");
  let commit = "0".repeat(40);
  if (initializeGit) {
    runGit(source, ["init", "--quiet"]);
    runGit(source, ["add", "."]);
    runGit(source, [
      "-c", "user.name=mstack test",
      "-c", "user.email=mstack@example.test",
      "commit", "--quiet", "-m", "fixture",
    ]);
    commit = runGit(source, ["rev-parse", "HEAD"]);
  }
  write(join(target, "skills", "meta-mode", "SKILL.md"), "---\nname: meta-mode\ndescription: fixture\n---\n");
  write(join(target, "skills", "sample", "SKILL.md"), "---\nname: sample\ndescription: fixture\n---\n");
  write(join(target, "profiles", "upstreams.json"), JSON.stringify({
    pstack: {
      repository: "https://example.test/pstack",
      commit,
      renames: { "poteto-mode": "meta-mode" },
      artifacts: {
        guide: {
          source: "docs/guide",
          target: "docs/guide",
          compareContent: true,
          renameFiles: { "02-poteto-mode.md": "02-meta-mode.md" },
          replacements: [{ from: "Cursor confirms.", to: "Harness confirms." }],
        },
      },
    },
  }, null, 2));
  return { root, source, target };
}

test("upstream sync previews, transforms, and protects changed files", () => {
  const { root, source, target } = fixture();
  try {
    const dryRun = run(synchronizer, ["--source", source, "--target", target]);
    assert.equal(dryRun.status, 0, dryRun.stderr);
    assert.match(dryRun.stdout, /Dry run: 4 file\(s\) would be written/);
    assert.equal(existsSync(join(target, "automations")), false);

    const applied = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
    assert.equal(applied.status, 0, applied.stderr);
    assert.equal(
      readFileSync(join(target, "automations", "benny", "README.md"), "utf8"),
      "mstack uses meta-mode.\n",
    );
    assert.equal(
      readFileSync(join(target, "docs", "guide", "02-meta-mode.md"), "utf8"),
      "Use /meta-mode with mstack.\nHarness confirms.\n",
    );
    assert.equal(
      readFileSync(join(target, "tools", "meta-mode", "tool.mjs"), "utf8"),
      "const mode = 'meta-mode';\n",
    );
    assert.ok(existsSync(join(target, "agents", "meta-agent.md")));
    assert.ok(existsSync(join(target, "profiles", "upstream-manifest.json")));

    const checked = run(checker, ["--source", source, "--target", target, "--strict"]);
    assert.equal(checked.status, 0, checked.stderr);
    assert.match(checked.stdout, /artifact guide: 1 present, 0 missing, 0 changed/);

    write(join(target, "automations", "benny", "README.md"), "local edit\n");
    const refused = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /Refusing to replace or remove changed upstream artifacts/);

    const forced = run(synchronizer, ["--source", source, "--target", target, "--apply", "--force"]);
    assert.equal(forced.status, 0, forced.stderr);
    assert.equal(
      readFileSync(join(target, "automations", "benny", "README.md"), "utf8"),
      "mstack uses meta-mode.\n",
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("apply and strict checks reject tracked and untracked source changes", () => {
  const { root, source, target } = fixture();
  try {
    write(join(source, "skills", "sample", "SKILL.md"), "modified\n");
    write(join(source, "untracked.txt"), "untracked\n");

    const preview = run(synchronizer, ["--source", source, "--target", target]);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stderr, /Warning: Source subtree has tracked or untracked changes/);
    assert.match(preview.stderr, /skills\/sample\/SKILL\.md/);
    assert.match(preview.stderr, /untracked\.txt/);

    const applied = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
    assert.notEqual(applied.status, 0);
    assert.match(applied.stderr, /Upstream source provenance check failed/);
    assert.equal(existsSync(join(target, "automations")), false);

    const checked = run(checker, ["--source", source, "--target", target, "--strict"]);
    assert.notEqual(checked.status, 0);
    assert.match(checked.stderr, /Upstream source provenance check failed/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("strict operations reject a non-Git source while previews warn", () => {
  const { root, source, target } = fixture({ initializeGit: false });
  try {
    const preview = run(synchronizer, ["--source", source, "--target", target]);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stderr, /Warning: Source is not inside a Git checkout/);

    const nonStrictCheck = run(checker, ["--source", source, "--target", target]);
    assert.equal(nonStrictCheck.status, 0, nonStrictCheck.stderr);
    assert.match(nonStrictCheck.stderr, /Warning: Source is not inside a Git checkout/);

    const applied = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
    assert.notEqual(applied.status, 0);
    assert.match(applied.stderr, /Source is not inside a Git checkout/);

    const checked = run(checker, ["--source", source, "--target", target, "--strict"]);
    assert.notEqual(checked.status, 0);
    assert.match(checked.stderr, /Source is not inside a Git checkout/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("strict operations reject a clean source at a different commit", () => {
  const { root, source, target } = fixture();
  try {
    write(join(source, "CHANGELOG.md"), "new commit\n");
    runGit(source, ["add", "CHANGELOG.md"]);
    runGit(source, [
      "-c", "user.name=mstack test",
      "-c", "user.email=mstack@example.test",
      "commit", "--quiet", "-m", "advance source",
    ]);

    const preview = run(synchronizer, ["--source", source, "--target", target]);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stderr, /Warning: Source checkout is at [0-9a-f]+, profile pins [0-9a-f]+/);

    const applied = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
    assert.notEqual(applied.status, 0);
    assert.match(applied.stderr, /Upstream source provenance check failed/);

    const checked = run(checker, ["--source", source, "--target", target, "--strict"]);
    assert.notEqual(checked.status, 0);
    assert.match(checked.stderr, /Source checkout is at [0-9a-f]+, profile pins [0-9a-f]+/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("artifact paths cannot escape the source or target checkout", () => {
  const cases = [
    {
      configure(pstack) { pstack.artifacts.guide.source = "../outside-source"; },
      expected: /artifact guide source must stay inside its checkout; parent traversal is not allowed/,
    },
    {
      configure(pstack) { pstack.artifacts.guide.target = "../outside-target"; },
      expected: /artifact guide target must stay inside its checkout; parent traversal is not allowed/,
    },
    {
      configure(pstack, root) { pstack.artifacts.guide.target = join(root, "outside-target"); },
      expected: /artifact guide target must stay inside its checkout; absolute paths are not allowed/,
    },
    {
      configure(pstack) { pstack.artifacts.guide.renameFiles["02-poteto-mode.md"] = "../../outside.md"; },
      expected: /artifact guide rename .* parent traversal is not allowed/,
    },
  ];

  for (const testCase of cases) {
    const { root, source, target } = fixture();
    try {
      updateProfile(target, (pstack) => testCase.configure(pstack, root));
      for (const script of [synchronizer, checker]) {
        const result = run(script, ["--source", source, "--target", target]);
        assert.notEqual(result.status, 0);
        assert.match(result.stderr, testCase.expected);
      }
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  }
});

test("manifest paths cannot escape the target checkout", () => {
  const { root, source, target } = fixture();
  try {
    write(join(target, "profiles", "upstream-manifest.json"), JSON.stringify({
      artifacts: { guide: { "../outside.md": "0".repeat(64) } },
    }));

    for (const script of [synchronizer, checker]) {
      const result = run(script, ["--source", source, "--target", target]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /upstream manifest artifact guide must stay inside its checkout/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("artifact target collisions are rejected", () => {
  const { root, source, target } = fixture();
  try {
    updateProfile(target, (pstack) => {
      pstack.artifacts.agents = {
        source: "agents",
        target: "docs/guide",
        compareContent: false,
        renameFiles: { "poteto-agent.md": "02-meta-mode.md" },
      };
    });

    for (const script of [synchronizer, checker]) {
      const result = run(script, ["--source", source, "--target", target]);
      assert.notEqual(result.status, 0);
      assert.match(result.stderr, /resolve to the same target: docs\/guide\/02-meta-mode\.md/);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("removed upstream artifacts are reported and safely deleted", () => {
  const { root, source, target } = fixture();
  try {
    const initial = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
    assert.equal(initial.status, 0, initial.stderr);
    const removedPath = join(target, "automations", "benny", "README.md");
    assert.ok(existsSync(removedPath));

    unlinkSync(join(source, "automations", "benny", "README.md"));
    const commit = commitSourceChange(source, "remove automation readme");
    updateProfile(target, (pstack) => { pstack.commit = commit; });

    const preview = run(synchronizer, ["--source", source, "--target", target]);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /removed=1/);
    assert.match(preview.stdout, /Files removed upstream:\r?\n  automations\/benny\/README\.md/);
    assert.ok(existsSync(removedPath));

    const checked = run(checker, ["--source", source, "--target", target, "--strict"]);
    assert.notEqual(checked.status, 0);
    assert.match(checked.stderr, /removed upstream: automations\/benny\/README\.md/);

    const applied = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
    assert.equal(applied.status, 0, applied.stderr);
    assert.match(applied.stdout, /Removed 1 file\(s\)/);
    assert.equal(existsSync(removedPath), false);

    const manifest = JSON.parse(readFileSync(join(target, "profiles", "upstream-manifest.json"), "utf8"));
    assert.deepEqual(manifest.artifacts.automations, {});
    const rechecked = run(checker, ["--source", source, "--target", target, "--strict"]);
    assert.equal(rechecked.status, 0, rechecked.stderr);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("locally adapted removed artifacts require force before deletion", () => {
  const { root, source, target } = fixture();
  try {
    const initial = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
    assert.equal(initial.status, 0, initial.stderr);
    const removedPath = join(target, "agents", "meta-agent.md");
    write(removedPath, "local adaptation\n");

    const adaptedCheck = run(checker, ["--source", source, "--target", target, "--strict"]);
    assert.equal(adaptedCheck.status, 0, adaptedCheck.stderr);

    unlinkSync(join(source, "agents", "poteto-agent.md"));
    const commit = commitSourceChange(source, "remove agent");
    updateProfile(target, (pstack) => { pstack.commit = commit; });

    const preview = run(synchronizer, ["--source", source, "--target", target]);
    assert.equal(preview.status, 0, preview.stderr);
    assert.match(preview.stdout, /agents\/meta-agent\.md \(locally changed\)/);

    const refused = run(synchronizer, ["--source", source, "--target", target, "--apply"]);
    assert.notEqual(refused.status, 0);
    assert.match(refused.stderr, /Refusing to replace or remove changed upstream artifacts/);
    assert.match(refused.stderr, /remove: agents\/meta-agent\.md/);
    assert.equal(readFileSync(removedPath, "utf8"), "local adaptation\n");

    const forced = run(synchronizer, ["--source", source, "--target", target, "--apply", "--force"]);
    assert.equal(forced.status, 0, forced.stderr);
    assert.equal(existsSync(removedPath), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
