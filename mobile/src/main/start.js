// Android "main process": a port of main.cjs that runs inside the WebView.
// Handler names, arguments and results match main.cjs so the shared ui/ code and preload.cjs
// work unchanged; the Markdown, converter and AI handlers are the desktop modules themselves.
import { Buffer } from 'buffer';
import path from 'path';
import fs from '../shims/fs-promises.js';
import { randomUUID } from '../shims/crypto.js';
import { paths } from '../shims/env.js';
import { isNative, Native, bridgeMissing } from '../shims/backend.js';
import { handle, ipcMain, mainReady, sendToRenderer } from './ipc.js';
import { app, shell, mainWindow as window, BrowserWindow, safeStorage, session, dialog, loadDataKey, purgeTrash } from './facades.js';
import { storageState, requestStorageAccess } from './dialogs.js';
import { T, TF, setLanguage, whenLoaded } from './i18n-main.js';
import { pdfBytes, digest, fingerprint, atomicWrite, samplePdf } from './core.js';
import { runOffline } from './offline.js';
import markdownFiles from '../../../markdown-files.cjs';
import recoveryModule from '../../../recovery.cjs';
import notesModule from '../../../notes-markdown.cjs';
import mdIpc from '../../../markdown-ipc.cjs';
import converterIpc from '../../../converter-ipc.cjs';
import aiIpc from '../../../ai-ipc.cjs';
import libraryModule from '../../../library-index.cjs';

const { Recovery } = recoveryModule, { notesMarkdown, normalizeNotes } = notesModule;
const runningJobs = new Map(), canceledJobs = new Set(), recoveryTokens = new Map();
const documents = new Map(), closedDocuments = new Map(), recentTokens = new Map(), assetTokens = new Map(), batchTokens = new Map();
let preferences = { schemaVersion: 1, recent: [] };
let preferenceQueue = Promise.resolve();
let recovery, converterLifecycle, rendererReady = false, finishingClose = false, pendingFiles = [];
const key = file => path.resolve(file).toLowerCase();
// On a phone the Markdown outline is a drawer over the text, so documents start with it closed.
const phone = () => matchMedia('(max-width: 760px)').matches;
const metadata = record => ({ id: record.id, name: record.name, path: record.path, state: record.kind === 'markdown' && phone() ? { ...record.state, outline: false } : record.state, kind: record.kind || 'pdf', ...(record.kind === 'markdown' ? { eol: record.eol, encoding: record.encoding } : {}) });
const preferencesPath = () => path.join(paths.userData, 'reading-state.json');
const command = (name, data) => sendToRenderer('command', name, data);

