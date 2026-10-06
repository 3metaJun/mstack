import assert from "node:assert/strict";
import test from "node:test";
import { skillCompatProblems } from "./skill-compat-lib.mjs";

const cases = [
  ["valid plain", "name: meta-mode\ndescription: Route a task through a workflow.", 0],
  ["valid plain with colon inside a word", "name: a\ndescription: See http://example.com/x or a:b", 0],
  ["valid double-quoted", 'name: tdd\ndescription: "Use when: a bug has a test, # not a comment"', 0],
  ["valid single-quoted", "name: tdd\ndescription: 'Use when: a bug'", 0],
  ["valid block scalar", "name: tdd\ndescription: >\n  Use when: a bug", 0],
  ["valid literal block", "name: tdd\ndescription: |-\n  Use when: a bug", 0],
  ["valid multiline plain string", "name: tdd\ndescription: Use for bugs\n  when a test fails\n  or a regression appears", 0],
  ["valid multiline plain string starting on the next line", "name: tdd\ndescription:\n  Use for bugs\n  when a test fails", 0],
  ["valid multiline plain string with CRLF", "name: tdd\r\ndescription: Use for bugs\r\n  when a test fails\r\n", 0],
  ["valid hyphen, question mark and colon without a separator", "name: tdd\ndescription: -fast ?maybe :colon a-b", 0],
  ["valid NBSP after a colon", "name: tdd\ndescription: Use when: a bug", 0],
  ["valid NBSP before a hash", "name: tdd\ndescription: Use for bugs #urgent", 0],
  ["valid ideographic space around a colon and hash", "name: tdd\ndescription: Use when:　a bug 　#x", 0],
  ["valid next field after a multiline value", "name: tdd\ndescription: Use for bugs\n  when a test fails\nmetadata:\n  a: b", 0],
  ["nested mapping as description", "name: tdd\ndescription:\n  Use when: a bug", 1, /description contains ': '/],
  ["sequence as description", "name: tdd\ndescription:\n  - Run tests", 1, /starts with YAML indicator -/],
  ["leading hyphen separator", "name: tdd\ndescription: - Run tests", 1, /starts with YAML indicator -/],
  ["leading hyphen separator with CRLF", "name: tdd\r\ndescription: - Run tests\r\n", 1, /starts with YAML indicator -/],
  ["leading hyphen separator with a tab", "name: tdd\ndescription: -\tRun tests", 1, /starts with YAML indicator -/],
  ["leading question mark separator", "name: tdd\ndescription: ? Run tests", 1, /starts with YAML indicator \?/],
  ["leading colon separator", "name: tdd\ndescription: : Run tests", 1, /starts with YAML indicator :/],
  ["lone leading hyphen", "name: tdd\ndescription: -", 1, /starts with YAML indicator -/],
  ["leading flow closer", "name: tdd\ndescription: ] Run tests", 1, /starts with YAML indicator \]/],
  ["colon continuation line", "name: tdd\ndescription: Use for bugs\n  Use when: a test fails", 1, /description contains ': '/],
  ["colon continuation line with CRLF", "name: tdd\r\ndescription: Use for bugs\r\n  Use when: a test fails\r\n", 1, /description contains ': '/],
  ["trailing colon on a continuation line", "name: tdd\ndescription: Use for bugs\n  Use when:\n  a test fails", 1, /description contains ': '/],
  ["hash continuation line", "name: tdd\ndescription: Use for bugs\n  when a test fails #urgent", 1, /description contains ' #'/],
  ["comment-only continuation line", "name: tdd\ndescription: Use for bugs\n  # note\n  when a test fails", 1, /description contains ' #'/],
  ["tab separator before a hash", "name: tdd\ndescription: Use for bugs\t#urgent", 1, /description contains ' #'/],
  ["tab separator after a colon", "name: tdd\ndescription: Use when:\ta bug", 1, /description contains ': '/],
  ["plain with ': '", "name: tdd\ndescription: Use when: a bug", 1, /description contains ': '/],
  ["plain with trailing colon", "name: tdd\ndescription: Use for bugs:", 1, /description contains ': '/],
  ["plain with ' #'", "name: tdd\ndescription: Use for bugs #urgent", 1, /description contains ' #'/],
  ["plain with leading bracket", "name: tdd\ndescription: [draft] Use for bugs", 1, /starts with YAML indicator \[/],
  ["plain with leading backtick", "name: tdd\ndescription: `tdd` helper", 1, /starts with YAML indicator `/],
  ["plain with leading star", "name: tdd\ndescription: *important* bugs", 1, /starts with YAML indicator \*/],
  ["plain name with ': '", "name: a: b\ndescription: ok", 2, /name contains ': '/],
  ["name with space", "name: my skill\ndescription: ok", 1, /name my skill does not match/],
  ["name with dot", "name: my.skill\ndescription: ok", 1, /does not match/],
  ["name starting with hyphen", "name: -skill\ndescription: ok", 1, /does not match/],
  ["name without a letter", "name: 123\ndescription: ok", 1, /does not match/],
  ["quoted name that violates the pattern", 'name: "my skill"\ndescription: ok', 1, /does not match/],
  ["valid name with colon and underscore", "name: plugin:my_skill-2\ndescription: ok", 0],
];

for (const [label, frontmatter, count, pattern] of cases) {
  test(`skill compat: ${label}`, () => {
    const problems = skillCompatProblems(frontmatter);
    assert.equal(problems.length, count, problems.join("\n"));
    if (pattern) assert.match(problems.join("\n"), pattern);
  });
}
