// Minimal ZIP writer (deflate via CompressionStream, "store" fallback) for .docx and .epub output.
const enc = new TextEncoder();
const TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
export function crc32(bytes) { let c = 0xffffffff; for (let i = 0; i < bytes.length; i++) c = TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; }
async function deflateRaw(bytes) {
  if (typeof CompressionStream === 'undefined') return null;
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}
const u16 = (v, n) => { v.push(n & 255, (n >>> 8) & 255); };
const u32 = (v, n) => { v.push(n & 255, (n >>> 8) & 255, (n >>> 16) & 255, (n >>> 24) & 255); };
export async function makeZip(entries, { date = new Date() } = {}) {
  const dosTime = (date.getHours() << 11) | (date.getMinutes() << 5) | (date.getSeconds() >> 1);
  const dosDate = ((Math.max(1980, date.getFullYear()) - 1980) << 9) | ((date.getMonth() + 1) << 5) | date.getDate();
  const chunks = [], central = [];
  let offset = 0;
  for (const entry of entries) {
    const name = enc.encode(entry.name), raw = typeof entry.data === 'string' ? enc.encode(entry.data) : entry.data;
    const crc = crc32(raw);
    let body = raw, method = 0;
    if (!entry.store && raw.length > 64) { const packed = await deflateRaw(raw); if (packed && packed.length < raw.length) { body = packed; method = 8; } }
    const local = [];
    u32(local, 0x04034b50); u16(local, 20); u16(local, 0x0800); u16(local, method); u16(local, dosTime); u16(local, dosDate);
    u32(local, crc); u32(local, body.length); u32(local, raw.length); u16(local, name.length); u16(local, 0);
    chunks.push(Uint8Array.from(local), name, body);
    const c = [];
    u32(c, 0x02014b50); u16(c, 20); u16(c, 20); u16(c, 0x0800); u16(c, method); u16(c, dosTime); u16(c, dosDate);
    u32(c, crc); u32(c, body.length); u32(c, raw.length); u16(c, name.length); u16(c, 0); u16(c, 0); u16(c, 0); u16(c, 0); u32(c, 0); u32(c, offset);
    central.push(Uint8Array.from(c), name);
    offset += local.length + name.length + body.length;
  }
  const cdSize = central.reduce((n, p) => n + p.length, 0);
  const end = []; u32(end, 0x06054b50); u16(end, 0); u16(end, 0); u16(end, entries.length); u16(end, entries.length); u32(end, cdSize); u32(end, offset); u16(end, 0);
  const parts = [...chunks, ...central, Uint8Array.from(end)];
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let at = 0; for (const p of parts) { out.set(p, at); at += p.length; }
  return out;
}
