// T3 Code lists skills discovered by each provider. Cursor's and Antigravity's
// scanners drop a skill whose frontmatter fails YAML parsing, and T3's composer
// only forms a skill chip for names matching the pattern below. Keep these
// checks dependency-free: they flag only plain scalars that are invalid YAML.
//
// YAML separation whitespace is space and tab only, so every check below uses
// [ \t] and never \s (which also matches NBSP and other Unicode spaces that are
// ordinary plain-scalar text).

const T3_SKILL_NAME = /^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/;
const PLAIN_SCALAR_FIELDS = ["name", "description"];
// Indicators that can never start a plain scalar (quote and block forms are handled earlier).
const ALWAYS_INDICATORS = new Set(["[", "]", "{", "}", ",", "&", "*", "!", "%", "@", "`"]);
// `-`, `?` and `:` are indicators only when followed by a separator.
const CONDITIONAL_INDICATORS = /^[-?:]([ \t]|$)/;

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

function plainScalarProblem(field) {
  const lines = [field.first, ...field.continuation].filter((line) => trimSeparators(line) !== "");
  if (lines.length === 0) return undefined;
  const head = trimSeparators(lines[0]);
  if (ALWAYS_INDICATORS.has(head[0]) || CONDITIONAL_INDICATORS.test(head)) {
    return `starts with YAML indicator ${head[0]}`;
  }
  for (const line of lines) {
    if (/:([ \t]|$)/.test(trimSeparators(line))) return "contains ': ' (invalid in a plain YAML scalar)";
    if (/(^|[ \t])#/.test(line)) return "contains ' #' (starts a YAML comment)";
  }
  return undefined;
}

/**
 * Returns problems that make T3-hosted providers drop or fail to chip a skill.
 * Quoted and block scalars are accepted as written.
 */
export function skillCompatProblems(frontmatter) {
  const lines = frontmatter.split(/\r?\n/);
  const problems = [];
  for (const fieldName of PLAIN_SCALAR_FIELDS) {
    const field = readField(lines, fieldName);
    if (!field || /^["'|>]/.test(field.first)) continue;
    const problem = plainScalarProblem(field);
    if (problem) problems.push(`${fieldName} ${problem}; quote it`);
  }
  const name = readField(lines, "name")?.first.replace(/^(["'])(.*)\1$/, "$2");
  if (name && (!T3_SKILL_NAME.test(name) || !/[a-zA-Z]/.test(name))) {
    problems.push(`name ${name} does not match the T3 skill chip pattern ${T3_SKILL_NAME}`);
  }
  return problems;
}
