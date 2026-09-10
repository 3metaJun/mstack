import { createHash } from "node:crypto";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { homedir } from "node:os";
import { basename, dirname, join, relative, resolve, sep } from "node:path";
import { spawnSync } from "node:child_process";
import { createInterface } from "node:readline";
import { createReadStream } from "node:fs";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const userHome = homedir();
const codexHome = process.env.CODEX_HOME ? resolve(process.env.CODEX_HOME) : join(userHome, ".codex");
const args = process.argv.slice(2);

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

if (args.includes("--help")) {
  console.log(`Usage: node scripts/audit-context.mjs [--days N] [--official-root PATH] [--output-dir PATH] [--exclude-latest]

Audits active Codex skill descriptions, invocation policies, overlap, and recent local usage.
The command is read-only except for its reports under .audit/ by default.`);
  process.exit(0);
}

const days = Number.parseInt(valueAfter("--days") ?? "180", 10);
if (!Number.isFinite(days) || days < 1) throw new Error("--days must be a positive integer");
const outputDir = resolve(valueAfter("--output-dir") ?? join(repoRoot, ".audit"));
const officialRoot = valueAfter("--official-root") ? resolve(valueAfter("--official-root")) : undefined;
const excludeLatest = args.includes("--exclude-latest");

function unquote(value) {
  const trimmed = value.trim();
  if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
    try {
      return JSON.parse(trimmed);
    } catch {
      return trimmed.slice(1, -1);
    }
  }
  if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).replaceAll("''", "'");
  }
  return trimmed;
}

function parseFrontmatter(path) {
  const content = readFileSync(path, "utf8");
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`${path} has no YAML frontmatter`);
  const lines = match[1].split(/\r?\n/);
  const fields = {};
  for (let index = 0; index < lines.length; index += 1) {
    const field = lines[index].match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s*(.*))?$/);
    if (!field) continue;
    const [, key, rawValue = ""] = field;
    if (rawValue === ">" || rawValue === "|" || rawValue === ">-" || rawValue === "|-") {
      const parts = [];
      while (index + 1 < lines.length && (/^\s+/.test(lines[index + 1]) || lines[index + 1] === "")) {
        index += 1;
        parts.push(lines[index].trim());
      }
      fields[key] = rawValue.startsWith(">") ? parts.join(" ").replace(/\s+/g, " ").trim() : parts.join("\n");
    } else {
      fields[key] = unquote(rawValue);
    }
  }
  return { content, fields };
}

function walkFiles(root, predicate = () => true, seenDirectories = new Set()) {
  if (!existsSync(root)) return [];
  const realRoot = realpathSync(root).toLowerCase();
  if (seenDirectories.has(realRoot)) return [];
  seenDirectories.add(realRoot);
  const files = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    const directory = entry.isDirectory() || (entry.isSymbolicLink() && statSync(path).isDirectory());
    if (directory) files.push(...walkFiles(path, predicate, seenDirectories));
    else if (entry.isFile() && predicate(path)) files.push(path);
  }
  return files;
}

function enabledPlugins() {
  const arguments_ = ["plugin", "list", "--json"];
  let command = "codex";
  if (process.platform === "win32") {
    const entrypoint = join(dirname(process.execPath), "node_modules", "@openai", "codex", "bin", "codex.js");
    if (!existsSync(entrypoint)) throw new Error(`Cannot locate Codex CLI entrypoint at ${entrypoint}`);
    command = process.execPath;
    arguments_.unshift(entrypoint);
  }
  const result = spawnSync(command, arguments_, { encoding: "utf8", shell: false });
  if (result.error) throw new Error(`codex plugin list failed: ${result.error.message}`);
  if (result.status !== 0) throw new Error(`codex plugin list failed: ${(result.stderr ?? "").trim()}`);
  return JSON.parse(result.stdout).installed
    .filter((plugin) => plugin.installed && plugin.enabled && plugin.source?.path)
    .map((plugin) => ({
      id: plugin.pluginId,
      name: plugin.name,
      marketplace: plugin.marketplaceName,
      root: plugin.source.path,
      contextMode: plugin.marketplaceName === "openai-curated" ? "lazy" : "eager",
    }));
}

function implicitInvocation(skillRoot) {
  const metadataPath = join(skillRoot, "agents", "openai.yaml");
  if (!existsSync(metadataPath)) return true;
  return !/^\s*allow_implicit_invocation:\s*false\s*$/m.test(readFileSync(metadataPath, "utf8"));
}

