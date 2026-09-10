import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, posix } from "node:path";

const POSIX_SHELL = "posix";
const POWERSHELL = "powershell";
const ENVIRONMENT_TRANSPORTS = new Set(["local", "ssh"]);

function expandHome(value) {
  if (value === "~") return homedir();
  return value?.startsWith("~/") ? join(homedir(), value.slice(2)) : value;
}

function environmentFilePath() {
  return expandHome(process.env.MSTACK_ENVIRONMENTS_FILE ?? "~/.config/mstack/environments.json");
}

export function readEnvironment(name, harnesses = []) {
  if (!name) return { name: undefined, transport: "local", targets: {}, artifacts: {} };
  const path = environmentFilePath();
  if (!existsSync(path)) throw new Error(`Environment file not found: ${path}`);
  const data = JSON.parse(readFileSync(path, "utf8"));
  const environment = data[name];
  if (!environment || typeof environment !== "object" || Array.isArray(environment)) {
    throw new Error(`Unknown environment: ${name}`);
  }
  const transport = environment.transport ?? "local";
  if (!ENVIRONMENT_TRANSPORTS.has(transport)) {
    throw new Error(`Environment ${name} has unsupported transport: ${transport}`);
  }
  const targets = environment.targets;
  if (!targets || typeof targets !== "object" || Array.isArray(targets)) {
    throw new Error(`Environment ${name} must define a targets object`);
  }
  const missingTargets = harnesses.filter((harness) => typeof targets[harness] !== "string" || !targets[harness]);
  if (missingTargets.length) {
    throw new Error(`Environment ${name} has no target for: ${missingTargets.join(", ")}`);
  }
  const artifacts = environment.artifacts ?? {};
  if (typeof artifacts !== "object" || Array.isArray(artifacts)) {
    throw new Error(`Environment ${name} artifacts must be an object`);
  }
  if (transport === "ssh") {
    if (typeof environment.host !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.@:-]*$/.test(environment.host)) {
      throw new Error(`Environment ${name} ssh transport requires a safe host alias in host`);
    }
    const shell = environment.shell ?? POSIX_SHELL;
    if (shell !== POSIX_SHELL && shell !== POWERSHELL) {
      throw new Error(`Environment ${name} has unsupported remote shell: ${shell}`);
    }
    if (environment.sshArgs !== undefined && (!Array.isArray(environment.sshArgs) || environment.sshArgs.some((value) => typeof value !== "string"))) {
      throw new Error(`Environment ${name} sshArgs must be an array of strings`);
    }
    for (const command of ["sshCommand", "rsyncCommand"]) {
      if (environment[command] !== undefined && (typeof environment[command] !== "string" || !environment[command])) {
        throw new Error(`Environment ${name} ${command} must be a non-empty string`);
      }
    }
    if (environment.rsyncArgs !== undefined && (!Array.isArray(environment.rsyncArgs) || environment.rsyncArgs.some((value) => typeof value !== "string"))) {
      throw new Error(`Environment ${name} rsyncArgs must be an array of strings`);
    }
  }
  return { ...environment, name, transport, targets, artifacts };
}

export function environmentCwd(environment, harness, override) {
  if (override) return override;
  if (typeof environment.cwd === "string") return environment.cwd;
  if (environment.cwd && typeof environment.cwd === "object" && !Array.isArray(environment.cwd)) {
    const value = environment.cwd[harness];
    if (value !== undefined && typeof value !== "string") {
      throw new Error(`Environment ${environment.name} cwd.${harness} must be a path`);
    }
    return value;
  }
  return undefined;
}

export function quotePosix(value, label = "remote argument") {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new Error(`${label} contains an invalid remote argument`);
  }
  return `'${value.replaceAll("'", "'\"'\"'")}'`;
}

export function parseRemoteStage(output, parent) {
  const candidate = output.split(/\r?\n/).filter(Boolean).at(-1);
  if (
    !candidate ||
    posix.dirname(candidate) !== parent ||
    !/^\.mstack-stage\.[A-Za-z0-9._-]+$/.test(posix.basename(candidate))
  ) {
    throw new Error(`Remote stage path was invalid: ${candidate ?? "<empty>"}`);
  }
  return candidate;
}

function quotePowerShell(value, label) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new Error(`${label} contains an invalid remote argument`);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

function buildPowerShellScript(command, commandArgs, cwd) {
  const lines = ["$ErrorActionPreference = 'Stop'"];
  if (cwd) lines.push(`Set-Location -LiteralPath ${quotePowerShell(cwd, "remote cwd")}`);
  lines.push(`& ${quotePowerShell(command, "remote command")} ${commandArgs.map((value, index) => quotePowerShell(value, `remote argument ${index}`)).join(" ")}`);
  lines.push("exit $LASTEXITCODE");
  return lines.join("\n");
}

export function buildRemoteCommand({ shell = POSIX_SHELL, command, args, cwd }) {
  if (!Array.isArray(args) || args.some((value) => typeof value !== "string")) {
    throw new Error("Remote command args must be strings");
  }
  if (shell === POSIX_SHELL) {
    const invocation = [quotePosix(command, "remote command"), ...args.map((value, index) => quotePosix(value, `remote argument ${index}`))].join(" ");
    return cwd ? `cd -- ${quotePosix(cwd, "remote cwd")} && ${invocation}` : invocation;
  }
  if (shell === POWERSHELL) {
    const encoded = Buffer.from(buildPowerShellScript(command, args, cwd), "utf16le").toString("base64");
    return ["powershell.exe", "-NoLogo", "-NoProfile", "-NonInteractive", "-EncodedCommand", encoded].join(" ");
  }
  throw new Error(`Unsupported remote shell: ${shell}`);
}

export function buildSshInvocation(environment, command, args, cwd) {
  if (environment.transport !== "ssh") throw new Error("SSH invocation requires an ssh environment");
  if (typeof environment.host !== "string" || !/^[A-Za-z0-9][A-Za-z0-9_.@:-]*$/.test(environment.host)) {
    throw new Error("SSH environment host must be a safe alias");
  }
  const remoteCommand = buildRemoteCommand({ shell: environment.shell ?? POSIX_SHELL, command, args, cwd });
  return {
    command: environment.sshCommand ?? "ssh",
    args: [...(environment.sshArgs ?? []), environment.host, "--", remoteCommand],
  };
}
