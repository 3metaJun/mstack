import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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
  uploadSizeProblem,
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

test("link rewriting skips code, handles images, parentheses, angle brackets, and queries", () => {
  const skillsRoot = resolve("/s");
  const root = join(skillsRoot, "a");
  const file = join(root, "r.md");
  const rewrite = (text) => rewriteEscapingLinks(text, file, root, skillsRoot);
  assert.equal(rewrite("![fig](../b/img.png)"), "fig (the `b` skill, `img.png`)");
  assert.equal(rewrite("[x](../b/foo(1).md)"), "x (the `b` skill, `foo(1).md`)");
  assert.equal(rewrite("[x](<../b/my doc.md>)"), "x (the `b` skill, `my doc.md`)");
  assert.equal(rewrite("[x](../b/SKILL.md?plain=1#top \"title\")"), "x (the `b` skill)");
  assert.equal(rewrite("[x](../b/my%20doc.md)"), "x (the `b` skill, `my doc.md`)");
  assert.equal(rewrite("`[x](../b/SKILL.md)` and ``[y](../b/SKILL.md)``"), "`[x](../b/SKILL.md)` and ``[y](../b/SKILL.md)``");
  const fenced = "```md\n[x](../b/SKILL.md)\n```\n[x](../b/SKILL.md)\n~~~\n[z](../b/SKILL.md)\n~~~";
  assert.equal(rewrite(fenced), "```md\n[x](../b/SKILL.md)\n```\nx (the `b` skill)\n~~~\n[z](../b/SKILL.md)\n~~~");
  assert.equal(rewrite("[in](./k.md)\r\n[out](../b/SKILL.md)"), "[in](./k.md)\r\nout (the `b` skill)");
});

test("reference-style links that leave the skill are rejected", () => {
  const skillsRoot = resolve("/s");
  const root = join(skillsRoot, "a");
  const file = join(root, "r.md");
  assert.throws(() => rewriteEscapingLinks("[x][ref]\n\n[ref]: ../b/SKILL.md", file, root, skillsRoot), /reference-style link leaves the skill/);
  assert.equal(rewriteEscapingLinks("[ref]: ./local.md\n[w]: https://e.com", file, root, skillsRoot), "[ref]: ./local.md\n[w]: https://e.com");
});

test("frontmatter parser joins wrapped scalars, unescapes quotes, and rejects unquoted colons", () => {
  const fields = parseTopLevel('name: demo\ndescription: one\n  two\nlicense: "say \\"hi\\"" # note\ncompatibility: \'it\'\'s\'\n');
  assert.equal(fields.get("description"), "one two");
  assert.equal(fields.get("license"), 'say "hi"');
  assert.equal(fields.get("compatibility"), "it's");
  assert.throws(() => parseTopLevel("description: Use for: things"), /must be quoted/);
  assert.match(validateUploadFrontmatter("demo", "---\nname: demo\ndescription: Use for: things\n---\n").join(), /must be quoted/);
});

test("name rules follow the Agent Skills specification", () => {
  for (const name of ["-demo", "demo-", "de--mo", "Demo", "d".repeat(65)]) {
    assert.match(validateUploadFrontmatter(name, `---\nname: ${name}\ndescription: d\n---\n`).join(), /name must be 1-64/, name);
  }
  assert.deepEqual(validateUploadFrontmatter("a1-b2", "---\nname: a1-b2\ndescription: d\n---\n"), []);
});

test("default output stays in the packer's repository when run from another directory", () => {
  // A temporary checkout layout, so the real dist/ is never touched.
  const root = mkdtempSync(join(tmpdir(), "mstack-root-"));
  const cwd = mkdtempSync(join(tmpdir(), "mstack-cwd-"));
  try {
    mkdirSync(join(root, "scripts"));
    for (const file of ["pack-claude-skills.mjs", "claude-package-lib.mjs", "cli-args.mjs"]) {
      cpSync(join(repoRoot, "scripts", file), join(root, "scripts", file));
    }
    mkdirSync(join(root, "profiles"));
    cpSync(join(repoRoot, "profiles", "skills.json"), join(root, "profiles", "skills.json"));
    cpSync(join(repoRoot, "skills", "architect"), join(root, "skills", "architect"), { recursive: true });
    execFileSync(process.execPath, [join(root, "scripts", "pack-claude-skills.mjs"), "--skill", "architect"], { cwd });
    assert.equal(existsSync(join(root, "dist", "claude-skills", "architect.zip")), true);
    assert.equal(existsSync(join(cwd, "dist")), false);
  } finally {
    rmSync(root, { recursive: true, force: true });
    rmSync(cwd, { recursive: true, force: true });
  }
});

