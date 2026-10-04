// Library search (0.11.0): full-text search across every document in the recent list.
// The index lives in the user-data folder, one JSON file per document, and is rebuilt for a
// document whenever its size or modification time changes. Nothing leaves the computer.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const LIMITS = { pages: 5000, pageChars: 200000, documentChars: 24 * 1024 * 1024, hitsPerDocument: 20, hits: 300, terms: 8 };
const fold = text => String(text).toLowerCase();
/** "deep learning" 图像 → ['deep learning', '图像'] */
function parseQuery(query) {
  const terms = [], pattern = /"([^"]+)"|“([^”]+)”|(\S+)/g;
  for (let m; (m = pattern.exec(String(query || '').slice(0, 400))) && terms.length < LIMITS.terms;) { const term = fold(m[1] || m[2] || m[3]).replace(/\s+/g, ' ').trim(); if (term) terms.push(term); }
  return terms;
}
function snippet(text, at, length, radius = 48) {
  const from = Math.max(0, at - radius), to = Math.min(text.length, at + length + radius * 1.5);
  return { before: (from > 0 ? '…' : '') + text.slice(from, at).replace(/\s+/g, ' '), match: text.slice(at, at + length), after: text.slice(at + length, to).replace(/\s+/g, ' ') + (to < text.length ? '…' : '') };
}
/** Hits of one document. A PDF page (or a Markdown paragraph) matches when it contains every term;
 *  each occurrence of the first term is one hit. */
function searchDocument(entry, terms, limit = LIMITS.hitsPerDocument) {
  const hits = []; let total = 0;
  const scan = (text, base, place) => {
    const low = fold(text); if (!terms.every(term => low.includes(term))) return;
    for (let at = low.indexOf(terms[0]); at >= 0; at = low.indexOf(terms[0], at + terms[0].length)) { total++; if (hits.length < limit) hits.push({ ...place, offset: base + at, ...snippet(text, at, terms[0].length) }); }
  };
  if (entry.kind === 'markdown') {
    const text = entry.pages[0] || ''; let line = 1;
    // Paragraphs: blocks separated by blank lines.
    for (const block of text.matchAll(/[^\n]+(?:\n[^\n]+)*/g)) { scan(block[0], block.index, { line: text.slice(0, block.index).split('\n').length }); line++; }
  } else entry.pages.forEach((text, index) => scan(text, 0, { page: index + 1 }));
  return { hits, total };
}
function search(entries, query, { limit = LIMITS.hits } = {}) {
  const terms = parseQuery(query); if (!terms.length) return { terms, documents: [], total: 0 };
  const documents = [];
  for (const entry of entries) { const found = searchDocument(entry, terms); if (found.total) documents.push({ path: entry.path, name: entry.name, kind: entry.kind, total: found.total, hits: found.hits }); }
  documents.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  let left = limit; for (const doc of documents) { doc.hits = doc.hits.slice(0, Math.max(0, left)); left -= doc.hits.length; }
  return { terms, documents: documents.filter(doc => doc.hits.length), total: documents.reduce((sum, doc) => sum + doc.total, 0) };
}
function cleanPages(pages) {
  if (!Array.isArray(pages) || pages.length > LIMITS.pages) throw new Error('文档页数超过全库搜索的上限。');
  let total = 0;
  return pages.map(page => { const text = String(page ?? '').slice(0, LIMITS.pageChars); total += text.length; if (total > LIMITS.documentChars) throw new Error('文档文字超过全库搜索的上限。'); return text; });
}

function createLibraryIndex({ directory, keyOf = file => file }) {
  const entries = new Map(); let loaded = null;
  const fileOf = file => path.join(directory, createHash('sha256').update(keyOf(file)).digest('hex').slice(0, 32) + '.json');
  const load = () => loaded ||= (async () => {
    for (const name of await fs.readdir(directory).catch(() => [])) {
      if (!name.endsWith('.json')) continue;
      try { const entry = JSON.parse(await fs.readFile(path.join(directory, name), 'utf8')); if (entry?.path && Array.isArray(entry.pages)) entries.set(keyOf(entry.path), entry); } catch { /* a damaged index file is rebuilt on demand */ }
    }
  })();
  const stamp = async file => { const info = await fs.stat(file).catch(() => null); return info?.isFile() ? { size: info.size, mtime: Math.round(info.mtimeMs) } : null; };
  /** 'ready' | 'stale' (changed or never indexed) | 'missing' (file is gone) */
  async function state(file) { await load(); const now = await stamp(file); if (!now) return 'missing'; const entry = entries.get(keyOf(file)); return entry && entry.size === now.size && entry.mtime === now.mtime ? 'ready' : 'stale'; }
  async function put(file, { name, kind, pages, note }) {
    await load(); const now = await stamp(file); if (!now) throw new Error('文件不存在：' + file);
    const entry = { version: 1, path: file, name: name || path.basename(file), kind, ...now, pages: cleanPages(pages), ...(note ? { note: String(note).slice(0, 200) } : {}) };
    await fs.mkdir(directory, { recursive: true });
    const target = fileOf(file), temp = target + '.' + process.pid + '.tmp';
    await fs.writeFile(temp, JSON.stringify(entry)); await fs.rename(temp, target);
    entries.set(keyOf(file), entry); return true;
  }
  /** Drops index files of documents that are no longer in the recent list. */
  async function prune(files) {
    await load(); const keep = new Set(files.map(keyOf));
    for (const [key, entry] of [...entries]) if (!keep.has(key)) { entries.delete(key); await fs.rm(fileOf(entry.path), { force: true }).catch(() => {}); }
  }
  async function find(query, files) { await load(); const wanted = files.map(file => entries.get(keyOf(file))).filter(Boolean); return search(wanted, query); }
  async function clear() { await load(); entries.clear(); await fs.rm(directory, { recursive: true, force: true }).catch(() => {}); }
  return { state, put, prune, find, clear, size: async () => { await load(); return entries.size; } };
}
module.exports = { createLibraryIndex, search, searchDocument, parseQuery, snippet, cleanPages, LIMITS };
