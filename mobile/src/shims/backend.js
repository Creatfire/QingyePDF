// Storage backends behind the Node-style fs shim.
// - native: the QingyeNative Capacitor plugin (real files on the device)
// - memory: an in-memory tree used in a plain browser (development and automated tests)
// Paths under /__app are the read-only bundled web assets (ui/, vendor/) and are fetched.
import { Capacitor, registerPlugin } from '@capacitor/core';

export const isNative = Capacitor.isNativePlatform();
// Inside the installed app the native bridge must be there. Falling back to the in-memory
// storage would make saved files silently disappear, so that case is a start-up error instead.
export const bridgeMissing = !isNative && /Android/.test(navigator.userAgent) && location.protocol === 'https:' && location.hostname === 'localhost';
export const Native = isNative ? registerPlugin('QingyeNative') : null;
export const APP_ROOT = '/__app';

const fail = (code, path, message) => Object.assign(new Error(`${code}: ${message || 'file error'}, '${path}'`), { code, path });
const norm = p => { const parts = []; for (const s of String(p).split('/')) { if (!s || s === '.') continue; if (s === '..') parts.pop(); else parts.push(s); } return '/' + parts.join('/'); };
const parent = p => { const n = norm(p), i = n.lastIndexOf('/'); return i <= 0 ? '/' : n.slice(0, i); };
const b64encode = bytes => { let out = ''; for (let i = 0; i < bytes.length; i += 0x8000) out += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(out); };
const b64decode = text => { const bin = atob(text), out = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i); return out; };
export { b64encode, b64decode };

// ——— bundled assets ———
const assetUrl = p => new URL('..' + norm(p).slice(APP_ROOT.length).split('/').map(encodeURIComponent).join('/'), document.baseURI).href;
const isAsset = p => { const n = norm(p); return n === APP_ROOT || n.startsWith(APP_ROOT + '/'); };
async function assetRead(p) {
  const response = await fetch(assetUrl(p)).catch(() => null);
  if (!response || !response.ok) throw fail('ENOENT', p, 'no such file or directory');
  return new Uint8Array(await response.arrayBuffer());
}

// ——— memory backend ———
function memoryBackend() {
  const files = new Map(), dirs = new Map([['/', Date.now()]]);
  const touchDirs = p => { let d = parent(p); const chain = []; while (!dirs.has(d)) { chain.push(d); d = parent(d); } for (const c of chain) dirs.set(c, Date.now()); };
  return {
    kind: 'memory', files, dirs,
    async stat(p) { p = norm(p); if (files.has(p)) { const f = files.get(p); return { type: 'file', size: f.bytes.length, mtime: f.mtime }; } if (dirs.has(p)) return { type: 'dir', size: 0, mtime: dirs.get(p) }; throw fail('ENOENT', p, 'no such file or directory'); },
    async readdir(p) { p = norm(p); if (!dirs.has(p)) throw fail(files.has(p) ? 'ENOTDIR' : 'ENOENT', p, 'no such directory'); const prefix = p === '/' ? '/' : p + '/', out = [];
      for (const d of dirs.keys()) if (d !== p && d.startsWith(prefix) && !d.slice(prefix.length).includes('/')) out.push({ name: d.slice(prefix.length), type: 'dir', size: 0, mtime: dirs.get(d) });
      for (const [f, v] of files) if (f.startsWith(prefix) && !f.slice(prefix.length).includes('/')) out.push({ name: f.slice(prefix.length), type: 'file', size: v.bytes.length, mtime: v.mtime });
      return out; },
    async read(p) { p = norm(p); const f = files.get(p); if (!f) throw fail(dirs.has(p) ? 'EISDIR' : 'ENOENT', p, 'no such file or directory'); return f.bytes.slice(); },
    async write(p, bytes) { p = norm(p); if (dirs.has(p)) throw fail('EISDIR', p, 'is a directory'); if (!dirs.has(parent(p))) throw fail('ENOENT', p, 'no such file or directory'); files.set(p, { bytes: bytes.slice(), mtime: Date.now() }); },
    async mkdir(p, recursive) { p = norm(p); if (dirs.has(p)) { if (recursive) return; throw fail('EEXIST', p, 'file already exists'); } if (files.has(p)) throw fail('EEXIST', p, 'file already exists'); if (!dirs.has(parent(p))) { if (!recursive) throw fail('ENOENT', p, 'no such file or directory'); touchDirs(p); } dirs.set(p, Date.now()); },
    async rm(p, recursive) { p = norm(p); if (files.delete(p)) return; if (!dirs.has(p)) throw fail('ENOENT', p, 'no such file or directory'); const prefix = p + '/';
      const inside = [...files.keys(), ...dirs.keys()].filter(k => k.startsWith(prefix)); if (inside.length && !recursive) throw fail('ENOTEMPTY', p, 'directory not empty');
      for (const k of inside) { files.delete(k); dirs.delete(k); } dirs.delete(p); },
    async rename(a, b) { a = norm(a); b = norm(b); if (a === b) return; if (!dirs.has(parent(b))) throw fail('ENOENT', b, 'no such file or directory');
      if (files.has(a)) { files.set(b, files.get(a)); files.delete(a); return; }
      if (!dirs.has(a)) throw fail('ENOENT', a, 'no such file or directory');
      for (const k of [...files.keys()]) if (k.startsWith(a + '/')) { files.set(b + k.slice(a.length), files.get(k)); files.delete(k); }
      for (const k of [...dirs.keys()]) if (k === a || k.startsWith(a + '/')) { dirs.set(b + k.slice(a.length), dirs.get(k)); dirs.delete(k); } },
    async copy(a, b, exclusive) { a = norm(a); b = norm(b); const f = files.get(a); if (!f) throw fail('ENOENT', a, 'no such file or directory'); if (exclusive && (files.has(b) || dirs.has(b))) throw fail('EEXIST', b, 'file already exists'); if (!dirs.has(parent(b))) throw fail('ENOENT', b, 'no such file or directory'); files.set(b, { bytes: f.bytes.slice(), mtime: Date.now() }); },
  };
}

