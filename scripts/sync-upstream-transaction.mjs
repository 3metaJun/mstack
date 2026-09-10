import {
  closeSync,
  existsSync,
  fchmodSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  rmdirSync,
  statSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { basename, dirname, isAbsolute, posix, relative, resolve, sep } from "node:path";

const LOCK_NAME = ".mstack-sync-upstream.lock";
const STATE_NAME = ".mstack-sync-upstream";
const SIDECAR_NAME = ".mstack-sync-upstream-tx";
const JOURNAL_VERSION = 1;
const HASH_PATTERN = /^[0-9a-f]{64}$/;
const RUNTIME_HOST = hostname();

function processStartIdentity(pid) {
  if (!Number.isSafeInteger(pid) || pid < 1) return undefined;
  if (process.platform === "linux") {
    try {
      const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
      const commandEnd = stat.lastIndexOf(")");
      if (commandEnd === -1) return undefined;
      const fields = stat.slice(commandEnd + 2).trim().split(/\s+/);
      return fields[19] ? `linux:${fields[19]}` : undefined;
    } catch {
      return undefined;
    }
  }
  if (process.platform === "win32") {
    try {
      const start = execFileSync(
        "powershell.exe",
        [
          "-NoProfile",
          "-NonInteractive",
          "-Command",
          `$p = Get-Process -Id ${pid} -ErrorAction SilentlyContinue; if ($null -ne $p) { $p.StartTime.ToFileTimeUtc() }`,
        ],
        { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] },
      ).trim();
      return start ? `windows:${start}` : undefined;
    } catch {
      return undefined;
    }
  }
  if (process.platform === "darwin") {
    try {
      const start = execFileSync("ps", ["-p", String(pid), "-o", "lstart="], {
        encoding: "utf8",
        stdio: ["ignore", "pipe", "ignore"],
      }).trim();
      return start ? `darwin:${start}` : undefined;
    } catch {
      return undefined;
    }
  }
  return undefined;
}

function processLiveness(pid) {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (error) {
    if (error.code === "ESRCH") return "dead";
    return "unknown";
  }
}

function ownerLiveness(owner) {
  const liveness = processLiveness(owner.pid);
  if (liveness === "dead") return "dead";
  if (owner.host !== RUNTIME_HOST || owner.platform !== process.platform) return "unknown";
  if (typeof owner.start !== "string" || owner.start.length === 0) return "unknown";
  const actualStart = processStartIdentity(owner.pid);
  if (!actualStart) return "unknown";
  return actualStart === owner.start ? "alive" : "dead";
}

function currentOwner() {
  return {
    version: 2,
    pid: process.pid,
    token: randomUUID(),
    host: RUNTIME_HOST,
    platform: process.platform,
    start: processStartIdentity(process.pid) ?? null,
  };
}

function assertOwnerShape(owner, label) {
  if (!owner || !Number.isSafeInteger(owner.pid) || owner.pid < 1 ||
      typeof owner.token !== "string" || owner.token.length === 0) {
    throw new Error(`Invalid upstream sync ${label}.`);
  }
  if (owner.version !== undefined && ![1, 2].includes(owner.version)) {
    throw new Error(`Invalid upstream sync ${label}.`);
  }
  if (owner.host !== undefined && typeof owner.host !== "string") {
    throw new Error(`Invalid upstream sync ${label}.`);
  }
  if (owner.platform !== undefined && typeof owner.platform !== "string") {
    throw new Error(`Invalid upstream sync ${label}.`);
  }
  if (owner.start !== undefined && owner.start !== null && typeof owner.start !== "string") {
    throw new Error(`Invalid upstream sync ${label}.`);
  }
}

function digest(value) {
  return createHash("sha256").update(value).digest("hex");
}

