import { afterEach, describe, expect, it } from "bun:test";
import { spawnSync } from "node:child_process";
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

function nodeArgsForNoStripTypes(): string[] {
  const version = spawnSync("node", ["-p", "process.versions.node"], {
    encoding: "utf8",
    timeout: 5000,
  }).stdout.trim();
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 6)
    ? ["--no-experimental-strip-types"]
    : [];
}

describe("bootstrap.ts", () => {
  it("fails with a clear message when watch-pr or ship-pr is run under Node instead of Bun", () => {
    const extra = nodeArgsForNoStripTypes();
    for (const cli of ["watch-pr", "ship-pr"]) {
      const entry = join(import.meta.dir, "watch-pr", cli);
      const result = spawnSync("node", [...extra, entry], {
        encoding: "utf8",
        timeout: 5000,
      });
      expect(result.status).toBe(1);
      expect(result.stderr).toContain("requires bun");
    }
  });

  it("loads commander from the install-keyed external cache without writing node_modules into the plugin dir", () => {
    const root = mkdtempSync(join(tmpdir(), "mstack-bootstrap-"));
    tempDirs.push(root);
    const pluginDir = join(root, "plugin");
    const cacheRoot = join(root, "cache");
    mkdirSync(pluginDir, { recursive: true });
    for (const file of ["require-bun.mjs", "bootstrap.ts", "package.json", "bun.lock"]) {
      copyFileSync(join(import.meta.dir, file), join(pluginDir, file));
    }
    const probe = join(pluginDir, "probe.ts");
    writeFileSync(
      probe,
      `import { ensureDependenciesInstalled } from "./bootstrap.ts";
ensureDependenciesInstalled();
const { Command } = await import("commander");
console.log(JSON.stringify({ ok: typeof Command === "function", nodePath: process.env.NODE_PATH ?? "" }));
`
    );

    // First run populates the external cache; second run reuses it cleanly.
    const env = {
      ...process.env,
      XDG_CACHE_HOME: cacheRoot,
      NODE_PATH: "",
    };
    const first = spawnSync(process.execPath, [probe], {
      cwd: pluginDir,
      encoding: "utf8",
      env,
      timeout: 30_000,
    });
    expect(first.status).toBe(0);
    const firstPayload = JSON.parse(first.stdout.trim()) as {
      ok: boolean;
      nodePath: string;
    };
    expect(firstPayload.ok).toBe(true);
    expect(firstPayload.nodePath).toContain(join(cacheRoot, "mstack", "meta-mode-tools"));
    expect(existsSync(join(pluginDir, "node_modules"))).toBe(false);

    // Even if a partial local node_modules/commander/package.json exists,
    // bootstrap.ts does not skip populating and exporting the lockfile-keyed
    // external cache in NODE_PATH.
    const staleDir = join(pluginDir, "node_modules", "commander");
    mkdirSync(staleDir, { recursive: true });
    writeFileSync(join(staleDir, "package.json"), JSON.stringify({ name: "commander", version: "0.0.0-stale" }));
    const second = spawnSync(process.execPath, [probe], {
      cwd: pluginDir,
      encoding: "utf8",
      env,
      timeout: 15_000,
    });
    expect(second.status).toBe(0);
    const secondPayload = JSON.parse(second.stdout.trim()) as {
      ok: boolean;
      nodePath: string;
    };
    expect(secondPayload.ok).toBe(true);
    expect(secondPayload.nodePath).toContain(join(cacheRoot, "mstack", "meta-mode-tools"));
  });
});
