// T3 Code lists skills discovered by each provider. Cursor's and Antigravity's
// scanners drop a skill whose frontmatter fails YAML parsing, and T3's composer
// only forms a skill chip for names matching the pattern below. Keep these
// checks dependency-free: they flag only plain scalars that are invalid YAML.

const T3_SKILL_NAME = /^[a-zA-Z0-9][a-zA-Z0-9:_-]*$/;
const PLAIN_SCALAR_FIELDS = ["name", "description"];
// YAML indicators that cannot start a plain scalar (quote and block forms are handled earlier).
const LEADING_INDICATORS = new Set(["[", "{", "&", "*", "!", "%", "@", "`"]);

function fieldValue(frontmatter, field) {
  return frontmatter.match(new RegExp(`^${field}:[ \\t]*(.*)$`, "m"))?.[1]?.trim();
}

function plainScalarProblem(value) {
  if (LEADING_INDICATORS.has(value[0])) return `starts with YAML indicator ${value[0]}`;
  if (/:(\s|$)/.test(value)) return "contains ': ' (invalid in a plain YAML scalar)";
  if (/\s#/.test(value)) return "contains ' #' (starts a YAML comment)";
  return undefined;
}

/**
 * Returns problems that make T3-hosted providers drop or fail to chip a skill.
 * Quoted and block scalars are accepted as written.
 */
export function skillCompatProblems(frontmatter) {
  const problems = [];
  for (const field of PLAIN_SCALAR_FIELDS) {
    const raw = fieldValue(frontmatter, field);
    if (!raw || /^["'|>]/.test(raw)) continue;
    const problem = plainScalarProblem(raw);
    if (problem) problems.push(`${field} ${problem}; quote it`);
  }
  const name = fieldValue(frontmatter, "name")?.replace(/^(["'])(.*)\1$/, "$2");
  if (name && (!T3_SKILL_NAME.test(name) || !/[a-zA-Z]/.test(name))) {
    problems.push(`name ${name} does not match the T3 skill chip pattern ${T3_SKILL_NAME}`);
  }
  return problems;
}
