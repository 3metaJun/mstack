const supportedFields = new Set(["name", "description"]);

function readScalar(raw, path, field) {
  const value = raw.trim();
  let result;
  if (value.startsWith('"')) {
    const match = value.match(/^("(?:[^"\\]|\\.)*")(?:[ \t]+#.*)?$/);
    try {
      if (!match) throw new Error();
      result = JSON.parse(match[1]);
    } catch {
      throw new Error(`${path}: ${field} must use a valid single-line JSON double-quoted string`);
    }
  } else if (value.startsWith("'")) {
    const match = value.match(/^'((?:[^']|'')*)'(?:[ \t]+#.*)?$/);
    if (!match) throw new Error(`${path}: ${field} has an invalid single-quoted string`);
    result = match[1].replace(/''/g, "'");
  } else {
    result = value.replace(/(?:^|[ \t]+)#.*$/, "").trimEnd();
    if (/^[|>&*!\[\]{},@`%]|^[?:-](?:[ \t]|$)|:(?:[ \t]|$)/.test(result)) {
      throw new Error(`${path}: ${field} uses unsupported frontmatter syntax; use a single-line string`);
    }
    if (/^(?:null|true|false|~|[-+]?(?:0x[0-9a-f]+|0o[0-7]+|(?:[0-9]+(?:\.[0-9]*)?|\.[0-9]+)(?:e[-+]?[0-9]+)?|\.inf|\.nan))$/i.test(result)) {
      throw new Error(`${path}: ${field} must be a string; quote scalar values`);
    }
  }
  if (!result.trim()) throw new Error(`${path}: ${field} must be a non-empty string`);
  return result;
}

function tomlString(value, path, field) {
  for (const character of value) {
    const point = character.codePointAt(0);
    if (point >= 0xd800 && point <= 0xdfff) {
      throw new Error(`${path}: ${field} contains an unpaired Unicode surrogate`);
    }
  }
  // TOML also forbids a literal DEL, which JSON.stringify leaves untouched.
  return JSON.stringify(value).replace(/\u007f/g, "\\u007f");
}

export function convertAgentMarkdown(content, path) {
  const match = content.match(/^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/);
  if (!match) throw new Error(`${path}: agent Markdown has no complete frontmatter`);
  const fields = new Map();
  for (const line of match[1].split(/\r?\n/)) {
    if (!line.trim() || line.trimStart().startsWith("#")) continue;
    const entry = line.match(/^([a-zA-Z_][\w-]*):(?:[ \t]+(.*)|$)$/);
    if (!entry) throw new Error(`${path}: unsupported agent frontmatter line ${JSON.stringify(line)}`);
    const [, field, raw = ""] = entry;
    if (!supportedFields.has(field)) throw new Error(`${path}: unsupported agent frontmatter field ${field}`);
    if (fields.has(field)) throw new Error(`${path}: duplicate agent frontmatter field ${field}`);
    fields.set(field, readScalar(raw, path, field));
  }
  for (const field of supportedFields) {
    if (!fields.has(field)) throw new Error(`${path}: agent frontmatter is missing ${field}`);
  }
  const body = content.slice(match[0].length);
  if (!body.trim()) throw new Error(`${path}: agent body must be non-empty`);
  return [
    `name = ${tomlString(fields.get("name"), path, "name")}`,
    `description = ${tomlString(fields.get("description"), path, "description")}`,
    `developer_instructions = ${tomlString(body, path, "body")}`,
    "",
  ].join("\n");
}
