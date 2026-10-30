import fs from "node:fs";
import { killGroup } from "./run.ts";

const [pid, stage, tmp] = process.argv.slice(2);
process.stdin.resume();
process.stdin.once("end", async () => {
  const workerPid = Number(pid);
  if (Number.isSafeInteger(workerPid) && workerPid > 0) await killGroup(workerPid);
  for (const folder of [stage, tmp])
    fs.rmSync(folder, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
});
