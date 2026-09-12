import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { validateArtifactOverrides } from "./install-paths.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = join(repoRoot, "skills");
const EXPECTED_SKILLS = JSON.parse(readFileSync(join(repoRoot, "profiles", "skills.json"), "utf8")).skills;
const artifactsProfilePath = join(repoRoot, "profiles", "artifacts.json");
const harnesses = Object.keys(JSON.parse(readFileSync(join(repoRoot, "profiles", "harnesses.json"), "utf8")));

const errors = [];

try {
  const profile = JSON.parse(readFileSync(artifactsProfilePath, "utf8"));
  if (!profile.artifacts || typeof profile.artifacts !== "object" || Array.isArray(profile.artifacts)) {
    errors.push("profiles/artifacts.json must define an artifacts object");
  } else {
    for (const [name, artifact] of Object.entries(profile.artifacts)) {
      if (!artifact || typeof artifact !== "object" || Array.isArray(artifact)) {
        errors.push(`artifact ${name} must be an object`);
        continue;
      }
      if (typeof artifact.source !== "string" || !artifact.source) {
        errors.push(`artifact ${name} is missing source`);
      } else {
        const source = resolve(repoRoot, artifact.source);
        if (!source.startsWith(`${repoRoot}${sep}`) || !existsSync(source)) {
          errors.push(`artifact ${name} source is outside the repository or missing: ${artifact.source}`);
        }
      }
      if (artifact.installable !== false) {
        try {
          validateArtifactOverrides(name, artifact, harnesses);
        } catch (error) {
          errors.push(error.message);
        }
      } else if (typeof artifact.reason !== "string" || !artifact.reason) {
        errors.push(`unsupported artifact ${name} must explain its reason`);
      }
    }
  }
  const unsupported = profile.unsupported;
  for (const name of ["commands", "hooks", "settings", "automations"]) {
    if (typeof unsupported?.[name] !== "string" || !unsupported[name]) {
      errors.push(`profiles/artifacts.json must document unsupported ${name}`);
    }
  }
} catch (error) {
  errors.push(`invalid profiles/artifacts.json: ${error.message}`);
}
const actual = readdirSync(skillsRoot, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => entry.name)
  .sort();

if (JSON.stringify(actual) !== JSON.stringify(EXPECTED_SKILLS)) {
  errors.push(`skill inventory mismatch\nexpected: ${EXPECTED_SKILLS.join(", ")}\nactual: ${actual.join(", ")}`);
}

const forbidden = [
  /disable-model-invocation:/i,
  /\bTask tool\b/i,
  /\brun_in_background\b/i,
  /\bsubagent_type\b/i,
  /\bAskQuestion\b/i,
];

const adapterAllowedFields = new Set(["compatibility", "metadata"]);
const adapterRemovableFields = new Set(["metadata"]);

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

for (const harness of harnesses) {
  const adapterPath = join(repoRoot, "adapters", `${harness}.json`);
  try {
    const adapter = JSON.parse(readFileSync(adapterPath, "utf8"));
    for (const [skill, fields] of Object.entries(adapter.removeFrontmatter ?? {})) {
      if (!EXPECTED_SKILLS.includes(skill)) errors.push(`${harness} adapter removes fields from unknown skill ${skill}`);
      if (!Array.isArray(fields)) errors.push(`${harness} adapter removeFrontmatter for ${skill} must be an array`);
      else for (const field of fields) {
        if (!adapterRemovableFields.has(field) || (harness === "codex" && field !== "metadata")) {
          errors.push(`${harness} adapter may not remove frontmatter field ${field}`);
        }
      }
    }
    for (const [skill, fields] of Object.entries(adapter.frontmatter ?? {})) {
      if (!EXPECTED_SKILLS.includes(skill)) errors.push(`${harness} adapter references unknown skill ${skill}`);
      for (const field of Object.keys(fields)) {
        if (!adapterAllowedFields.has(field) || (harness === "codex" && field !== "metadata")) {
          errors.push(`${harness} adapter uses unsupported field ${field}`);
        }
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
  if (manifest.name !== "mstack") errors.push("plugin manifest has the wrong name");
  if (manifest.skills !== "./skills/") errors.push("plugin manifest does not expose ./skills/");
} catch (error) {
  errors.push(`invalid plugin manifest: ${error.message}`);
}

function walk(directory) {
  return readdirSync(directory).flatMap((name) => {
    if (name === "node_modules" || (directory === repoRoot && (name === ".git" || name === ".audit"))) {
      return [];
    }
    const path = join(directory, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

for (const file of walk(skillsRoot)) {
  const content = readFileSync(file, "utf8");
  const compatibilityReference = file === join(skillsRoot, "create-verification-skill", "references", "harness-paths.md");
  if (!compatibilityReference && /\.cursor[\\/]skills/i.test(content)) {
    errors.push(`${relative(repoRoot, file)} contains a native skill path outside the compatibility reference`);
  }
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
  /[A-Za-z]:\\Users\\[^\\/\r\n]+/i,
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
