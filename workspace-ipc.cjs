// Document workspaces and pinned documents (0.20). A workspace remembers a set of documents (PDF,
// Markdown, Office), the notes-mode pair and its divider, and which tab was active; opening it
// restores them, and documents that were moved can be located again without losing their place in
// the workspace. Pinned documents are a short list of their own, kept apart from the recent list.
// Everything is stored in the user's preferences file; files are referenced by path only.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

const MAX_WORKSPACES = 50, MAX_ITEMS = 30, MAX_PINNED = 40;
const cleanName = (value, fallback) => String(value || '').replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80) || fallback;
const exists = file => fs.stat(file).then(s => s.isFile(), () => false);

/** Validates a workspace read from the preferences file. */
function normalizeWorkspace(w) {
  if (!w || typeof w !== 'object' || typeof w.id !== 'string') return null;
  const items = (Array.isArray(w.items) ? w.items : []).filter(i => i && typeof i.path === 'string' && path.isAbsolute(i.path)).slice(0, MAX_ITEMS).map(i => ({ path: i.path, name: cleanName(i.name, path.basename(i.path)) }));
  if (!items.length) return null;
  const index = v => (Number.isInteger(v) && v >= 0 && v < items.length ? v : null);
  const split = w.split && index(w.split.left) != null && index(w.split.right) != null && w.split.left !== w.split.right ? { left: w.split.left, right: w.split.right, ratio: Math.max(20, Math.min(80, Number(w.split.ratio) || 50)) } : null;
  return { id: w.id, name: cleanName(w.name, '未命名工作区'), items, split, active: index(w.active) ?? 0, created: Number(w.created) || Date.now(), updated: Number(w.updated) || Date.now() };
}
function normalizePreferences(data) {
  return {
    workspaces: (Array.isArray(data?.workspaces) ? data.workspaces : []).map(normalizeWorkspace).filter(Boolean).slice(0, MAX_WORKSPACES),
    pinned: (Array.isArray(data?.pinned) ? data.pinned : []).filter(p => p && typeof p.path === 'string' && path.isAbsolute(p.path)).slice(0, MAX_PINNED).map(p => ({ path: p.path, name: cleanName(p.name, path.basename(p.path)), pinned: Number(p.pinned) || Date.now() })),
  };
}