// ——— native backend ———
// Capacitor serves device files under /_capacitor_file_/<absolute path>; every segment is
// encoded so that names containing #, ? or % survive the URL.
const fileUrl = p => location.origin + '/_capacitor_file_' + String(p).split('/').map(encodeURIComponent).join('/');
function nativeBackend() {
  const call = async (method, args) => { try { return await Native[method](args); } catch (error) { const code = /^E[A-Z]+$/.test(error?.code || '') ? error.code : (/^(E[A-Z]+)\b/.exec(error?.message || '') || [])[1] || 'EIO'; throw fail(code, args.path || args.from, error?.message); } };
  const CHUNK = 3 * 256 * 1024; // multiple of 3: base64 chunks concatenate cleanly
  return {
    kind: 'native',
    stat: p => call('stat', { path: p }),
    async readdir(p) { return (await call('readdir', { path: p })).entries; },
    async read(p) {
      // Large files stream through the WebView's local file server instead of the JSON bridge.
      const response = await fetch(fileUrl(p), { cache: 'no-store' }).catch(() => null);
      if (response && response.ok) return new Uint8Array(await response.arrayBuffer());
      const info = await call('stat', { path: p }); if (info.type !== 'file') throw fail('EISDIR', p, 'is a directory');
      const parts = []; for (let at = 0; at < info.size || at === 0; at += CHUNK) { const r = await call('read', { path: p, offset: at, length: CHUNK }); parts.push(b64decode(r.data)); if (!r.data) break; }
      const out = new Uint8Array(parts.reduce((n, c) => n + c.length, 0)); let at = 0; for (const c of parts) { out.set(c, at); at += c.length; } return out;
    },
    async write(p, bytes) {
      if (bytes.length <= CHUNK) { await call('write', { path: p, data: b64encode(bytes), append: false }); return; }
      for (let at = 0; at < bytes.length; at += CHUNK) await call('write', { path: p, data: b64encode(bytes.subarray(at, at + CHUNK)), append: at > 0 });
    },
    mkdir: (p, recursive) => call('mkdir', { path: p, recursive: !!recursive }),
    rm: (p, recursive) => call('rm', { path: p, recursive: !!recursive }),
    rename: (a, b) => call('rename', { from: a, to: b }),
    copy: (a, b, exclusive) => call('copy', { from: a, to: b, exclusive: !!exclusive }),
  };
}

const disk = isNative ? nativeBackend() : memoryBackend();
const readOnly = p => fail('EROFS', p, 'read-only file system');
export const backend = {
  kind: disk.kind, disk,
  async stat(p) { if (isAsset(p)) { if (/\.[a-z0-9]+$/i.test(p)) { const bytes = await assetRead(p); return { type: 'file', size: bytes.length, mtime: 0 }; } return { type: 'dir', size: 0, mtime: 0 }; } return disk.stat(p); },
  async readdir(p) { if (isAsset(p)) throw fail('ENOENT', p, 'bundled assets cannot be listed'); return disk.readdir(p); },
  async read(p) { return isAsset(p) ? assetRead(p) : disk.read(p); },
  async write(p, bytes) { if (isAsset(p)) throw readOnly(p); return disk.write(p, bytes); },
  async mkdir(p, r) { if (isAsset(p)) throw readOnly(p); return disk.mkdir(p, r); },
  async rm(p, r) { if (isAsset(p)) throw readOnly(p); return disk.rm(p, r); },
  async rename(a, b) { if (isAsset(a) || isAsset(b)) throw readOnly(a); return disk.rename(a, b); },
  async copy(a, b, x) { if (isAsset(b)) throw readOnly(b); if (isAsset(a)) return disk.write(b, await assetRead(a)); return disk.copy(a, b, x); },
};
export { fail, norm };
