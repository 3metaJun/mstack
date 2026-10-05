#!/usr/bin/env node
// SessionStart hook for the mstack Claude Code plugin (hooks/hooks.json). It prints a
// short routing note to the session as additionalContext. One Node script serves
// Windows, macOS, and Linux, so there is no shell variant to keep in sync.
//
// Off switch: `"sessionHook": false` in ~/.config/mstack/models.json. Anything else,
// including a missing, unreadable, or malformed file, leaves the hook on. The hook
// never blocks a session: every failure ends in exit 0 with no output.
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
export const CONTEXT_FILE = join(repoRoot, "hooks", "session-start-context.md");

export function defaultConfigPath() {
  return join(homedir(), ".config", "mstack", "models.json");
}

// Windows PowerShell 5.1's `>` writes UTF-16 LE with a byte-order mark, and many
// editors add a UTF-8 one. JSON.parse rejects both, so decode and drop the mark first.
export function decodeText(bytes) {
  const text = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe
    ? bytes.toString("utf16le")
    : bytes.toString("utf8");
  return text.replace(/^﻿/, "");
}

export function sessionHookEnabled(configPath = defaultConfigPath()) {
  try {
    const config = JSON.parse(decodeText(readFileSync(configPath)));
    return config?.sessionHook !== false;
  } catch {
    return true;
  }
}

export function sessionStartOutput(context) {
  return JSON.stringify({
    hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
  });
}

export function run({ configPath = defaultConfigPath(), contextFile = CONTEXT_FILE } = {}) {
  try {
    if (!sessionHookEnabled(configPath)) return "";
    const context = decodeText(readFileSync(contextFile)).replace(/\r\n/g, "\n").trim();
    return context ? sessionStartOutput(context) : "";
  } catch {
    return "";
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const output = run();
  if (output) process.stdout.write(`${output}\n`);
}
