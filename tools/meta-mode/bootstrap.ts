import "./require-bun.mjs";
import { createHash } from "node:crypto";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  renameSync,
  rmSync,
} from "node:fs";
import { homedir } from "node:os";
import { delimiter, join } from "node:path";

const scriptsDirectory = import.meta.dir;

function currentInstallKey(): string {
  return createHash("sha256")
    .update(readFileSync(join(scriptsDirectory, "package.json")))
    .update("\0")
    .update(readFileSync(join(scriptsDirectory, "bun.lock")))
    .digest("hex");
}

// Installing node_modules inside the plugin directory changes its file hash,
// which turns off Codex 0.164+ plugin hooks. Keep runtime dependencies in a
// per-user cache keyed by package.json + bun.lock and expose them via NODE_PATH.
function dependencyDirectory(): string {
  const cache = process.env.XDG_CACHE_HOME || join(homedir(), ".cache");
  return join(cache, "mstack", "meta-mode-tools", currentInstallKey());
}

// Stage in a sibling temp directory and rename into place so a crash or
// concurrent run never leaves a partial install at the cache key path.
function install(directory: string, commanderPackagePath: string): void {
  const staging = `${directory}.${process.pid}.tmp`;
  rmSync(staging, { recursive: true, force: true });
  mkdirSync(staging, { recursive: true });
  for (const file of ["package.json", "bun.lock"]) {
    copyFileSync(join(scriptsDirectory, file), join(staging, file));
  }
  const result = Bun.spawnSync(
    [process.execPath, "install", "--frozen-lockfile", "--production"],
    { cwd: staging }
  );
  if (result.exitCode !== 0) {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    rmSync(staging, { recursive: true, force: true });
    throw new Error(
      `bun install --frozen-lockfile --production exited with status ${result.exitCode}`
    );
  }
  try {
    renameSync(staging, directory);
  } catch {
    // Another process won the race; replace only if its install is incomplete.
    if (!existsSync(commanderPackagePath)) {
      rmSync(directory, { recursive: true, force: true });
      renameSync(staging, directory);
    }
  }
  rmSync(staging, { recursive: true, force: true });
  if (!existsSync(commanderPackagePath)) {
    throw new Error(
      "bun install --frozen-lockfile --production completed without installing commander"
    );
  }
}

export function ensureDependenciesInstalled(): void {
  const directory = dependencyDirectory();
  const nodeModulesDirectory = join(directory, "node_modules");
  const commanderPackagePath = join(
    nodeModulesDirectory,
    "commander",
    "package.json"
  );
  if (!existsSync(commanderPackagePath)) {
    install(directory, commanderPackagePath);
  }
  const nodePath = process.env.NODE_PATH;
  if (nodePath?.split(delimiter).includes(nodeModulesDirectory)) return;

  // Bun reads NODE_PATH only at startup, so re-exec with it set.
  const argv = [process.execPath, ...process.argv.slice(1)];
  const env = {
    ...process.env,
    NODE_PATH: nodePath
      ? `${nodeModulesDirectory}${delimiter}${nodePath}`
      : nodeModulesDirectory,
  };
  if (process.platform !== "win32" && typeof process.execve === "function") {
    process.execve(process.execPath, argv, env);
  }
  const restarted = Bun.spawnSync(argv, {
    cwd: process.cwd(),
    env,
    stdin: "inherit",
    stdout: "inherit",
    stderr: "inherit",
  });
  process.exit(restarted.exitCode ?? 1);
}
