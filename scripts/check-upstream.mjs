import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { dirname, extname, isAbsolute, join, posix, relative, resolve, sep, win32 } from "node:path";
import { fileURLToPath } from "node:url";

const args = process.argv.slice(2);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

function valueAfter(flag) {
  const index = args.indexOf(flag);
  return index === -1 ? undefined : args[index + 1];
}

if (args.includes("--help")) {
  console.log(
    "Usage: node scripts/check-upstream.mjs --source <pstack checkout> [--target <mstack checkout>] [--strict]\n\n" +
      "Reports skill and transformed artifact drift, including files removed upstream according to the previous manifest. " +
      "--strict requires a clean source checkout at the pinned commit and exits non-zero for missing, changed, or removed artifacts. " +
      "Manifest hashes are transformed upstream baselines; adapted compareContent=false files may differ.",
  );
  process.exit(0);
}

const targetRoot = resolve(valueAfter("--target") ?? repoRoot);
const upstreamsPath = resolveInside(targetRoot, "profiles/upstreams.json", "upstream profile");
if (!existsSync(upstreamsPath)) throw new Error(`mstack upstream profile not found: ${upstreamsPath}`);
const upstreams = JSON.parse(readFileSync(upstreamsPath, "utf8"));
const pstack = upstreams.pstack;
if (!pstack || typeof pstack !== "object") throw new Error("profiles/upstreams.json has no pstack entry");

const source = valueAfter("--source") ?? process.env.MSTACK_PSTACK_SOURCE;
if (!source) {
  console.log("Pass --source <pstack checkout> or set MSTACK_PSTACK_SOURCE to check the upstream inventory.");
  process.exit(0);
}

const sourceRoot = resolve(source);
function toPlatformPath(value) {
  return value.split("/").join(sep);
}

