// 0.11.0: library search across the recent list, and reference details (DOI lookup, .bib export).
// The index lives in the user-data folder (library-index.cjs); nothing here leaves the computer
// except the DOI itself, and only when the user presses "look up online".
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createLibraryIndex } = require('./library-index.cjs');

/** @param ctx handle, app, T, dialog, getWindow, preferences, recentTokens, documents, key, markdownFiles, atomicWrite, fingerprint */
function register(ctx) {
  const { handle, app, T, dialog, getWindow, preferences, recentTokens, documents, key, markdownFiles, atomicWrite, fingerprint } = ctx;
  const library = createLibraryIndex({ directory: path.join(app.getPath('userData'), 'library-index'), keyOf: key });
  const recentFile = id => { const file = recentTokens.get(id); if (!file) throw new Error('最近文件不存在。'); return file; };
  const recentEntries = () => preferences.recent.map(item => { let token = [...recentTokens].find(([, file]) => file === item.path)?.[0]; if (!token) { token = randomUUID(); recentTokens.set(token, item.path); } return { id: token, name: item.name, path: item.path, kind: markdownFiles.isMarkdown(item.path) ? 'markdown' : 'pdf' }; });
  // Which documents are searchable. Markdown is indexed here; PDFs are read by the window (PDF.js).
  handle('library-status', async () => {
    const items = recentEntries(), out = [];
    await library.prune(items.map(item => item.path));
    for (const item of items) {
      let state = await library.state(item.path);
      if (state === 'stale' && item.kind === 'markdown') {
        try { const raw = await fs.readFile(item.path); if (raw.length > 16 * 1024 * 1024) throw new Error('too large'); await library.put(item.path, { name: item.name, kind: 'markdown', pages: [markdownFiles.decodeMarkdown(raw).text.replace(/\r\n?/g, '\n')] }); state = 'ready'; }
        catch { state = 'skipped'; }
      }
      const open = [...documents.values()].find(d => d.path && key(d.path) === key(item.path));
      out.push({ ...item, state, openId: open?.id || null });
    }
    return out;
  });
  handle('library-read', async id => {
    const file = recentFile(id); if (path.extname(file).toLowerCase() !== '.pdf') throw new Error('只能为 PDF 读取索引内容。');
    const info = await fs.stat(file); if (info.size > 300 * 1024 * 1024) throw new Error('文件超过 300 MB，未加入全库搜索。');
    return fs.readFile(file);
  });
  handle('library-put', async (id, pages, note) => { const file = recentFile(id); return library.put(file, { name: path.basename(file), kind: markdownFiles.isMarkdown(file) ? 'markdown' : 'pdf', pages, note }); });
  handle('library-search', async query => {
    const items = recentEntries(), found = await library.find(String(query || ''), items.map(item => item.path));
    return { ...found, documents: found.documents.map(doc => ({ ...doc, id: items.find(item => key(item.path) === key(doc.path))?.id })) };
  });
  handle('library-clear', async () => { await library.clear(); return true; });
  // Only the DOI goes to doi.org, and only when the user presses "look up online".
  handle('citation-lookup', async doi => {
    const value = String(doi || '').trim(); if (!/^10\.\d{4,9}\/[^\s"<>]{1,200}$/.test(value)) throw new Error('DOI 格式无效。');
    let response;
    try { response = await fetch('https://doi.org/' + encodeURI(value), { headers: { Accept: 'application/vnd.citationstyles.csl+json', 'User-Agent': 'QingyePDF/' + app.getVersion() }, redirect: 'follow', signal: AbortSignal.timeout(15000) }); }
    catch { throw new Error('无法连接 doi.org，请检查网络后重试。'); }
    if (response.status === 404) throw new Error('doi.org 没有这个 DOI 的记录。');
    if (!response.ok) throw new Error('doi.org 返回了错误（' + response.status + '）。');
    const text = await response.text(); if (text.length > 2 * 1024 * 1024) throw new Error('doi.org 返回的记录过大。');
    try { return JSON.parse(text); } catch { throw new Error('doi.org 返回的记录无法识别。'); }
  });
  handle('save-text-file', async (name, text) => {
    const base = path.basename(String(name || 'references.bib')), ext = path.extname(base).toLowerCase();
    if (!['.bib', '.txt', '.md'].includes(ext)) throw new Error('不支持的导出格式。');
    if (typeof text !== 'string' || Buffer.byteLength(text, 'utf8') > 32 * 1024 * 1024) throw new Error('导出内容无效或超过 32 MB。');
    const selected = await dialog.showSaveDialog(getWindow(), { title: T('导出'), defaultPath: path.join(app.getPath('documents'), base), filters: [{ name: ext.slice(1).toUpperCase(), extensions: [ext.slice(1)] }] });
    if (selected.canceled) return { canceled: true };
    const target = selected.filePath.toLowerCase().endsWith(ext) ? selected.filePath : selected.filePath + ext;
    if ([...documents.values()].some(d => d.path && key(d.path) === key(target))) throw new Error('输出不能覆盖正在打开的文档，请使用新的文件名。');
    await atomicWrite(target, Buffer.from(text, 'utf8'), await fingerprint(target)); return { path: target };
  });
  return { library };
}

module.exports = { register };
