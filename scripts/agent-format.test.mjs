import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import test from "node:test";
import { convertAgentMarkdown } from "./agent-format.mjs";

function markdown(frontmatter, body = "Review the supplied files.\n") {
  return `---\n${frontmatter}\n---\n${body}`;
}

test("converts plain, JSON double-quoted and YAML single-quoted agent metadata", () => {
  assert.equal(
    convertAgentMarkdown(markdown("name: reviewer # routing name\ndescription: 'Don''t skip # details'"), "agent.md"),
    'name = "reviewer"\ndescription = "Don\'t skip # details"\ndeveloper_instructions = "Review the supplied files.\\n"\n',
  );
  assert.equal(
    convertAgentMarkdown(markdown('name: "reviewer" # routing name\ndescription: "Read \\"quoted\\" paths: C:\\\\work"'), "agent.md"),
    'name = "reviewer"\ndescription = "Read \\"quoted\\" paths: C:\\\\work"\ndeveloper_instructions = "Review the supplied files.\\n"\n',
  );
});

test("preserves CRLF body whitespace, Unicode, and control characters in valid TOML escapes", () => {
  const source = '---\r\nname: reviewer\r\ndescription: "Unicode \\u4e2d \\ud83d\\ude00 and newline\\n"\r\n---\r\n\r\n  body\t\u007f\u0000\r\n';
  assert.equal(
    convertAgentMarkdown(source, "agent.md"),
    'name = "reviewer"\ndescription = "Unicode 中 😀 and newline\\n"\ndeveloper_instructions = "\\r\\n  body\\t\\u007f\\u0000\\r\\n"\n',
  );
});

test("rejects malformed metadata without reading a following field as its value", () => {
  const cases = [
    ["name:\ndescription: valid", /name must be a non-empty string/],
    ["name: # empty\ndescription: valid", /name must be a non-empty string/],
    ['name: ""\ndescription: valid', /name must be a non-empty string/],
    ["name: reviewer\nname: other\ndescription: valid", /duplicate.*name/],
    ["name: reviewer", /missing description/],
    ["description: valid", /missing name/],
    ["name: reviewer\ndescription: |\n  detail", /unsupported.*syntax/],
    ["name: reviewer\ndescription: >\n  detail", /unsupported.*syntax/],
    ["name: reviewer\ndescription: [one, two]", /unsupported.*syntax/],
    ["name: reviewer\ndescription: {text: value}", /unsupported.*syntax/],
    ["name: reviewer\ndescription: &description text", /unsupported.*syntax/],
    ["name: reviewer\ndescription: *description", /unsupported.*syntax/],
    ["name: reviewer\ndescription: !!str value", /unsupported.*syntax/],
    ["name: reviewer\ndescription: text: value", /unsupported.*syntax/],
    ["name: reviewer\ndescription: valid\n  nested: value", /unsupported.*line/],
    ["name:reviewer\ndescription: valid", /unsupported.*line/],
    ["name: reviewer\ndescription: valid\nmodel: custom", /unsupported.*field model/],
    ['name: reviewer\ndescription: "bad\\escape"', /valid.*double-quoted string/],
    ['name: reviewer\ndescription: "unfinished', /valid.*double-quoted string/],
    ["name: reviewer\ndescription: 'Don't'", /invalid single-quoted string/],
    ['name: reviewer\ndescription: "valid" trailing', /valid.*double-quoted string/],
  ];
  for (const [frontmatter, expected] of cases) {
    assert.throws(() => convertAgentMarkdown(markdown(frontmatter), "broken.md"), (error) => {
      assert.match(error.message, /^broken\.md:/);
      assert.match(error.message, expected);
      return true;
    });
  }
  for (const scalar of ["123", "true", "false", "null", "~", ".nan", "0x12", "1.5e3"]) {
    assert.throws(() => convertAgentMarkdown(markdown(`name: ${scalar}\ndescription: valid`), "broken.md"), /must be a string/);
  }
});

test("rejects missing frontmatter, empty body, and unpaired Unicode surrogates", () => {
  assert.throws(() => convertAgentMarkdown("# No metadata", "broken.md"), /no complete frontmatter/);
  assert.throws(() => convertAgentMarkdown(markdown("name: reviewer\ndescription: valid", " \n"), "broken.md"), /body must be non-empty/);
  for (const invalid of ["\ud800", "\udfff"]) {
    assert.throws(() => convertAgentMarkdown(markdown("name: reviewer\ndescription: valid", invalid), "broken.md"), /body contains an unpaired Unicode surrogate/);
    assert.throws(() => convertAgentMarkdown(markdown(`name: reviewer\ndescription: "${invalid}"`), "broken.md"), /description contains an unpaired Unicode surrogate/);
  }
});

test("round-trips actual agent files and escaped strings through Python's standard TOML parser", (t) => {
  const candidates = process.platform === "win32" ? ["python", "python3"] : ["python3", "python"];
  const python = candidates.find((command) => spawnSync(command, ["-c", "import tomllib"], { encoding: "utf8" }).status === 0);
  if (!python) return t.skip("Python 3.11+ with tomllib is unavailable; literal conversion assertions still run");
  const fixtures = [
    ["comment-reviewer.md", "comment-reviewer"],
    ["meta-agent.md", "meta-agent"],
  ].map(([file, name]) => {
    const source = readFileSync(new URL(`../agents/${file}`, import.meta.url), "utf8");
    const frontmatter = source.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
    return {
      toml: convertAgentMarkdown(source, file),
      expected: {
        name,
        description: frontmatter[1].split(/\r?\n/).find((line) => line.startsWith("description: ")).slice("description: ".length),
        developer_instructions: source.slice(frontmatter[0].length),
      },
    };
  });
  const description = 'Quoted "paths": C:\\work, 中文 😀, newline\n';
  const body = `  All controls: ${Array.from({ length: 32 }, (_, index) => String.fromCharCode(index)).join("")}\u007f\r\nUnicode 中文 😀\n`;
  fixtures.push({
    toml: convertAgentMarkdown(markdown(`name: reviewer\ndescription: ${JSON.stringify(description)}`, body), "escaped.md"),
    expected: { name: "reviewer", description, developer_instructions: body },
  });
  const result = spawnSync(python, ["-c", "import json, sys, tomllib; fixtures = json.load(sys.stdin); [None if tomllib.loads(f['toml']) == f['expected'] else sys.exit('TOML round-trip mismatch') for f in fixtures]"], {
    input: JSON.stringify(fixtures),
    encoding: "utf8",
  });
  assert.equal(result.status, 0, result.stderr);
});
