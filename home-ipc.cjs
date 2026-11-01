// What the home page shows beyond the recent list (0.23): the page thumbnails, the highlights read
// from each PDF, and a short preview of each Markdown note. Thumbnails and highlights live in the
// user-data folder ("home/"), never next to the documents, and are forgotten with the recent entry.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');
const { fileURLToPath } = require('node:url');

const MAX_THUMBS = 30, MAX_MARKS = 40, MAX_THUMB_BYTES = 1024 * 1024, MAX_NOTES = 10, NOTE_HEAD = 64 * 1024;
const MAX_HIGHLIGHTS = 40, MAX_HIGHLIGHT_CHARS = 240;

/** Title, the first two lines of text, and the first PDF the note links back to. */
function notePreview(text, fallback = '') {
  const lines = String(text || '').replace(/\r\n?/g, '\n').replace(/^---\n[\s\S]*?\n---\n/, '').split('\n');
  let title = '', fence = false; const body = [];
  for (const raw of lines) {
    if (/^\s*(```|~~~)/.test(raw)) { fence = !fence; continue; }
    if (fence) continue;
    const heading = /^\s{0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(raw);
    if (heading) { title ||= plain(heading[1]); continue; }
    const line = plain(raw);
    if (line && body.length < 2) body.push(line.slice(0, 160));
  }
  const link = /\]\(<?file:\/\/([^)>\s#]*)#page=\d+/.exec(String(text || ''));
  let source = null;
  if (link) { try { const file = fileURLToPath('file://' + link[1]); source = { name: path.basename(file), path: file }; } catch { /* a malformed link is simply not a source */ } }
  return { title: title || fallback, lines: body, source };
}
const plain = line => line.replace(/^\s*(?:>+\s*|[-*+]\s+|\d+[.)]\s+)*/, '').replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/[*_`~]+/g, '').replace(/\s+/g, ' ').trim();

/** Validates what the window read from a PDF. */
function cleanMarks(marks) {
  const m = marks && typeof marks === 'object' ? marks : {};
  const highlights = (Array.isArray(m.highlights) ? m.highlights : [])
    .filter(h => h && Number.isInteger(h.page) && h.page > 0 && typeof h.text === 'string' && h.text.trim())
    .slice(0, MAX_HIGHLIGHTS).map(h => ({ page: h.page, text: h.text.trim().slice(0, MAX_HIGHLIGHT_CHARS), at: Number(h.at) || 0 }));
  return { annotations: Math.max(0, Math.min(1000000, Math.floor(Number(m.annotations) || 0))), highlights };
}

function createHomeData({ directory, write, keyOf }) {
  const indexFile = path.join(directory, 'index.json'), thumbFile = file => path.join(directory, 'thumbs', createHash('sha1').update(keyOf(file)).digest('hex') + '.jpg');
  let index = null, saving = Promise.resolve();
  async function load() {
    if (index) return index;
    try { const data = JSON.parse(await fs.readFile(indexFile, 'utf8')); index = { thumbs: Array.isArray(data.thumbs) ? data.thumbs.filter(t => typeof t?.path === 'string') : [], marks: Array.isArray(data.marks) ? data.marks.filter(m => typeof m?.path === 'string') : [] }; }
    catch { index = { thumbs: [], marks: [] }; }
    return index;
  }
  // Windows and the periodic capture can write at the same time; writes run one after another.
  const save = () => (saving = saving.catch(() => {}).then(async () => { await fs.mkdir(directory, { recursive: true }); await write(indexFile, JSON.stringify(index)); }));
  const same = (a, b) => keyOf(a) === keyOf(b);

  async function putThumb(file, page, dataUrl) {
    const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
    if (!match) throw new Error('缩略图格式无效。');
    const bytes = Buffer.from(match[1], 'base64'); if (!bytes.length || bytes.length > MAX_THUMB_BYTES) throw new Error('缩略图过大。');
    await load(); await fs.mkdir(path.dirname(thumbFile(file)), { recursive: true });
    await write(thumbFile(file), bytes);
    index.thumbs = [{ path: file, page: Math.max(1, Math.floor(Number(page) || 1)), at: Date.now() }, ...index.thumbs.filter(t => !same(t.path, file))];
    for (const old of index.thumbs.splice(MAX_THUMBS)) await fs.rm(thumbFile(old.path), { force: true }).catch(() => {});
    await save();
    return true;
  }
  async function getThumb(file) {
    await load(); if (!index.thumbs.some(t => same(t.path, file))) return null;
    try { return 'data:image/jpeg;base64,' + (await fs.readFile(thumbFile(file))).toString('base64'); }
    catch { index.thumbs = index.thumbs.filter(t => !same(t.path, file)); await save(); return null; }
  }
  async function putMarks(file, sig, marks) {
    await load();
    index.marks = [{ path: file, sig: String(sig || ''), ...cleanMarks(marks) }, ...index.marks.filter(m => !same(m.path, file))].slice(0, MAX_MARKS);
    await save();
  }
  async function info(file) { await load(); return { thumb: index.thumbs.find(t => same(t.path, file)) || null, marks: index.marks.find(m => same(m.path, file)) || null }; }
  /** Removing a recent entry also removes the page image and the quoted text stored for it. */
  async function forget(file) {
    await load(); index.thumbs = index.thumbs.filter(t => !same(t.path, file)); index.marks = index.marks.filter(m => !same(m.path, file));
    await fs.rm(thumbFile(file), { force: true }).catch(() => {}); await save();
  }
  async function clear() { await load(); index = { thumbs: [], marks: [] }; await fs.rm(path.join(directory, 'thumbs'), { recursive: true, force: true }).catch(() => {}); await save(); }
  return { putThumb, getThumb, putMarks, info, forget, clear };
}

function register({ handle, app, preferences, recentTokens, documentById, key, markdownFiles, officeConvert, atomicWrite, fingerprint }) {
  const write = async (file, bytes) => atomicWrite(file, Buffer.from(bytes), await fingerprint(file));
  const data = createHomeData({ directory: path.join(app.getPath('userData'), 'home'), write, keyOf: key });
  const tokenFor = file => { let token = [...recentTokens].find(([, p]) => p === file)?.[0]; if (!token) { token = randomUUID(); recentTokens.set(token, file); } return token; };
  const fileOf = id => { const file = recentTokens.get(id); if (!file) throw new Error('最近文件不存在。'); return file; };
  const kindOf = (file, item) => (item?.kind === 'office' || officeConvert.isOffice(file) ? 'office' : markdownFiles.isMarkdown(file) ? 'markdown' : 'pdf');

  async function book(file, name, item, extras) {
    const stat = await fs.stat(file).catch(() => null), { thumb, marks } = await data.info(file), kind = kindOf(file, item), state = item?.state || {};
    const pinned = (preferences.pinned || []).some(p => key(p.path) === key(file));
    return { id: tokenFor(file), name, path: file, kind, ext: path.extname(file).slice(1).toLowerCase(), opened: Number(item?.opened) || 0, inRecent: !!item, ...extras,
      page: kind === 'pdf' ? Number(state.page) || 0 : 0, pages: kind === 'pdf' ? Number(state.pages) || 0 : 0, chapter: typeof state.chapter === 'string' ? state.chapter : '',
      bookmarks: Array.isArray(state.bookmarks) ? state.bookmarks.length : 0, annotations: marks?.annotations || 0, highlights: marks?.highlights || [], marksSig: marks?.sig || '',
      sig: stat ? `${stat.mtimeMs}:${stat.size}` : '', size: stat?.size || 0, missing: !stat, hasThumb: !!thumb, thumbPage: thumb?.page || 0, pinned };
  }
  /** Everything the home page needs in one call: recent documents first, then pinned and workspace files. */
  handle('home-feed', async () => {
    const seen = new Set(), books = [];
    for (const item of preferences.recent) { if (seen.has(key(item.path))) continue; seen.add(key(item.path)); books.push(await book(item.path, item.name, item)); }
    for (const other of [...(preferences.pinned || []), ...(preferences.workspaces || []).flatMap(w => w.items)]) { if (seen.has(key(other.path))) continue; seen.add(key(other.path)); books.push(await book(other.path, other.name, null)); }
    const collections = (preferences.workspaces || []).map(w => ({ id: w.id, name: w.name, ids: w.items.map(i => books.find(b => key(b.path) === key(i.path))?.id).filter(Boolean) }));
    return { books, collections };
  });
  handle('home-thumb', id => data.getThumb(fileOf(id)));
  // The window renders the page; only the path known for that open document is written for.
  handle('home-thumb-put', async (documentId, page, dataUrl) => { const record = documentById(documentId), file = record.source || record.path; if (!file) return false; return data.putThumb(file, page, dataUrl); });
  handle('home-marks-put', async (id, sig, marks) => { await data.putMarks(fileOf(id), sig, marks); return true; });
  /** Previews of the most recent notes, and which PDF each one links back to. */
  handle('home-notes', async () => {
    const out = [];
    for (const item of preferences.recent.filter(r => markdownFiles.isMarkdown(r.path)).slice(0, MAX_NOTES)) {
      try {
        const handleFile = await fs.open(item.path, 'r');
        try { const buffer = Buffer.alloc(NOTE_HEAD), { bytesRead } = await handleFile.read(buffer, 0, NOTE_HEAD, 0); out.push({ id: tokenFor(item.path), name: item.name, path: item.path, opened: Number(item.opened) || 0, ...notePreview(markdownFiles.decodeMarkdown(buffer.subarray(0, bytesRead)).text, item.name.replace(/\.[^.]+$/, '')) }); }
        finally { await handleFile.close(); }
      } catch { /* a moved note just has no preview */ }
    }
    return out;
  });
  return { forget: file => data.forget(file), clear: () => data.clear() };
}
module.exports = { register, createHomeData, notePreview, cleanMarks, MAX_THUMBS };
