import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { deflateRawSync } from "node:zlib";

// Fields accepted by claude.ai uploads and the Skills API. Anything else is a hard
// error there, even though Claude Code ignores unknown keys.
export const UPLOAD_FIELDS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
export const MAX_ARCHIVE_BYTES = 30 * 1024 * 1024;
const RESERVED_NAME_WORDS = ["anthropic", "claude"];

export function splitFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error("missing YAML frontmatter");
  return { block: match[1], body: content.slice(match[0].length) };
}

// Reads top-level scalar keys, including folded (>) and literal (|) blocks. Nested
// maps such as `metadata` are reported by key only, which is all upload validation needs.
export function parseTopLevel(block) {
  const fields = new Map();
  const lines = block.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*)$/);
    if (!match) continue;
    const [, key, rest] = match;
    if (fields.has(key)) throw new Error(`duplicate frontmatter key ${key}`);
    const indicator = rest.match(/^([>|])[+-]?$/);
    const continuation = [];
    while (i + 1 < lines.length && (lines[i + 1] === "" || /^\s/.test(lines[i + 1]))) {
      continuation.push(lines[(i += 1)]);
    }
    if (indicator) {
      const text = continuation.map((line) => line.trim()).filter(Boolean);
      fields.set(key, indicator[1] === ">" ? text.join(" ") : text.join("\n"));
    } else if (rest === "" && continuation.some((line) => line.trim())) {
      fields.set(key, continuation);
    } else {
      fields.set(key, rest.replace(/^(["'])(.*)\1$/, "$2"));
    }
  }
  return fields;
}

export function validateUploadFrontmatter(skill, content) {
  const problems = [];
  let fields;
  try {
    fields = parseTopLevel(splitFrontmatter(content).block);
  } catch (error) {
    return [`${skill}: ${error.message}`];
  }
  for (const key of fields.keys()) {
    if (!UPLOAD_FIELDS.has(key)) problems.push(`${skill}: frontmatter field ${key} is rejected by claude.ai uploads`);
  }
  const name = fields.get("name");
  if (name !== skill) problems.push(`${skill}: frontmatter name must equal the directory name for upload`);
  if (typeof name === "string") {
    if (!/^[a-z0-9-]{1,64}$/.test(name)) problems.push(`${skill}: name must be 1-64 lowercase letters, digits, or hyphens`);
    if (RESERVED_NAME_WORDS.some((word) => name.includes(word))) problems.push(`${skill}: name contains a reserved word`);
  }
  const description = fields.get("description");
  if (typeof description !== "string" || !description) problems.push(`${skill}: description is required`);
  else {
    if (description.length > 1024) problems.push(`${skill}: description is ${description.length} characters; the limit is 1024`);
    if (/<[^>]*>/.test(description)) problems.push(`${skill}: description may not contain XML tags`);
  }
  const compatibility = fields.get("compatibility");
  if (typeof compatibility === "string" && compatibility.length > 500) {
    problems.push(`${skill}: compatibility is ${compatibility.length} characters; the limit is 500`);
  }
  return problems;
}

export function listFiles(directory) {
  return readdirSync(directory, { withFileTypes: true })
    .sort((a, b) => (a.name < b.name ? -1 : 1))
    .flatMap((entry) => {
      if (entry.name === "node_modules" || entry.name === ".git" || entry.name === ".DS_Store") return [];
      const path = join(directory, entry.name);
      return entry.isDirectory() ? listFiles(path) : [path];
    });
}

// An uploaded skill is isolated: links into sibling skills or the wider repository
// resolve nowhere. Replace each such link with its text and a pointer by skill name.
export function rewriteEscapingLinks(content, filePath, skillRoot, skillsRoot) {
  return content.replace(/\[([^\]]+)\]\(([^)\s]+)\)/g, (whole, text, target) => {
    if (/^(?:[a-z][a-z0-9+.-]*:|#)/i.test(target)) return whole;
    const resolved = resolve(dirname(filePath), target.split("#")[0]);
    if (resolved === skillRoot || resolved.startsWith(skillRoot + sep)) return whole;
    if (resolved.startsWith(skillsRoot + sep)) {
      const [sibling, ...rest] = relative(skillsRoot, resolved).split(sep);
      const inner = rest.filter((part) => part !== "SKILL.md").join("/");
      return `${text} (the \`${sibling}\` skill${inner ? `, \`${inner}\`` : ""})`;
    }
    return text;
  });
}

export function buildSkillFiles(skill, skillsRoot) {
  const skillRoot = join(skillsRoot, skill);
  return listFiles(skillRoot).map((path) => {
    const data = readFileSync(path);
    const name = `${skill}/${relative(skillRoot, path).split(sep).join("/")}`;
    if (!path.endsWith(".md")) return { name, data };
    const text = data.toString("utf8");
    return { name, data: Buffer.from(rewriteEscapingLinks(text, path, skillRoot, skillsRoot), "utf8") };
  });
}

const CRC_TABLE = new Uint32Array(256).map((_, n) => {
  let c = n;
  for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
  return c >>> 0;
});

function crc32(buffer) {
  let crc = 0xffffffff;
  for (const byte of buffer) crc = CRC_TABLE[(crc ^ byte) & 0xff] ^ (crc >>> 8);
  return (crc ^ 0xffffffff) >>> 0;
}

// Fixed timestamp keeps archives reproducible across runs and machines.
const DOS_TIME = 0;
const DOS_DATE = ((2020 - 1980) << 9) | (1 << 5) | 1;

export function createZip(files) {
  const locals = [];
  const central = [];
  let offset = 0;
  for (const { name, data } of files) {
    const nameBuffer = Buffer.from(name, "utf8");
    const compressed = deflateRawSync(data, { level: 9 });
    const useDeflate = compressed.length < data.length;
    const payload = useDeflate ? compressed : data;
    const crc = crc32(data);
    const flags = 0x0800; // UTF-8 names
    const method = useDeflate ? 8 : 0;
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(flags, 6);
    local.writeUInt16LE(method, 8);
    local.writeUInt16LE(DOS_TIME, 10);
    local.writeUInt16LE(DOS_DATE, 12);
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(payload.length, 18);
    local.writeUInt32LE(data.length, 22);
    local.writeUInt16LE(nameBuffer.length, 26);
    locals.push(local, nameBuffer, payload);
    const entry = Buffer.alloc(46);
    entry.writeUInt32LE(0x02014b50, 0);
    entry.writeUInt16LE(20, 4);
    entry.writeUInt16LE(20, 6);
    entry.writeUInt16LE(flags, 8);
    entry.writeUInt16LE(method, 10);
    entry.writeUInt16LE(DOS_TIME, 12);
    entry.writeUInt16LE(DOS_DATE, 14);
    entry.writeUInt32LE(crc, 16);
    entry.writeUInt32LE(payload.length, 20);
    entry.writeUInt32LE(data.length, 24);
    entry.writeUInt16LE(nameBuffer.length, 28);
    entry.writeUInt32LE(offset, 42);
    central.push(entry, nameBuffer);
    offset += local.length + nameBuffer.length + payload.length;
  }
  const centralBuffer = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(files.length, 8);
  end.writeUInt16LE(files.length, 10);
  end.writeUInt32LE(centralBuffer.length, 12);
  end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, centralBuffer, end]);
}

export function skillPackable(skillsRoot, skill) {
  const path = join(skillsRoot, skill);
  return existsSync(join(path, "SKILL.md")) && statSync(path).isDirectory();
}
