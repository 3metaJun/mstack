#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
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
  return text.match(/^---\n([\s\S]*?)\n---\n/)?.[1] ?? "";
}

function field(text, key) {
  return frontmatter(text).match(new RegExp(`^${key}:[ \\t]*(.*)$`, "m"))?.[1].trim() ?? "";
}

function readPlaybook(root, stem) {
  const path = join(root, `${stem}.md`);
  return existsSync(path) ? readFileSync(path, "utf8").replaceAll("\r\n", "\n") : null;
}

function diagnostic(severity, message, code) {
  return { severity, message, code };
}

export function checkPlaybooksDetailed(root, bundled = BUNDLED) {
  const directory = join(resolve(root), ".agents", "playbooks");
  if (!existsSync(directory)) return { diagnostics: [], errors: [], warnings: [] };

  const diagnostics = [];
  const add = (severity, message, code) => diagnostics.push(diagnostic(severity, message, code));
  for (const name of readdirSync(directory).filter((file) => file.endsWith(".md")).sort()) {
    const relativePath = `.agents/playbooks/${name}`;
    const text = readFileSync(join(directory, name), "utf8").replaceAll("\r\n", "\n");
    const when = field(text, "when");
    if (!when) add("error", `${relativePath}: its frontmatter needs a "when:" line`, "missing-when");

    const extendsValue = field(text, "extends");
    const stems = extendsValue.split(",").map((stem) => stem.trim()).filter(Boolean);
    const seenStems = new Set();
    for (const stem of stems) {
      if (seenStems.has(stem)) {
        add("warning", `${relativePath}: extends \`${stem}\` more than once`, "duplicate-extends");
      }
      seenStems.add(stem);
    }
    const bases = stems.map((stem) => ({ stem, text: readPlaybook(bundled, stem) }));
    for (const base of bases) {
      if (base.text === null) add("error", `${relativePath}: extends \`${base.stem}\`, which this mstack has no playbook for`, "missing-base");
    }

    const anchors = new Map();
    for (const line of text.split("\n")) {
      if (CHANGE_VERB.test(line) && !CHANGE.test(line)) {
        add("error", `${relativePath}: a change has no straight-quoted step text to anchor on: ${line.trim().slice(0, 80)}`, "unquoted-anchor");
      }
      const anchor = line.match(CHANGE)?.[1];
      if (!anchor) continue;
      const normalized = flat(anchor);
      if (anchors.has(normalized)) add("warning", `${relativePath}: anchor "${anchor}" is repeated`, "duplicate-anchor");
      anchors.set(normalized, true);
      const matches = [];
      for (const base of [...new Map(bases.filter((base) => base.text).map((base) => [base.stem, base])).values()]) {
        const source = flat(base.text);
        let at = source.indexOf(normalized);
        while (at !== -1) {
          matches.push(base.stem);
          at = source.indexOf(normalized, at + normalized.length);
        }
      }
      if (matches.length === 0) {
        add("error", `${relativePath}: "${anchor}" is not in any playbook it extends`, "stale-anchor");
      } else if (matches.length > 1) {
        add("error", `${relativePath}: "${anchor}" is ambiguous in the playbooks it extends`, "ambiguous-anchor");
      }
    }
  }
  return {
    diagnostics,
    errors: diagnostics.filter((item) => item.severity === "error"),
    warnings: diagnostics.filter((item) => item.severity === "warning"),
  };
}

export function checkPlaybooks(root, bundled = BUNDLED) {
  return checkPlaybooksDetailed(root, bundled).diagnostics.map(({ message }) => message);
}

function parseArgs(args) {
  const values = new Map();
  const positional = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index];
    if (arg === "--help") return { help: true, values, positional };
    if (arg === "--json" || arg === "--strict") {
      if (values.has(arg)) throw new Error(`Duplicate option: ${arg}`);
      values.set(arg, true);
    } else if (arg === "--root" || arg === "--bundled") {
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
      console.log("Usage: node tools/meta-mode/check-playbooks.mjs [--root <project-root>] [--bundled <playbooks>] [--json] [--strict]\n\nChecks .agents/playbooks against bundled meta-mode playbooks. Warnings do not fail unless --strict is used.");
      process.exit(0);
    }
    const root = parsed.values.get("--root") ?? parsed.positional[0] ?? ".";
    const bundled = parsed.values.get("--bundled") ?? BUNDLED;
    const result = checkPlaybooksDetailed(root, bundled);
    const strict = parsed.values.has("--strict");
    const failed = result.errors.length > 0 || (strict && result.warnings.length > 0);
    if (parsed.values.has("--json")) {
      console.log(JSON.stringify({ ok: !failed, strict, errors: result.errors, warnings: result.warnings, diagnostics: result.diagnostics }, null, 2));
    } else if (result.diagnostics.length > 0) {
      for (const item of result.diagnostics) console.error(`${item.severity === "warning" ? "warning: " : ""}${item.message}`);
    } else {
      console.log("Every project playbook matches this mstack's playbooks.");
    }
    process.exitCode = failed ? 1 : 0;
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
