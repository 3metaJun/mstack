import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

export function stagingPath(target, transactionId, sequence) {
  return join(dirname(target), `.harness-skills-stage-${transactionId}-${sequence}`);
}

export function targetPathsOverlap(left, right) {
  let normalizedLeft = resolve(left);
  let normalizedRight = resolve(right);
  if (process.platform === "win32") {
    normalizedLeft = normalizedLeft.toLowerCase();
    normalizedRight = normalizedRight.toLowerCase();
  }
  const leftToRight = relative(normalizedLeft, normalizedRight);
  const rightToLeft = relative(normalizedRight, normalizedLeft);
  const contains = (value) => value === "" || (!isAbsolute(value) && value !== ".." && !value.startsWith(`..${sep}`));
  return contains(leftToRight) || contains(rightToLeft);
}