function persist() {
  const content = JSON.stringify(preferences, null, 2);
  preferenceQueue = preferenceQueue.catch(() => {}).then(async () => {
    await fs.mkdir(paths.userData, { recursive: true });
    const tmp = preferencesPath() + '.tmp';
    await fs.writeFile(tmp, content);
    await fs.rename(tmp, preferencesPath());
  });
  return preferenceQueue;
}
function remember(record, state = record.state) {
  if (!record.path) return;
  if (record.kind === 'markdown') {
    const s = state && typeof state === 'object' ? state : {};
    record.state = { kind: 'markdown', scrollTop: Math.max(0, Number(s.scrollTop) || 0), caret: Math.max(0, Math.floor(Number(s.caret) || 0)), source: !!s.source, ...(typeof s.reading === 'boolean' ? { reading: s.reading } : {}), outline: s.outline !== false };
  } else record.state = state && typeof state === 'object' ? {
    page: Math.max(1, Math.min(1000000, Number(state.page) || 1)),
    zoom: typeof state.zoom === 'string' ? state.zoom.slice(0, 40) : 'page-width',
    rotation: [0, 90, 180, 270].includes(state.rotation) ? state.rotation : 0,
    scrollTop: Math.max(0, Number(state.scrollTop) || 0),
    scrollMode: [0, 1, 2, 3].includes(state.scrollMode) ? state.scrollMode : 0,
    spreadMode: [0, 1, 2].includes(state.spreadMode) ? state.spreadMode : 0,
    color: typeof state.color === 'string' ? state.color.slice(0, 30) : 'light',
    paper: /^#[\da-fA-F]{6}$/.test(state.paper) ? state.paper : '#f0f4f5',
    ink: /^#[\da-fA-F]{6}$/.test(state.ink) ? state.ink : '#111111',
    preserveImages: !!state.preserveImages,
    brightness: Math.max(.5, Math.min(1.5, Number(state.brightness) || 1)),
    contrast: Math.max(.5, Math.min(1.5, Number(state.contrast) || 1)),
    crop: Array.isArray(state.crop) && state.crop.length === 4 ? state.crop.map(x => Math.max(0, Math.min(40, Number(x) || 0))) : [0, 0, 0, 0],
    reflow: !!state.reflow,
    fontSize: Math.max(14, Math.min(36, Number(state.fontSize) || 20)),
    bookmarks: Array.isArray(state.bookmarks) ? state.bookmarks.filter(b => Number.isInteger(b.page) && b.page > 0 && typeof b.title === 'string').slice(0, 10000).map(b => ({ page: Math.min(1000000, b.page), title: b.title.slice(0, 200) })) : [],
  } : {};
  preferences.recent = [{ path: record.path, name: record.name, state: record.state, opened: Date.now() }, ...preferences.recent.filter(r => key(r.path) !== key(record.path))].slice(0, 30);
}
async function openFiles(files) {
  const opened = [];
  for (const candidate of files) {
    try {
      const markdown = typeof candidate === 'string' && markdownFiles.isMarkdown(candidate);
      if (typeof candidate !== 'string' || (!markdown && path.extname(candidate).toLowerCase() !== '.pdf')) throw new Error('请选择 PDF 或 Markdown 文件。');
      const file = await fs.realpath(candidate);
      let record = [...documents.values()].find(r => r.path && key(r.path) === key(file));
      if (record) { opened.push(metadata(record)); continue; }
      if (markdown) {
        const raw = await fs.readFile(file), decoded = markdownFiles.decodeMarkdown(raw);
        record = { id: randomUUID(), kind: 'markdown', name: path.basename(file), path: file, hash: digest(raw), encoding: decoded.encoding, bom: decoded.bom, eol: decoded.eol, state: preferences.recent.find(r => key(r.path) === key(file))?.state || {} };
        documents.set(record.id, record); remember(record);
        opened.push({ ...metadata(record), text: decoded.text, notice: decoded.notice });
        continue;
      }
      const bytes = pdfBytes(await fs.readFile(file));
      record = { id: randomUUID(), name: path.basename(file), path: file, hash: digest(bytes), state: preferences.recent.find(r => key(r.path) === key(file))?.state || {} };
      documents.set(record.id, record);
      remember(record);
      opened.push({ ...metadata(record), bytes: new Uint8Array(bytes) });
    } catch (error) {
      await dialog.showMessageBox(window, { type: 'error', title: T('无法打开文件'), message: path.basename(String(candidate)), detail: error.code === 'ENOENT' ? T('文件不存在或已被移动。') : error.message });
    }
  }
  await persist().catch(error => console.warn('Reading state:', error.message));
  return opened;
}
function documentById(id) {
  const record = documents.get(id);
  if (!record) throw new Error('文档已经关闭，请重新打开。');
  return record;
}
// There is no folder watcher on Android: open Markdown files are compared with the disk when
// the app returns to the foreground and before each save.
function watchMarkdown() {}
async function checkMarkdown(record, notify) {
  if (!record || record.kind !== 'markdown' || !record.path || record.saving || !documents.has(record.id)) return 'same';
  const actual = await fingerprint(record.path);
  if (actual === record.hash || record.saving) return 'same';
  const state = actual === null ? 'deleted' : 'changed';
  if (notify && record.notified !== (actual || 'deleted')) { record.notified = actual || 'deleted'; command('file-changed', { id: record.id, state }); }
  return state;
}
// Pixel size from the image header itself; used to size image-stamp selections.
function imageDimensions(b) {
  const view = new DataView(b.buffer, b.byteOffset, b.byteLength), ascii = (from, to) => String.fromCharCode(...b.subarray(from, to));
  if (b.length >= 24 && view.getUint32(0) === 0x89504e47) return { width: view.getUint32(16), height: view.getUint32(20) };
  if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d) return { width: Math.abs(view.getInt32(18, true)), height: Math.abs(view.getInt32(22, true)) };
  if (b.length >= 30 && ascii(0, 4) === 'RIFF' && ascii(8, 12) === 'WEBP') {
    const chunk = ascii(12, 16);
    if (chunk === 'VP8X') return { width: 1 + (b[24] | b[25] << 8 | b[26] << 16), height: 1 + (b[27] | b[28] << 8 | b[29] << 16) };
    if (chunk === 'VP8 ') return { width: view.getUint16(26, true) & 0x3fff, height: view.getUint16(28, true) & 0x3fff };
    if (chunk === 'VP8L' && b.length >= 25) { const bits = view.getUint32(21, true); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }; }
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let at = 2;
    while (at + 9 < b.length) {
      if (b[at] !== 0xff) { at++; continue; }
      const marker = b[at + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: view.getUint16(at + 5), width: view.getUint16(at + 7) };
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { at += 2; continue; }
      at += 2 + view.getUint16(at + 2);
    }
  }
  return null;
}

