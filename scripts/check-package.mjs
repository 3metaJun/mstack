import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const packageManifest = JSON.parse(readFileSync(join(repoRoot, "package.json"), "utf8"));
const pluginManifest = JSON.parse(readFileSync(join(repoRoot, ".codex-plugin", "plugin.json"), "utf8"));
if (packageManifest.version !== pluginManifest.version) {
  throw new Error(
    `Package and Codex plugin versions must match (package.json=${packageManifest.version}, ` +
      `.codex-plugin/plugin.json=${pluginManifest.version}).`,
  );
}

const npmArgs = ["pack", "--dry-run", "--json"];
const npmExecutable = process.env.npm_execpath ? process.execPath : "npm";
const result = spawnSync(
  npmExecutable,
  process.env.npm_execpath ? [process.env.npm_execpath, ...npmArgs] : npmArgs,
  {
  encoding: "utf8",
  windowsHide: true,
  },
);
if (result.error || result.status !== 0) {
  throw new Error((result.stderr || result.error?.message || "npm pack failed").trim());
}

let report;
try {
  [report] = JSON.parse(result.stdout);
} catch (error) {
  throw new Error(`npm pack returned invalid JSON: ${error.message}`);
}
if (!report || !Array.isArray(report.files)) {
  throw new Error("npm pack did not return a file list");
}

const forbidden = report.files
  .map((file) => file.path)
  .filter(
    (path) =>
      /(^|\/)node_modules\//.test(path) ||
      /(^|\/)\.audit\//.test(path) ||
      /\.(?:key|pem)$/i.test(path),
  );
if (forbidden.length) {
  throw new Error(`npm package contains excluded files:\n${forbidden.join("\n")}`);
}

console.log(
  `Package contains ${report.entryCount} files (${report.size} bytes packed, ${report.unpackedSize} bytes unpacked).`,
);
