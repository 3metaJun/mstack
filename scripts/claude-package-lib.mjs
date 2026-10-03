import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { deflateRawSync } from "node:zlib";

// Fields accepted by claude.ai uploads and the Skills API. Anything else is a hard
// error there, even though Claude Code ignores unknown keys.
export const UPLOAD_FIELDS = new Set(["name", "description", "license", "compatibility", "metadata", "allowed-tools"]);
const RESERVED_NAME_WORDS = ["anthropic", "claude"];
// The Skills API guide limits the total upload to 30 MB uncompressed. claude.ai's own
// limit is not documented, so this is the closest published bound for either surface.
export const MAX_UPLOAD_BYTES = 30 * 1024 * 1024;

export function splitFrontmatter(content) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error("missing YAML frontmatter");
  return { block: match[1], body: content.slice(match[0].length) };
}

// Reads top-level keys, including folded (>) and literal (|) blocks and plain or quoted
// scalars that wrap onto indented lines. Nested maps such as `metadata` are reported
// by key only, which is all upload validation needs.
export function parseTopLevel(block) {
  const fields = new Map();
  const lines = block.split(/\r?\n/);
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(/^([A-Za-z][A-Za-z0-9_-]*):(?:\s+(.*))?$/);
    if (!match) continue;
    const [, key, rest = ""] = match;
    if (fields.has(key)) throw new Error(`duplicate frontmatter key ${key}`);
    const continuation = [];
    while (i + 1 < lines.length && (lines[i + 1] === "" || /^\s/.test(lines[i + 1]))) {
      continuation.push(lines[(i += 1)]);
    }
    const text = continuation.map((line) => line.trim()).filter(Boolean);
    const indicator = rest.match(/^([>|])[+-]?$/);
    if (indicator) {
      fields.set(key, indicator[1] === ">" ? text.join(" ") : text.join("\n"));
    } else if (rest === "") {
      fields.set(key, text.length ? continuation : "");
    } else {
      fields.set(key, parseScalar(key, [rest.trim(), ...text].join(" ")));
    }
  }
  return fields;
}

