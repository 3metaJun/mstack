import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { inflateRawSync } from "node:zlib";
import {
  buildSkillFiles,
  createZip,
  parseTopLevel,
  rewriteEscapingLinks,
  validateUploadFrontmatter,
} from "./claude-package-lib.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillCount = JSON.parse(readFileSync(join(repoRoot, "profiles", "skills.json"), "utf8")).skills.length;

// Reads entries back through the central directory, independent of createZip's layout.
function readZip(buffer) {
  const end = buffer.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const count = buffer.readUInt16LE(end + 10);
  let pointer = buffer.readUInt32LE(end + 16);
  const entries = {};
  for (let i = 0; i < count; i += 1) {
    const method = buffer.readUInt16LE(pointer + 10);
    const size = buffer.readUInt32LE(pointer + 20);
    const nameLength = buffer.readUInt16LE(pointer + 28);
    const local = buffer.readUInt32LE(pointer + 42);
    const name = buffer.toString("utf8", pointer + 46, pointer + 46 + nameLength);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28);
    const payload = buffer.subarray(start, start + size);
    entries[name] = method === 8 ? inflateRawSync(payload) : payload;
    pointer += 46 + nameLength;
  }
  return entries;
}

test("zip round-trips deflated and stored entries", () => {
  const text = Buffer.from("hello ".repeat(200));
  const tiny = Buffer.from("x");
  const entries = readZip(createZip([{ name: "s/a.md", data: text }, { name: "s/b.txt", data: tiny }]));
  assert.deepEqual(Object.keys(entries), ["s/a.md", "s/b.txt"]);
  assert.equal(entries["s/a.md"].equals(text), true);
  assert.equal(entries["s/b.txt"].equals(tiny), true);
});

test("frontmatter parser folds block descriptions", () => {
  const fields = parseTopLevel("name: demo\ndescription: >-\n  one\n  two\nmetadata:\n  k: v\n");
  assert.equal(fields.get("description"), "one two");
  assert.ok(fields.has("metadata"));
});

test("upload validation rejects fields and limits that claude.ai refuses", () => {
  const good = "---\nname: demo\ndescription: Does a thing.\n---\n";
  assert.deepEqual(validateUploadFrontmatter("demo", good), []);
  const bad = `---\nname: other\ndescription: ${"x".repeat(1025)} <b>\nuser-invocable: false\n---\n`;
  const problems = validateUploadFrontmatter("demo", bad).join("\n");
  assert.match(problems, /user-invocable is rejected/);
  assert.match(problems, /name must equal/);
  assert.match(problems, /limit is 1024/);
  assert.match(problems, /XML tags/);
  assert.match(validateUploadFrontmatter("claude-demo", "---\nname: claude-demo\ndescription: d\n---\n").join(), /reserved word/);
});

test("links that leave the skill directory are rewritten, internal links stay", () => {
  const skillsRoot = resolve("/s");
  const root = join(skillsRoot, "a");
  const file = join(root, "references", "r.md");
  const input = "[in](../SKILL.md) [sib](../../b/SKILL.md) [deep](../../b/x/y.md#z) [out](../../../tools/t.md) [web](https://e.com)";
  assert.equal(
    rewriteEscapingLinks(input, file, root, skillsRoot),
    "[in](../SKILL.md) sib (the `b` skill) deep (the `b` skill, `x/y.md`) out [web](https://e.com)",
  );
});

test("every canonical skill packs and passes upload validation", () => {
  const out = execFileSync(process.execPath, [join(repoRoot, "scripts", "pack-claude-skills.mjs"), "--check"], { encoding: "utf8" });
  assert.match(out, new RegExp(`^${skillCount} skills are valid`));
});

test("packed archive contains the skill tree under a single top-level folder", () => {
  const dir = mkdtempSync(join(tmpdir(), "mstack-pack-"));
  try {
    execFileSync(process.execPath, [join(repoRoot, "scripts", "pack-claude-skills.mjs"), "--skill", "architect", "--out", dir]);
    const entries = readZip(readFileSync(join(dir, "architect.zip")));
    assert.ok(Object.keys(entries).every((name) => name.startsWith("architect/")));
    const files = buildSkillFiles("architect", join(repoRoot, "skills")).map((file) => file.name);
    assert.deepEqual(Object.keys(entries), files);
    assert.doesNotMatch(entries["architect/references/rationale-template.md"].toString(), /\.\.\/\.\.\/arena/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unknown skills fail before writing", () => {
  const dir = mkdtempSync(join(tmpdir(), "mstack-pack-"));
  try {
    assert.throws(
      () => execFileSync(process.execPath, [join(repoRoot, "scripts", "pack-claude-skills.mjs"), "--skill", "nope", "--out", dir], { stdio: "pipe" }),
      /Unknown skill: nope/,
    );
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
