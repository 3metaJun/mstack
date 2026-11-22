// Pure ESM guard so running Bun-only meta-mode CLIs under Node 18+ prints a
// clear message before any TypeScript module is loaded.
if (typeof Bun === "undefined") {
  console.error(
    "mstack meta-mode tooling requires bun (https://bun.sh). Install bun, then re-run.",
  );
  process.exit(1);
}
