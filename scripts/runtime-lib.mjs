function quotePowerShell(value, label) {
  if (typeof value !== "string" || value.includes("\0")) {
    throw new Error(`${label} contains an invalid command argument`);
  }
  return `'${value.replaceAll("'", "''")}'`;
}

export function buildWindowsInvocation(command, args) {
  if (!Array.isArray(args)) throw new Error("Command arguments must be an array");
  const values = args.map((value, index) => quotePowerShell(value, `argument ${index}`)).join(", ");
  const script = [
    "$ErrorActionPreference = 'Stop'",
    `$mstackArgs = @(${values})`,
    `& ${quotePowerShell(command, "command")} @mstackArgs`,
    "if ($null -ne $LASTEXITCODE) { exit $LASTEXITCODE }",
  ].join("\n");
  return {
    command: "powershell.exe",
    args: [
      "-NoLogo",
      "-NoProfile",
      "-NonInteractive",
      "-ExecutionPolicy",
      "Bypass",
      "-EncodedCommand",
      Buffer.from(script, "utf16le").toString("base64"),
    ],
  };
}

export function processInvocation(command, args, platform = process.platform) {
  return platform === "win32" ? buildWindowsInvocation(command, args) : { command, args };
}
