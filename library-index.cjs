// Library search (0.11.0): full-text search across every document in the recent list.
// The index lives in the user-data folder, one JSON file per document, and is rebuilt for a
// document whenever its size or modification time changes. Nothing leaves the computer.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash } = require('node:crypto');

const LIMITS = { pages: 5000, pageChars: 200000, documentChars: 24 * 1024 * 1024, hitsPerDocument: 20, hits: 300, terms: 8, cachedChars: 24 * 1024 * 1024 };
// 2 (0.20): Markdown notes are no longer cut at the PDF page limit; older index files are rebuilt.
const INDEX_VERSION = 2;
const fold = text => String(text).toLowerCase();
// Lower-cased text is reused across keystrokes; without the cache every query folds the whole
// index again. Entries are the keys, so re-indexing a document drops its cached copy by itself,
// and caching stops once it would hold more text than the index itself is worth.
const foldedCache = new WeakMap();
let cachedChars = 0;
function cached(entry, build) {
  const hit = foldedCache.get(entry); if (hit) return hit;
  const units = build();
  const chars = units.reduce((sum, unit) => sum + (typeof unit === 'string' ? unit.length : unit.low.length), 0);
  if (cachedChars + chars <= LIMITS.cachedChars) { cachedChars += chars; foldedCache.set(entry, units); }
  return units;
}
/** Paragraphs of a Markdown note: where each starts, its folded text and its 1-based line. */
function markdownBlocks(text) {
  const blocks = []; let counted = 0, line = 1;
  for (const block of text.matchAll(/[^\n]+(?:\n[^\n]+)*/g)) {
    // Newlines are counted only up to the previous paragraph. Recomputing the line from the start of
    // the document for every paragraph is quadratic, which a long note feels on every keystroke.
    for (let at = counted; at < block.index; at++) if (text.charCodeAt(at) === 10) line++;
    counted = block.index;
    blocks.push({ at: block.index, low: fold(block[0]), line });
  }
  return blocks;
}
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
  const scan = (text, low, base, place) => {
    if (!terms.every(term => low.includes(term))) return;
    for (let at = low.indexOf(terms[0]); at >= 0; at = low.indexOf(terms[0], at + terms[0].length)) { total++; if (hits.length < limit) hits.push({ ...place, offset: base + at, ...snippet(text, base + at, terms[0].length) }); }
  };
  if (entry.kind === 'markdown') {
    const text = entry.pages[0] || '';
    // Paragraphs: blocks separated by blank lines.
    for (const block of cached(entry, () => markdownBlocks(text))) scan(text, block.low, block.at, { line: block.line });
  } else {
    const folded = cached(entry, () => entry.pages.map(fold));
    entry.pages.forEach((text, index) => scan(text, folded[index], 0, { page: index + 1 }));
  }
  return { hits, total };
}
function search(entries, query, { limit = LIMITS.hits } = {}) {
  const terms = parseQuery(query); if (!terms.length) return { terms, documents: [], total: 0 };
  const documents = [];
  for (const entry of entries) { const found = searchDocument(entry, terms); if (found.total) documents.push({ path: entry.path, name: entry.name, kind: entry.kind, total: found.total, hits: found.hits, ...(entry.truncated ? { truncated: entry.truncated } : {}) }); }
  documents.sort((a, b) => b.total - a.total || a.name.localeCompare(b.name));
  let left = limit; for (const doc of documents) { doc.hits = doc.hits.slice(0, Math.max(0, left)); left -= doc.hits.length; }
  // Documents indexed only in part are reported even without hits: the term may be in the rest.
  const truncated = entries.filter(entry => entry.truncated).map(entry => ({ name: entry.name, path: entry.path, indexedChars: entry.truncated.indexedChars }));
  return { terms, documents: documents.filter(doc => doc.hits.length), total: documents.reduce((sum, doc) => sum + doc.total, 0), truncated };
}
/** Index text of a document. A PDF page keeps at most `pageChars`; a Markdown note is one "page"
 *  limited only by `documentChars`. Whatever is cut is reported in `truncated` (shown in search). */
function indexPages(pages, kind) {
  if (!Array.isArray(pages) || pages.length > LIMITS.pages) throw new Error('文档页数超过全库搜索的上限。');
  const pageLimit = kind === 'markdown' ? LIMITS.documentChars : LIMITS.pageChars;
  let total = 0, cut = false;
  const out = pages.map(page => {
    const full = String(page ?? ''), text = full.slice(0, Math.max(0, Math.min(pageLimit, LIMITS.documentChars - total)));
    if (text.length < full.length) cut = true; total += text.length; return text;
  });
  return { pages: out, truncated: cut ? { indexedChars: total } : null };
}
const cleanPages = (pages, kind) => indexPages(pages, kind).pages;

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
  async function state(file) { await load(); const now = await stamp(file); if (!now) return 'missing'; const entry = entries.get(keyOf(file)); return entry && entry.version === INDEX_VERSION && entry.size === now.size && entry.mtime === now.mtime ? 'ready' : 'stale'; }
  async function put(file, { name, kind, pages, note }) {
    await load(); const now = await stamp(file); if (!now) throw new Error('文件不存在：' + file);
    const indexed = indexPages(pages, kind);
    const entry = { version: INDEX_VERSION, path: file, name: name || path.basename(file), kind, ...now, pages: indexed.pages, ...(indexed.truncated ? { truncated: indexed.truncated } : {}), ...(note ? { note: String(note).slice(0, 200) } : {}) };
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
module.exports = { createLibraryIndex, search, searchDocument, parseQuery, snippet, cleanPages, indexPages, LIMITS, INDEX_VERSION };
