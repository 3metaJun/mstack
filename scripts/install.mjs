import {
  closeSync,
  cpSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  rmSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

if (Number.parseInt(process.versions.node, 10) < 18) {
  console.error("harness-skills requires Node.js 18 or newer");
  process.exit(1);
}

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceRoot = join(repoRoot, "skills");
const args = process.argv.slice(2);
const validHarnesses = ["codex", "claude", "opencode"];

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

if (args.includes("--help") || !args.includes("--harness")) {
  console.log(`Usage: node scripts/install.mjs --harness <codex|claude|opencode|all> [--skill <name[,name...]>] [--dry-run] [--replace]

Installs all or selected canonical skills into user-level harness directories.
Existing skill directories are preserved unless --replace is supplied.`);
  process.exit(args.includes("--help") ? 0 : 1);
}

const requested = valueAfter("--harness");
const requestedHarnesses = requested === "all" ? validHarnesses : requested?.split(",");
if (!requestedHarnesses?.length || requestedHarnesses.some((name) => !validHarnesses.includes(name))) {
  throw new Error(`Invalid --harness value: ${requested ?? "<missing>"}`);
}
if (new Set(requestedHarnesses).size !== requestedHarnesses.length) {
  throw new Error(`Duplicate harness in --harness: ${requested}`);
}

const harnesses = [...requestedHarnesses];
const dryRun = args.includes("--dry-run");
const replace = args.includes("--replace");
const userHome = homedir();

function expandHome(path) {
  if (path === "~") return userHome;
  if (/^~[\\/]/.test(path)) return join(userHome, path.slice(2));
  return path;
}

function configuredPath(value, fallback, label) {
  const expanded = expandHome(value ?? fallback);
  if (value && !isAbsolute(expanded)) {
    throw new Error(`${label} must be an absolute path or start with ~/`);
  }
  return resolve(expanded);
}

const targets = {
  codex: configuredPath(
    process.env.HARNESS_SKILLS_CODEX_DIR,
    join(userHome, ".agents", "skills"),
    "HARNESS_SKILLS_CODEX_DIR",
  ),
  claude: process.env.HARNESS_SKILLS_CLAUDE_DIR
    ? configuredPath(process.env.HARNESS_SKILLS_CLAUDE_DIR, "", "HARNESS_SKILLS_CLAUDE_DIR")
    : join(configuredPath(process.env.CLAUDE_CONFIG_DIR, join(userHome, ".claude"), "CLAUDE_CONFIG_DIR"), "skills"),
  opencode: process.env.HARNESS_SKILLS_OPENCODE_DIR
    ? configuredPath(process.env.HARNESS_SKILLS_OPENCODE_DIR, "", "HARNESS_SKILLS_OPENCODE_DIR")
    : join(configuredPath(process.env.XDG_CONFIG_HOME, join(userHome, ".config"), "XDG_CONFIG_HOME"), "opencode", "skills"),
};

const targetKeys = harnesses.map((harness) =>
  process.platform === "win32" ? targets[harness].toLowerCase() : targets[harness],
);
if (new Set(targetKeys).size !== targetKeys.length) {
  throw new Error("Selected harnesses resolve to the same target directory");
}

const adapters = Object.fromEntries(
  validHarnesses.map((harness) => [
    harness,
    JSON.parse(readFileSync(join(repoRoot, "adapters", `${harness}.json`), "utf8")),
  ]),
);

function renderFrontmatter(fields) {
  return Object.entries(fields).flatMap(([key, value]) => {
    if (typeof value === "string") return [`${key}: ${JSON.stringify(value)}`];
    if (value && typeof value === "object" && !Array.isArray(value)) {
      return [
        `${key}:`,
        ...Object.entries(value).map(([childKey, childValue]) =>
          `  ${childKey}: ${JSON.stringify(childValue)}`,
        ),
      ];
    }
    throw new Error(`Unsupported adapter value for ${key}`);
  });
}

function removeFrontmatterFields(frontmatter, fields) {
  const removed = new Set(fields);
  const output = [];
  let skipping = false;
  for (const line of frontmatter.split(/\r?\n/)) {
    const topLevel = line.match(/^([A-Za-z][A-Za-z0-9_-]*):/);
    if (topLevel) skipping = removed.has(topLevel[1]);
    if (!skipping) output.push(line);
  }
  return output.join("\n").replace(/\n+$/, "");
}

function parseFrontmatter(content, path) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n/);
  if (!match) throw new Error(`${path} has no frontmatter`);
  return match;
}

function applyAdapter(skillPath, harness, skill) {
  const removedFields = adapters[harness].removeFrontmatter?.[skill] ?? [];
  const fields = adapters[harness].frontmatter?.[skill];
  if (!fields && !removedFields.length) return;

  const path = join(skillPath, "SKILL.md");
  const content = readFileSync(path, "utf8");
  const match = parseFrontmatter(content, path);
  const base = removeFrontmatterFields(match[1], removedFields);
  const additions = fields ? renderFrontmatter(fields).join("\n") : "";
  const adaptedFrontmatter = [base, additions].filter(Boolean).join("\n");
  writeFileSync(path, content.replace(match[0], `---\n${adaptedFrontmatter}\n---\n`), "utf8");
}

