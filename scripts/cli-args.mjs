export function parseCliArgs(args, valueFlags, switchFlags = []) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (Object.hasOwn(options, flag)) throw new Error(`Duplicate option: ${flag}`);
    if (switchFlags.includes(flag)) {
      options[flag] = true;
    } else if (valueFlags.includes(flag)) {
      const value = args[++index];
      if (!value?.trim() || value.startsWith("--")) throw new Error(`${flag} requires a value`);
      options[flag] = value;
    } else {
      throw new Error(`Unknown option: ${flag}`);
    }
  }
  return options;
}
