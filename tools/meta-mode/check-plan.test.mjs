import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

// Resolve relative to this file so the test works from any cwd, including `bun test` inside tools/meta-mode.
const script = fileURLToPath(new URL("./check-plan.mjs", import.meta.url));
const playbook = readFileSync(fileURLToPath(new URL("../../skills/meta-mode/playbooks/multi-phase-plan.md", import.meta.url)), "utf8").replaceAll("\r\n", "\n");
const skeleton = playbook.match(/^````markdown\n([\s\S]*?)^````$/m)?.[1];
assert.ok(skeleton, "the multi-phase playbook has no plan skeleton");

function run(plan) {
  const dir = mkdtempSync(join(tmpdir(), "mstack-check-plan-"));
  try {
    const file = join(dir, "plan.md");
    writeFileSync(file, plan);
    const result = spawnSync(process.execPath, [script, file], { encoding: "utf8" });
    return { code: result.status, out: `${result.stdout}${result.stderr}` };
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

// Replace the body of one heading's section, up to the next heading.
function editSection(heading, edit) {
  const start = skeleton.indexOf(`${heading}\n`) + heading.length;
  const end = skeleton.indexOf("\n#", start);
  return skeleton.slice(0, start) + edit(skeleton.slice(start, end)) + skeleton.slice(end);
}

test("the shipped skeleton passes, checked or not", () => {
  const result = run(skeleton);
  assert.equal(result.code, 0, result.out);
  assert.match(result.out, /1 PR sections, 0 problems/);
  assert.equal(run(skeleton.replaceAll("- [ ]", "- [x]")).code, 0);
});

test("a plan saved with a UTF-8 byte-order mark passes, with or without frontmatter", () => {
  for (const plan of [`\uFEFF${skeleton}`, `\uFEFF---\ntitle: Plan\n---\n${skeleton}`]) {
    const result = run(plan);
    assert.equal(result.code, 0, result.out);
  }
});

test("a CRLF plan passes", () => {
  const result = run(skeleton.replaceAll("\n", "\r\n"));
  assert.equal(result.code, 0, result.out);
});

for (const heading of ["### Arm the program", "### Spawn owners", "### PR mechanics", "### Verdict and merge", "### Boot recipe"]) {
  test(`${heading} needs a box, not only prose`, () => {
    const start = skeleton.indexOf(heading);
    assert.notEqual(start, -1, `${heading} is not in the skeleton`);
    const result = run(editSection(skeleton.slice(start).split("\n")[0], (body) => body.replaceAll("- [ ] ", "")));
    assert.equal(result.code, 1);
    assert.match(result.out, new RegExp(`${heading.slice(4)}.* has no box`));
  });
}

test("Close the program needs a box", () => {
  const result = run(editSection("## Close the program", () => "\n"));
  assert.equal(result.code, 1);
  assert.match(result.out, /Close the program has no box/);
});

test("boxes inside an example fence cannot stand in for program tasks", () => {
  const result = run(editSection("### Spawn owners", (body) => `\n\`\`\`markdown\n${body}\n\`\`\`\n`));
  assert.equal(result.code, 1);
  assert.match(result.out, /Spawn owners has no box/);
});

// An example fence hides its contents from the prose rules, whatever delimiter spelling opens it.
for (const [name, open, inner, close] of [
  ["backticks", "```yaml", "message: “code”", "```"],
  ["tildes", "~~~yaml", "message: “code”", "~~~"],
  ["longer outer backticks", "````markdown", "```yaml\nmessage: “code”\n```", "````"],
  ["longer outer tildes", "~~~~markdown", "~~~yaml\nmessage: “code”\n~~~", "~~~~"],
  ["different inner delimiter", "```markdown", "~~~yaml\nmessage: “code”\n~~~", "```"],
  ["indented delimiter", "   ~~~yaml", "message: “code”", "   ~~~"],
  ["longer closing delimiter", "~~~yaml", "message: “code”", "~~~~"],
  ["inner text after a backtick run", "```text", "```still code\nmessage: “code”", "```"],
]) {
  test(`fenced example with ${name} is skipped, prose after it is not`, () => {
    const example = `\n${open}\n${inner}\n## Example heading\n${close}\n`;
    const accepted = run(skeleton + example);
    assert.equal(accepted.code, 0, accepted.out);
    const rejected = run(`${skeleton}${example}Prose: “invalid”\n`);
    assert.equal(rejected.code, 1);
    assert.match(rejected.out, /curly quote/);
    assert.match(rejected.out, /mid-sentence colon/);
  });
}

// CommonMark allows at most three spaces before a fence. Four make an indented code block, so the line is
// not a fence delimiter: it neither opens a fence that hides the prose after it nor closes one.
test("a fence indented four spaces does not open an example", () => {
  const result = run(`${skeleton}\n    ~~~yaml\nmessage: “code”\n    ~~~\n`);
  assert.equal(result.code, 1);
  assert.match(result.out, /curly quote/);
});

test("a closing delimiter indented four spaces does not close the example", () => {
  const result = run(`${skeleton}\n\`\`\`yaml\nmessage: “code”\n    \`\`\`\nstill inside: “code”\n\`\`\`\n`);
  assert.equal(result.code, 0, result.out);
});

for (const marker of ["program objective", "every hour"]) {
  test(`the program checklist must keep "${marker}"`, () => {
    assert.ok(skeleton.includes(marker), `the shipped skeleton lacks "${marker}"`);
    const result = run(skeleton.replaceAll(marker, "removed"));
    assert.equal(result.code, 1);
    assert.match(result.out, new RegExp(`Program checklist lacks "${marker}"`));
  });
}
