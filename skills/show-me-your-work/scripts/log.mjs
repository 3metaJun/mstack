#!/usr/bin/env node
import { appendFileSync, closeSync, mkdirSync, openSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

if (Number.parseInt(process.versions.node, 10) < 18) {
  console.error("show-me-your-work requires Node.js 18 or newer");
  process.exit(1);
}

const values = process.argv.slice(2);
if (values.length !== 6) {
  console.error("usage: log.mjs <logfile> <phase> <decision> <why> <evidence> <result>");
  process.exit(1);
}

const [logfile, ...cells] = values;
const logDirectory = dirname(logfile);
if (logDirectory !== ".") mkdirSync(logDirectory, { recursive: true });

try {
  const descriptor = openSync(logfile, "wx");
  writeFileSync(descriptor, "ts\tphase\tdecision\twhy\tevidence\tresult\n", "utf8");
  closeSync(descriptor);
} catch (error) {
  if (error.code !== "EEXIST") throw error;
}

function clean(value) {
  const singleLine = value.replace(/[\t\r\n]/g, " ");
  return /^\s*[=+\-@]/.test(singleLine) ? `'${singleLine}` : singleLine;
}

const timestamp = new Date().toISOString().replace(/\.\d{3}Z$/, "Z");
appendFileSync(logfile, `${[timestamp, ...cells.map(clean)].join("\t")}\n`, "utf8");
