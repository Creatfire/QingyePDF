// Test double for the Android side: runs in the page before any app script, pretends to be the
// Capacitor Android bridge and implements the QingyeNative plugin over an in-page file map with
// the same method names, arguments, results and error codes as QingyeNativePlugin.java.
(() => {
  const files = new Map(), dirs = new Set(['/', '/storage', '/storage/emulated', '/storage/emulated/0', '/storage/emulated/0/Documents', '/storage/emulated/0/Download', '/data/user/0/org.qingye.pdf/files', '/data/user/0/org.qingye.pdf/cache', '/sandbox']);
  for (const d of [...dirs]) { let p = d; while (p.lastIndexOf('/') > 0) { p = p.slice(0, p.lastIndexOf('/')); dirs.add(p); } }
  const state = { granted: true, calls: [], listeners: new Map(), pending: [], background: 0, exits: 0, shared: [], bars: null, externals: [] };
  const parent = p => p.slice(0, p.lastIndexOf('/')) || '/';
  const fail = (code, text) => { const e = new Error(code + ': ' + text); e.code = code; return e; };
  const b64 = bytes => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); };
  const unb64 = text => Uint8Array.from(atob(text), c => c.charCodeAt(0));
  const describe = p => files.has(p) ? { type: 'file', size: files.get(p).bytes.length, mtime: files.get(p).mtime } : { type: 'dir', size: 0, mtime: 1 };
  const mkdirs = p => { if (p && p !== '/' && !dirs.has(p)) { mkdirs(parent(p)); dirs.add(p); } };
  const inbox = () => state.granted ? '/storage/emulated/0/Documents/QingyePDF' : '/sandbox/QingyePDF';
  const locations = () => { mkdirs(inbox()); mkdirs('/data/user/0/org.qingye.pdf/files/qingye'); mkdirs('/data/user/0/org.qingye.pdf/cache/qingye-tmp'); return { userData: '/data/user/0/org.qingye.pdf/files/qingye', temp: '/data/user/0/org.qingye.pdf/cache/qingye-tmp', storage: state.granted ? '/storage/emulated/0' : inbox(), documents: state.granted ? '/storage/emulated/0/Documents' : inbox(), inbox: inbox(), granted: state.granted, sdk: 34 }; };
  const emit = (event, data) => { for (const id of state.listeners.get(event) || []) window.Capacitor.fromNative({ callbackId: id, pluginId: 'QingyeNative', methodName: 'addListener', save: true, success: true, data }); };
  const readable = p => state.granted || p.startsWith('/data/') || p.startsWith('/sandbox');
  const methods = {
    paths: locations, storageState: locations,
    requestStorage() { state.granted = true; return locations(); },
    openAppSettings() {},
    stat({ path }) { if (!files.has(path) && !dirs.has(path)) throw fail('ENOENT', 'no such file or directory'); return describe(path); },
    readdir({ path }) { if (!dirs.has(path)) throw fail(files.has(path) ? 'ENOTDIR' : 'ENOENT', 'no such directory'); if (!readable(path)) throw fail('EACCES', 'permission denied'); const prefix = path === '/' ? '/' : path + '/', entries = []; for (const p of [...dirs, ...files.keys()]) if (p !== path && p.startsWith(prefix) && !p.slice(prefix.length).includes('/')) entries.push({ name: p.slice(prefix.length), ...describe(p) }); return { entries }; },
    mkdir({ path, recursive }) { if (dirs.has(path)) { if (recursive) return; throw fail('EEXIST', 'file already exists'); } if (files.has(path)) throw fail('EEXIST', 'file already exists'); if (!recursive && !dirs.has(parent(path))) throw fail('ENOENT', 'no such file or directory'); recursive ? mkdirs(path) : dirs.add(path); },
    rm({ path, recursive }) { if (files.delete(path)) return; if (!dirs.has(path)) throw fail('ENOENT', 'no such file or directory'); const inside = [...dirs, ...files.keys()].filter(p => p.startsWith(path + '/')); if (inside.length && !recursive) throw fail('ENOTEMPTY', 'directory not empty'); for (const p of inside) { dirs.delete(p); files.delete(p); } dirs.delete(path); },
    rename({ from, to }) { if (!files.has(from) && !dirs.has(from)) throw fail('ENOENT', 'no such file or directory'); if (!dirs.has(parent(to))) throw fail('ENOENT', 'no such file or directory'); if (files.has(from)) { files.set(to, files.get(from)); files.delete(from); return; } for (const p of [...files.keys()]) if (p.startsWith(from + '/')) { files.set(to + p.slice(from.length), files.get(p)); files.delete(p); } for (const p of [...dirs]) if (p === from || p.startsWith(from + '/')) { dirs.delete(p); dirs.add(to + p.slice(from.length)); } },
    copy({ from, to, exclusive }) { if (!files.has(from)) throw fail('ENOENT', 'no such file or directory'); if (exclusive && (files.has(to) || dirs.has(to))) throw fail('EEXIST', 'file already exists'); if (!dirs.has(parent(to))) throw fail('ENOENT', 'no such file or directory'); files.set(to, { bytes: files.get(from).bytes.slice(), mtime: Date.now() }); },
    read({ path, offset = 0, length = 8 << 20 }) { const f = files.get(path); if (!f) throw fail(dirs.has(path) ? 'EISDIR' : 'ENOENT', 'no such file'); return { data: b64(f.bytes.subarray(offset, offset + length)) }; },
    write({ path, data, append }) { if (dirs.has(path)) throw fail('EISDIR', 'is a directory'); if (!dirs.has(parent(path))) throw fail('ENOENT', 'no such file or directory'); if (!readable(path)) throw fail('EACCES', 'permission denied'); const next = unb64(data || ''), old = append && files.get(path) ? files.get(path).bytes : new Uint8Array(); const all = new Uint8Array(old.length + next.length); all.set(old); all.set(next, old.length); files.set(path, { bytes: all, mtime: Date.now() }); },
    pendingOpens() { const paths = state.pending; state.pending = []; return { paths }; },
    pickAndImport() { const folder = inbox() + '/导入'; mkdirs(folder); files.set(folder + '/picked.pdf', { bytes: files.get('/storage/emulated/0/Documents/guide.pdf')?.bytes || new Uint8Array(), mtime: Date.now() }); return { paths: [folder + '/picked.pdf'] }; },
    shareFile({ path, mime }) { if (!files.has(path)) throw fail('ENOENT', 'no such file'); state.shared.push({ path, mime }); },
    openExternal({ url }) { state.externals.push(url); },
    exitApp() { state.exits++; }, moveToBackground() { state.background++; },
    setImmersive() {}, keepScreenOn() {}, setBars(options) { state.bars = options; },
    dataKey() { return { key: b64(new Uint8Array(32).map((_, i) => i * 7 + 1)) }; },
    async httpStart({ id, url, method, headers, body }) {
      const response = await fetch(url, { method, headers, body: body || undefined });
      const out = {}; response.headers.forEach((v, k) => { out[k] = v; });
      (async () => { try { const reader = response.body.getReader(); for (;;) { const { done, value } = await reader.read(); if (done) break; emit('http', { id, data: b64(value) }); } emit('http', { id, done: true }); } catch (error) { emit('http', { id, error: String(error) }); } })();
      return { status: response.status, statusText: response.statusText, headers: out };
    },
    httpCancel() {},
    htmlToPdf({ html }) { const path = '/data/user/0/org.qingye.pdf/cache/qingye-tmp/export-' + Date.now() + '.pdf'; files.set(path, { bytes: new TextEncoder().encode('%PDF-1.4\n% fake print of ' + html.length + ' chars\n'), mtime: Date.now() }); return { path }; },
    htmlToPng({ html }) { const path = '/data/user/0/org.qingye.pdf/cache/qingye-tmp/export-' + Date.now() + '.png'; files.set(path, { bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mtime: Date.now() }); return { path }; },
    printHtml() {},
  };
  window.androidBridge = { postMessage(text) {
    const message = JSON.parse(text), { callbackId, pluginId, methodName, options = {} } = message;
    if (pluginId !== 'QingyeNative') { setTimeout(() => window.Capacitor.fromNative({ callbackId, pluginId, methodName, success: true, data: {} })); return; }
    state.calls.push(methodName);
    if (methodName === 'addListener') { if (!state.listeners.has(options.eventName)) state.listeners.set(options.eventName, []); state.listeners.get(options.eventName).push(callbackId); return; }
    if (methodName === 'removeListener' || methodName === 'removeAllListeners') return;
    Promise.resolve().then(() => { if (!methods[methodName]) throw fail('UNIMPLEMENTED', methodName); return methods[methodName](options); })
      .then(data => window.Capacitor.fromNative({ callbackId, pluginId, methodName, success: true, data: data ?? {} }), error => window.Capacitor.fromNative({ callbackId, pluginId, methodName, success: false, error: { message: error.message, code: error.code } }));
  } };
  const names = [...Object.keys(methods).map(name => ({ name, rtype: 'promise' })), { name: 'addListener', rtype: 'callback' }, { name: 'removeListener' }, { name: 'removeAllListeners', rtype: 'promise' }];
  window.Capacitor = { PluginHeaders: [{ name: 'QingyeNative', methods: names }] };
  window.fakeNative = { files, dirs, state, emit, put(path, bytes) { mkdirs(parent(path)); files.set(path, { bytes, mtime: Date.now() }); }, get: path => files.get(path)?.bytes || null };
})();
