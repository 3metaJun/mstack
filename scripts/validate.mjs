import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = join(repoRoot, "skills");
const EXPECTED_SKILLS = [
  "blast-radius",
  "codebase-design",
  "create-verification-skill",
  "diagnosing-bugs",
  "principle-boundary-discipline",
  "principle-build-the-lever",
  "principle-fix-root-causes",
  "principle-make-operations-idempotent",
  "principle-model-the-domain",
  "principle-prove-it-works",
  "principle-separate-before-serializing-shared-state",
  "principle-sequence-verifiable-units",
  "principle-type-system-discipline",
  "recall",
  "show-me-your-work",
  "tdd",
  "typescript-best-practices",
  "writing-for-agents",
].sort();

const errors = [];
const actual = readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (JSON.stringify(actual) !== JSON.stringify(EXPECTED_SKILLS)) {
  errors.push(`skill inventory mismatch\nexpected: ${EXPECTED_SKILLS.join(", ")}\nactual: ${actual.join(", ")}`);
}

const forbidden = [
  /\.cursor[\\/]skills/i,
  /disable-model-invocation:/i,
  /\bTask tool\b/i,
  /\brun_in_background\b/i,
  /\bsubagent_type\b/i,
  /\bAskQuestion\b/i,
];

const adapterAllowedFields = {
  codex: new Set(["metadata"]),
  claude: new Set(["compatibility", "metadata"]),
  opencode: new Set(["compatibility", "metadata"]),
};
const adapterRemovableFields = {
  codex: new Set(),
  claude: new Set(["metadata"]),
  opencode: new Set(["metadata"]),
};

for (const skill of actual) {
  const path = join(skillsRoot, skill, "SKILL.md");
  if (!existsSync(path)) {
    errors.push(`${skill}: missing SKILL.md`);
    continue;
  }
  const content = readFileSync(path, "utf8");
  const frontmatter = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!frontmatter) {
    errors.push(`${skill}: missing YAML frontmatter`);
    continue;
  }
  const name = frontmatter[1].match(/^name:\s*([^\r\n]+)$/m)?.[1]?.trim();
  const description = frontmatter[1].match(/^description:\s*(.+)$/m)?.[1]?.trim();
  if (name !== skill) errors.push(`${skill}: frontmatter name is ${name ?? "missing"}`);
  if (!description) errors.push(`${skill}: missing description`);
  for (const match of content.matchAll(/\[[^\]]+\]\((?!https?:|#)([^)]+)\)/g)) {
    const linked = resolve(dirname(path), match[1]);
    if (!existsSync(linked)) errors.push(`${skill}: broken relative link ${match[1]}`);
  }
}

for (const [harness, allowedFields] of Object.entries(adapterAllowedFields)) {
  const adapterPath = join(repoRoot, "adapters", `${harness}.json`);
  try {
    const adapter = JSON.parse(readFileSync(adapterPath, "utf8"));
    for (const [skill, fields] of Object.entries(adapter.removeFrontmatter ?? {})) {
      if (!EXPECTED_SKILLS.includes(skill)) errors.push(`${harness} adapter removes fields from unknown skill ${skill}`);
      if (!Array.isArray(fields)) errors.push(`${harness} adapter removeFrontmatter for ${skill} must be an array`);
      else for (const field of fields) {
        if (!adapterRemovableFields[harness].has(field)) {
          errors.push(`${harness} adapter may not remove frontmatter field ${field}`);
        }
      }
    }
    for (const [skill, fields] of Object.entries(adapter.frontmatter ?? {})) {
      if (!EXPECTED_SKILLS.includes(skill)) errors.push(`${harness} adapter references unknown skill ${skill}`);
      for (const field of Object.keys(fields)) {
        if (!allowedFields.has(field)) errors.push(`${harness} adapter uses unsupported field ${field}`);
      }
    }
  } catch (error) {
    errors.push(`invalid ${harness} adapter: ${error.message}`);
  }
}

const showWorkContent = readFileSync(join(skillsRoot, "show-me-your-work", "SKILL.md"), "utf8");
const showWorkBody = showWorkContent.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n/, "");
if (/requires? Node\.js|Node\.js .*required/i.test(showWorkBody)) {
  errors.push("show-me-your-work leaks its runtime requirement into the skill body");
}

const manifestPath = join(repoRoot, ".codex-plugin", "plugin.json");
try {
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  if (manifest.name !== "harness-skills") errors.push("plugin manifest has the wrong name");
  if (manifest.skills !== "./skills/") errors.push("plugin manifest does not expose ./skills/");
} catch (error) {
  errors.push(`invalid plugin manifest: ${error.message}`);
}

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    if (directory === repoRoot && name === ".git") return [];
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

for (const file of walk(skillsRoot)) {
  const content = readFileSync(file, "utf8");
  if (file.endsWith(".md") && content.includes(String.fromCodePoint(0xfffd))) {
    errors.push(`${relative(repoRoot, file)} contains a replacement character`);
  }
  for (const pattern of forbidden) {
    if (pattern.test(content)) {
      errors.push(`${relative(repoRoot, file)} contains forbidden Cursor-specific pattern ${pattern}`);
    }
  }
}

const privateMarkers = [
  /-----BEGIN (?:RSA |EC |OPENSSH )?PRIVATE KEY-----/,
  /C:\\Users\\\d+/i,
  /\/home\/[A-Za-z0-9._-]+\/\.codex\/sessions\//,
  /\b100\.(?:64|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}\b/,
];
for (const file of walk(repoRoot)) {
  const content = readFileSync(file, "utf8");
  for (const pattern of privateMarkers) {
    if (pattern.test(content)) errors.push(`${relative(repoRoot, file)} contains private-data marker ${pattern}`);
  }
}

if (errors.length) {
  console.error(errors.map((error) => `- ${error}`).join("\n"));
  process.exit(1);
}

console.log(`Validated ${actual.length} portable skills.`);
