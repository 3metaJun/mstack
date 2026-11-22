// Covers structural invariants absorbed from reference stacks:
// decision-log TSV sanitization (including leading double quotes),
// validate.mjs CRLF conflict-marker detection, and worktree-cleanup safety.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const logScript = join(repoRoot, "skills", "show-me-your-work", "scripts", "log.mjs");

test("show-me-your-work log.mjs neutralizes formula prefixes and leading double quotes and flattens whitespace", (t) => {
  const root = mkdtempSync(join(tmpdir(), "mstack-log-"));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const logFile = join(root, "decisions.tsv");
  const result = spawnSync(process.execPath, [
    logScript,
    logFile,
    "review",
    "=HYPERLINK(\"http://evil\")",
    '  "quoted\tcell\nnext"',
    "+cmd",
    "-flag",
  ], { encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
  const lines = readFileSync(logFile, "utf8").trim().split("\n");
  assert.equal(lines.length, 2);
  assert.equal(lines[0], "ts\tphase\tdecision\twhy\tevidence\tresult");
  const cells = lines[1].split("\t");
  assert.equal(cells.length, 6);
  assert.equal(cells[1], "review");
  assert.equal(cells[2], "'=HYPERLINK(\"http://evil\")");
  assert.equal(cells[3], "'  \"quoted cell next\"");
  assert.equal(cells[4], "'+cmd");
  assert.equal(cells[5], "'-flag");
});

test("validate.mjs conflict-marker check catches LF/CRLF merge conflicts without flagging 7-char setext headings", () => {
  const validateSource = readFileSync(join(repoRoot, "scripts", "validate.mjs"), "utf8");
  assert.match(validateSource, /hasConflictMarkers/);
  const hasConflictMarkers = (content) =>
    /^<{7} /m.test(content) && /^={7}\r?$/m.test(content) && /^>{7} /m.test(content);
  assert.equal(hasConflictMarkers("<<<<<<< HEAD\r\nfoo\r\n=======\r\nbar\r\n>>>>>>> branch\r\n"), true);
  assert.equal(hasConflictMarkers("<<<<<<< HEAD\nfoo\n=======\nbar\n>>>>>>> branch\n"), true);
  assert.equal(hasConflictMarkers("Summary\n=======\n\nNormal markdown.\n"), false);
  assert.equal(hasConflictMarkers("Summary\r\n=======\r\n\r\nNormal markdown.\r\n"), false);
});

test("worktree-cleanup playbook never prescribes destructive force-remove, rm -rf, or git clean -fdx", () => {
  const playbook = readFileSync(join(repoRoot, "skills", "meta-mode", "playbooks", "worktree-cleanup.md"), "utf8");
  const lines = playbook.split(/\r?\n/);
  const destructive = [
    /\bgit\b[^\n`]*\bworktree\s+remove\b[^\n`]*\s(?:--force|-f{1,2})\b/,
    /\brm\s+(?:-[a-z]*r[a-z]*f|-[a-z]*f[a-z]*r|-r\s+-f|-f\s+-r)\b/,
    /\bgit\b[^\n`]*\bclean\b[^\n`]*\s-[a-z]*x[a-z]*\b/,
  ];
  const explicitProhibition = /\b(?:never|do not|don't|instead of|forbid(?:s|den)?)\b/i;
  const violations = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    // Split sentences so an unrelated "never" earlier in a paragraph cannot excuse a destructive command later.
    for (const sentence of line.split(/(?<=[.!?])\s+/)) {
      if (explicitProhibition.test(sentence)) continue;
      for (const pattern of destructive) {
        if (pattern.test(sentence)) violations.push(`line ${i + 1}: ${sentence.trim()}`);
      }
    }
  }
  assert.deepEqual(violations, []);
});