function register({ handle, preferences, persist, documents, documentById, openFiles, dialog, getWindow, key }) {
  preferences.workspaces ||= []; preferences.pinned ||= [];
  const tokens = new Map(); // token → path, for pinned entries shown on the home page
  const tokenFor = file => { let token = [...tokens].find(([, p]) => key(p) === key(file))?.[0]; if (!token) { token = randomUUID(); tokens.set(token, file); } return token; };
  const find = id => { const w = preferences.workspaces.find(x => x.id === id); if (!w) throw new Error('工作区不存在或已被删除。'); return w; };

  handle('workspace-list', async () => Promise.all(preferences.workspaces.map(async w => ({
    id: w.id, name: w.name, updated: w.updated, count: w.items.length, notes: !!w.split,
    names: w.items.map(i => i.name), missing: (await Promise.all(w.items.map(i => exists(i.path)))).filter(ok => !ok).length,
  }))));

  /** Saves the given open documents (ids) as a workspace; split = { leftId, rightId, ratio }. */
  handle('workspace-save', async ({ id, name, ids, split, activeId } = {}) => {
    if (!Array.isArray(ids) || !ids.length) throw new Error('没有可以保存的文档。');
    // Office tabs are unsaved PDFs: the workspace keeps the original Office file (r.source).
    const records = ids.map(docId => documents.get(docId)).filter(r => r?.path || r?.source);
    if (!records.length) throw new Error('请先保存文档：未保存的新文档不能放进工作区。');
    const items = []; for (const r of records) { const file = r.source || r.path; if (!items.some(i => key(i.path) === key(file))) items.push({ path: file, name: r.source ? path.basename(r.source) : r.name }); }
    const at = p => items.findIndex(i => key(i.path) === key(p));
    const pathOf = docId => { const r = documents.get(docId); return r ? (r.source || r.path) : null; };
    const left = split ? at(pathOf(split.leftId) || '') : -1, right = split ? at(pathOf(split.rightId) || '') : -1;
    const existing = id ? preferences.workspaces.find(w => w.id === id) : null;
    const workspace = normalizeWorkspace({ id: existing?.id || randomUUID(), name: name || existing?.name, items: items.slice(0, MAX_ITEMS), split: left >= 0 && right >= 0 ? { left, right, ratio: split.ratio } : null, active: Math.max(0, at(pathOf(activeId) || '')), created: existing?.created, updated: Date.now() });
    preferences.workspaces = [workspace, ...preferences.workspaces.filter(w => w.id !== workspace.id)].slice(0, MAX_WORKSPACES);
    await persist();
    return { id: workspace.id, name: workspace.name, count: workspace.items.length, skipped: ids.length - records.length };
  });

  /** Opens what can be opened; moved files are reported so the window can offer to locate them. */
  handle('workspace-open', async id => {
    const w = find(id), present = await Promise.all(w.items.map(i => exists(i.path)));
    const files = w.items.filter((_, n) => present[n]).map(i => i.path);
    const opened = files.length ? await openFiles(files) : [];
    // Match by path; Office files come back as converted PDFs without one, so fall back to the order.
    const byPath = n => opened.find(d => [d.path, d.source].some(p => p && key(p) === key(w.items[n].path)));
    const docOf = n => { if (!present[n]) return null; const hit = byPath(n); if (hit) return hit.id; return opened.length === files.length ? opened[files.indexOf(w.items[n].path)]?.id || null : null; };
    w.updated = Date.now(); preferences.workspaces = [w, ...preferences.workspaces.filter(x => x !== w)]; await persist();
    return {
      name: w.name, opened,
      split: w.split ? { leftId: docOf(w.split.left), rightId: docOf(w.split.right), ratio: w.split.ratio } : null,
      activeId: docOf(w.active),
      missing: w.items.map((item, index) => ({ index, name: item.name, path: item.path })).filter(m => !present[m.index]),
    };
  });

  /** A file of the workspace was moved or renamed: pick it again; the workspace keeps the new path. */
  handle('workspace-relocate', async (id, index) => {
    const w = find(id), item = w.items[index]; if (!item) throw new Error('工作区条目不存在。');
    const ext = path.extname(item.path).slice(1).toLowerCase();
    const result = await dialog.showOpenDialog(getWindow(), { title: `重新定位“${item.name}”`, defaultPath: path.dirname(item.path), filters: ext ? [{ name: ext.toUpperCase(), extensions: [ext] }] : [], properties: ['openFile'] });
    if (result.canceled) return null;
    const file = await fs.realpath(result.filePaths[0]);
    w.items[index] = { path: file, name: path.basename(file) }; w.updated = Date.now(); await persist();
    return { opened: await openFiles([file]), index };
  });
  handle('workspace-rename', async (id, name) => { const w = find(id); w.name = cleanName(name, w.name); w.updated = Date.now(); await persist(); return true; });
  handle('workspace-remove', async id => { preferences.workspaces = preferences.workspaces.filter(w => w.id !== id); await persist(); return true; });

  // ——— pinned documents ———
  handle('pinned-list', async () => Promise.all(preferences.pinned.map(async p => ({ id: tokenFor(p.path), name: p.name, path: p.path, pinned: p.pinned, missing: !(await exists(p.path)) }))));
  handle('pin-document', async docId => {
    const r = documentById(docId), file = r.source || r.path; if (!file) throw new Error('请先保存文档再固定。');
    if (preferences.pinned.some(p => key(p.path) === key(file))) return false;
    preferences.pinned = [{ path: file, name: path.basename(file), pinned: Date.now() }, ...preferences.pinned].slice(0, MAX_PINNED); await persist(); return true;
  });
  handle('unpin', async token => { const file = tokens.get(token); if (!file) return false; preferences.pinned = preferences.pinned.filter(p => key(p.path) !== key(file)); tokens.delete(token); await persist(); return true; });
  handle('open-pinned', async token => { const file = tokens.get(token); if (!file) throw new Error('固定的文档不存在。'); if (!(await exists(file))) throw new Error('文件已被移动或删除：' + file); return openFiles([file]); });
  /** Files the library search should include besides the recent list. */
  return { libraryFiles: () => [...preferences.pinned.map(p => p.path), ...preferences.workspaces.flatMap(w => w.items.map(i => i.path))] };
}
module.exports = { register, normalizeWorkspace, normalizePreferences, MAX_ITEMS };
