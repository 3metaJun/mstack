import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";

const scripts = dirname(fileURLToPath(import.meta.url));
const digest = (content) => createHash("sha256").update(content.replaceAll("\r\n", "\n")).digest("hex");
const artifact = "automations/benny/README.md";
const upstream = "Use /poteto-mode with pstack.\n";
const transformed = "Use /meta-mode with mstack.\n";
const adapted = "Read the shared project contract before using /meta-mode.\n";

function write(root, path, content) {
  mkdirSync(dirname(join(root, path)), { recursive: true });
  writeFileSync(join(root, path), content);
}

function json(root, path, content) {
  write(root, path, JSON.stringify(content, null, 2) + "\n");
}

function git(root, ...args) {
  return execFileSync("git", ["-C", root, ...args], { encoding: "utf8", windowsHide: true, stdio: ["ignore", "pipe", "pipe"] }).trim();
}

function fixture(t) {
  const scratch = existsSync("G:/agents_temp") ? "G:/agents_temp" : tmpdir();
  const temporary = mkdtempSync(join(scratch, "mstack-adaptation-"));
  t.after(() => rmSync(temporary, { recursive: true, force: true }));
  const source = join(temporary, "source");
  const target = join(temporary, "target");
  const skill = "---\nname: sample\ndescription: Verify the sample.\n---\n\nRun the sample.\n";
  write(source, "skills/sample/SKILL.md", skill);
  write(target, "skills/sample/SKILL.md", skill);
  write(source, artifact, upstream);
  write(target, artifact, adapted);
  write(source, "automations/benny/unchanged.md", "Keep strict comparison.\n");
  write(target, "automations/benny/unchanged.md", "Keep strict comparison.\n");
  for (const path of ["agents/agent.md", "docs/guide/README.md", "skills/poteto-mode/scripts/tool.mjs"]) {
    const sourcePath = path.replace("skills/poteto-mode/scripts", "tools");
    write(source, sourcePath, "Shared artifact.\n");
    write(target, sourcePath === "tools/tool.mjs" ? "tools/meta-mode/tool.mjs" : sourcePath, "Shared artifact.\n");
  }
  git(source, "init", "--quiet");
  git(source, "config", "core.autocrlf", "false");
  const commit = () => {
    git(source, "add", ".");
    git(source, "-c", "user.name=Fixture", "-c", "user.email=fixture@example.invalid", "commit", "--quiet", "-m", "Fixture source");
    return git(source, "rev-parse", "HEAD");
  };
  const pinned = commit();
  const profile = { pstack: { repository: "https://example.invalid/pstack", commit: pinned, artifacts: { "meta-mode-tools": { source: "tools", target: "tools/meta-mode", compareContent: false } } } };
  const manifest = {
    source: profile.pstack.repository, commit: pinned,
    canonicalSkills: { sample: { source: digest(skill), target: digest(skill) } },
    artifacts: { automations: { [artifact]: digest(transformed), "automations/benny/unchanged.md": digest("Keep strict comparison.\n") } },
    adaptedArtifacts: { [artifact]: { source: digest(transformed), target: digest(adapted), reason: "Route verification through the shared project contract." } },
  };
  const save = () => {
    json(target, "profiles/upstreams.json", profile);
    json(target, "profiles/upstream-manifest.json", manifest);
  };
  save();
  const run = (script, args) => spawnSync(process.execPath, [resolve(scripts, script), "--source", source, "--target", target, ...args], { encoding: "utf8", windowsHide: true });
  return { source, target, profile, manifest, commit, save, check: () => run("check-upstream.mjs", ["--strict"]), sync: () => run("sync-upstream.mjs", ["--apply"]) };
}

test("reviewed adaptations accept pinned source and target content, including CRLF, while unlisted files remain strict", (t) => {
  const f = fixture(t);
  write(f.target, artifact, adapted.replaceAll("\n", "\r\n"));
  const passing = f.check();
  assert.equal(passing.status, 0, passing.stderr);
  assert.match(passing.stdout, /reviewed artifact adaptations: 1 entries, 0 problem/);
  assert.equal(f.manifest.artifacts.automations[artifact], digest(transformed));
  write(f.target, "automations/benny/unchanged.md", "Unreviewed change.\n");
  const rejected = f.check();
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /changed: automations\/benny\/unchanged.md/);
});

test("a reviewed adaptation detects target edits and clean newly pinned source drift independently", (t) => {
  const f = fixture(t);
  write(f.target, artifact, adapted + "Unreviewed instructions.\n");
  const targetDrift = f.check();
  assert.equal(targetDrift.status, 1);
  assert.match(targetDrift.stderr, /reviewed target content changed/);
  write(f.target, artifact, adapted);
  write(f.source, artifact, upstream + "New upstream requirement.\n");
  const commit = f.commit();
  f.profile.pstack.commit = commit;
  f.manifest.commit = commit;
  f.save();
  const sourceDrift = f.check();
  assert.equal(sourceDrift.status, 1);
  assert.match(sourceDrift.stderr, /reviewed upstream source changed/);
  assert.doesNotMatch(sourceDrift.stderr, /source provenance check failed/i);
});

test("adaptation metadata requires a reason, exact hashes, and an existing upstream artifact", (t) => {
  const f = fixture(t);
  const entry = f.manifest.adaptedArtifacts[artifact];
  for (const replacement of [{ ...entry, reason: " " }, { ...entry, source: "latest" }, { ...entry, target: null }]) {
    f.manifest.adaptedArtifacts[artifact] = replacement;
    f.save();
    const rejected = f.check();
    assert.equal(rejected.status, 1);
    assert.match(rejected.stderr, /adaptation requires/);
  }
  f.manifest.adaptedArtifacts = { [artifact]: entry, "docs/guide/missing.md": entry };
  f.save();
  const stale = f.check();
  assert.equal(stale.status, 1);
  assert.match(stale.stderr, /stale adaptation; no matching upstream artifact/);
});

test("sync preserves reviewed baselines and refuses to overwrite an adapted target", (t) => {
  const f = fixture(t);
  const before = readFileSync(join(f.target, "profiles/upstream-manifest.json"), "utf8");
  const refused = f.sync();
  assert.equal(refused.status, 1);
  assert.match(refused.stderr, /Refusing to replace or remove changed upstream artifacts/);
  assert.equal(readFileSync(join(f.target, artifact), "utf8"), adapted);
  assert.equal(readFileSync(join(f.target, "profiles/upstream-manifest.json"), "utf8"), before);
  write(f.target, artifact, transformed);
  const applied = f.sync();
  assert.equal(applied.status, 0, applied.stderr);
  const after = JSON.parse(readFileSync(join(f.target, "profiles/upstream-manifest.json"), "utf8"));
  assert.deepEqual(after.adaptedArtifacts, f.manifest.adaptedArtifacts);
  assert.equal(after.artifacts.automations[artifact], digest(transformed));
  assert.match(f.check().stderr, /reviewed target content changed/);
});