function validateAdaptedSkill(skillPath, expectedName) {
  const path = join(skillPath, "SKILL.md");
  const frontmatter = parseFrontmatter(readFileSync(path, "utf8"), path)[1];
  const keys = [...frontmatter.matchAll(/^([A-Za-z][A-Za-z0-9_-]*):/gm)].map((match) => match[1]);
  if (new Set(keys).size !== keys.length) throw new Error(`${path} has duplicate frontmatter keys`);
  if (!frontmatter.includes(`name: ${expectedName}`)) throw new Error(`${path} lost its name`);
  if (!/^description:\s*.+$/m.test(frontmatter)) throw new Error(`${path} lost its description`);
}

function copyDirectoryContents(source, target) {
  mkdirSync(target, { recursive: false });
  for (const entry of readdirSync(source, { withFileTypes: true })) {
    cpSync(join(source, entry.name), join(target, entry.name), {
      recursive: entry.isDirectory(),
      errorOnExist: true,
      force: false,
    });
  }
}

const availableSkills = await (await import("node:fs/promises"))
  .readdir(sourceRoot, { withFileTypes: true })
  .then((entries) => entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort());
const hasSkillFilter = args.includes("--skill");
const skillFilter = valueAfter("--skill");
if (hasSkillFilter && (!skillFilter || skillFilter.startsWith("--"))) {
  throw new Error("--skill requires one or more comma-separated skill names");
}
const requestedSkills = hasSkillFilter ? skillFilter.split(",").filter(Boolean) : undefined;
if (requestedSkills?.length === 0) throw new Error("--skill requires at least one skill name");
if (requestedSkills && new Set(requestedSkills).size !== requestedSkills.length) {
  throw new Error(`Duplicate skill in --skill: ${requestedSkills.join(",")}`);
}
const unknownSkills = requestedSkills?.filter((skill) => !availableSkills.includes(skill)) ?? [];
if (unknownSkills.length) throw new Error(`Unknown skill: ${unknownSkills.join(", ")}`);
const skills = requestedSkills ?? availableSkills;

const plan = harnesses.flatMap((harness) =>
  skills.map((skill) => ({ harness, skill, target: join(targets[harness], skill) })),
);
const conflicts = plan.filter(({ target }) => existsSync(target));

for (const harness of harnesses) console.log(`${harness}: ${targets[harness]}`);
if (dryRun) {
  for (const item of plan) {
    const action = existsSync(item.target) ? (replace ? "replace with backup" : "conflict") : "install";
    console.log(`  ${action}: ${item.skill}`);
  }
  if (conflicts.length && !replace) process.exitCode = 2;
  else console.log("Dry run complete.");
  process.exit();
}

if (conflicts.length && !replace) {
  throw new Error(
    `Existing skills would be overwritten:\n${conflicts.map(({ target }) => `  ${target}`).join("\n")}\n` +
      "Re-run with --replace to back them up and replace them.",
  );
}

const stamp = new Date().toISOString().replaceAll(":", "-").replaceAll(".", "-");
const locks = [];
const stageRoots = new Map();
const committed = [];

try {
  for (const harness of harnesses) {
    const targetRoot = targets[harness];
    mkdirSync(targetRoot, { recursive: true });
    const lockPath = join(targetRoot, ".harness-skills-install.lock");
    let descriptor;
    try {
      descriptor = openSync(lockPath, "wx", 0o600);
    } catch (error) {
      if (error.code === "EEXIST") {
        throw new Error(`Another install may be active. Inspect and remove stale lock: ${lockPath}`);
      }
      throw error;
    }
    writeFileSync(descriptor, `${process.pid}\n`, "utf8");
    locks.push({ descriptor, lockPath });

    const stageRoot = join(dirname(targetRoot), `.harness-skills-stage-${stamp}-${harness}`);
    mkdirSync(stageRoot, { recursive: false, mode: 0o700 });
    stageRoots.set(harness, stageRoot);
    for (const skill of skills) {
      const staged = join(stageRoot, skill);
      copyDirectoryContents(join(sourceRoot, skill), staged);
      applyAdapter(staged, harness, skill);
      validateAdaptedSkill(staged, skill);
    }
  }

  for (const { harness, skill, target } of plan) {
    if (existsSync(target) && !replace) {
      throw new Error(`Refusing to replace ${target} without --replace`);
    }

    let backup;
    if (existsSync(target)) {
      backup = join(dirname(targets[harness]), ".harness-skills-backups", stamp, skill);
      mkdirSync(dirname(backup), { recursive: true, mode: 0o700 });
      renameSync(target, backup);
    }

    const entry = { harness, skill, target, backup };
    committed.push(entry);
    renameSync(join(stageRoots.get(harness), skill), target);
  }
} catch (error) {
  for (const item of committed.reverse()) {
    if (existsSync(item.target)) {
      const failed = join(dirname(targets[item.harness]), ".harness-skills-failed", stamp, item.skill);
      mkdirSync(dirname(failed), { recursive: true, mode: 0o700 });
      renameSync(item.target, failed);
    }
    if (item.backup) renameSync(item.backup, item.target);
  }
  throw error;
} finally {
  for (const stageRoot of stageRoots.values()) rmSync(stageRoot, { recursive: true, force: true });
  for (const { descriptor, lockPath } of locks.reverse()) {
    closeSync(descriptor);
    if (existsSync(lockPath)) unlinkSync(lockPath);
  }
}

console.log(`Installed ${plan.length} skill copies; replaced ${conflicts.length}.`);
