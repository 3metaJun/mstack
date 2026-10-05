#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";

const BUNDLED = resolve(dirname(fileURLToPath(import.meta.url)), "../../skills/meta-mode/playbooks");
const CHANGE = /^\s*(?:[-*]|\d+\.)\s+\*\*(?:After|Before|Replace|In)\*\*\s+"([^"]+)"/;
const CHANGE_VERB = /^\s*(?:[-*]|\d+\.)\s+\*\*(?:After|Before|Replace|In)\*\*/;

function flat(text) {
  return text.replace(/\s+/g, " ");
}

function frontmatter(text) {
  return text.match(/^---\n([\s\S]*?)\n---(?:\n|$)/)?.[1] ?? "";
}

function readText(path) {
  return readFileSync(path, "utf8").replace(/^﻿/, "").replaceAll("\r\n", "\n");
}

function field(text, key) {
  return frontmatter(text).match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"))?.[1].trim() ?? "";
}

// Match against the directory listing so a stem resolves the same on case-insensitive and case-sensitive filesystems and cannot escape the directory.
function readPlaybook(root, stem) {
  const file = `${stem}.md`;
  return readdirSync(root).includes(file) ? readText(join(root, file)) : null;
}

export function checkPlaybooks(root, bundled = BUNDLED) {
  if (!existsSync(root) || !statSync(root).isDirectory()) throw new Error(`Project root is not a directory: ${root}`);
  const directory = join(resolve(root), ".agents", "playbooks");
  if (!existsSync(directory)) return [];
  if (!existsSync(bundled) || !statSync(bundled).isDirectory()) throw new Error(`Bundled playbooks directory not found: ${bundled}`);

  const problems = [];
  for (const name of readdirSync(directory).filter((file) => file.endsWith(".md")).sort()) {
    const relativePath = `.agents/playbooks/${name}`;
    const text = readText(join(directory, name));
    const when = field(text, "when");
    if (!when) problems.push(`${relativePath}: its frontmatter needs a "when:" line`);

    const bases = field(text, "extends")
      .split(",")
      .map((stem) => stem.trim())
      .filter(Boolean)
      .map((stem) => ({ stem, text: readPlaybook(bundled, stem) }));
    for (const base of bases) {
      if (base.text === null) problems.push(`${relativePath}: extends \`${base.stem}\`, which this mstack has no playbook for`);
    }

    for (const line of text.split("\n")) {
      if (CHANGE_VERB.test(line) && !CHANGE.test(line)) {
        problems.push(`${relativePath}: a change has no straight-quoted step text to anchor on: ${line.trim().slice(0, 80)}`);
      }
      const anchor = line.match(CHANGE)?.[1];
      if (anchor && !bases.some((base) => base.text && flat(base.text).includes(flat(anchor)))) {
        problems.push(`${relativePath}: "${anchor}" is not in any playbook it extends`);
      }
    }
  }
  return problems;
}

function parseArgs(args) {
  const values = new Map();
  const positional = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--help") return { help: true, values, positional };
    if (arg === "--root" || arg === "--bundled") {
      if (values.has(arg)) throw new Error(`Duplicate option: ${arg}`);
      const value = args[++index];
      if (!value || value.startsWith("--")) throw new Error(`${arg} requires a value`);
      values.set(arg, value);
    } else if (arg.startsWith("--")) {
      throw new Error(`Unknown option: ${arg}`);
    } else {
      positional.push(arg);
    }
  }
  if (positional.length > 1) throw new Error("Only one project root may be supplied");
  return { help: false, values, positional };
}

function directInvocation() {
  if (!process.argv[1]) return false;
  try {
    return fileURLToPath(import.meta.url) === realpathSync(process.argv[1]);
  } catch {
    return false;
  }
}

if (directInvocation()) {
  try {
    const parsed = parseArgs(process.argv.slice(2));
    if (parsed.help) {
      console.log("Usage: node tools/meta-mode/check-playbooks.mjs [--root <project-root>] [--bundled <playbooks>]\n\nChecks .agents/playbooks against bundled meta-mode playbooks.");
      process.exit(0);
    }
    const root = parsed.values.get("--root") ?? parsed.positional[0] ?? ".";
    const bundled = parsed.values.get("--bundled") ?? BUNDLED;
    const problems = checkPlaybooks(root, bundled);
    if (problems.length > 0) {
      console.error(problems.join("\n"));
      process.exitCode = 1;
    } else {
      console.log("Every project playbook matches this mstack's playbooks.");
    }
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
