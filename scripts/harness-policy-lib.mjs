import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, dirname, isAbsolute, join, posix, resolve, win32 } from "node:path";

const HARNESSES = ["cursor", "grokbot", "codex", "claude", "opencode", "pi"];
const SKILL_ROOTS = [".cursor/skills", ".agents/skills", ".claude/skills", ".opencode/skills", ".pi/skills"];
const CONTRACT_SECTIONS = ["Launch", "Doctor", "Drive", "Evidence", "Cleanup", "Isolation"];
const SEMVER = /^v?(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+[0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*)?$/;

function object(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objectFields(value, label, fields, errors) {
  if (!object(value)) {
    errors.push(`${label} must be an object`);
    return false;
  }
  for (const key of Object.keys(value)) {
    if (!fields.includes(key)) errors.push(`${label}.${key} is not supported`);
  }
  for (const key of fields) {
    if (!Object.hasOwn(value, key)) errors.push(`${label}.${key} is required`);
  }
  return true;
}

function stringList(value, label, errors, valid = () => true) {
  if (!Array.isArray(value) || value.length === 0) {
    errors.push(`${label} must be a non-empty array`);
    return false;
  }
  const seen = new Set();
  for (const item of value) {
    if (typeof item !== "string" || !item.trim() || item !== item.trim() || /[\x00-\x1f\x7f]/.test(item) || !valid(item)) {
      errors.push(`${label} contains an invalid value: ${JSON.stringify(item)}`);
    } else if (seen.has(item)) {
      errors.push(`${label} contains a duplicate: ${item}`);
    }
    seen.add(item);
  }
  return true;
}

function relativePath(value) {
  return typeof value === "string" && value.length > 0 && !isAbsolute(value) && !win32.isAbsolute(value)
    && !/[\\:\x00-\x1f\x7f<>"|?*]/.test(value)
    && value.split("/").every((part) => part && part !== "." && part !== ".." && !/[. ]$/.test(part)
      && !/^(?:con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part));
}

function branchName(value) {
  return typeof value === "string" && !!value && value !== "@" && !value.startsWith("-")
    && !/[\s~^:?*\[\\\x00-\x1f\x7f]/.test(value) && !value.includes("..") && !value.includes("@{")
    && !value.endsWith(".") && value.split("/").every((part) => part && !part.startsWith(".") && !part.endsWith(".lock"));
}

function appName(value) {
  return /^[a-z0-9](?:[a-z0-9-]{0,55}[a-z0-9])?$/.test(value) && relativePath(value);
}

export function validateHarnessPolicy(policy) {
  const errors = [];
  if (!objectFields(policy, "policy", ["schemaVersion", "baseBranch", "allowedHarnesses", "workflows", "worktrees", "verification", "integration"], errors)) return errors;
  if (policy.schemaVersion !== 1) errors.push("policy.schemaVersion must be 1");
  if (!branchName(policy.baseBranch)) errors.push("policy.baseBranch must be a valid Git branch name");
  stringList(policy.allowedHarnesses, "policy.allowedHarnesses", errors, (value) => HARNESSES.includes(value));
  if (!object(policy.workflows) || Object.keys(policy.workflows).length === 0) errors.push("policy.workflows must be a non-empty object");
  else {
    for (const workflow of Object.keys(policy.workflows)) {
      if (!["pstack", "mstack"].includes(workflow)) {
        errors.push(`policy.workflows.${workflow} is not supported`);
        continue;
      }
      const entry = policy.workflows[workflow];
      if (!objectFields(entry, `policy.workflows.${workflow}`, ["revision"], errors)) continue;
      if (typeof entry.revision !== "string" || (!/^[a-f0-9]{40}$/i.test(entry.revision) && !SEMVER.test(entry.revision))) {
        errors.push(`policy.workflows.${workflow}.revision must pin a full 40-character commit or exact SemVer`);
      }
    }
  }
  if (objectFields(policy.worktrees, "policy.worktrees", ["required", "sharedCheckout"], errors)) {
    if (policy.worktrees.required !== true) errors.push("policy.worktrees.required must be true");
    if (policy.worktrees.sharedCheckout !== false) errors.push("policy.worktrees.sharedCheckout must be false");
  }
  if (objectFields(policy.verification, "policy.verification", ["canonicalRoot", "apps", "requiredCommands"], errors)) {
    const canonicalRoot = policy.verification.canonicalRoot;
    if (!relativePath(canonicalRoot) || SKILL_ROOTS.some((root) => canonicalRoot === root || canonicalRoot.startsWith(`${root}/`) || root.startsWith(`${canonicalRoot}/`))) {
      errors.push("policy.verification.canonicalRoot must be a portable repository-relative path outside harness skill roots");
    }
    stringList(policy.verification.apps, "policy.verification.apps", errors, appName);
    stringList(policy.verification.requiredCommands, "policy.verification.requiredCommands", errors);
  }
  if (objectFields(policy.integration, "policy.integration", ["mode", "protectedBranches", "requireRebase"], errors)) {
    if (policy.integration.mode !== "pull-request") errors.push("policy.integration.mode must be pull-request");
    if (policy.integration.requireRebase !== true) errors.push("policy.integration.requireRebase must be true");
    if (stringList(policy.integration.protectedBranches, "policy.integration.protectedBranches", errors, branchName)
      && !policy.integration.protectedBranches.includes(policy.baseBranch)) errors.push("policy.integration.protectedBranches must include baseBranch");
  }
  return errors;
}

// Check existing ancestors before either reading or creating a project path.
export function safeProjectPath(root, relative) {
  if (typeof root !== "string" || !root || !relativePath(relative)) throw new Error(`Unsafe project path: ${String(relative)}`);
  const absoluteRoot = resolve(root);
  const rootInfo = lstatSync(absoluteRoot);
  if (rootInfo.isSymbolicLink() || !rootInfo.isDirectory()) throw new Error(`Project root must be a directory, not a symlink: ${root}`);
  let target = absoluteRoot;
  for (const part of relative.split("/")) {
    target = join(target, part);
    let info;
    try {
      info = lstatSync(target);
    } catch (error) {
      if (error.code === "ENOENT") continue;
      throw error;
    }
    if (info.isSymbolicLink()) throw new Error(`Symlink is not allowed in project path: ${relative}`);
  }
  return target;
}

export function wrapperPaths(app, harnesses) {
  if (!appName(app) || !Array.isArray(harnesses) || harnesses.some((name) => !HARNESSES.includes(name))) throw new Error("Invalid wrapper app or harnesses");
  const roots = [];
  if (harnesses.includes("codex")) roots.push(".agents/skills");
  else if (harnesses.includes("cursor") || harnesses.includes("grokbot")) roots.push(".cursor/skills");
  for (const [harness, root] of [["claude", ".claude/skills"], ["opencode", ".opencode/skills"], ["pi", ".pi/skills"]]) {
    if (harnesses.includes(harness)) roots.push(root);
  }
  return roots.map((root) => `${root}/verify-${app}/SKILL.md`);
}

export function wrapperText(app, contractPath) {
  if (!appName(app) || !relativePath(contractPath)) throw new Error("Invalid verification wrapper path or app");
  return `---\nname: verify-${app}\ndescription: Verify ${app} through the shared repository contract.\nmetadata:\n  verification-contract: ${contractPath}\n---\n\n# Verify ${app}\n\nResolve \`${contractPath}\` from the repository root, read it and its feature map,\nand follow the shared contract. Choose the available capability that can drive\nthe documented user path. Report an unavailable capability as a blocked step;\nnever replace required application evidence with a weaker check.\n\nKeep project facts in the canonical contract and feature map. This wrapper\ncontains no separate launch, driving, or evidence instructions.\n`;
}

function readProjectFile(root, relative, errors) {
  try {
    const target = safeProjectPath(root, relative);
    if (!lstatSync(target).isFile()) throw new Error("expected a regular file");
    return readFileSync(target, "utf8").replaceAll("\r\n", "\n");
  } catch (error) {
    errors.push(`${relative}: ${error.message}`);
    return undefined;
  }
}

function projectFiles(root, relative, errors, optional = false) {
  const files = [];
  let directory;
  try {
    directory = safeProjectPath(root, relative);
    if (!lstatSync(directory).isDirectory()) throw new Error("expected a directory");
  } catch (error) {
    if (!(optional && error.code === "ENOENT")) errors.push(`${relative}: ${error.message}`);
    return files;
  }
  try {
    for (const entry of readdirSync(directory, { withFileTypes: true }).sort((left, right) => left.name.localeCompare(right.name))) {
      const path = `${relative}/${entry.name}`;
      if (entry.isSymbolicLink()) errors.push(`${path}: symlinks are not allowed`);
      else if (entry.isDirectory()) files.push(...projectFiles(root, path, errors));
      else if (entry.isFile()) files.push(path);
      else errors.push(`${path}: expected a regular file or directory`);
    }
  } catch (error) {
    errors.push(`${relative}: ${error.message}`);
  }
  return files;
}

function markdownSections(text) {
  const sections = [];
  let fence;
  for (const line of text.replace(/<!--[\s\S]*?-->/g, "").split("\n")) {
    const marker = /^ {0,3}(`{3,}|~{3,})/.exec(line);
    if (marker) {
      if (!fence) fence = marker[1];
      else if (marker[1][0] === fence[0] && marker[1].length >= fence.length) fence = undefined;
      sections.at(-1)?.body.push(line);
      continue;
    }
    const heading = !fence && /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line);
    if (heading && heading[1].length <= 2) sections.push({ level: heading[1].length, title: heading[2], body: [] });
    else sections.at(-1)?.body.push(line);
  }
  return sections;
}

function checkSections(text, relative, errors, feature = false) {
  const sections = markdownSections(text);
  const headings = sections.filter((section) => section.level === 2);
  if (feature) {
    const h1 = sections.find((section) => section.level === 1);
    if (!h1 || sections[0] !== h1 || sections.filter((section) => section.level === 1).length !== 1 || !h1.body.join("\n").trim()) errors.push(`${relative}: feature needs one initial H1 and user-visible description`);
    const expected = ["Sub-features", "How to get to it (user POV)", "Driving it with <driver>", "Gotchas"];
    if (headings.length !== 4 || headings.some((section, index) => index === 2 ? !/^Driving it with \S.*$/.test(section.title) : section.title !== expected[index])) {
      errors.push(`${relative}: feature must have exactly these four H2 sections in order: ${expected.join(", ")}`);
    }
  } else {
    for (const title of CONTRACT_SECTIONS) {
      if (headings.filter((section) => section.title === title).length !== 1) errors.push(`${relative}: requires one ## ${title} section`);
    }
  }
  for (const section of headings) {
    const body = section.body.join("\n");
    const instructions = body.replace(/^\s*(?:`{3,}|~{3,})[^\n]*$/gm, "").replace(/^\s*(?:#{1,6}\s.*|[-*+]\s*)$/gm, "").trim();
    if (!instructions || /\b(?:TODO|TBD)\b/i.test(body)) {
      errors.push(`${relative}: ## ${section.title} must contain completed instructions, not empty content or TODO/TBD markers`);
    }
  }
}

function markdownLinks(text) {
  const clean = text.replace(/<!--[\s\S]*?-->/g, "").replace(/^ {0,3}(`{3,}|~{3,})[^\n]*\n[\s\S]*?^ {0,3}\1\s*$/gm, "");
  const definitions = new Map();
  for (const match of clean.matchAll(/^ {0,3}\[([^\]\n]+)\]:\s*(<[^>\n]+>|\S+)/gm)) definitions.set(match[1].toLowerCase(), match[2].replace(/^<|>$/g, ""));
  const body = clean.replace(/^ {0,3}\[[^\]\n]+\]:[^\n]*$/gm, "").replace(/(`+)([^`]|(?!\1)`)*\1/g, "");
  const links = [];
  for (const match of body.matchAll(/(?<!!)\[[^\]\n]+\]\(\s*(<[^>\n]+>|[^\s)]+)(?:\s+["'][^\n]*?["'])?\s*\)/g)) links.push(match[1].replace(/^<|>$/g, ""));
  for (const match of body.matchAll(/(?<!!)\[([^\]\n]+)\](?:\[([^\]\n]*)\])?/g)) {
    const value = definitions.get((match[2] || match[1]).toLowerCase());
    if (value) links.push(value);
  }
  return links;
}

function checkFeatureIndex(root, indexPath, text, featureFiles, errors) {
  const indexed = new Set();
  for (const link of markdownLinks(text)) {
    if (/^https?:\/\//i.test(link) || link.startsWith("#")) continue;
    let target;
    try {
      const decoded = decodeURIComponent(link.split(/[?#]/, 1)[0]);
      if (!decoded || /[\\:\x00-\x1f]/.test(decoded) || posix.isAbsolute(decoded) || win32.isAbsolute(decoded)) throw new Error("unsafe local link");
      target = posix.normalize(posix.join(posix.dirname(indexPath), decoded));
      const file = safeProjectPath(root, target);
      if (!lstatSync(file).isFile()) throw new Error("link must resolve to a regular file");
      if (featureFiles.includes(target)) indexed.add(target);
    } catch (error) {
      errors.push(`${indexPath}: broken or unsafe link ${link}: ${error.message}`);
    }
  }
  for (const feature of featureFiles) {
    if (!indexed.has(feature)) errors.push(`${indexPath}: feature is not indexed: ${feature}`);
  }
}

function skillName(text, relative, errors) {
  const frontmatter = /^\uFEFF?---\n([\s\S]*?)\n---(?:\n|$)/.exec(text);
  if (!frontmatter) return basename(dirname(relative));
  const names = [...frontmatter[1].matchAll(/^(?:name|"name"|'name'):\s*(.*)$/gm)];
  if (names.length === 0) return basename(dirname(relative));
  if (names.length !== 1) {
    errors.push(`${relative}: duplicate frontmatter name`);
    return basename(dirname(relative));
  }
  const raw = names[0][1].replace(/\s+#.*$/, "").trim();
  let name = raw;
  try {
    if (raw.startsWith('"')) name = JSON.parse(raw);
    else if (/^'(?:[^']|'')*'$/.test(raw)) name = raw.slice(1, -1).replaceAll("''", "'");
    if (typeof name !== "string" || !/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error("name must be a plain or quoted skill slug");
    return name;
  } catch (error) {
    errors.push(`${relative}: cannot determine frontmatter name: ${error.message}`);
    return basename(dirname(relative));
  }
}

export function checkProject(root, policy) {
  const errors = validateHarnessPolicy(policy);
  if (errors.length) return errors;
  const canonicalRoot = policy.verification.canonicalRoot;
  const expectedWrappers = new Map();
  for (const app of policy.verification.apps) {
    const contractPath = `${canonicalRoot}/${app}/contract.md`;
    const contract = readProjectFile(root, contractPath, errors);
    if (contract !== undefined) checkSections(contract, contractPath, errors);
    const files = projectFiles(root, `${canonicalRoot}/${app}`, errors);
    const indexPath = `${canonicalRoot}/${app}/features/README.md`;
    const index = readProjectFile(root, indexPath, errors);
    const features = files.filter((path) => path.startsWith(`${canonicalRoot}/${app}/features/`) && path.endsWith(".md") && path !== indexPath);
    if (features.length === 0) errors.push(`${canonicalRoot}/${app}/features: requires at least one documented feature`);
    for (const path of features) {
      const text = readProjectFile(root, path, errors);
      if (text !== undefined) checkSections(text, path, errors, true);
    }
    if (index !== undefined) checkFeatureIndex(root, indexPath, index, features, errors);
    for (const path of wrapperPaths(app, policy.allowedHarnesses)) expectedWrappers.set(path, wrapperText(app, contractPath));
  }
  const found = new Set();
  const discoveries = new Map();
  for (const skillRoot of SKILL_ROOTS) {
    const files = projectFiles(root, skillRoot, errors, true);
    for (const path of files.filter((file) => posix.basename(file).toLowerCase() === "skill.md")) {
      const text = readProjectFile(root, path, errors);
      if (text === undefined) continue;
      const name = skillName(text, path, errors);
      const discoveryRoot = [".cursor/skills", ".agents/skills"].includes(skillRoot) ? ".cursor/skills + .agents/skills" : skillRoot;
      const key = `${discoveryRoot}:${name}`;
      if (discoveries.has(key)) errors.push(`${path}: duplicate discovered skill name ${name}; also present at ${discoveries.get(key)}`);
      else discoveries.set(key, path);
      if (!name.startsWith("verify-") && !posix.basename(posix.dirname(path)).startsWith("verify-")) continue;
      found.add(path);
      if (!expectedWrappers.has(path)) errors.push(`${path}: legacy or unconfigured verification skill; migrate facts into ${canonicalRoot} and keep only configured wrappers`);
      else if (text !== expectedWrappers.get(path)) errors.push(`${path}: verification wrapper differs from the canonical generated wrapper`);
      if (files.some((file) => file !== path && file.startsWith(`${posix.dirname(path)}/`))) errors.push(`${path}: verification wrappers may contain only SKILL.md; move supporting files into ${canonicalRoot}`);
      const featureRoot = `${posix.dirname(path)}/features/`;
      if (files.some((file) => file.startsWith(featureRoot))) errors.push(`${path}: duplicate feature map outside ${canonicalRoot}; migrate its facts before removing it`);
    }
  }
  for (const path of expectedWrappers.keys()) {
    if (!found.has(path)) errors.push(`${path}: required verification wrapper is missing`);
  }
  return errors;
}