function profilePath(value, label, { allowRoot = true } = {}) {
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${label} must be a non-empty relative path.`);
  }
  if (posix.isAbsolute(value.replaceAll("\\", "/")) || win32.isAbsolute(value)) {
    throw new Error(`${label} must stay inside its checkout; absolute paths are not allowed: ${value}`);
  }
  const parts = value.split(/[\\/]/).filter((part) => part.length > 0 && part !== ".");
  if (parts.includes("..")) {
    throw new Error(`${label} must stay inside its checkout; parent traversal is not allowed: ${value}`);
  }
  const normalized = parts.join("/");
  if (!allowRoot && normalized.length === 0) {
    throw new Error(`${label} must identify a file inside its checkout.`);
  }
  return normalized || ".";
}

function resolveInside(root, path, label) {
  const candidate = resolve(root, toPlatformPath(path));
  const fromRoot = relative(root, candidate);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`${label} resolves outside its checkout: ${path}`);
  }
  let existing = candidate;
  while (true) {
    try {
      lstatSync(existing);
      break;
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
      const parent = dirname(existing);
      if (parent === existing) throw error;
      existing = parent;
    }
  }
  const realRoot = realpathSync(root);
  const realExisting = realpathSync(existing);
  const fromRealRoot = relative(realRoot, realExisting);
  if (fromRealRoot === ".." || fromRealRoot.startsWith(`..${sep}`) || isAbsolute(fromRealRoot)) {
    throw new Error(`${label} resolves outside its checkout through a symbolic link: ${path}`);
  }
  return candidate;
}

const sourceSkills = resolveInside(sourceRoot, "skills", "upstream skills directory");
if (!existsSync(sourceSkills)) throw new Error(`Upstream skills directory not found: ${sourceSkills}`);
const strict = args.includes("--strict");

function gitOutput(arguments_) {
  try {
    return execFileSync("git", ["-C", sourceRoot, ...arguments_], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  } catch {
    return undefined;
  }
}

function sourceProvenanceProblems() {
  if (gitOutput(["rev-parse", "--is-inside-work-tree"]) !== "true") {
    return [`Source is not inside a Git checkout: ${sourceRoot}.`];
  }

  const problems = [];
  const sourceCommit = gitOutput(["rev-parse", "--verify", "HEAD"]);
  if (!sourceCommit) {
    problems.push(`Source Git checkout has no readable HEAD: ${sourceRoot}.`);
  } else if (typeof pstack.commit !== "string" || pstack.commit.length === 0) {
    problems.push("profiles/upstreams.json has no pinned pstack commit.");
  } else if (sourceCommit !== pstack.commit) {
    problems.push(`Source checkout is at ${sourceCommit}, profile pins ${pstack.commit}.`);
  }

  const sourceStatus = gitOutput(["status", "--porcelain=v1", "--untracked-files=all", "--", "."]);
  if (sourceStatus === undefined) {
    problems.push(`Could not inspect source subtree status: ${sourceRoot}.`);
  } else if (sourceStatus.length > 0) {
    problems.push(`Source subtree has tracked or untracked changes:\n${sourceStatus}`);
  }
  return problems;
}

const provenanceProblems = sourceProvenanceProblems();
if (strict && provenanceProblems.length > 0) {
  console.error(`Upstream source provenance check failed:\n${provenanceProblems.join("\n")}`);
  process.exit(1);
}
for (const problem of provenanceProblems) {
  console.error(`Warning: ${problem}`);
}

const renames = pstack.renames ?? {};
const expected = readdirSync(sourceSkills, { withFileTypes: true })
  .filter((entry) => entry.isDirectory())
  .map((entry) => profilePath(renames[entry.name] ?? entry.name, `skill rename for ${entry.name}`, { allowRoot: false }))
  .sort();
const targetSkills = resolveInside(targetRoot, "skills", "target skills directory");
const actual = new Set(
  readdirSync(targetSkills, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name),
);
const missing = expected.filter((skill) => !actual.has(skill));
if (missing.length) {
  console.error(`Missing pstack skills: ${missing.join(", ")}`);
  process.exit(1);
}

const invalid = expected.filter((skill) => {
  const skillPath = profilePath(join("skills", skill, "SKILL.md"), `computed skill target for ${skill}`, {
    allowRoot: false,
  });
  return !existsSync(resolveInside(targetRoot, skillPath, `computed skill target for ${skill}`));
});
if (invalid.length) {
  console.error(`Missing SKILL.md for pstack skills: ${invalid.join(", ")}`);
  process.exit(1);
}

const textExtensions = new Set([
  ".cjs", ".css", ".cts", ".hbs", ".html", ".js", ".json", ".lock", ".md", ".mjs",
  ".sh", ".ts", ".tsx", ".txt", ".yaml", ".yml",
]);
const defaultArtifacts = {
  agents: {
    source: "agents",
    target: "agents",
    compareContent: false,
    renameFiles: { "poteto-agent.md": "meta-agent.md", "comment-sicko.md": "comment-reviewer.md" },
  },
  automations: { source: "automations", target: "automations", compareContent: true },
  guide: {
    source: "docs/guide",
    target: "docs/guide",
    compareContent: true,
    renameFiles: { "02-poteto-mode.md": "02-meta-mode.md" },
  },
  "meta-mode-tools": {
    source: "skills/poteto-mode/scripts",
    target: "tools/meta-mode",
    compareContent: false,
  },
};
const artifacts = { ...defaultArtifacts, ...(pstack.artifacts ?? {}) };

function normalizePath(value) {
  return value.split(/[\\/]/).filter(Boolean).join("/");
}

function walkFiles(directory) {
  if (!existsSync(directory)) return [];
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return walkFiles(path).map((file) => join(entry.name, file));
    return entry.isFile() ? [entry.name] : [];
  });
}

function renamePath(path, renameFiles = {}, label = "artifact rename") {
  const parts = normalizePath(path).split("/");
  const renamed = renameFiles[parts.at(-1)];
  if (renamed !== undefined) {
    parts[parts.length - 1] = profilePath(renamed, label, { allowRoot: false });
  }
  return parts.join("/");
}

function transformBuffer(path, replacements = []) {
  const value = readFileSync(path);
  if (!textExtensions.has(extname(path).toLowerCase())) return value;
  let transformed = value.toString("utf8").replace(/\r\n/g, "\n")
      .replaceAll("setup-pstack", "setup-mstack")
      .replaceAll("poteto-mode", "meta-mode")
      .replaceAll("poteto-agent", "meta-agent")
      .replace(/\bpstack\b/g, "mstack");
  for (const replacement of replacements) {
    if (!replacement || typeof replacement.from !== "string" || typeof replacement.to !== "string") {
      throw new Error("Upstream artifact replacements require string from and to values");
    }
    transformed = transformed.replaceAll(replacement.from, replacement.to);
  }
  return Buffer.from(transformed);
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function equalContent(path, current, expected) {
  if (textExtensions.has(extname(path).toLowerCase())) {
    return current.toString("utf8").replace(/\r\n/g, "\n") === expected.toString("utf8").replace(/\r\n/g, "\n");
  }
  return digest(current) === digest(expected);
}

let artifactProblems = 0;
const expectedTargets = new Map();
const missingSourceNames = new Set();
for (const [name, configured] of Object.entries(artifacts)) {
  const spec = {
    ...configured,
    source: profilePath(configured.source, `artifact ${name} source`),
    target: profilePath(configured.target, `artifact ${name} target`),
  };
  const sourceDirectory = resolveInside(sourceRoot, spec.source, `artifact ${name} source`);
  if (!existsSync(sourceDirectory)) {
    console.error(`Missing upstream artifact directory: ${spec.source}`);
    artifactProblems += 1;
    missingSourceNames.add(name);
    continue;
  }
  const expected = new Map(
    walkFiles(sourceDirectory).map((sourceFile) => {
      const sourceRelative = profilePath(
        join(spec.source, sourceFile),
        `artifact ${name} computed source`,
        { allowRoot: false },
      );
      const target = profilePath(
        join(spec.target, renamePath(sourceFile, spec.renameFiles, `artifact ${name} rename for ${sourceFile}`)),
        `artifact ${name} computed target`,
        { allowRoot: false },
      );
      const targetOwner = expectedTargets.get(target);
      if (targetOwner) {
        throw new Error(
          `Upstream artifacts ${targetOwner} and ${name}:${normalizePath(sourceFile)} resolve to the same target: ${target}`,
        );
      }
      expectedTargets.set(target, `${name}:${normalizePath(sourceFile)}`);
      return [
        target,
        transformBuffer(resolveInside(sourceRoot, sourceRelative, `artifact ${name} computed source`), spec.replacements),
      ];
    }),
  );
  const missing = [];
  const changed = [];
  for (const [target, expectedContent] of expected) {
    const targetPath = resolveInside(targetRoot, target, `artifact ${name} computed target`);
    if (!existsSync(targetPath)) missing.push(target);
    else if (spec.compareContent !== false && !equalContent(targetPath, readFileSync(targetPath), expectedContent)) {
      changed.push(target);
    }
  }
  const status = `artifact ${name}: ${expected.size - missing.length} present, ${missing.length} missing, ${changed.length} changed`;
  console.log(status);
  if (strict && (missing.length || changed.length)) {
    for (const path of missing) console.error(`  missing: ${path}`);
    for (const path of changed) console.error(`  changed: ${path}`);
    artifactProblems += missing.length + changed.length;
  }
}

const manifestPath = resolveInside(targetRoot, "profiles/upstream-manifest.json", "upstream manifest");
if (!existsSync(manifestPath)) {
  console.error("Missing upstream provenance manifest: profiles/upstream-manifest.json");
  if (strict) artifactProblems += 1;
} else {
  let manifest;
  try {
    manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  } catch (error) {
    console.error(`Invalid upstream provenance manifest: ${error.message}`);
    if (strict) artifactProblems += 1;
  }
  if (manifest) {
    const removed = [];
    for (const [name, files] of Object.entries(manifest.artifacts ?? {})) {
      if (!files || typeof files !== "object" || Array.isArray(files)) {
        throw new Error(`Invalid artifact group: ${name}`);
      }
      for (const path of Object.keys(files)) {
        const target = profilePath(path, `upstream manifest artifact ${name}`, { allowRoot: false });
        if (expectedTargets.has(target) || missingSourceNames.has(name)) continue;
        const targetPath = resolveInside(targetRoot, target, `upstream manifest artifact ${name}`);
        if (existsSync(targetPath)) removed.push(target);
      }
    }
    console.log(`upstream removals: ${removed.length} tracked artifact(s) still present`);
    if (strict && removed.length > 0) {
      for (const path of removed) console.error(`  removed upstream: ${path}`);
      artifactProblems += removed.length;
    }
    if (manifest.commit !== pstack.commit) {
      const message = `Upstream manifest pins ${manifest.commit ?? "<missing>"}, profile pins ${pstack.commit}.`;
      console.error(message);
      if (strict) artifactProblems += 1;
    } else {
      console.log("upstream provenance manifest: commit matches profile");
    }
  }
}

console.log(`Matched ${expected.length} pstack skills at ${pstack.commit}.`);
if (artifactProblems && strict) process.exit(1);
