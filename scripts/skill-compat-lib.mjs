// T3 Code lists skills discovered by each provider. Cursor's and Antigravity's
// scanners drop a skill whose frontmatter fails YAML parsing, and T3's composer
// only forms a skill chip for names matching the pattern below. Keep these
// checks dependency-free: they inspect only the scalar forms a skill description
// or name can take (plain, quoted, block), not YAML in general.
//
// YAML separation whitespace is space and tab only, so every check below uses
// [ \t] and never \s (which also matches NBSP and other Unicode spaces that are
// ordinary plain-scalar text).
//
// Deliberately stricter than YAML: ` #` inside a plain scalar is a valid comment,
// not a parse error, but it silently truncates the value. A truncated
// description misroutes the skill, so it is rejected like a parse failure.

const T3_SKILL_NAME = /^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/;
const PLAIN_SCALAR_FIELDS = ["name", "description"];
// Indicators that can never start a plain scalar (quote and block forms are handled separately).
const ALWAYS_INDICATORS = new Set(["[", "]", "{", "}", ",", "&", "*", "!", "%", "@", "`"]);
// `-`, `?` and `:` are indicators only when followed by a separator.
const CONDITIONAL_INDICATORS = /^[-?:]([ \t]|$)/;
// Block scalar header: indentation and chomping indicators only, then an optional comment.
const BLOCK_HEADER = /^[|>](?:[1-9][+-]?|[+-][1-9]?)?(?:[ \t]+#.*)?$/;
const COMMENT_TAIL = /^(?:[ \t]+#.*)?[ \t]*$/;
const BLANK_OR_COMMENT_LINE = /^[ \t]*(?:#.*)?$/;
const QUOTE_REMEDY = "quote the value";

const trimSeparators = (text) => text.replace(/^[ \t]+|[ \t]+$/g, "");

/** Reads a top-level field: its same-line value and any indented continuation lines. */
function readField(lines, field) {
  const start = lines.findIndex((line) => new RegExp(`^${field}:([ \\t]|$)`).test(line));
  if (start === -1) return undefined;
  let first = trimSeparators(lines[start].slice(field.length + 1));
  if (first.startsWith("#")) first = ""; // the whole remainder is a comment
  const continuation = [];
  for (const line of lines.slice(start + 1)) {
    if (line.trim() === "") continue;
    if (!/^[ \t]/.test(line)) break;
    continuation.push(line);
  }
  return { first, continuation };
}

/** Parses a quoted scalar that may continue onto indented lines. */
function inspectQuoted(text) {
  const quote = text[0];
  let close = -1;
  for (let i = 1; i < text.length && close === -1; i++) {
    if (quote === '"' && text[i] === "\\") i++;
    else if (text[i] === quote) {
      if (quote === "'" && text[i + 1] === "'") i++;
      else close = i;
    }
  }
  if (close === -1) return { problem: `has an unterminated ${quote === '"' ? "double" : "single"}-quoted scalar` };
  const [sameLine, ...later] = text.slice(close + 1).split("\n");
  if (!COMMENT_TAIL.test(sameLine) || !later.every((line) => BLANK_OR_COMMENT_LINE.test(line))) {
    return { problem: `has content after the closing ${quote}` };
  }
  const inner = text.slice(1, close);
  return { value: quote === "'" ? inner.replaceAll("''", "'") : inner };
}

function inspectPlain(lines) {
  const head = trimSeparators(lines[0]);
  if (ALWAYS_INDICATORS.has(head[0]) || CONDITIONAL_INDICATORS.test(head)) {
    return { problem: `starts with YAML indicator ${head[0]}; ${QUOTE_REMEDY}` };
  }
  const value = lines.map(trimSeparators).join(" ");
  for (const line of lines) {
    if (/:([ \t]|$)/.test(trimSeparators(line))) {
      return { value, problem: `contains ': ' (invalid in a plain YAML scalar); ${QUOTE_REMEDY}` };
    }
    // Includes an indented `#` line inside a multiline plain scalar.
    if (/(^|[ \t])#/.test(line)) {
      return { value, problem: `contains ' #', which starts a YAML comment and truncates the value; ${QUOTE_REMEDY}` };
    }
  }
  return { value };
}

/** Returns `{ problem }` and/or the scalar's string `value` when it can be determined. */
function inspectField(field) {
  const lines = [field.first, ...field.continuation].filter((line) => trimSeparators(line) !== "");
  if (lines.length === 0) return { problem: "is empty or comment-only (YAML null)" };
  const head = trimSeparators(lines[0]);
  if (/^[|>]/.test(head)) {
    return BLOCK_HEADER.test(head) ? {} : { problem: `has an invalid block scalar header ${head}` };
  }
  if (/^["']/.test(head)) return inspectQuoted(lines.map(trimSeparators).join("\n"));
  return inspectPlain(lines);
}

/**
 * Returns problems that make T3-hosted providers drop or fail to chip a skill.
 * Well-formed quoted and block scalars are accepted as written.
 */
export function skillCompatProblems(frontmatter) {
  const lines = frontmatter.split(/\r?\n/);
  const problems = [];
  for (const fieldName of PLAIN_SCALAR_FIELDS) {
    const field = readField(lines, fieldName);
    if (!field) continue;
    const { problem, value } = inspectField(field);
    if (problem) problems.push(`${fieldName} ${problem}`);
    if (fieldName === "name" && value && (!T3_SKILL_NAME.test(value) || !/[a-zA-Z]/.test(value))) {
      problems.push(`name ${value} does not match the T3 skill chip pattern ${T3_SKILL_NAME}`);
    }
  }
  return problems;
}