function parseScalar(key, raw) {
  const double = raw.match(/^"((?:[^"\\]|\\.)*)"\s*(?:#.*)?$/);
  if (double) return double[1].replace(/\\(["\\])/g, "$1");
  const single = raw.match(/^'((?:[^']|'')*)'\s*(?:#.*)?$/);
  if (single) return single[1].replace(/''/g, "'");
  const plain = raw.replace(/\s+#.*$/, "");
  // Claude Code's reader accepts this, but a strict YAML parser rejects it. Flow
  // collections such as `{a: b}` legitimately contain ": ".
  if (!/^[{[]/.test(plain) && /:\s/.test(plain)) throw new Error(`frontmatter ${key} contains ": " and must be quoted`);
  return plain;
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
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(name) || name.length > 64) {
      problems.push(`${skill}: name must be 1-64 lowercase letters, digits, and single hyphens, none at either end`);
    }
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
// Code fences and inline code are left alone. A reference-style definition cannot be
// rewritten without changing its uses, so one that leaves the skill is an error when
// its label is used.
// A label holds no bare `[` and no blank line, so a stray bracket cannot pair with a link
// in a later paragraph.
const INLINE_LINK = /(!?)\[((?:[^[\]\n]|\n(?!\s*\n))*)\]\((?:<([^>]+)>|((?:[^()\s]|\([^()\s]*\))+))(?:\s+(?:"[^"]*"|'[^']*'))?\)/g;
const LINK_DEFINITION = /^ {0,3}\[([^\]]+)\]:\s*<?([^\s>]+)/;
const EXTERNAL = /^(?:[a-z][a-z0-9+.-]*:|#|\/\/)/i;

function resolveTarget(target, filePath) {
  const path = target.split(/[?#]/)[0];
  let decoded = path;
  try {
    decoded = decodeURIComponent(path);
  } catch {
    // Not valid percent-encoding, so the raw text is the path.
  }
  return resolve(dirname(filePath), decoded);
}

function staysInside(resolved, skillRoot) {
  return resolved === skillRoot || resolved.startsWith(skillRoot + sep);
}

function rewriteInline(text, filePath, skillRoot, skillsRoot) {
  return text.replace(INLINE_LINK, (whole, _bang, label, angled, plain) => {
    const target = angled ?? plain;
    if (EXTERNAL.test(target)) return whole;
    const resolved = resolveTarget(target, filePath);
    if (staysInside(resolved, skillRoot)) return whole;
    if (resolved.startsWith(skillsRoot + sep)) {
      const [sibling, ...rest] = relative(skillsRoot, resolved).split(sep);
      const inner = rest.filter((part) => part !== "SKILL.md").join("/");
      return `${label} (the \`${sibling}\` skill${inner ? `, \`${inner}\`` : ""})`;
    }
    return label;
  });
}

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

// A definition only matters when something uses its label, so prose such as
// "[Note]: /tmp/x is the dir" is not an error. Multi-line definitions are not detected.
function assertNoEscapingDefinitions(text, filePath, skillRoot, skillsRoot) {
  for (const line of text.split(/\r?\n/)) {
    const definition = line.match(LINK_DEFINITION);
    if (!definition || EXTERNAL.test(definition[2]) || staysInside(resolveTarget(definition[2], filePath), skillRoot)) continue;
    const label = escapeRegExp(definition[1]);
    const used = new RegExp(`\\]\\[${label}\\]|\\[${label}\\]\\[\\]|\\[${label}\\](?![:(\\[])`, "i");
    const uses = text.split(/\r?\n/).filter((other) => other !== line).some((other) => used.test(other));
    if (uses) throw new Error(`${relative(skillsRoot, filePath)}: reference-style link leaves the skill: ${definition[2]}`);
  }
}

function rewriteProse(text, filePath, skillRoot, skillsRoot) {
  // Code spans are masked so link syntax inside them survives, while a span inside a
  // link label does not stop the link from being rewritten.
  const spans = [];
  const masked = text.replace(/(``[^\n]*?``|`[^`\n]*`)/g, (span) => `\u0000${spans.push(span) - 1}\u0000`);
  return rewriteInline(masked, filePath, skillRoot, skillsRoot).replace(/\u0000(\d+)\u0000/g, (_, index) => spans[index]);
}

// Fenced code passes through untouched. Prose between fences is rewritten as one block,
// because a link label may wrap across lines. Definitions are checked over all prose in
// the file, since a definition usually sits after the fences that its uses precede.
export function rewriteEscapingLinks(content, filePath, skillRoot, skillsRoot) {
  // The code-span mask uses NUL as its delimiter.
  if (content.includes("\u0000")) throw new Error(`${relative(skillsRoot, filePath)}: contains a NUL byte`);
  const parts = content.split(/(\r?\n)/);
  const segments = [];
  let prose = "";
  let fence = null;
  let rawLine = false;
  const flush = () => {
    if (prose) segments.push({ prose });
    prose = "";
  };
  parts.forEach((part, index) => {
    if (index % 2) {
      if (rawLine) segments.push({ raw: part });
      else prose += part;
      return;
    }
    // A backtick fence's info string cannot contain a backtick, or it is inline code.
    const opener = part.match(/^ {0,3}(`{3,}(?=[^`]*$)|~{3,})/)?.[1];
    if (fence) {
      rawLine = true;
      if (opener && opener[0] === fence.char && opener.length >= fence.length && /^\s*$/.test(part.slice(part.indexOf(opener) + opener.length))) {
        fence = null;
      }
    } else if (opener) {
      fence = { char: opener[0], length: opener.length };
      rawLine = true;
    } else {
      rawLine = false;
    }
    if (rawLine) {
      flush();
      segments.push({ raw: part });
    } else {
      prose += part;
    }
  });
  flush();
  assertNoEscapingDefinitions(
    segments.map((segment) => segment.prose).filter((text) => text !== undefined).join("\n"),
    filePath,
    skillRoot,
    skillsRoot,
  );
  return segments
    .map((segment) => segment.raw ?? rewriteProse(segment.prose, filePath, skillRoot, skillsRoot))
    .join("");
}

export function uploadSizeProblem(skill, files) {
  const bytes = files.reduce((total, file) => total + file.data.length, 0);
  return bytes > MAX_UPLOAD_BYTES ? `${skill}: ${bytes} uncompressed bytes exceed the ${MAX_UPLOAD_BYTES} byte upload limit` : null;
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