function portablePath(path) {
  const normalizedHome = userHome.toLowerCase();
  const normalized = path.toLowerCase();
  if (normalized === normalizedHome) return "~";
  if (normalized.startsWith(`${normalizedHome}${sep}`)) return `~${sep}${relative(userHome, path)}`;
  return path;
}

function skillFromFile(path, source, prefix, contextMode = "eager") {
  const root = dirname(path);
  const { content, fields } = parseFrontmatter(path);
  const name = fields.name || basename(root);
  const description = fields.description || "";
  return {
    name,
    displayName: prefix ? `${prefix}:${name}` : name,
    description,
    descriptionChars: [...description].length,
    implicit: implicitInvocation(root),
    contextMode,
    contextIncluded: contextMode === "eager" && implicitInvocation(root),
    source,
    root,
    path: portablePath(path),
    contentHash: createHash("sha256").update(content.replaceAll("\r\n", "\n")).digest("hex"),
  };
}

function discoverSkills() {
  const skills = [];
  const seen = new Set();
  const roots = [
    { root: join(userHome, ".agents", "skills"), source: "user-agent" },
    { root: join(codexHome, "skills"), source: "codex" },
  ];
  for (const { root, source } of roots) {
    for (const path of walkFiles(root, (candidate) => basename(candidate) === "SKILL.md")) {
      const real = realpathSync(path).toLowerCase();
      if (seen.has(real)) continue;
      seen.add(real);
      skills.push(skillFromFile(path, source));
    }
  }
  for (const plugin of enabledPlugins()) {
    const skillsRoot = join(plugin.root, "skills");
    for (const path of walkFiles(skillsRoot, (candidate) => basename(candidate) === "SKILL.md")) {
      const real = realpathSync(path).toLowerCase();
      if (seen.has(real)) continue;
      seen.add(real);
      skills.push(skillFromFile(path, `plugin:${plugin.id}`, plugin.name, plugin.contextMode));
    }
  }
  return skills.sort((left, right) => left.displayName.localeCompare(right.displayName));
}

const stopWords = new Set([
  "agent",
  "agents",
  "and",
  "for",
  "from",
  "skill",
  "tasks",
  "that",
  "the",
  "this",
  "use",
  "user",
  "when",
  "with",
]);

function tokens(value) {
  const normalized = value.toLowerCase();
  const result = new Set(
    (normalized.match(/[a-z0-9][a-z0-9+._-]{2,}/g) ?? []).filter((token) => !stopWords.has(token)),
  );
  const chinese = normalized.match(/[\p{Script=Han}]+/gu) ?? [];
  for (const run of chinese) {
    const characters = [...run];
    for (let index = 0; index < characters.length - 1; index += 1) {
      result.add(characters.slice(index, index + 2).join(""));
    }
  }
  return result;
}

function jaccard(left, right) {
  if (!left.size || !right.size) return 0;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection += 1;
  return intersection / (left.size + right.size - intersection);
}

function overlapCandidates(skills) {
  const tokenSets = new Map(skills.map((skill) => [skill.displayName, tokens(`${skill.displayName} ${skill.description}`)]));
  const pairs = [];
  for (let leftIndex = 0; leftIndex < skills.length; leftIndex += 1) {
    for (let rightIndex = leftIndex + 1; rightIndex < skills.length; rightIndex += 1) {
      const left = skills[leftIndex];
      const right = skills[rightIndex];
      const similarity = jaccard(tokenSets.get(left.displayName), tokenSets.get(right.displayName));
      if (similarity >= 0.16) pairs.push({ left: left.displayName, right: right.displayName, similarity });
    }
  }
  return pairs.sort((left, right) => right.similarity - left.similarity).slice(0, 30);
}

function sessionFiles() {
  const root = join(codexHome, "sessions");
  const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
  const files = walkFiles(root, (path) => path.endsWith(".jsonl"))
    .filter((path) => statSync(path).mtimeMs >= cutoff)
    .sort((left, right) => statSync(right).mtimeMs - statSync(left).mtimeMs);
  return excludeLatest ? files.slice(1) : files;
}

function messageText(payload) {
  return (payload.content ?? []).map((item) => item.text ?? item.input_text ?? "").join("\n");
}

function literalPattern(value, explicit = false) {
  const escaped = value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return explicit
    ? new RegExp(`(?:\\$|/)${escaped}(?![a-z0-9-])`, "i")
    : new RegExp(`(^|[^a-z0-9-])${escaped}(?![a-z0-9-])`, "i");
}