function fsyncDirectory(path) {
  let descriptor;
  try {
    descriptor = openSync(path, "r");
    fsyncSync(descriptor);
  } catch (error) {
    const unsupportedOnWindows = process.platform === "win32" &&
      ["EACCES", "EBADF", "EINVAL", "EISDIR", "ENOTSUP", "EPERM"].includes(error.code);
    if (!unsupportedOnWindows) throw error;
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}

function writeDurableFile(path, content, mode = 0o600) {
  const descriptor = openSync(path, "wx", mode);
  try {
    writeFileSync(descriptor, content);
    fchmodSync(descriptor, mode);
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
  fsyncDirectory(dirname(path));
}

function createDurableMarker(transactionPath, name, content) {
  const temporaryPath = resolve(transactionPath, `${name}.tmp`);
  const markerPath = resolve(transactionPath, name);
  writeDurableFile(temporaryPath, content);
  durableRename(temporaryPath, markerPath);
}

function durableRename(from, to) {
  renameSync(from, to);
  fsyncDirectory(dirname(from));
  if (dirname(to) !== dirname(from)) fsyncDirectory(dirname(to));
}

function durableUnlink(path) {
  unlinkSync(path);
  fsyncDirectory(dirname(path));
}

function lstatIfPresent(path) {
  try {
    return lstatSync(path);
  } catch (error) {
    if (error.code === "ENOENT") return undefined;
    throw error;
  }
}

function readRegularFile(path, label) {
  const status = lstatIfPresent(path);
  if (!status || !status.isFile() || status.isSymbolicLink()) {
    throw new Error(`${label} is missing or is not a regular file: ${path}`);
  }
  return readFileSync(path);
}

function markerExists(transactionPath, name) {
  const path = resolve(transactionPath, name);
  const status = lstatIfPresent(path);
  if (!status) return false;
  if (!status.isFile() || status.isSymbolicLink()) {
    throw new Error(`Invalid upstream sync transaction marker: ${path}`);
  }
  return true;
}

function fingerprint(path) {
  const status = lstatIfPresent(path);
  if (!status) return { kind: "absent" };
  if (!status.isFile()) throw new Error(`Upstream sync target is not a regular file: ${path}`);
  return {
    kind: "file",
    sha256: digest(readFileSync(path)),
    mode: statSync(path).mode & 0o777,
  };
}

export function captureUpstreamSyncFingerprint(path) {
  return fingerprint(path);
}

function fingerprintsEqual(left, right) {
  return left.kind === right.kind &&
    (left.kind === "absent" || (left.sha256 === right.sha256 && left.mode === right.mode));
}

function describeFingerprint(value) {
  return value.kind === "absent" ? "absent" : `${value.sha256} mode ${value.mode.toString(8)}`;
}

function assertFingerprint(path, expected, label) {
  const actual = fingerprint(path);
  if (!fingerprintsEqual(actual, expected)) {
    throw new Error(
      `${label} changed unexpectedly: ${path}\n` +
      `Expected ${describeFingerprint(expected)}, found ${describeFingerprint(actual)}.`,
    );
  }
}

function normalizedRelativePath(value, label) {
  if (typeof value !== "string" || value.length === 0 || value.includes("\\")) {
    throw new Error(`Invalid upstream sync transaction ${label}.`);
  }
  if (posix.isAbsolute(value) || isAbsolute(value)) {
    throw new Error(`Upstream sync transaction ${label} must stay inside the target checkout: ${value}`);
  }
  const normalized = posix.normalize(value);
  if (normalized !== value || value === "." || value === ".." || value.startsWith("../")) {
    throw new Error(`Upstream sync transaction ${label} must stay inside the target checkout: ${value}`);
  }
  return value;
}

function resolveInside(root, path, label) {
  const normalized = normalizedRelativePath(path, label);
  const candidate = resolve(root, ...normalized.split("/"));
  const fromRoot = relative(root, candidate);
  if (fromRoot === ".." || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
    throw new Error(`Upstream sync transaction ${label} resolves outside the target checkout: ${path}`);
  }

  let existing = candidate;
  while (!lstatIfPresent(existing)) {
    const parent = dirname(existing);
    if (parent === existing) {
      throw new Error(`Cannot validate upstream sync transaction ${label}: ${path}`);
    }
    existing = parent;
  }
  const fromRealRoot = relative(realpathSync(root), realpathSync(existing));
  if (fromRealRoot === ".." || fromRealRoot.startsWith(`..${sep}`) || isAbsolute(fromRealRoot)) {
    throw new Error(`Upstream sync transaction ${label} escapes the target checkout through a link: ${path}`);
  }
  return candidate;
}

function sidecarPath(target, id, index, suffix) {
  return posix.join(posix.dirname(target), SIDECAR_NAME, id, `${index}.${suffix}`);
}

function localPathKey(path) {
  return process.platform === "win32" || process.platform === "darwin" ? path.toLowerCase() : path;
}

function pathsOverlap(left, right) {
  const leftKey = localPathKey(left);
  const rightKey = localPathKey(right);
  return leftKey === rightKey || leftKey.startsWith(`${rightKey}/`) || rightKey.startsWith(`${leftKey}/`);
}

function assertTargetDoesNotOverlap(targets, target, label) {
  const overlap = targets.find((candidate) => pathsOverlap(candidate, target));
  if (overlap) throw new Error(`Overlapping targets in ${label}: ${overlap} and ${target}`);
}

function assertReservedTransactionTarget(target, label) {
  if (target.split("/").some((part) => [LOCK_NAME, STATE_NAME, SIDECAR_NAME].includes(part))) {
    throw new Error(`Upstream sync ${label} uses a reserved transaction path: ${target}`);
  }
}

function targetRootIdentity(path) {
  let normalized = path.replaceAll("\\", "/");
  const windowsDrive = normalized.match(/^([A-Za-z]):(?:\/|$)/);
  if (windowsDrive) normalized = `/mnt/${windowsDrive[1].toLowerCase()}${normalized.slice(2)}`;
  normalized = normalized.replace(/\/+$/, "");
  return process.platform === "win32" || normalized.startsWith("/mnt/") ? normalized.toLowerCase() : normalized;
}

function assertFingerprintShape(value, label) {
  if (!value || typeof value !== "object" || !["absent", "file"].includes(value.kind)) {
    throw new Error(`Invalid upstream sync transaction ${label}.`);
  }
  if (value.kind === "file" &&
      (!HASH_PATTERN.test(value.sha256) || !Number.isInteger(value.mode) || value.mode < 0 || value.mode > 0o777)) {
    throw new Error(`Invalid upstream sync transaction ${label}.`);
  }
}

function transactionRoots(targetRoot) {
  const stateRoot = resolve(targetRoot, STATE_NAME);
  const transactionsRoot = resolve(stateRoot, "transactions");
  for (const [path, label] of [[stateRoot, "state root"], [transactionsRoot, "transactions root"]]) {
    const status = lstatIfPresent(path);
    if (status && (!status.isDirectory() || status.isSymbolicLink())) {
      throw new Error(`Invalid upstream sync ${label}: ${path}`);
    }
    if (status) {
      const fromTarget = relative(realpathSync(targetRoot), realpathSync(path));
      if (fromTarget === ".." || fromTarget.startsWith(`..${sep}`) || isAbsolute(fromTarget)) {
        throw new Error(`Upstream sync ${label} escapes the target checkout: ${path}`);
      }
    }
  }
  return {
    stateRoot,
    transactionsRoot,
  };
}

function readJournal(targetRoot, transactionPath, id) {
  const journalPath = resolve(transactionPath, "journal.json");
  let journal;
  try {
    journal = JSON.parse(readRegularFile(journalPath, "Upstream sync transaction journal").toString("utf8"));
  } catch (error) {
    throw new Error(`Invalid upstream sync transaction journal at ${journalPath}: ${error.message}`, { cause: error });
  }

  if (!journal || typeof journal !== "object" || journal.version !== JOURNAL_VERSION || journal.id !== id) {
    throw new Error(`Invalid upstream sync transaction journal at ${journalPath}.`);
  }
  assertOwnerShape(journal.owner, `transaction owner at ${journalPath}`);
  if (typeof journal.targetRoot !== "string" || journal.targetRoot.length === 0 ||
      targetRootIdentity(journal.targetRoot) !== targetRootIdentity(realpathSync(targetRoot))) {
    throw new Error(`Invalid upstream sync transaction target root at ${journalPath}.`);
  }
  if (!Array.isArray(journal.createdDirectories) || !Array.isArray(journal.operations) || !journal.operations.length) {
    throw new Error(`Invalid upstream sync transaction journal at ${journalPath}.`);
  }

  const createdDirectories = new Set();
  for (const [index, path] of journal.createdDirectories.entries()) {
    normalizedRelativePath(path, `createdDirectories[${index}]`);
    assertReservedTransactionTarget(path, `createdDirectories[${index}]`);
    resolveInside(targetRoot, path, `createdDirectories[${index}]`);
    if (createdDirectories.has(path)) throw new Error(`Duplicate directory in upstream sync transaction: ${path}`);
    createdDirectories.add(path);
  }

  const targets = [];
  for (const [index, operation] of journal.operations.entries()) {
    if (!operation || typeof operation !== "object" ||
        !["write", "remove", "manifest"].includes(operation.kind)) {
      throw new Error(`Invalid upstream sync transaction operation ${index}.`);
    }
    normalizedRelativePath(operation.target, `operations[${index}].target`);
    assertReservedTransactionTarget(operation.target, `operations[${index}].target`);
    resolveInside(targetRoot, operation.target, `operations[${index}].target`);
    assertTargetDoesNotOverlap(targets, operation.target, "upstream sync transaction");
    targets.push(operation.target);

    const expectedBackup = sidecarPath(operation.target, id, index, "old");
    const expectedStage = operation.kind === "remove" ? null : sidecarPath(operation.target, id, index, "new");
    if (operation.backup !== expectedBackup || operation.stage !== expectedStage) {
      throw new Error(`Invalid sidecar path in upstream sync transaction operation ${index}.`);
    }
    resolveInside(targetRoot, operation.backup, `operations[${index}].backup`);
    if (operation.stage !== null) resolveInside(targetRoot, operation.stage, `operations[${index}].stage`);
    assertFingerprintShape(operation.before, `operations[${index}].before`);
    assertFingerprintShape(operation.after, `operations[${index}].after`);
    if (operation.kind === "remove" && operation.after.kind !== "absent") {
      throw new Error(`Invalid removal state in upstream sync transaction operation ${index}.`);
    }
    if (operation.kind !== "remove" && operation.after.kind !== "file") {
      throw new Error(`Invalid write state in upstream sync transaction operation ${index}.`);
    }
  }

  const manifest = journal.operations.at(-1);
  if (manifest.kind !== "manifest" || manifest.target !== "profiles/upstream-manifest.json") {
    throw new Error(`Upstream sync transaction journal does not commit the manifest last: ${journalPath}`);
  }
  return journal;
}

function listTransactions(targetRoot) {
  const { transactionsRoot } = transactionRoots(targetRoot);
  if (!existsSync(transactionsRoot)) return [];
  return readdirSync(transactionsRoot, { withFileTypes: true })
    .map((entry) => {
      if (!entry.isDirectory()) {
        throw new Error(`Invalid entry in upstream sync transaction directory: ${resolve(transactionsRoot, entry.name)}`);
      }
      return entry.name;
    })
    .sort();
}

function removeEmptyDirectory(path) {
  try {
    rmdirSync(path);
    fsyncDirectory(dirname(path));
  } catch (error) {
    if (!["ENOENT", "ENOTEMPTY", "EEXIST"].includes(error.code)) throw error;
  }
}

function removeIfPresent(path) {
  const status = lstatIfPresent(path);
  if (!status) return;
  if (!status.isFile() || status.isSymbolicLink()) {
    throw new Error(`Refusing to remove non-file upstream sync state: ${path}`);
  }
  durableUnlink(path);
}

function removeExpectedFile(path, expected, label) {
  if (!lstatIfPresent(path)) return;
  assertFingerprint(path, expected, label);
  durableUnlink(path);
}

function removeOwnedEmptyDirectory(path) {
  const status = lstatIfPresent(path);
  if (!status) return;
  if (!status.isDirectory() || status.isSymbolicLink()) {
    throw new Error(`Invalid upstream sync sidecar directory: ${path}`);
  }
  const entries = readdirSync(path);
  if (entries.length) {
    throw new Error(`Unexpected content in upstream sync sidecar directory: ${path}\n${entries.join("\n")}`);
  }
  rmdirSync(path);
  fsyncDirectory(dirname(path));
}

function cleanupEmptyStateRoots(targetRoot) {
  const { stateRoot, transactionsRoot } = transactionRoots(targetRoot);
  removeEmptyDirectory(transactionsRoot);
  removeEmptyDirectory(stateRoot);
}

function cleanupAbandonedJournalWrite(targetRoot, transactionPath) {
  const entries = readdirSync(transactionPath);
  const completedCleanup = entries.includes("COMMITTED") &&
    entries.every((entry) => entry === "COMMITTED" || entry === "COMMITTED.tmp");
  const abandonedJournal = entries.every((entry) => entry === "journal.json.tmp");
  if (!completedCleanup && !abandonedJournal) {
    throw new Error(`Invalid incomplete upstream sync transaction at ${transactionPath}.`);
  }
  removeIfPresent(resolve(transactionPath, "COMMITTED.tmp"));
  removeIfPresent(resolve(transactionPath, "COMMITTED"));
  removeIfPresent(resolve(transactionPath, "journal.json.tmp"));
  removeEmptyDirectory(transactionPath);
  cleanupEmptyStateRoots(targetRoot);
}

function transactionPaths(targetRoot, journal) {
  return journal.operations.map((operation, index) => ({
    ...operation,
    index,
    targetPath: resolveInside(targetRoot, operation.target, "operation target"),
    stagePath: operation.stage === null ? undefined : resolveInside(targetRoot, operation.stage, "operation stage"),
    backupPath: resolveInside(targetRoot, operation.backup, "operation backup"),
  }));
}

function quarantineUnknownTarget(targetRoot, transactionPath, operation) {
  const { stateRoot } = transactionRoots(targetRoot);
  const recoveryRoot = resolve(stateRoot, "recovery", basename(transactionPath));
  resolveInside(
    targetRoot,
    relative(targetRoot, recoveryRoot).split(sep).join("/"),
    "upstream sync recovery directory",
  );
  mkdirSync(recoveryRoot, { recursive: true, mode: 0o700 });
  fsyncDirectory(dirname(recoveryRoot));
  fsyncDirectory(recoveryRoot);
  const recoveryPath = resolve(recoveryRoot, `${operation.index}.user`);
  if (lstatIfPresent(recoveryPath)) {
    throw new Error(`Recovery file already exists: ${recoveryPath}`);
  }
  durableRename(operation.targetPath, recoveryPath);
  return { path: recoveryPath, target: operation.target };
}

function rollbackOperation(targetRoot, transactionPath, operation) {
  const backup = lstatIfPresent(operation.backupPath);
  let current = fingerprint(operation.targetPath);
  let quarantined;

  if (operation.before.kind === "file") {
    if (backup) {
      assertFingerprint(operation.backupPath, operation.before, "Upstream sync backup");
      if (current.kind !== "absent" &&
          !fingerprintsEqual(current, operation.before) && !fingerprintsEqual(current, operation.after)) {
        quarantined = quarantineUnknownTarget(targetRoot, transactionPath, operation);
        current = { kind: "absent" };
      }
      if (current.kind === "absent") {
        durableRename(operation.backupPath, operation.targetPath);
      } else if (fingerprintsEqual(current, operation.after)) {
        durableUnlink(operation.targetPath);
        durableRename(operation.backupPath, operation.targetPath);
      } else if (fingerprintsEqual(current, operation.before)) {
        durableUnlink(operation.backupPath);
      } else {
        throw new Error(`Refusing to overwrite an unknown file while rolling back: ${operation.targetPath}`);
      }
    } else if (!fingerprintsEqual(current, operation.before)) {
      throw new Error(`Cannot restore upstream sync target because its backup is missing: ${operation.targetPath}`);
    }
  } else {
    if (backup) throw new Error(`Unexpected backup for a newly created target: ${operation.backupPath}`);
    if (fingerprintsEqual(current, operation.after)) {
      durableUnlink(operation.targetPath);
    } else if (current.kind !== "absent") {
      quarantined = quarantineUnknownTarget(targetRoot, transactionPath, operation);
      current = { kind: "absent" };
    }
  }

  if (operation.stagePath) removeExpectedFile(operation.stagePath, operation.after, "Upstream sync staged file");
  assertFingerprint(operation.targetPath, operation.before, "Rolled back upstream sync target");
  return quarantined;
}

function rollbackJournal(targetRoot, transactionPath, journal) {
  const errors = [];
  const quarantined = [];
  for (const operation of transactionPaths(targetRoot, journal).reverse()) {
    try {
      const result = rollbackOperation(targetRoot, transactionPath, operation);
      if (result) quarantined.push(result);
    } catch (error) {
      errors.push(`${operation.target}: ${error.message}`);
    }
  }
  if (errors.length) throw new Error(errors.join("\n"));
  return quarantined;
}

function cleanupTransaction(targetRoot, transactionPath, journal) {
  const sidecarTransactions = new Set();
  for (const operation of transactionPaths(targetRoot, journal)) {
    if (operation.stagePath) removeExpectedFile(operation.stagePath, operation.after, "Upstream sync staged file");
    if (lstatIfPresent(operation.backupPath)) {
      assertFingerprint(operation.backupPath, operation.before, "Upstream sync backup");
      durableUnlink(operation.backupPath);
    }
    sidecarTransactions.add(dirname(operation.backupPath));
  }

  for (const path of sidecarTransactions) {
    removeOwnedEmptyDirectory(path);
    removeEmptyDirectory(dirname(path));
  }
  for (const path of [...journal.createdDirectories].reverse()) {
    removeEmptyDirectory(resolveInside(targetRoot, path, "created directory"));
  }
  removeIfPresent(resolve(transactionPath, "COMMITTING.tmp"));
  removeIfPresent(resolve(transactionPath, "COMMITTING"));
  removeIfPresent(resolve(transactionPath, "COMMITTED.tmp"));
  const allowedEntries = new Set(["COMMITTED", "journal.json", "journal.json.tmp"]);
  const unknownEntries = readdirSync(transactionPath).filter((entry) => !allowedEntries.has(entry));
  if (unknownEntries.length) {
    throw new Error(`Unexpected content in upstream sync transaction directory: ${transactionPath}\n${unknownEntries.join("\n")}`);
  }
  removeIfPresent(resolve(transactionPath, "journal.json"));
  removeIfPresent(resolve(transactionPath, "journal.json.tmp"));
  // Keep COMMITTED until the journal is gone so cleanup cannot be mistaken for rollback.
  removeIfPresent(resolve(transactionPath, "COMMITTED"));
  removeEmptyDirectory(transactionPath);
  cleanupEmptyStateRoots(targetRoot);
}

function validateCommittedTargets(targetRoot, journal) {
  for (const operation of transactionPaths(targetRoot, journal)) {
    assertFingerprint(operation.targetPath, operation.after, "Committed upstream sync target");
  }
}

function lockOwnerText(owner) {
  return JSON.stringify(owner);
}

function assertLockOwned(lock) {
  let current;
  try {
    current = JSON.parse(readRegularFile(lock.lockPath, "Upstream sync lock").toString("utf8"));
  } catch (error) {
    throw new Error(`Upstream sync lost its lock: ${lock.lockPath}`, { cause: error });
  }
  if (current.pid !== lock.owner.pid || current.token !== lock.owner.token) {
    throw new Error(`Upstream sync lost its lock to another process: ${lock.lockPath}`);
  }
}

function createOwnedLock(lockPath, owner) {
  const temporaryPath = `${lockPath}.${owner.pid}.${owner.token}.tmp`;
  let published = false;
  try {
    writeDurableFile(temporaryPath, `${lockOwnerText(owner)}\n`);
    try {
      linkSync(temporaryPath, lockPath);
    } catch (error) {
      if (["EPERM", "EOPNOTSUPP", "ENOTSUP", "EXDEV"].includes(error.code)) {
        throw new Error(
          `Upstream sync requires hard links for its lock on this filesystem: ${lockPath}`,
          { cause: error },
        );
      }
      throw error;
    }
    published = true;
    fsyncDirectory(dirname(lockPath));
    durableUnlink(temporaryPath);
    return owner;
  } catch (error) {
    try {
      if (published &&
          readRegularFile(lockPath, "Upstream sync lock").toString("utf8").trim() === lockOwnerText(owner)) {
        durableUnlink(lockPath);
      }
    } catch {
      // Keep the original lock creation error.
    }
    try {
      if (existsSync(temporaryPath)) durableUnlink(temporaryPath);
    } catch {
      // Keep the original lock creation error.
    }
    throw error;
  }
}

function removeDeadLockInitializers(targetRoot) {
  const prefix = `${LOCK_NAME}.`;
  for (const entry of readdirSync(targetRoot, { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(prefix) || !entry.name.endsWith(".tmp")) continue;
    const match = entry.name.match(/^\.mstack-sync-upstream\.lock\.(?:takeover\.)?([1-9]\d*)\.([0-9a-f-]+)\.tmp$/);
    if (!match) continue;
    const initializerPath = resolve(targetRoot, entry.name);
    let initializer;
    try {
      initializer = JSON.parse(readRegularFile(initializerPath, "upstream sync lock initializer").toString("utf8"));
      assertOwnerShape(initializer, `lock initializer at ${initializerPath}`);
    } catch (error) {
      throw new Error(`Invalid upstream sync lock initializer: ${initializerPath}`, { cause: error });
    }
    if (ownerLiveness(initializer) !== "dead") {
      throw new Error(`Another upstream sync is initializing its lock: ${initializerPath}`);
    }
    try {
      durableUnlink(initializerPath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
}

function acquireTakeoverGuard(guardPath, owner) {
  const reclaimPrefix = `${basename(guardPath)}.`;
  for (const entry of readdirSync(dirname(guardPath), { withFileTypes: true })) {
    if (!entry.isFile() || !entry.name.startsWith(reclaimPrefix) || !entry.name.endsWith(".reclaimed")) continue;
    const reclaimedPath = resolve(dirname(guardPath), entry.name);
    let reclaimedOwner;
    try {
      reclaimedOwner = JSON.parse(readRegularFile(reclaimedPath, "upstream sync takeover claim").toString("utf8"));
    } catch (error) {
      throw new Error(`Invalid upstream sync takeover claim: ${reclaimedPath}`, { cause: error });
    }
    assertOwnerShape(reclaimedOwner, `takeover claim at ${reclaimedPath}`);
    if (ownerLiveness(reclaimedOwner) !== "dead") {
      throw new Error(`Another upstream sync is recovering the lock: ${reclaimedPath}`);
    }
    durableUnlink(reclaimedPath);
  }
  try {
    return { lockPath: guardPath, owner: createOwnedLock(guardPath, owner) };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }
  let current;
  try {
    current = JSON.parse(readRegularFile(guardPath, "upstream sync takeover guard").toString("utf8"));
  } catch (error) {
    throw new Error(`Invalid or initializing upstream sync takeover guard: ${guardPath}`, { cause: error });
  }
  try {
    assertOwnerShape(current, `takeover guard at ${guardPath}`);
  } catch (error) {
    throw new Error(`Invalid upstream sync takeover guard: ${guardPath}`, { cause: error });
  }
  if (ownerLiveness(current) !== "dead") {
    throw new Error(`Another upstream sync is recovering the lock: ${guardPath}`);
  }
  const reclaimedPath = `${guardPath}.${owner.token}.reclaimed`;
  try {
    durableRename(guardPath, reclaimedPath);
  } catch (error) {
    if (error.code === "ENOENT" || error.code === "EEXIST") {
      throw new Error(`Another upstream sync is recovering the lock: ${guardPath}`, { cause: error });
    }
    throw error;
  }
  try {
    return { lockPath: guardPath, owner: createOwnedLock(guardPath, owner) };
  } catch (error) {
    if (error.code === "EEXIST") throw new Error(`Another upstream sync is recovering the lock: ${guardPath}`, { cause: error });
    throw error;
  } finally {
    if (lstatIfPresent(reclaimedPath)) durableUnlink(reclaimedPath);
  }
}

export function acquireUpstreamSyncLock(targetRoot, { recoverStale = true } = {}) {
  const lockPath = resolve(targetRoot, LOCK_NAME);
  const owner = currentOwner();
  removeDeadLockInitializers(targetRoot);
  try {
    return { lockPath, owner: createOwnedLock(lockPath, owner) };
  } catch (error) {
    if (error.code !== "EEXIST") throw error;
  }

  let current;
  try {
    current = JSON.parse(readRegularFile(lockPath, "Upstream sync lock").toString("utf8"));
  } catch (error) {
    throw new Error(`Invalid or initializing upstream sync lock: ${lockPath}`, { cause: error });
  }
  try {
    assertOwnerShape(current, `lock at ${lockPath}`);
  } catch (error) {
    throw new Error(`Invalid upstream sync lock: ${lockPath}`, { cause: error });
  }
  const currentLiveness = ownerLiveness(current);
  if (currentLiveness === "alive") {
    throw new Error(`Another live upstream sync owns the lock: ${lockPath}`);
  }
  if (currentLiveness === "unknown") {
    throw new Error(`Cannot verify the upstream sync lock owner; verify no sync is running, then remove ${lockPath} and retry.`);
  }
  if (!recoverStale) {
    throw new Error(`Target has an active or interrupted upstream sync; rerun sync-upstream with --apply: ${lockPath}`);
  }

  const guardPath = `${lockPath}.takeover`;
  let guard;
  try {
    guard = acquireTakeoverGuard(guardPath, owner);
    let guardedCurrent;
    try {
      guardedCurrent = JSON.parse(readRegularFile(lockPath, "Upstream sync lock").toString("utf8"));
    } catch (error) {
      throw new Error(`Invalid or initializing upstream sync lock: ${lockPath}`, { cause: error });
    }
    try {
      assertOwnerShape(guardedCurrent, `lock at ${lockPath}`);
    } catch (error) {
      throw new Error(`Invalid upstream sync lock: ${lockPath}`, { cause: error });
    }
    const guardedLiveness = ownerLiveness(guardedCurrent);
    if (guardedLiveness === "alive") {
      throw new Error(`Another live upstream sync owns the lock: ${lockPath}`);
    }
    if (guardedLiveness === "unknown") {
      throw new Error(`Cannot verify the upstream sync lock owner; verify no sync is running, then remove ${lockPath} and retry.`);
    }
    durableUnlink(lockPath);
    try {
      return { lockPath, owner: createOwnedLock(lockPath, owner) };
    } catch (error) {
      if (error.code === "EEXIST") throw new Error(`Another upstream sync became active: ${lockPath}`, { cause: error });
      throw error;
    }
  } finally {
    if (guard) releaseUpstreamSyncLock(guard);
  }
}

export function releaseUpstreamSyncLock(lock) {
  let current;
  try {
    current = JSON.parse(readRegularFile(lock.lockPath, "Upstream sync lock").toString("utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return;
    throw error;
  }
  if (current.pid !== lock.owner.pid || current.token !== lock.owner.token) {
    throw new Error(`Refusing to release an upstream sync lock owned by another process: ${lock.lockPath}`);
  }
  durableUnlink(lock.lockPath);
}

export function assertUpstreamSyncTargetReadable(targetRoot, heldLock) {
  if (heldLock) assertLockOwned(heldLock);
  const lockPath = resolve(targetRoot, LOCK_NAME);
  const transactions = listTransactions(targetRoot);
  if ((!heldLock && existsSync(lockPath)) || transactions.length) {
    throw new Error(`Target has an active or interrupted upstream sync; rerun sync-upstream with --apply: ${targetRoot}`);
  }
}

export function recoverUpstreamSyncTransactions(targetRoot, lock) {
  assertLockOwned(lock);
  let recovered = 0;
  const quarantined = [];
  for (const id of listTransactions(targetRoot)) {
    assertLockOwned(lock);
    normalizedRelativePath(id, "transaction id");
    if (id.includes("/")) throw new Error(`Invalid upstream sync transaction id: ${id}`);
    const { transactionsRoot } = transactionRoots(targetRoot);
    const transactionPath = resolve(transactionsRoot, id);
    const journalPath = resolve(transactionPath, "journal.json");
    if (!existsSync(journalPath)) {
      cleanupAbandonedJournalWrite(targetRoot, transactionPath);
      recovered += 1;
      continue;
    }

    const journal = readJournal(targetRoot, transactionPath, id);
    if (journal.owner.pid === process.pid && journal.owner.token !== lock.owner.token) {
      throw new Error(`Upstream sync transaction owner token does not match the current lock: ${transactionPath}`);
    }
    const transactionLiveness = ownerLiveness(journal.owner);
    if (transactionLiveness === "alive" && journal.owner.token !== lock.owner.token) {
      throw new Error(`Upstream sync transaction is still owned by live process ${journal.owner.pid}: ${transactionPath}`);
    }
    if (transactionLiveness === "unknown") {
      throw new Error(
        `Cannot verify the upstream sync transaction owner; verify no sync is running, then inspect ${transactionPath}.`,
      );
    }
    if (!markerExists(transactionPath, "COMMITTED")) {
      quarantined.push(...rollbackJournal(targetRoot, transactionPath, journal).map((item) => ({ id, ...item })));
    }
    cleanupTransaction(targetRoot, transactionPath, journal);
    recovered += 1;
  }
  assertLockOwned(lock);
  return { count: recovered, quarantined };
}

function missingParentDirectories(targetRoot, targetPath) {
  const missing = [];
  let current = dirname(targetPath);
  while (current !== targetRoot) {
    const status = lstatIfPresent(current);
    if (status) {
      if (!status.isDirectory()) throw new Error(`Upstream sync target parent is not a directory: ${current}`);
      break;
    }
    missing.push(current);
    current = dirname(current);
  }
  return missing.reverse();
}

function buildJournal(targetRoot, id, changes, lock) {
  if (!Array.isArray(changes) || !changes.length) throw new Error("Upstream sync transaction has no operations.");
  const targets = [];
  const createdDirectories = new Set();
  const operations = changes.map((change, index) => {
    if (!change || !["write", "remove", "manifest"].includes(change.kind)) {
      throw new Error(`Invalid upstream sync change ${index}.`);
    }
    const target = normalizedRelativePath(change.target, `change ${index} target`);
    assertReservedTransactionTarget(target, `change ${index} target`);
    assertTargetDoesNotOverlap(targets, target, "upstream sync transaction");
    targets.push(target);
    const targetPath = resolveInside(targetRoot, target, `change ${index} target`);
    for (const path of missingParentDirectories(targetRoot, targetPath)) {
      createdDirectories.add(relative(targetRoot, path).split(sep).join("/"));
    }

    const before = fingerprint(targetPath);
    assertFingerprintShape(change.before, `change ${index} before`);
    if (!fingerprintsEqual(before, change.before)) {
      throw new Error(`Upstream sync target changed after planning: ${targetPath}`);
    }
    let after;
    if (change.kind === "remove") {
      if (change.content !== undefined) throw new Error(`Removal has unexpected content: ${target}`);
      after = { kind: "absent" };
    } else {
      if (!Buffer.isBuffer(change.content)) throw new Error(`Write has no Buffer content: ${target}`);
      after = {
        kind: "file",
        sha256: digest(change.content),
        mode: before.kind === "file" ? before.mode : 0o666 & ~process.umask(),
      };
    }
    return {
      kind: change.kind,
      target,
      stage: change.kind === "remove" ? null : sidecarPath(target, id, index, "new"),
      backup: sidecarPath(target, id, index, "old"),
      before,
      after,
    };
  });

  const manifest = operations.at(-1);
  if (manifest.kind !== "manifest" || manifest.target !== "profiles/upstream-manifest.json") {
    throw new Error("Upstream sync transaction must write the manifest last.");
  }
  return {
    version: JOURNAL_VERSION,
    id,
    owner: lock.owner,
    targetRoot: realpathSync(targetRoot),
    createdDirectories: [...createdDirectories],
    operations,
  };
}

function createJournal(targetRoot, journal) {
  const { stateRoot, transactionsRoot } = transactionRoots(targetRoot);
  const transactionPath = resolve(transactionsRoot, journal.id);
  mkdirSync(transactionPath, { recursive: true, mode: 0o700 });
  transactionRoots(targetRoot);
  const transactionStatus = lstatSync(transactionPath);
  const fromTarget = relative(realpathSync(targetRoot), realpathSync(transactionPath));
  if (!transactionStatus.isDirectory() || transactionStatus.isSymbolicLink() ||
      fromTarget === ".." || fromTarget.startsWith(`..${sep}`) || isAbsolute(fromTarget)) {
    throw new Error(`Invalid upstream sync transaction directory: ${transactionPath}`);
  }
  fsyncDirectory(targetRoot);
  fsyncDirectory(stateRoot);
  fsyncDirectory(transactionsRoot);
  const temporaryPath = resolve(transactionPath, "journal.json.tmp");
  const journalPath = resolve(transactionPath, "journal.json");
  writeDurableFile(temporaryPath, `${JSON.stringify(journal, null, 2)}\n`);
  durableRename(temporaryPath, journalPath);
  return transactionPath;
}

function createTargetDirectories(targetRoot, journal) {
  for (const path of journal.createdDirectories) {
    const directory = resolveInside(targetRoot, path, "created directory");
    const status = lstatIfPresent(directory);
    if (status) {
      throw new Error(`Upstream sync target directory changed after planning: ${directory}`);
    }
    mkdirSync(directory);
    fsyncDirectory(dirname(directory));
  }
}

function prepareStages(targetRoot, journal, changes, lock) {
  const operations = transactionPaths(targetRoot, journal);
  for (const [index, operation] of operations.entries()) {
    assertLockOwned(lock);
    const sidecarTransaction = dirname(operation.backupPath);
    const sidecarRoot = dirname(sidecarTransaction);
    for (const path of [sidecarRoot, sidecarTransaction]) {
      const status = lstatIfPresent(path);
      if (status && (!status.isDirectory() || status.isSymbolicLink())) {
        throw new Error(`Invalid upstream sync sidecar directory: ${path}`);
      }
    }
    mkdirSync(sidecarTransaction, { recursive: true, mode: 0o700 });
    for (const path of [sidecarRoot, sidecarTransaction]) {
      const status = lstatIfPresent(path);
      if (!status?.isDirectory() || status.isSymbolicLink()) {
        throw new Error(`Invalid upstream sync sidecar directory: ${path}`);
      }
    }
    resolveInside(targetRoot, operation.backup, "operation backup");
    fsyncDirectory(dirname(sidecarRoot));
    fsyncDirectory(sidecarRoot);
    if (!operation.stagePath) continue;
    writeDurableFile(operation.stagePath, changes[index].content, operation.after.mode);
    assertFingerprint(operation.stagePath, operation.after, "Staged upstream sync file");
  }
}

function commitJournal(targetRoot, transactionPath, journal, lock) {
  const operations = transactionPaths(targetRoot, journal);
  for (const operation of operations) {
    assertFingerprint(operation.targetPath, operation.before, "Upstream sync target before commit");
    if (lstatIfPresent(operation.backupPath)) {
      throw new Error(`Upstream sync backup already exists: ${operation.backupPath}`);
    }
  }

  assertLockOwned(lock);
  createDurableMarker(transactionPath, "COMMITTING", "committing\n");
  for (const operation of operations) {
    assertLockOwned(lock);
    if (operation.before.kind === "file") durableRename(operation.targetPath, operation.backupPath);
    if (operation.stagePath) durableRename(operation.stagePath, operation.targetPath);
    assertFingerprint(operation.targetPath, operation.after, "Upstream sync target after commit");
  }
  validateCommittedTargets(targetRoot, journal);
  assertLockOwned(lock);
  createDurableMarker(transactionPath, "COMMITTED", "committed\n");
}

export function applyUpstreamSyncTransaction(targetRoot, changes, lock) {
  assertLockOwned(lock);
  const id = randomUUID();
  const journal = buildJournal(targetRoot, id, changes, lock);
  const { transactionsRoot } = transactionRoots(targetRoot);
  const transactionPath = resolve(transactionsRoot, id);
  let quarantined = [];
  try {
    createJournal(targetRoot, journal);
    assertLockOwned(lock);
    createTargetDirectories(targetRoot, journal);
    prepareStages(targetRoot, journal, changes, lock);
    commitJournal(targetRoot, transactionPath, journal, lock);
    cleanupTransaction(targetRoot, transactionPath, journal);
  } catch (error) {
    if (markerExists(transactionPath, "COMMITTED")) {
      throw new Error(`Upstream sync committed, but transaction cleanup failed: ${error.message}`, { cause: error });
    }
    try {
      if (existsSync(resolve(transactionPath, "journal.json"))) {
        quarantined = rollbackJournal(targetRoot, transactionPath, journal);
        cleanupTransaction(targetRoot, transactionPath, journal);
      } else if (existsSync(transactionPath)) {
        cleanupAbandonedJournalWrite(targetRoot, transactionPath);
      }
    } catch (rollbackError) {
      throw new Error(
        `${error.message}\nRollback failed; transaction state was retained for recovery:\n${rollbackError.message}`,
        { cause: error },
      );
    }
    if (quarantined.length) {
      const details = quarantined.map(({ target, path }) => `Preserved ${target} at ${path}.`).join("\n");
      throw new Error(`${error.message}\n${details}`, { cause: error });
    }
    throw error;
  }
}
