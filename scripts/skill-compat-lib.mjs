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
// A leading `|` or `>` is a block header, handled before the plain-scalar check; otherwise invalid.
const ALWAYS_INDICATORS = new Set(["[", "]", "{", "}", ",", "&", "*", "!", "%", "@", "`", "|", ">"]);
// `-`, `?` and `:` are indicators only when followed by a separator.
const CONDITIONAL_INDICATORS = /^[-?:]([ \t]|$)/;
// Block scalar header: indentation and chomping indicators only, then an optional comment.
const BLOCK_HEADER = /^[|>](?:[1-9][+-]?|[+-][1-9]?)?(?:[ \t]+#.*)?$/;
// YAML 1.2 double-quoted escapes. A backslash before a newline is a line continuation.
const SIMPLE_ESCAPES = '0abtnvfre \t"/\\N_LP\n';
const HEX_ESCAPES = { x: 2, u: 4, U: 8 };
const COMMENT_TAIL = /^(?:[ \t]+#.*)?[ \t]*$/;
const BLANK_OR_COMMENT_LINE = /^[ \t]*(?:#.*)?$/;
const QUOTE_REMEDY = "quote the value";

const isCommentLine = (line) => /^[ \t]*#/.test(line);
const trimSeparators =(text) => text.replace(/^[ \t]+|[ \t]+$/g, "");

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
    if (quote === '"' && text[i] === "\\") {
      const escape = text[i + 1];
      if (escape === undefined) break; // unterminated
      const digits = HEX_ESCAPES[escape];
      if (digits !== undefined) {
        if (!new RegExp(`^[0-9a-fA-F]{${digits}}$`).test(text.slice(i + 2, i + 2 + digits))) {
          return { problem: `has an invalid escape \\${escape} (needs ${digits} hex digits)` };
        }
        i += 1 + digits;
      } else if (SIMPLE_ESCAPES.includes(escape)) i++;
      else return { problem: `has an invalid escape \\${escape}; double-quoted YAML allows only the YAML 1.2 escapes` };
    } else if (text[i] === quote) {
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

/** Checks a block scalar header and that its body is indented under the (indent 0) key. */
function inspectBlock({ first, continuation }) {
  if (!BLOCK_HEADER.test(first)) return { problem: `has an invalid block scalar header ${first}` };
  if (continuation.length === 0) return { problem: "has an empty block scalar body" };
  const indicators = first.match(/^[|>]([1-9+-]*)/)[1];
  const explicit = Number(indicators.match(/[1-9]/)?.[0] ?? 0);
  const indents = continuation.map((line) => line.match(/^ */)[0].length);
  // Without an indentation indicator YAML takes the first body line's indent.
  const required = Math.max(explicit || indents[0], 1);
  const end = indents.findIndex((indent) => indent < required);
  if (end === -1) return {};
  // A line below the body's indent ends the scalar. Only comments may follow it,
  // and a comment-only line there is not body text.
  if (end > 0 && continuation.slice(end).every(isCommentLine)) return {};
  return { problem: `has a block scalar body line indented less than ${required} space(s)` };
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
function inspectField({ first, continuation: rawContinuation }) {
  // Comment lines between the key and its value are not part of the value.
  const valueStart = rawContinuation.findIndex((line) => !isCommentLine(line));
  const continuation = first === "" ? (valueStart === -1 ? [] : rawContinuation.slice(valueStart)) : rawContinuation;
  const lines = [first, ...continuation].filter((line) => trimSeparators(line) !== "");
  if (lines.length === 0) return { problem: "is empty or comment-only (YAML null)" };
  const head = trimSeparators(lines[0]);
  // A block header is the value itself, either after the key or on the next value-bearing line.
  if (/^[|>]/.test(first)) return inspectBlock({ first, continuation });
  if (first === "" && /^[|>]/.test(head)) {
    return inspectBlock({ first: head, continuation: continuation.slice(1) });
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