async function usageSignals(skills) {
  const usage = Object.fromEntries(
    skills.map((skill) => [skill.displayName, { explicitMentions: 0, plainMentions: 0, instructionLoads: 0 }]),
  );
  const patterns = skills.map((skill) => ({
    skill,
    explicit: literalPattern(skill.name, true),
    plain: literalPattern(skill.name),
    path: new RegExp(`[\\\\/]skills[\\\\/]${skill.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}[\\\\/]SKILL\\.md`, "i"),
  }));
  const files = sessionFiles();
  for (const path of files) {
    const lines = createInterface({ input: createReadStream(path, { encoding: "utf8" }), crlfDelay: Infinity });
    for await (const line of lines) {
      let item;
      try {
        item = JSON.parse(line);
      } catch {
        continue;
      }
      if (item.type === "response_item" && item.payload?.type === "message" && item.payload.role === "user") {
        const text = messageText(item.payload);
        if (text.includes("<recommended_plugins>") || text.includes("# AGENTS.md instructions")) continue;
        for (const pattern of patterns) {
          if (pattern.explicit.test(text)) usage[pattern.skill.displayName].explicitMentions += 1;
          else if (pattern.plain.test(text)) usage[pattern.skill.displayName].plainMentions += 1;
        }
      }
      if (item.type === "response_item" && item.payload?.type === "custom_tool_call") {
        const input = typeof item.payload.input === "string" ? item.payload.input : JSON.stringify(item.payload.input ?? "");
        for (const pattern of patterns) {
          if (pattern.path.test(input)) usage[pattern.skill.displayName].instructionLoads += 1;
        }
      }
    }
  }
  return { files: files.length, usage };
}

function treeHash(root) {
  const hash = createHash("sha256");
  for (const path of walkFiles(root).sort()) {
    hash.update(relative(root, path).replaceAll("\\", "/"));
    hash.update("\0");
    hash.update(readFileSync(path));
    hash.update("\0");
  }
  return hash.digest("hex");
}

function groupBy(values, keyFor) {
  const groups = new Map();
  for (const value of values) {
    const key = keyFor(value);
    const group = groups.get(key);
    if (group) group.push(value);
    else groups.set(key, [value]);
  }
  return groups;
}

function officialComparison(skills) {
  if (!officialRoot) return undefined;
  const roots = [join(officialRoot, ".system"), join(officialRoot, ".curated")].filter(existsSync);
  const official = roots.flatMap((root) =>
    readdirSync(root, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && existsSync(join(root, entry.name, "SKILL.md")))
      .map((entry) => ({ name: entry.name, root: join(root, entry.name), channel: basename(root) })),
  );
  const localByName = groupBy(skills, (skill) => skill.name);
  return official
    .filter((entry) => localByName.has(entry.name))
    .flatMap((entry) =>
      localByName.get(entry.name).map((local) => ({
        name: entry.name,
        channel: entry.channel,
        local: local.displayName,
        source: local.source,
        status: treeHash(entry.root) === treeHash(local.root) ? "exact" : "different",
      })),
    )
    .sort((left, right) => left.name.localeCompare(right.name));
}

function markdownTable(headers, rows) {
  const escape = (value) => String(value).replaceAll("|", "\\|").replaceAll("\n", " ");
  return [
    `| ${headers.map(escape).join(" | ")} |`,
    `| ${headers.map(() => "---").join(" | ")} |`,
    ...rows.map((row) => `| ${row.map(escape).join(" | ")} |`),
  ].join("\n");
}

const skills = discoverSkills();
const usageResult = await usageSignals(skills);
const contextSkills = skills.filter((skill) => skill.contextIncluded);
const overlaps = overlapCandidates(contextSkills);
const official = officialComparison(skills);
const implicitSkills = skills.filter((skill) => skill.implicit);
const totalDescriptionChars = skills.reduce((sum, skill) => sum + skill.descriptionChars, 0);
const contextDescriptionChars = contextSkills.reduce((sum, skill) => sum + skill.descriptionChars, 0);
const duplicateNames = [...groupBy(skills, (skill) => skill.name)]
  .filter(([, entries]) => entries.length > 1)
  .map(([name, entries]) => ({ name, entries: entries.map((entry) => entry.displayName) }));
const duplicateContent = [...groupBy(skills, (skill) => skill.contentHash)]
  .filter(([, entries]) => entries.length > 1)
  .map(([hash, entries]) => ({ hash, entries: entries.map((entry) => entry.displayName) }));