export async function start() {
  // ——— where things live on this device ———
  if (bridgeMissing) throw new Error('无法连接安卓系统接口（Capacitor 原生桥未加载）。请更新“Android System WebView”后重试。');
  if (isNative) { const found = await Native.paths(); for (const name of ['storage', 'documents', 'inbox', 'userData', 'temp']) if (typeof found[name] === 'string') paths[name] = found[name]; }
  paths.trash = path.join(paths.userData, 'trash');
  await fs.mkdir(paths.userData, { recursive: true });
  await fs.mkdir(paths.temp, { recursive: true }).catch(() => {});
  await loadDataKey();
  recovery = new Recovery(path.join(paths.userData, 'recovery'));
  const firstRun = await fs.readFile(preferencesPath()).then(() => false, error => error.code === 'ENOENT');
  try { const data = JSON.parse(await fs.readFile(preferencesPath(), 'utf8')); if (data.schemaVersion === 1 && Array.isArray(data.recent)) { preferences.recent = data.recent.filter(r => typeof r.path === 'string').slice(0, 30); if (typeof data.language === 'string') preferences.language = data.language; preferences.stamps = Array.isArray(data.stamps) ? data.stamps.slice(0, 100) : []; if (Array.isArray(data.converterPresets)) preferences.converterPresets = data.converterPresets; } } catch {}
  setLanguage(preferences.language || 'zh-CN'); await whenLoaded();
  purgeTrash();

  handle('app-version', () => app.getVersion());
  // ——— Settings: language, file associations, data ———
  handle('set-language', async (code, explicit) => { const next = setLanguage(code); await whenLoaded(); const stored = explicit ? next : undefined; if (preferences.language !== stored) { preferences.language = stored; await persist(); } return next; });
  // Android registers the PDF / Markdown "open with" entries from the app manifest.
  const associationInfo = () => ({ supported: false, reason: T('安卓版已在系统的“打开方式”中登记 PDF 与 Markdown，无需在此注册。'), types: {} });
  handle('assoc-status', associationInfo);
  for (const channel of ['assoc-register', 'assoc-unregister', 'assoc-choose', 'assoc-open-settings']) handle(channel, async () => { if (isNative) await Native.openAppSettings().catch(() => {}); return associationInfo(); });
  handle('recent-clear', async () => { preferences.recent = []; recentTokens.clear(); await persist(); return true; });
  handle('open-data-folder', async () => { await shell.openPath(paths.userData); return true; });
  handle('open', async () => {
    const result = await dialog.showOpenDialog(window, { title: T('打开文档'), filters: [{ name: T('PDF 与 Markdown'), extensions: ['pdf', ...markdownFiles.MARKDOWN_EXTENSIONS.map(e => e.slice(1))] }], properties: ['openFile', 'multiSelections'] });
    return result.canceled ? [] : openFiles(result.filePaths);
  });
  handle('drop', files => openFiles(Array.isArray(files) ? files.filter(Boolean) : []));
  handle('checkpoint', async (items, activeId) => {
    if (!Array.isArray(items) || items.length > 64) throw new Error('恢复标签数量过多。');
    const entries = items.filter(item => documents.has(item.id)).map(item => { const r = documentById(item.id); remember(r, item.state); const markdown = r.kind === 'markdown'; return { id: r.id, name: r.name, path: r.path, hash: r.hash, state: r.state, dirty: !!item.dirty, ...(markdown ? { kind: 'markdown' } : {}), ...(markdown && typeof item.text === 'string' ? { text: item.text } : !markdown && item.bytes ? { bytes: pdfBytes(item.bytes) } : {}) }; });
    await recovery.checkpoint(entries, activeId); await persist(); return true;
  });
  handle('recovery-list', async () => {
    const found = await recovery.list(); return found.map(item => { const token = randomUUID(); recoveryTokens.set(token, item); return { token, updated: item.updated, names: item.entries.map(e => e.name), drafts: item.entries.filter(e => e.draft).length }; });
  });
  handle('last-session-count', async () => ((await recovery.last()).entries || []).length);
  handle('restore-session', async token => {
    const item = token ? recoveryTokens.get(token) : await recovery.last(); if (!item) throw new Error('恢复记录已失效。');
    const opened = [];
    for (const entry of item.entries) {
      if (entry.draft && entry.draft.endsWith('.md')) {
        const text = await fs.readFile(path.join(recovery.folder, entry.draft), 'utf8');
        const unchanged = entry.path && !Array.from(documents.values()).some(r => r.path && key(r.path) === key(entry.path)) && await fingerprint(entry.path).catch(() => null) === entry.hash;
        let meta = { encoding: 'utf-8', bom: false, eol: '\n' };
        if (unchanged) { try { const d = markdownFiles.decodeMarkdown(await fs.readFile(entry.path)); meta = { encoding: d.encoding, bom: d.bom, eol: d.eol }; } catch {} }
        const record = { id: randomUUID(), kind: 'markdown', name: entry.name, path: unchanged ? entry.path : null, hash: unchanged ? entry.hash : null, ...meta, state: entry.state || {} };
        documents.set(record.id, record); opened.push({ ...metadata(record), text, recovered: true, wasActive: entry.id === item.activeId });
      } else if (entry.draft) {
        const bytes = pdfBytes(await fs.readFile(path.join(recovery.folder, entry.draft)));
        const unchanged = entry.path && !Array.from(documents.values()).some(r => r.path && key(r.path) === key(entry.path)) && await fingerprint(entry.path).catch(() => null) === entry.hash;
        const record = { id: randomUUID(), name: entry.name, path: unchanged ? entry.path : null, hash: unchanged ? entry.hash : null, state: entry.state || {} };
        documents.set(record.id, record); opened.push({ ...metadata(record), bytes: new Uint8Array(bytes), recovered: true, wasActive: entry.id === item.activeId });
      } else if (entry.path) opened.push(...(await openFiles([entry.path])).map(info => ({ ...info, wasActive: entry.id === item.activeId })));
    }
    // Remove the abandoned manifest only after the recovered drafts are durably checkpointed.
    if (token) { await recovery.checkpoint([...recovery.entries.filter(e => documents.has(e.id)), ...opened.filter(info => info.bytes || typeof info.text === 'string').map(info => { const r = documentById(info.id); return { ...metadata(r), hash: r.hash, dirty: !!info.recovered, ...(info.recovered ? (typeof info.text === 'string' ? { text: info.text } : { bytes: info.bytes }) : {}) }; })], opened.at(-1)?.id); await recovery.remove(item); recoveryTokens.delete(token); }
    return opened;
  });
  handle('discard-recovery', async token => { const item = recoveryTokens.get(token); if (item) { await recovery.remove(item); recoveryTokens.delete(token); } return true; });
  handle('finish-session', async (items, activeId) => { await recovery.finish(items.map(i => documents.get(i.id) || closedDocuments.get(i.id)).filter(Boolean).map(metadata), activeId); return true; });
  handle('export-notes', async (id, notes, format, value) => {
    const r = documentById(id); if (!Array.isArray(notes) || notes.length > 100000) throw new Error('批注数据无效。');
    const safe = normalizeNotes(notes);
    const text = format === 'docx' ? '' : notesMarkdown(r, safe);
    const ext = format === 'docx' ? '.docx' : '.md'; let bytes = Buffer.from(text);
    if (format === 'docx') { const result = await runOffline({ bytes: pdfBytes(value), request: { action: 'notes-export', notes: safe } }); bytes = result.files[0].bytes; }
    const selected = await dialog.showSaveDialog(window, { title: T('导出批注摘录'), defaultPath: path.join(r.path ? path.dirname(r.path) : paths.documents, path.parse(r.name).name + '-批注' + ext), filters: [{ name: ext.slice(1), extensions: [ext.slice(1)] }] }); if (selected.canceled) return { canceled: true };
    const target = selected.filePath.toLowerCase().endsWith(ext) ? selected.filePath : selected.filePath + ext; await atomicWrite(target, bytes, await fingerprint(target)); return { path: target };
  });
  handle('title-bar-theme', async dark => { if (isNative) await Native.setBars({ dark: !!dark }).catch(() => {}); return true; });
  handle('window-state', () => ({ maximized: true, fullscreen: window.isFullScreen(), focused: true }));
  handle('set-window-style', async () => ({ style: 'windows', vibrancy: false }));
  handle('window-control', action => { if (action === 'close') window.close(); else if (action === 'minimize' && isNative) Native.moveToBackground().catch(() => {}); return true; });
  handle('relaunch-on-close', () => false);
  handle('fullscreen', async () => { await window.setFullScreen(!window.isFullScreen()); return window.isFullScreen(); });
  handle('exit-fullscreen', async () => { if (window.isFullScreen()) await window.setFullScreen(false); });
  handle('pick-asset', async kind => {
    const filters = kind === 'import' ? [{ name: T('可转换文件'), extensions: ['docx', 'xlsx', 'pptx', 'txt', 'html', 'htm', 'epub', 'xps', 'cbz', 'svg', 'png', 'jpg', 'jpeg', 'tif', 'tiff', 'bmp', 'webp'] }] : [{ name: T('图片'), extensions: ['png', 'jpg', 'jpeg', 'bmp', 'webp'] }];
    const result = await dialog.showOpenDialog(window, { title: kind === 'import' ? T('导入并转换为 PDF') : T('选择图片印章'), filters, properties: ['openFile'] });
    if (result.canceled) return null;
    const file = await fs.realpath(result.filePaths[0]);
    if (!filters[0].extensions.includes(path.extname(file).slice(1).toLowerCase())) throw new Error('文件类型不支持。');
    const token = randomUUID(); assetTokens.set(token, { path: file, kind });
    let dims = null;
    if (kind === 'image') dims = imageDimensions((await fs.readFile(file)).subarray(0, 131072));
    return { token, name: path.basename(file), ...(dims ? { width: dims.width, height: dims.height } : {}) };
  });
  handle('stamp-library', async (action, value) => {
    preferences.stamps ||= [];
    if (action === 'list') return preferences.stamps.map(s => ({ id: s.id, name: s.name, kind: s.kind }));
    if (action === 'remove') { const stamp = preferences.stamps.find(s => s.id === value); preferences.stamps = preferences.stamps.filter(s => s.id !== value); if (stamp?.file) await fs.rm(path.join(paths.userData, 'stamps', stamp.file), { force: true }); await persist(); return true; }
    if (action === 'load') { const stamp = preferences.stamps.find(s => s.id === value); if (!stamp) throw new Error('印章不存在。'); if (stamp.kind === 'image') { const token = randomUUID(); assetTokens.set(token, { path: path.join(paths.userData, 'stamps', stamp.file), kind: 'image' }); return { kind: 'image', asset: { token, name: stamp.name, ...(stamp.width ? { width: stamp.width, height: stamp.height } : {}) } }; } return { kind: 'stamp', settings: stamp.settings }; }
    if (action !== 'add' || preferences.stamps.length >= 100) throw new Error('印章库最多保存 100 项。');
    const id = randomUUID(), stamp = { id, name: String(value.name || '常用印章').slice(0, 60), kind: value.kind === 'image' ? 'image' : 'stamp' };
    if (stamp.kind === 'image') { const asset = assetTokens.get(value.assetToken); if (!asset || asset.kind !== 'image') throw new Error('请先选择图片印章。'); const folder = path.join(paths.userData, 'stamps'); await fs.mkdir(folder, { recursive: true }); stamp.file = id + path.extname(asset.path); await fs.copyFile(asset.path, path.join(folder, stamp.file)); if (Number(value.width) > 0 && Number(value.height) > 0) { stamp.width = Math.round(value.width); stamp.height = Math.round(value.height); } }
    else stamp.settings = { text: String(value.text || '').slice(0, 1000), size: Math.max(6, Math.min(100, Number(value.size) || 18)), color: /^#[\da-fA-F]{6}$/.test(value.color) ? value.color : '#b91c1c', opacity: Math.max(.05, Math.min(1, Number(value.opacity) || 1)) };
    preferences.stamps.push(stamp); await persist(); return { id, name: stamp.name, kind: stamp.kind };
  });
  handle('batch-folder', async () => {
    const result = await dialog.showOpenDialog(window, { title: T('选择批量输出目录'), properties: ['openDirectory', 'createDirectory'] });
    if (result.canceled) return null;
    const token = randomUUID(); batchTokens.set(token, result.filePaths[0]); return token;
  });
  handle('new-window', async () => { throw new Error('安卓版不支持多窗口，请使用标签切换文档。'); });
  handle('cancel-job', id => { if (typeof id !== 'string' || !/^[\da-f-]{36}$/i.test(id)) throw new Error('任务编号无效。'); if (runningJobs.has(id)) runningJobs.get(id).abort(); else { canceledJobs.add(id); setTimeout(() => canceledJobs.delete(id), 30000); } return true; });
  handle('tools-job', async (id, value, request) => {
    let record;
    const assets = [], inputs = [];
    if (request?.action === 'import') {
      const asset = assetTokens.get(request.assetToken);
      if (!asset || asset.kind !== 'import') throw new Error('请先选择导入文件。');
      value = await fs.readFile(asset.path); record = { name: path.basename(asset.path), path: asset.path };
    } else record = documentById(id);
    // A phone has far less memory than a desktop: keep single jobs to a size MuPDF can hold twice.
    if (value?.byteLength > 256 * 1024 * 1024) throw new Error('安卓版单文件处理目前支持最大 256 MB。');
    if (request?.action === 'image') {
      const asset = assetTokens.get(request.assetToken);
      if (!asset || asset.kind !== 'image') throw new Error('请先选择印章图片。');
      assets.push({ name: path.basename(asset.path), bytes: await fs.readFile(asset.path) });
    }
    for (const item of request?.mergeInputs || []) { documentById(item.id); inputs.push(pdfBytes(item.bytes)); }
    const safe = { ...request }; delete safe.mergeInputs;
    const jobId = typeof request.jobId === 'string' ? request.jobId.slice(0, 80) : randomUUID(); if (runningJobs.has(jobId)) throw new Error('任务编号重复。'); const controller = new AbortController(); runningJobs.set(jobId, controller); if (canceledJobs.delete(jobId)) controller.abort();
    let result; try { result = await runOffline({ bytes: value, request: safe, assets, inputs, inputName: record.name, signal: controller.signal, onProgress: data => sendToRenderer('job-progress', jobId, data) }); } finally { runningJobs.delete(jobId); }
    if (request.action === 'inspect') return { data: result.data, note: result.note };
    if (result.unchanged) return { unchanged: true, note: result.note };
    const output = result.files[0]; if (!output) throw new Error('处理未生成文件。');
    if (request.draft) {
      if (!['organize', 'outline', 'text', 'stamp', 'image', 'watermark', 'shape', 'annotation', 'crop', 'sharpen', 'ocr-layer'].includes(request.action) || path.extname(output.name) !== '.pdf') throw new Error('此操作不支持文档草稿。');
      return { bytes: output.bytes, note: result.note };
    }
    const extension = path.extname(output.name);
    let target;
    if (request.batchToken) {
      const folder = batchTokens.get(request.batchToken); if (!folder) throw new Error('批量目录授权已失效。');
      const stem = path.parse(record.name).name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_');
      target = path.join(folder, stem + '-' + request.action + extension);
      let suffix = 2; while (await fingerprint(target)) target = path.join(folder, stem + '-' + request.action + ' (' + (suffix++) + ')' + extension);
    } else {
      const selected = await dialog.showSaveDialog(window, { title: T('导出处理结果'), defaultPath: path.join(record.path ? path.dirname(record.path) : paths.documents, path.parse(record.name).name + '-' + request.action + extension), filters: [{ name: extension.slice(1).toUpperCase(), extensions: [extension.slice(1)] }] });
      if (selected.canceled) return { canceled: true };
      target = selected.filePath; if (path.extname(target).toLowerCase() !== extension) target += extension;
      if ([...documents.values()].some(d => d.path && key(d.path) === key(target))) throw new Error('输出不能覆盖正在打开的文档，请使用新的文件名。');
    }
    const hash = request.batchToken ? null : await fingerprint(target); await atomicWrite(target, output.bytes, hash);
    return { path: target, note: result.note, opened: extension === '.pdf' && request.action !== 'encrypt' && !request.batchToken ? await openFiles([target]) : [] };
  });
  handle('recent', () => preferences.recent.map(item => {
    let token = [...recentTokens].find(([, file]) => file === item.path)?.[0];
    if (!token) { token = randomUUID(); recentTokens.set(token, item.path); }
    return { id: token, name: item.name, path: item.path, opened: Number(item.opened) || 0, page: item.state?.kind === 'markdown' ? 0 : Number(item.state?.page) || 0 };
  }));
  handle('recent-remove', async id => { const file = recentTokens.get(id); if (!file) return false; preferences.recent = preferences.recent.filter(r => key(r.path) !== key(file)); recentTokens.delete(id); await persist(); return true; });
  handle('open-recent', id => { const file = recentTokens.get(id); if (!file) throw new Error('最近文件不存在。'); return openFiles([file]); });
  handle('example', async () => {
    // The touch edition of the guide describes gestures instead of keyboard shortcuts.
    const guide = await fs.readFile('/__app/ui/sample-guide-touch.pdf').catch(() => fs.readFile('/__app/ui/sample-guide.pdf')).catch(() => null);
    const record = { id: randomUUID(), name: guide ? '青页 PDF 使用示例.pdf' : '青页 PDF · 使用示例.pdf', path: null, hash: null, state: {} };
    documents.set(record.id, record);
    return [{ ...metadata(record), bytes: guide ? new Uint8Array(guide) : new Uint8Array(samplePdf()) }];
  });
  handle('save', async (id, value, saveAs) => {
    const record = documentById(id);
    if (record.kind === 'markdown') throw new Error('Markdown 文档请使用 Markdown 保存。');
    if (record.saving) throw new Error('文档正在保存。');
    record.saving = true;
    try {
      const bytes = pdfBytes(value);
      let target = record.path, expected = record.hash;
      if (saveAs || !target) {
        const result = await dialog.showSaveDialog(window, { title: T('另存为 PDF'), defaultPath: target || path.join(paths.documents, record.name), filters: [{ name: T('PDF 文档'), extensions: ['pdf'] }] });
        if (result.canceled) return null;
        target = result.filePath;
        if (path.extname(target).toLowerCase() !== '.pdf') target += '.pdf';
        const other = [...documents.values()].find(r => r.id !== id && r.path && key(r.path) === key(target));
        if (other) throw new Error('目标文件已在另一个标签中打开，请选择不同的文件名。');
        expected = record.path && key(target) === key(record.path) ? record.hash : await fingerprint(target);
      }
      record.hash = await atomicWrite(target, bytes, expected);
      record.path = target;
      record.name = path.basename(target);
      remember(record);
      await persist().catch(error => console.warn('Reading state:', error.message));
      return metadata(record);
    } finally { record.saving = false; }
  });
  // ——— Markdown ———
  const newMarkdown = (name, text = '') => {
    const record = { id: randomUUID(), kind: 'markdown', name, path: null, hash: null, encoding: 'utf-8', bom: false, eol: '\n', state: {} };
    documents.set(record.id, record);
    return [{ ...metadata(record), text }];
  };
  handle('markdown-new', () => { const taken = new Set([...documents.values()].map(r => r.name)); let n = 1, name = '未命名.md'; while (taken.has(name)) name = `未命名 ${++n}.md`; return newMarkdown(name); });
  handle('notes-markdown', (id, notes) => { const record = documentById(id); if (record.kind === 'markdown') throw new Error('请选择 PDF 批注。'); return newMarkdown(path.parse(record.name).name + '-批注笔记.md', notesMarkdown(record, notes)).map(info => ({ ...info, unsaved: true })); });
  handle('markdown-example', async () => newMarkdown('Markdown 示例.md', await fs.readFile('/__app/ui/markdown/sample.md', 'utf8')));
  handle('save-markdown', async (id, text, saveAs) => {
    const record = documentById(id);
    if (record.kind !== 'markdown') throw new Error('此标签不是 Markdown 文档。');
    if (typeof text !== 'string') throw new Error('无效的 Markdown 内容。');
    if (record.saving) throw new Error('文档正在保存。');
    record.saving = true;
    try {
      let target = record.path, expected = record.hash;
      if (!saveAs && target) {
        const actual = await fingerprint(target);
        if (actual !== expected) {
          const choice = await dialog.showMessageBox(window, { type: 'warning', title: T('文件已在外部修改'), message: actual === null ? TF('“{name}”已被移动或删除。', { name: record.name }) : TF('“{name}”已被其他程序修改。', { name: record.name }), detail: T('覆盖将用青页中的当前内容替换磁盘上的版本；“另存为”可以同时保留两份。'), buttons: [T('另存为…'), actual === null ? T('重新创建文件') : T('覆盖磁盘上的版本'), T('取消')], defaultId: 0, cancelId: 2, noLink: true });
          if (choice.response === 2) return null;
          if (choice.response === 0) saveAs = true; else expected = actual;
        }
      }
      if (saveAs || !target) {
        const result = await dialog.showSaveDialog(window, { title: T('另存为 Markdown'), defaultPath: target || path.join(paths.documents, record.name), filters: [{ name: T('Markdown 文档'), extensions: ['md', 'markdown'] }, { name: T('所有文件'), extensions: ['*'] }] });
        if (result.canceled) return null;
        target = result.filePath;
        if (!markdownFiles.isMarkdown(target)) target += '.md';
        const other = [...documents.values()].find(r => r.id !== id && r.path && key(r.path) === key(target));
        if (other) throw new Error('目标文件已在另一个标签中打开，请选择不同的文件名。');
        expected = record.path && key(target) === key(record.path) ? record.hash : await fingerprint(target);
      }
      const meta = record.path && key(target) === key(record.path) ? record : { ...record, encoding: 'utf-8', bom: false };
      record.hash = await atomicWrite(target, markdownFiles.encodeMarkdown(text, meta), expected);
      Object.assign(record, markdownFiles.savedEncoding(meta), { path: target, name: path.basename(target), notified: null });
      remember(record); mdCtx?.snapshotOnSave?.(record, text);
      await persist().catch(error => console.warn('Reading state:', error.message));
      return metadata(record);
    } finally { record.saving = false; }
  });
  handle('markdown-reload', async id => {
    const record = documentById(id);
    if (record.kind !== 'markdown' || !record.path) throw new Error('文档没有对应的磁盘文件。');
    const raw = await fs.readFile(record.path), decoded = markdownFiles.decodeMarkdown(raw);
    Object.assign(record, { hash: digest(raw), encoding: decoded.encoding, bom: decoded.bom, eol: decoded.eol, notified: null });
    return { text: decoded.text, notice: decoded.notice };
  });
  handle('markdown-check', async () => { for (const record of documents.values()) await checkMarkdown(record, true); return true; });
  handle('markdown-asset', async (id, source) => { const record = documentById(id); const asset = await markdownFiles.readAsset(record.path, source); return asset ? { bytes: new Uint8Array(asset.bytes), type: asset.type } : null; });
  handle('markdown-open-link', async (id, href) => {
    const record = documentById(id), value = String(href || '').trim();
    if (/^(https?:|mailto:)/i.test(value)) { await shell.openExternal(value); return { external: true }; }
    if (value.startsWith('#')) return { anchor: decodeURIComponent(value.slice(1)) };
    const resolved = markdownFiles.resolveLocal(record.path, value);
    if (!resolved) throw new Error(record.path ? '无法解析此链接。' : '请先保存文档，再打开相对路径链接。');
    if (key(resolved.file) === key(record.path || '')) return { anchor: resolved.fragment };
    if (markdownFiles.isMarkdown(resolved.file) || path.extname(resolved.file).toLowerCase() === '.pdf') return { opened: await openFiles([resolved.file]), anchor: resolved.fragment };
    if (!await fs.stat(resolved.file).catch(() => null)) throw new Error('链接指向的文件不存在：' + resolved.file);
    shell.showItemInFolder(resolved.file); return { revealed: true };
  });
  handle('markdown-save-image', async (id, value, extension) => {
    const record = documentById(id);
    if (!record.path) throw new Error('请先保存文档，再插入粘贴的图片（图片会保存到文档旁的 assets 文件夹）。');
    if (!(value instanceof Uint8Array) || value.byteLength > 40 * 1024 * 1024) throw new Error('图片数据无效或超过 40 MB。');
    const ext = ('.' + String(extension || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')).replace('.jpeg', '.jpg');
    if (!markdownFiles.IMAGE_TYPES[ext]) throw new Error('不支持的图片格式。');
    const folder = path.join(path.dirname(record.path), 'assets'); await fs.mkdir(folder, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    let file = path.join(folder, `image-${stamp}${ext}`), n = 2;
    while (await fs.stat(file).catch(() => null)) file = path.join(folder, `image-${stamp}-${n++}${ext}`);
    await atomicWrite(file, Buffer.from(value), null);
    return markdownFiles.markdownPath(record.path, file);
  });
  handle('markdown-pick-image', async id => {
    const record = documentById(id);
    const result = await dialog.showOpenDialog(window, { title: T('插入图片'), defaultPath: record.path ? path.dirname(record.path) : undefined, filters: [{ name: T('图片'), extensions: Object.keys(markdownFiles.IMAGE_TYPES).map(e => e.slice(1)) }], properties: ['openFile'] });
    if (result.canceled) return null;
    return { path: markdownFiles.markdownPath(record.path, result.filePaths[0]), name: path.parse(result.filePaths[0]).name };
  });
  handle('markdown-image-paths', async (id, files) => {
    const record = documentById(id);
    if (!Array.isArray(files) || files.length > 50) throw new Error('一次最多插入 50 张图片。');
    const out = [];
    for (const file of files) if (typeof file === 'string' && file && markdownFiles.IMAGE_TYPES[path.extname(file).toLowerCase()] && (await fs.stat(file).catch(() => null))?.isFile()) out.push(markdownFiles.markdownPath(record.path, file));
    return out;
  });
  // ——— library search and reference details (same handlers as main.cjs) ———
  const library = libraryModule.createLibraryIndex({ directory: path.join(paths.userData, 'library-index'), keyOf: key });
  const recentFile = id => { const file = recentTokens.get(id); if (!file) throw new Error('最近文件不存在。'); return file; };
  const recentEntries = () => preferences.recent.map(item => { let token = [...recentTokens].find(([, file]) => file === item.path)?.[0]; if (!token) { token = randomUUID(); recentTokens.set(token, item.path); } return { id: token, name: item.name, path: item.path, kind: markdownFiles.isMarkdown(item.path) ? 'markdown' : 'pdf' }; });
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
    // A phone has far less memory than a desktop.
    const info = await fs.stat(file); if (info.size > 120 * 1024 * 1024) throw new Error('文件超过 120 MB，未加入全库搜索。');
    return new Uint8Array(await fs.readFile(file));
  });
  handle('library-put', async (id, pages, note) => { const file = recentFile(id); return library.put(file, { name: path.basename(file), kind: markdownFiles.isMarkdown(file) ? 'markdown' : 'pdf', pages, note }); });
  handle('library-search', async query => { const items = recentEntries(), found = await library.find(String(query || ''), items.map(item => item.path)); return { ...found, documents: found.documents.map(doc => ({ ...doc, id: items.find(item => key(item.path) === key(doc.path))?.id })) }; });
  handle('library-clear', async () => { await library.clear(); return true; });
  handle('citation-lookup', async () => { throw new Error('安卓版不提供联网补全，请直接填写引用信息。'); });
  handle('save-text-file', async (name, text) => {
    const base = path.basename(String(name || 'references.bib')), ext = path.extname(base).toLowerCase();
    if (!['.bib', '.txt', '.md'].includes(ext)) throw new Error('不支持的导出格式。');
    if (typeof text !== 'string' || text.length > 16 * 1024 * 1024) throw new Error('导出内容无效或过大。');
    const selected = await dialog.showSaveDialog(window, { title: T('导出'), defaultPath: path.join(paths.documents, base), filters: [{ name: ext.slice(1).toUpperCase(), extensions: [ext.slice(1)] }] });
    if (selected.canceled) return { canceled: true };
    const target = selected.filePath.toLowerCase().endsWith(ext) ? selected.filePath : selected.filePath + ext;
    if ([...documents.values()].some(d => d.path && key(d.path) === key(target))) throw new Error('输出不能覆盖正在打开的文档，请使用新的文件名。');
    await atomicWrite(target, Buffer.from(text, 'utf8'), await fingerprint(target)); return { path: target };
  });
  const mdCtx = { handle, getWindow: () => window, dialog, shell, app, session, BrowserWindow, documents, documentById, openFiles, atomicWrite, fingerprint, digest, preferences, persist, watchMarkdown, key, command };
  mdIpc.register(mdCtx);
  converterLifecycle = converterIpc.register(mdCtx);
  aiIpc.register({ ...mdCtx, session, safeStorage, ipcMain, testMode: false });
  handle('edit-command', name => { if (!['cut', 'copy', 'paste', 'selectAll', 'pasteAndMatchStyle', 'undo', 'redo'].includes(name)) throw new Error('不支持的编辑命令。'); window.webContents[name](); return true; });
  handle('close-choice', async name => {
    const result = await dialog.showMessageBox(window, { type: 'question', title: T('保存修改'), message: TF('“{name}”有未保存的修改。', { name: String(name).slice(0, 200) }), buttons: [T('保存'), T('不保存'), T('取消')], defaultId: 0, cancelId: 2, noLink: true });
    return ['save', 'discard', 'cancel'][result.response];
  });
  handle('confirm-discard-edit', async name => { const result = await dialog.showMessageBox(window, { type: 'question', title: T('未应用的页面编辑'), message: name ? TF('“{name}”的页面编辑尚未应用。是否放弃并继续？', { name: String(name).slice(0, 200) }) : T('当前页面编辑尚未应用。是否放弃并继续？'), buttons: [T('继续编辑'), T('放弃未应用内容')], defaultId: 0, cancelId: 0, noLink: true }); return result.response === 1; });
  handle('remember', async (id, state) => { const record = documents.get(id); if (record) { remember(record, state); await persist(); } });
  handle('close-document', async (id, state) => { const record = documentById(id); if (record.saving) throw new Error('正在保存，请稍后关闭。'); remember(record, state); closedDocuments.set(id, record); documents.delete(id); await recovery.checkpoint(recovery.entries.filter(e => e.id !== id), null); await persist().catch(error => console.warn('Reading state:', error.message)); });
  ipcMain.on('finish-close', async () => { if (finishingClose) return; finishingClose = true; await converterLifecycle?.shutdown(); await preferenceQueue.catch(() => {}); app.emit('before-quit'); app.exit(); finishingClose = false; });

  // ——— documents handed over by other apps ("open with", share) ———
  const openIncoming = async files => { const list = (files || []).filter(f => typeof f === 'string'); if (!list.length) return; if (rendererReady) command('opened', await openFiles(list)); else pendingFiles.push(...list); };
  if (isNative) {
    Native.addListener('open', event => openIncoming(event.paths).catch(console.warn));
    Native.addListener('back', () => globalThis.dispatchEvent(new CustomEvent('qingye:back')));
    Native.addListener('resume', () => { for (const record of documents.values()) checkMarkdown(record, true).catch(() => {}); });
    Native.addListener('pause', () => globalThis.dispatchEvent(new CustomEvent('qingye:pause')));
  }
  ipcMain.on('ready', async () => {
    if (rendererReady) return; rendererReady = true;
    if (isNative) { try { pendingFiles.push(...((await Native.pendingOpens()).paths || [])); } catch {} }
    // First start: explain the one permission a document editor needs, then open the system page.
    if (firstRun && !pendingFiles.length) { const state = await storageState(); if (!state.granted) { const choice = await dialog.showMessageBox(window, { message: T('允许青页访问手机上的文件'), detail: T('青页直接在原位置打开和保存你的 PDF 与 Markdown，需要系统的“所有文件访问权限”。文件只在本机处理，不会上传。\n\n暂不授权也可以使用：通过“从其他应用导入”打开的文件会复制到青页自己的文件夹。'), buttons: [T('去授权'), T('暂不')], defaultId: 0, cancelId: 1 }); if (choice.response === 0) await requestStorageAccess(); } }
    if (pendingFiles.length) command('opened', await openFiles(pendingFiles));
    pendingFiles = [];
  });
  mainReady();
}
export const internals = { documents, openFiles, get preferences() { return preferences; } };
