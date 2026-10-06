// Windows PowerShell 5.1's `>` writes UTF-16 LE with a byte-order mark, and many
// editors add a UTF-8 one. JSON.parse rejects both, so decode and drop the mark first.
export function decodeText(bytes) {
  const text = bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe
    ? bytes.toString("utf16le")
    : bytes.toString("utf8");
  return text.replace(/^\uFEFF/, "");
}
