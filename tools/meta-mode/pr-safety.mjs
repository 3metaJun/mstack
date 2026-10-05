import { spawn } from "node:child_process";
import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export class DeadlineExceeded extends Error {
  constructor(message = "operation deadline reached") {
    super(message);
    this.name = "DeadlineExceeded";
  }
}

export class WatchDeadline {
  #expiresAt;
  constructor(timeoutMs = 0, now = () => performance.now()) {
    this.now = now;
    this.#expiresAt = timeoutMs > 0 ? now() + timeoutMs : Infinity;
  }
  remaining() { return Math.max(0, this.#expiresAt - this.now()); }
  assert() { if (this.remaining() === 0) throw new DeadlineExceeded(); }
}

function requiredText(value, key, pattern = null) {
  if (typeof value !== "string" || !value || value.trim() !== value || /[\u0000-\u001f\u007f]/.test(value)) {
    throw new TypeError(`invalid landing revision ${key}`);
  }
  if (pattern && !pattern.test(value)) throw new TypeError(`invalid landing revision ${key}`);
  return value;
}

function oid(value, key) {
  return requiredText(value, key, /^[0-9a-f]{40,64}$/i).toLowerCase();
}

export function parseLandingRevision(value) {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new TypeError("landing revision must be an object");
  if (!Number.isInteger(value.number) || value.number <= 0) throw new TypeError("invalid landing revision number");
  return {
    owner: requiredText(value.owner, "owner", /^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
    repo: requiredText(value.repo, "repo", /^[A-Za-z0-9][A-Za-z0-9_.-]*$/),
    number: value.number,
    headRefOid: oid(value.headRefOid, "headRefOid"),
    baseRefName: requiredText(value.baseRefName, "baseRefName"),
    baseRefOid: oid(value.baseRefOid, "baseRefOid"),
  };
}

export function sameLandingRevision(a, b) {
  const left = parseLandingRevision(a), right = parseLandingRevision(b);
  return left.owner.toLowerCase() === right.owner.toLowerCase() && left.repo.toLowerCase() === right.repo.toLowerCase() && left.number === right.number && left.headRefOid === right.headRefOid && left.baseRefName === right.baseRefName && left.baseRefOid === right.baseRefOid;
}

export function assertLandingRevision(expected, actual) {
  if (!sameLandingRevision(expected, actual)) throw new Error("landing revision changed while collecting safety evidence");
  return actual;
}

export function guardedMergeArgs({ forge = "gh", pr, head }) {
  if (!Number.isInteger(pr) || pr <= 0 || typeof head !== "string" || !head) throw new TypeError("merge requires a PR number and verified head SHA");
  if (forge === "gh") return ["pr", "merge", String(pr), "--match-head-commit", head];
  if (forge === "origin") return ["pr", "merge", String(pr), "--expected-head", head];
  throw new Error(`unsupported forge: ${forge}`);
}

export function runCommand(argv, deadline = new WatchDeadline()) {
  if (!Array.isArray(argv) || argv.length === 0) return Promise.reject(new TypeError("command argv must not be empty"));
  deadline.assert();
  return new Promise((resolvePromise, reject) => {
    const child = spawn(argv[0], argv.slice(1), { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "", stderr = "", expired = false, timer;
    const check = () => { const left = deadline.remaining(); if (!Number.isFinite(left)) return; if (left === 0) { expired = true; child.kill("SIGKILL"); } else timer = setTimeout(check, Math.min(left, 2_147_483_647)); };
    check();
    child.stdout.setEncoding("utf8"); child.stderr.setEncoding("utf8");
    child.stdout.on("data", chunk => { stdout += chunk; }); child.stderr.on("data", chunk => { stderr += chunk; });
    child.once("error", error => { clearTimeout(timer); reject(error); });
    child.once("close", code => { clearTimeout(timer); if (expired) reject(new DeadlineExceeded()); else resolvePromise({ code: code ?? -1, stdout, stderr }); });
  });
}

export async function runJsonCommand(argv, deadline) {
  const result = await runCommand(argv, deadline);
  if (result.code !== 0) throw new Error(result.stderr.trim().split(/\r?\n/, 1)[0] || `${argv[0]} exited ${result.code}`);
  try { return JSON.parse(result.stdout); } catch (error) { throw new Error(`invalid JSON from ${argv[0]}: ${error.message}`); }
}

export function resolveTool(relativePath, moduleUrl = import.meta.url) {
  const root = resolve(dirname(fileURLToPath(moduleUrl)), "../..");
  const target = resolve(root, relativePath);
  if (!existsSync(target)) throw new Error(`tool not found: ${relativePath}`);
  return realpathSync(target);
}
