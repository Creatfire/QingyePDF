// node:crypto subset: synchronous SHA-256 / SHA-1, UUIDs and random bytes.
import { Buffer } from 'buffer';
const K = new Uint32Array([0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2]);
function padded(bytes) { const length = bytes.length, total = ((length + 9 + 63) >> 6) << 6, out = new Uint8Array(total); out.set(bytes); out[length] = 0x80; const view = new DataView(out.buffer); view.setUint32(total - 8, Math.floor(length / 0x20000000)); view.setUint32(total - 4, (length << 3) >>> 0); return view; }
function sha256(bytes) {
  const view = padded(bytes), w = new Uint32Array(64); let h0=0x6a09e667,h1=0xbb67ae85,h2=0x3c6ef372,h3=0xa54ff53a,h4=0x510e527f,h5=0x9b05688c,h6=0x1f83d9ab,h7=0x5be0cd19;
  for (let off = 0; off < view.byteLength; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 64; i++) { const a = w[i-15], b = w[i-2]; w[i] = (w[i-16] + ((a>>>7|a<<25)^(a>>>18|a<<14)^(a>>>3)) + w[i-7] + ((b>>>17|b<<15)^(b>>>19|b<<13)^(b>>>10))) | 0; }
    let a=h0,b=h1,c=h2,d=h3,e=h4,f=h5,g=h6,h=h7;
    for (let i = 0; i < 64; i++) { const t1 = (h + ((e>>>6|e<<26)^(e>>>11|e<<21)^(e>>>25|e<<7)) + ((e&f)^(~e&g)) + K[i] + w[i]) | 0, t2 = (((a>>>2|a<<30)^(a>>>13|a<<19)^(a>>>22|a<<10)) + ((a&b)^(a&c)^(b&c))) | 0; h=g;g=f;f=e;e=(d+t1)|0;d=c;c=b;b=a;a=(t1+t2)|0; }
    h0=(h0+a)|0;h1=(h1+b)|0;h2=(h2+c)|0;h3=(h3+d)|0;h4=(h4+e)|0;h5=(h5+f)|0;h6=(h6+g)|0;h7=(h7+h)|0;
  }
  const out = new DataView(new ArrayBuffer(32)); [h0,h1,h2,h3,h4,h5,h6,h7].forEach((v, i) => out.setUint32(i * 4, v >>> 0)); return new Uint8Array(out.buffer);
}
function sha1(bytes) {
  const view = padded(bytes), w = new Uint32Array(80); let h0=0x67452301,h1=0xefcdab89,h2=0x98badcfe,h3=0x10325476,h4=0xc3d2e1f0;
  for (let off = 0; off < view.byteLength; off += 64) {
    for (let i = 0; i < 16; i++) w[i] = view.getUint32(off + i * 4);
    for (let i = 16; i < 80; i++) { const x = w[i-3]^w[i-8]^w[i-14]^w[i-16]; w[i] = (x<<1|x>>>31); }
    let a=h0,b=h1,c=h2,d=h3,e=h4;
    for (let i = 0; i < 80; i++) { const f = i<20?((b&c)|(~b&d)):i<40?(b^c^d):i<60?((b&c)|(b&d)|(c&d)):(b^c^d), k = i<20?0x5a827999:i<40?0x6ed9eba1:i<60?0x8f1bbcdc:0xca62c1d6, t = ((a<<5|a>>>27) + f + e + k + w[i]) | 0; e=d;d=c;c=(b<<30|b>>>2);b=a;a=t; }
    h0=(h0+a)|0;h1=(h1+b)|0;h2=(h2+c)|0;h3=(h3+d)|0;h4=(h4+e)|0;
  }
  const out = new DataView(new ArrayBuffer(20)); [h0,h1,h2,h3,h4].forEach((v, i) => out.setUint32(i * 4, v >>> 0)); return new Uint8Array(out.buffer);
}
export function createHash(name) {
  const algorithm = String(name).toLowerCase().replace('-', ''); if (!['sha256', 'sha1'].includes(algorithm)) throw new Error('Unsupported hash: ' + name);
  const chunks = [];
  const api = { update(data, encoding) { chunks.push(typeof data === 'string' ? Buffer.from(data, encoding || 'utf8') : data instanceof Uint8Array ? data : new Uint8Array(data)); return api; },
    digest(encoding) { const total = new Uint8Array(chunks.reduce((n, c) => n + c.length, 0)); let at = 0; for (const c of chunks) { total.set(c, at); at += c.length; } const out = Buffer.from((algorithm === 'sha1' ? sha1 : sha256)(total)); return encoding ? out.toString(encoding) : out; } };
  return api;
}
export const randomUUID = () => globalThis.crypto.randomUUID();
export const randomBytes = size => Buffer.from(globalThis.crypto.getRandomValues(new Uint8Array(size)));
export function timingSafeEqual(a, b) { if (a.length !== b.length) return false; let diff = 0; for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i]; return diff === 0; }
export default { createHash, randomUUID, randomBytes, timingSafeEqual };