test("repeated --skill names write one archive", () => {
  const dir = mkdtempSync(join(tmpdir(), "mstack-pack-"));
  try {
    const out = execFileSync(process.execPath, [join(repoRoot, "scripts", "pack-claude-skills.mjs"), "--skill", "bro,bro", "--out", dir], { encoding: "utf8" });
    assert.match(out, /Wrote 1 archives/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("links with code in the label or a wrapped label are rewritten", () => {
  const skillsRoot = resolve("/s");
  const root = join(skillsRoot, "a");
  const file = join(root, "r.md");
  const rewrite = (text) => rewriteEscapingLinks(text, file, root, skillsRoot);
  assert.equal(rewrite("[`foo`](../b/SKILL.md)"), "`foo` (the `b` skill)");
  assert.equal(rewrite("see [the `b` skill](../b/SKILL.md)."), "see the `b` skill (the `b` skill).");
  assert.equal(rewrite("[the b\nskill](../b/SKILL.md)"), "the b\nskill (the `b` skill)");
  assert.equal(rewrite("[the b\r\nskill](../b/SKILL.md)\r\nnext"), "the b\r\nskill (the `b` skill)\r\nnext");
  assert.equal(rewrite("`a` text `[x](../b/SKILL.md)`"), "`a` text `[x](../b/SKILL.md)`");
});

test("fence detection follows CommonMark openers and closers", () => {
  const skillsRoot = resolve("/s");
  const root = join(skillsRoot, "a");
  const file = join(root, "r.md");
  const rewrite = (text) => rewriteEscapingLinks(text, file, root, skillsRoot);
  // Backticks in the info string make this inline code, not a fence.
  assert.equal(rewrite("```x``` and [y](../b/SKILL.md)\n[z](../b/SKILL.md)"), "```x``` and y (the `b` skill)\nz (the `b` skill)");
  // A shorter inner fence does not close a longer one.
  assert.equal(
    rewrite("````\n```\n[x](../b/SKILL.md)\n````\n[y](../b/SKILL.md)"),
    "````\n```\n[x](../b/SKILL.md)\n````\ny (the `b` skill)",
  );
  // An unclosed fence protects the rest of the file.
  assert.equal(rewrite("```\n[x](../b/SKILL.md)"), "```\n[x](../b/SKILL.md)");
});

test("a link definition is an error only when its label is used", () => {
  const skillsRoot = resolve("/s");
  const root = join(skillsRoot, "a");
  const file = join(root, "r.md");
  const prose = "[Note]: /tmp/x is the dir";
  assert.equal(rewriteEscapingLinks(prose, file, root, skillsRoot), prose);
  for (const use of ["[t][ref]", "[ref][]", "see [Ref] here"]) {
    assert.throws(
      () => rewriteEscapingLinks(`${use}\n\n[ref]: ../b/SKILL.md`, file, root, skillsRoot),
      /reference-style link leaves the skill/,
      use,
    );
  }
});

test("flow collections may contain a colon", () => {
  assert.equal(parseTopLevel("metadata: {a: b}").get("metadata"), "{a: b}");
  assert.equal(parseTopLevel("description: see http://x and 10:30").get("description"), "see http://x and 10:30");
});

test("upload size counts uncompressed bytes against the documented limit", () => {
  const small = [{ name: "s/a", data: Buffer.alloc(10) }];
  const big = [{ name: "s/a", data: Buffer.alloc(16 * 1024 * 1024) }, { name: "s/b", data: Buffer.alloc(16 * 1024 * 1024) }];
  assert.equal(uploadSizeProblem("s", small), null);
  assert.match(uploadSizeProblem("s", big), /exceed the 31457280 byte upload limit/);
});
