import { createHash } from "node:crypto";
import { existsSync, lstatSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { physicalPathKey } from "./install-paths.mjs";

const packageName = "@3metajun/mstack";
const archivedDirectories = [".harness-skills-backups", ".harness-skills-failed", ".mstack-backups"];

function plainFile(path) {
  return existsSync(path) && lstatSync(path).isFile() && !lstatSync(path).isSymbolicLink();
}

function ownedSkill(path, name, digests) {
  if (!lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink()) return false;
  const receipt = join(path, ".mstack-install.json");
  if (plainFile(receipt)) {
    try {
      const data = JSON.parse(readFileSync(receipt, "utf8"));
      if (data.package === packageName && data.schemaVersion === 1) return true;
    } catch {}
  }
  const skillFile = join(path, "SKILL.md");
  if (!plainFile(skillFile)) return false;
  const digest = createHash("sha256").update(readFileSync(skillFile, "utf8").replaceAll("\r\n", "\n")).digest("hex");
  return digests.skills[name]?.includes(digest) ?? false;
}

export function planSkillMigration({ repoRoot, skills, targets, nativeTargets, sharedRoot, claudeRoot, externalClaudeRoot, migrate, replace, enabled }) {
  const result = { retirements: [], adaptations: [] };
  if (!enabled || skills.length === 0) return result;
  const digests = JSON.parse(readFileSync(join(repoRoot, "profiles", "legacy-skill-digests.json"), "utf8"));
  const directTargets = new Set(targets.map(({ target }) => physicalPathKey(target)));
  const seen = new Set();
  const candidates = [];
  const sharedKey = physicalPathKey(sharedRoot);
  const claudeRoots = new Map();
  for (const root of [claudeRoot, externalClaudeRoot]) {
    if (!root) continue;
    const key = physicalPathKey(root);
    if (key === sharedKey) throw new Error(`Claude and shared skills resolve to the same physical directory: ${root}; configure separate directories for Claude and shared skills`);
    if (!claudeRoots.has(key)) claudeRoots.set(key, root);
  }
  for (const harness of ["opencode", "pi"]) {
    const root = nativeTargets[harness];
    if (!root || physicalPathKey(root) === sharedKey) continue;
    for (const name of skills) {
      const target = join(root, name);
      if (!existsSync(target) || directTargets.has(physicalPathKey(target)) || seen.has(physicalPathKey(target))) continue;
      if (!ownedSkill(target, name, digests)) throw new Error(`Cannot migrate unrecognized skill at ${target}; preserve or relocate this local copy before retrying`);
      seen.add(physicalPathKey(target));
      candidates.push({ kind: "retired", harness, name: `${harness}-${name}`, target });
    }
  }
  for (const root of claudeRoots.values()) {
    for (const name of skills) {
      const target = join(root, name);
      if (!existsSync(target) || directTargets.has(physicalPathKey(target))) continue;
      const skillFile = join(target, "SKILL.md");
      if (!plainFile(skillFile)) throw new Error(`Cannot inspect Claude skill at ${target}`);
      const frontmatter = readFileSync(skillFile, "utf8").match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/)?.[1];
      if (!frontmatter || !/^name\s*:/m.test(frontmatter)) continue;
      if (!ownedSkill(target, name, digests)) throw new Error(`Cannot migrate unrecognized skill at ${target}; preserve or relocate this local copy before retrying`);
      result.adaptations.push({ kind: "skill", harness: "claude", name, skill: name, source: target, target });
    }
  }
  const roots = new Map();
  for (const [harness, root] of Object.entries({ shared: sharedRoot, claude: claudeRoot, externalClaude: externalClaudeRoot, ...nativeTargets })) {
    if (root && !roots.has(physicalPathKey(root))) roots.set(physicalPathKey(root), { harness, root });
  }
  for (const { harness, root } of roots.values()) {
    for (const directory of archivedDirectories) {
      const target = join(root, directory);
      if (!existsSync(target)) continue;
      if (!lstatSync(target).isDirectory() || lstatSync(target).isSymbolicLink()) throw new Error(`Cannot archive unexpected backup entry at ${target}`);
      candidates.push({ kind: "retired", harness, name: `${harness}-${directory.slice(1)}`, target });
    }
    if (!existsSync(root)) continue;
    for (const entry of readdirSync(root, { withFileTypes: true })) {
      if (!/^(?:\.harness-skills-stage-|\.mstack-stage\.)/.test(entry.name)) continue;
      const target = join(root, entry.name);
      const skillFile = join(target, "SKILL.md");
      if (!existsSync(skillFile)) continue;
      if (!plainFile(skillFile) || !entry.isDirectory() || entry.isSymbolicLink()) {
        throw new Error(`Cannot migrate unrecognized staged skill at ${target}; preserve or relocate this local copy before retrying`);
      }
      const content = readFileSync(skillFile, "utf8").replaceAll("\r\n", "\n");
      const frontmatter = content.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1];
      const declared = frontmatter?.match(/^name:\s*(?:"([a-z0-9-]+)"|'([a-z0-9-]+)'|([a-z0-9-]+))\s*(?:#.*)?$/m);
      const digest = createHash("sha256").update(content).digest("hex");
      const name = declared?.slice(1).find(Boolean) ?? Object.keys(digests.skills).find((name) => digests.skills[name].includes(digest));
      if (name && !skills.includes(name)) continue;
      if (!name || !ownedSkill(target, name, digests)) {
        throw new Error(`Cannot migrate unrecognized staged skill at ${target}; preserve or relocate this local copy before retrying`);
      }
      candidates.push({ kind: "retired", harness, name: `${harness}-${entry.name.slice(1)}`, target });
    }
  }
  if (candidates.length || result.adaptations.length) {
    if (!migrate || !replace) {
      const paths = [...candidates, ...result.adaptations].map(({ target }) => target).join("\n");
      throw new Error(`Legacy skill copies remain discoverable. Run with --migrate --replace to back up and migrate:\n${paths}`);
    }
  }
  result.retirements = candidates;
  return result;
}
