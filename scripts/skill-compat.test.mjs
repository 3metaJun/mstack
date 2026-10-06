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
  ["valid empty value followed by block", "name: tdd\ndescription:\n  Use when: a bug", 0],
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
