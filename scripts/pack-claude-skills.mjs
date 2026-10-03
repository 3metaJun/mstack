#!/usr/bin/env node
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseCliArgs } from "./cli-args.mjs";
import {
  buildSkillFiles,
  createZip,
  skillPackable,
  uploadSizeProblem,
  validateUploadFrontmatter,
} from "./claude-package-lib.mjs";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const skillsRoot = join(repoRoot, "skills");
const allSkills = JSON.parse(readFileSync(join(repoRoot, "profiles", "skills.json"), "utf8")).skills;

const usage = `Usage: node scripts/pack-claude-skills.mjs [--skill a,b] [--out <dir>] [--check]

Builds one zip per skill for Claude Desktop and claude.ai (Customize > Skills >
Upload). Claude Code does not need these archives: use the plugin or the installer.
--check validates every selected skill without writing archives.`;

function main() {
  const args = process.argv.slice(2);
  if (args.includes("--help")) return console.log(usage);
  const options = parseCliArgs(args, ["--skill", "--out"], ["--check"]);
  const selected = options["--skill"]
    ? [...new Set(options["--skill"].split(",").map((name) => name.trim()))]
    : allSkills;
  const unknown = selected.filter((name) => !allSkills.includes(name) || !skillPackable(skillsRoot, name));
  if (unknown.length) throw new Error(`Unknown skill: ${unknown.join(", ")}`);

  const problems = [];
  const archives = [];
  for (const skill of selected) {
    const content = readFileSync(join(skillsRoot, skill, "SKILL.md"), "utf8");
    problems.push(...validateUploadFrontmatter(skill, content));
    try {
      const files = buildSkillFiles(skill, skillsRoot);
      const sizeProblem = uploadSizeProblem(skill, files);
      if (sizeProblem) problems.push(sizeProblem);
      archives.push({ skill, zip: createZip(files), count: files.length });
    } catch (error) {
      problems.push(`${skill}: ${error.message}`);
    }
  }
  if (problems.length) throw new Error(problems.map((problem) => `- ${problem}`).join("\n"));

  if (options["--check"]) return console.log(`${selected.length} skills are valid for Claude upload.`);
  // An explicit relative --out follows the caller's directory; the default stays in the
  // repository, where .gitignore covers it, whatever the working directory is.
  const out = options["--out"];
  const outDir = out ? (isAbsolute(out) ? out : resolve(process.cwd(), out)) : join(repoRoot, "dist", "claude-skills");
  mkdirSync(outDir, { recursive: true });
  for (const { skill, zip, count } of archives) {
    writeFileSync(join(outDir, `${skill}.zip`), zip);
    console.log(`${skill}.zip (${count} files, ${zip.length} bytes)`);
  }
  console.log(`Wrote ${archives.length} archives to ${outDir}`);
}

try {
  main();
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