const unused = contextSkills
  .filter((skill) => {
    const usage = usageResult.usage[skill.displayName];
    return usage.explicitMentions + usage.plainMentions + usage.instructionLoads === 0;
  })
  .sort((left, right) => right.descriptionChars - left.descriptionChars);

const report = {
  generatedAt: new Date().toISOString(),
  windowDays: days,
  excludedLatestSession: excludeLatest,
  sessionFiles: usageResult.files,
  summary: {
    skills: skills.length,
    implicitSkills: implicitSkills.length,
    explicitOnlySkills: skills.length - implicitSkills.length,
    contextSkills: contextSkills.length,
    lazyPluginSkills: skills.filter((skill) => skill.contextMode === "lazy").length,
    totalDescriptionChars,
    contextDescriptionChars,
  },
  duplicateNames,
  duplicateContent,
  overlaps,
  official,
  skills: skills.map((skill) => ({ ...skill, root: portablePath(skill.root), usage: usageResult.usage[skill.displayName] })),
  unused: unused.map((skill) => skill.displayName),
};

const sourceRows = [...groupBy(skills, (skill) => skill.source)]
  .map(([source, entries]) => [
    source,
    entries.length,
    entries.filter((entry) => entry.contextIncluded).length,
    entries.reduce((sum, entry) => sum + entry.descriptionChars, 0),
  ])
  .sort((left, right) => right[1] - left[1]);
const longestRows = [...contextSkills]
  .sort((left, right) => right.descriptionChars - left.descriptionChars)
  .slice(0, 25)
  .map((skill) => {
    const usage = usageResult.usage[skill.displayName];
    return [
      skill.displayName,
      skill.source,
      skill.contextIncluded ? "context" : skill.contextMode,
      skill.descriptionChars,
      usage.explicitMentions + usage.plainMentions,
      usage.instructionLoads,
    ];
  });
const overlapRows = overlaps.map((pair) => [pair.left, pair.right, pair.similarity.toFixed(2)]);
const unusedRows = unused.slice(0, 40).map((skill) => [
  skill.displayName,
  skill.source,
  skill.contextIncluded ? "context" : skill.contextMode,
  skill.descriptionChars,
]);
const officialRows = (official ?? []).map((entry) => [
  entry.name,
  entry.channel,
  entry.local,
  entry.source,
  entry.status,
]);

const markdown = `# Codex skill context audit

Generated ${report.generatedAt}. Usage window is ${days} days across ${usageResult.files} session files${excludeLatest ? ", excluding the newest session" : ""}.

## Summary

- Discovered skills: ${skills.length}
- Current context candidates: ${contextSkills.length}
- Lazy plugin skills: ${skills.filter((skill) => skill.contextMode === "lazy").length}
- Explicit-only skills: ${skills.length - implicitSkills.length}
- All description characters: ${totalDescriptionChars.toLocaleString("en-US")}
- Current context description characters: ${contextDescriptionChars.toLocaleString("en-US")}
- Duplicate names: ${duplicateNames.length}
- Exact duplicate instruction files: ${duplicateContent.length}

## Sources

${markdownTable(["Source", "Skills", "In context", "Description chars"], sourceRows)}

## Longest descriptions

${markdownTable(["Skill", "Source", "Policy", "Chars", "User mentions", "Instruction loads"], longestRows)}

## Similarity candidates

These are lexical candidates for human review, not proof that two skills are interchangeable.

${markdownTable(["Left", "Right", "Jaccard"], overlapRows)}

## No usage signal in the selected window

The scanner counts user mentions and observed reads of each SKILL.md. Zero does not prove that Codex never selected a skill.

${markdownTable(["Skill", "Source", "Policy", "Chars"], unusedRows)}

## Official openai/skills comparison

${official ? markdownTable(["Name", "Channel", "Local", "Source", "Tree status"], officialRows) : "Run with --official-root <path-to-openai-skills/skills> to populate this section."}
`;

mkdirSync(outputDir, { recursive: true });
const jsonPath = join(outputDir, "skill-context-audit.json");
const markdownPath = join(outputDir, "skill-context-audit.md");
writeFileSync(jsonPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
writeFileSync(markdownPath, markdown, "utf8");
console.log(`Audited ${skills.length} skills (${contextSkills.length} current context, ${skills.length - contextSkills.length} lazy or explicit-only).`);
console.log(`Description characters: ${contextDescriptionChars} current context / ${totalDescriptionChars} total.`);
console.log(`Reports: ${markdownPath} and ${jsonPath}`);
