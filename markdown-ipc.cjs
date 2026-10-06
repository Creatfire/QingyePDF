// IPC handlers for the Typora-style Markdown features. Registered from main.cjs once the
// window exists; everything that touches the disk is validated against the documents the user
// opened or the folders they explicitly chose.
const fs = require('node:fs/promises');
const path = require('node:path');
const markdownFiles = require('./markdown-files.cjs');
const tools = require('./markdown-tools.cjs');
const { T } = require('./i18n-main.cjs');

function register(ctx) {
  const { handle, getWindow, dialog, shell, app, session, BrowserWindow, documents, documentById, openFiles, atomicWrite, fingerprint, digest, preferences, persist, watchMarkdown, key, command } = ctx;
  const historyBase = path.join(app.getPath('userData'), 'md-history');
  const themeDir = path.join(app.getPath('userData'), 'md-themes');
  const roots = new Set();
  const inside = (root, file) => { const r = path.relative(path.resolve(root), path.resolve(file)); return !!r && !r.startsWith('..') && !path.isAbsolute(r); };
  const allowed = file => [...roots].some(root => inside(root, file)) || [...documents.values()].some(r => r.path && (key(r.path) === key(file) || inside(path.dirname(r.path), file)));
  const mdRecord = id => { const r = documentById(id); if (r.kind !== 'markdown') throw new Error('此标签不是 Markdown 文档。'); return r; };
  const pandocPath = async custom => { const info = await tools.findPandoc(typeof custom === 'string' ? custom : ''); if (!info.found) throw new Error('文档转换引擎缺失，请重新解压青页便携版。'); return info.path; };
  const toBuffer = data => typeof data === 'string' ? Buffer.from(data, 'utf8') : Buffer.from(data);
  const win = () => getWindow();

  ctx.snapshotOnSave = (record, text) => tools.snapshot(historyBase, record.path, text).catch(() => {});

  // ——— Folder tree / recent ———
  const openFolder = async dir => { roots.add(dir); return { ...(await tools.listTree(dir)) }; };
  handle('markdown-open-folder', async fromDocument => {
    let dir = null;
    if (fromDocument) { const r = documents.get(fromDocument); if (r?.path) dir = path.dirname(r.path); }
    if (!dir) { const result = await dialog.showOpenDialog(win(), { title: T('打开文件夹'), properties: ['openDirectory'] }); if (result.canceled) return null; dir = result.filePaths[0]; }
    return openFolder(dir);
  });
  handle('markdown-tree', async dir => { if (typeof dir !== 'string' || !allowed(path.join(dir, 'x'))) throw new Error('该文件夹尚未打开。'); return tools.listTree(dir); });
  handle('markdown-open-path', async file => {
    if (typeof file !== 'string' || !markdownFiles.isMarkdown(file) || !allowed(file)) throw new Error('无法打开此文件。');
    return openFiles([file]);
  });

  // ——— File operations ———
  handle('markdown-file-op', async (target, op, arg) => {
    const record = target?.id ? mdRecord(target.id) : null;
    const file = record ? record.path : target?.path;
    if (!file || !allowed(file)) throw new Error(record ? '请先保存文档。' : '无法操作此文件。');
    switch (op) {
      case 'reveal': shell.showItemInFolder(file); return true;
      case 'copyPath': return file;
      case 'duplicate': {
        const parsed = path.parse(file); const copy = await tools.uniqueFile(parsed.dir, `${parsed.name} 副本${parsed.ext}`);
        await fs.copyFile(file, copy); return openFiles([copy]);
      }
      case 'rename': {
        const name = tools.safeFileName(arg); if (!name) throw new Error('文件名无效。');
        const next = path.join(path.dirname(file), markdownFiles.isMarkdown(name) ? name : name + path.extname(file));
        if (key(next) !== key(file) && await fs.stat(next).catch(() => null)) throw new Error('同名文件已存在。');
        await fs.rename(file, next);
        if (record) { record.path = next; record.name = path.basename(next); watchMarkdown(record); await persist().catch(() => {}); return { id: record.id, name: record.name, path: next }; }
        return { path: next };
      }
      case 'move': {
        const result = await dialog.showSaveDialog(win(), { title: T('移动到…'), defaultPath: file });
        if (result.canceled) return null;
        const next = result.filePath;
        if (await fs.stat(next).catch(() => null) && key(next) !== key(file)) throw new Error('目标文件已存在。');
        await fs.rename(file, next).catch(async error => { if (error.code !== 'EXDEV') throw error; await fs.copyFile(file, next); await fs.unlink(file); });
        if (record) { record.path = next; record.name = path.basename(next); watchMarkdown(record); await persist().catch(() => {}); return { id: record.id, name: record.name, path: next }; }
        return { path: next };
      }
      case 'trash': {
        const choice = await dialog.showMessageBox(win(), { type: 'warning', title: T('移到回收站'), message: `将“${path.basename(file)}”移到回收站？`, buttons: [T('移到回收站'), T('取消')], defaultId: 1, cancelId: 1, noLink: true });
        if (choice.response !== 0) return null;
        await shell.trashItem(file); return { trashed: true };
      }
      default: throw new Error('不支持的文件操作。');
    }
  });
  handle('markdown-set-eol', (id, eol) => { const r = mdRecord(id); if (!['\n', '\r\n'].includes(eol)) throw new Error('无效的换行符。'); r.eol = eol; return true; });
  handle('markdown-reopen-encoding', async (id, encoding) => {
    const r = mdRecord(id); if (!r.path) throw new Error('文档没有对应的磁盘文件。');
    const raw = await fs.readFile(r.path), decoded = tools.decodeWith(raw, String(encoding));
    Object.assign(r, { hash: digest(raw), encoding: String(encoding), bom: decoded.bom, eol: decoded.eol, notified: null });
    return { text: decoded.text, encoding: r.encoding };
  });

  // ——— Export ———
  const saveDialog = async (record, ext, title, filters) => {
    const base = tools.safeFileName(path.parse(record.name).name) || '未命名';
    const result = await dialog.showSaveDialog(win(), { title, defaultPath: path.join(record.path ? path.dirname(record.path) : app.getPath('documents'), base + '.' + ext), filters: filters || [{ name: ext.toUpperCase(), extensions: [ext] }] });
    if (result.canceled) return null;
    return result.filePath.toLowerCase().endsWith('.' + ext) ? result.filePath : result.filePath + '.' + ext;
  };
  const writeOut = async (target, bytes) => { await atomicWrite(target, bytes, await fingerprint(target)); return { path: target }; };
  handle('markdown-export-save', async (id, ext, data, title) => {
    const record = mdRecord(id); ext = String(ext).replace(/[^a-z0-9]/gi, '').toLowerCase();
    if (!ext || !(typeof data === 'string' || data instanceof Uint8Array) || data.length > 400e6) throw new Error('导出数据无效。');
    const target = await saveDialog(record, ext, title || '导出');
    return target ? writeOut(target, toBuffer(data)) : null;
  });
  const render = async (html, { width = 900, scripts = false, signal } = {}, use) => {
    if (signal?.aborted) throw new Error('已取消文档转换。');
    const file = await tools.tempHtml(html);
    const view = new BrowserWindow({ show: false, width, height: 800, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: scripts, partition: 'qingye-export-' + Date.now(), offscreen: false } });
    view.webContents.session.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*', 'ws://*/*', 'wss://*/*'] }, (_details, callback) => callback({ cancel: true }));
    view.webContents.on('will-navigate', event => event.preventDefault());
    view.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    const cancel = () => { if (!view.isDestroyed()) view.destroy(); };
    signal?.addEventListener('abort', cancel, { once: true });
    try { if (signal?.aborted) { cancel(); throw new Error('已取消文档转换。'); } await view.loadFile(file); await new Promise(r => setTimeout(r, 400)); return await use(view); }
    finally { signal?.removeEventListener('abort', cancel); if (!view.isDestroyed()) view.destroy(); await fs.rm(file, { force: true }); }
  };
  ctx.renderHtml = render;
  handle('markdown-export-pdf', async (id, html, options = {}) => {
    const record = mdRecord(id); if (typeof html !== 'string') throw new Error('导出数据无效。');
    const target = await saveDialog(record, 'pdf', '导出 PDF'); if (!target) return null;
    const pageSize = ['A3', 'A4', 'A5', 'Letter', 'Legal', 'Tabloid'].includes(options.pageSize) ? options.pageSize : 'A4';
    const m = Math.max(0, Math.min(60, Number(options.margin) || 20)) / 25.4;
    const pdf = await render(html, {}, view => view.webContents.printToPDF({ pageSize, printBackground: options.background !== false, landscape: !!options.landscape, margins: { top: m, bottom: m, left: m, right: m }, displayHeaderFooter: !!options.pageNumbers, headerTemplate: '<span></span>', footerTemplate: '<div style="font-size:9px;width:100%;text-align:center;color:#777"><span class="pageNumber"></span> / <span class="totalPages"></span></div>' }));
    return writeOut(target, pdf);
  });
  handle('markdown-export-image', async (id, html, options = {}) => {
    const record = mdRecord(id); if (typeof html !== 'string') throw new Error('导出数据无效。');
    const target = await saveDialog(record, 'png', '导出图片', [{ name: T('PNG 图片'), extensions: ['png'] }]); if (!target) return null;
    const width = Math.max(320, Math.min(2400, Number(options.width) || 900));
    const png = await render(html, { width, scripts: true }, async view => {
      const height = await view.webContents.executeJavaScript('Math.ceil(document.documentElement.scrollHeight)');
      view.setContentSize(width, Math.min(30000, Math.max(200, height)));
      await new Promise(r => setTimeout(r, 250));
      return (await view.webContents.capturePage()).toPNG();
    });
    return writeOut(target, png);
  });

  // ——— Pandoc ———
  handle('markdown-pandoc-info', custom => tools.findPandoc(typeof custom === 'string' ? custom : ''));
  handle('markdown-pandoc-export', async (id, format, text, custom) => {
    const record = mdRecord(id); if (typeof text !== 'string') throw new Error('无效的内容。');
    const pandoc = await pandocPath(custom);
    const ext = { latex: 'tex', markdown: 'md', mediawiki: 'wiki', asciidoc: 'adoc', epub: 'epub' }[format] || format;
    const target = await saveDialog(record, ext, '用 Pandoc 导出'); if (!target) return null;
    const tmp = path.join(app.getPath('temp'), `qingye-pandoc-${Date.now()}.md`);
    await fs.writeFile(tmp, text, 'utf8');
    try {
      const cwd = record.path ? path.dirname(record.path) : undefined;
      const out = path.join(app.getPath('temp'), `qingye-pandoc-${Date.now()}.${ext}`);
      await tools.runPandocConvert(pandoc, ['-t', tools.PANDOC_TARGETS[format] || format, '-o', out, '--standalone', ...(cwd ? ['--resource-path', cwd] : []), tmp], { cwd });
      await writeOut(target, await fs.readFile(out)); fs.rm(out, { force: true }).catch(() => {});
      return { path: target };
    } finally { fs.rm(tmp, { force: true }).catch(() => {}); }
  });
  handle('markdown-pandoc-import', async custom => {
    const pandoc = await pandocPath(custom);
    const exts = Object.keys(tools.PANDOC_SOURCES).map(e => e.slice(1));
    const result = await dialog.showOpenDialog(win(), { title: T('导入'), filters: [{ name: T('可导入的文档'), extensions: exts }], properties: ['openFile'] });
    if (result.canceled) return null;
    const file = result.filePaths[0];
    const text = await tools.pandocImport(pandoc, file, { mediaDir: path.join(path.dirname(file), path.parse(file).name + '.assets') });
    return { text, name: path.parse(file).name + '.md' };
  });

  // ——— History ———
  handle('markdown-history', async id => { const r = mdRecord(id); return r.path ? tools.listVersions(historyBase, r.path) : []; });
  handle('markdown-history-read', async (id, name) => { const r = mdRecord(id); if (!r.path) throw new Error('文档尚未保存。'); return tools.readVersion(historyBase, r.path, String(name)); });

  // ——— Themes / KaTeX ———
  handle('markdown-themes', () => tools.listThemes(themeDir));
  handle('markdown-theme-read', id => tools.readTheme(themeDir, String(id)));
  handle('markdown-theme-import', async () => {
    const result = await dialog.showOpenDialog(win(), { title: T('导入主题（CSS）'), filters: [{ name: T('CSS 主题'), extensions: ['css'] }], properties: ['openFile', 'multiSelections'] });
    if (result.canceled) return [];
    await fs.mkdir(themeDir, { recursive: true });
    for (const f of result.filePaths) { const s = await fs.stat(f); if (s.size > 2 * 1024 * 1024) throw new Error(path.basename(f) + ' 超过 2 MB。'); await fs.copyFile(f, path.join(themeDir, tools.safeFileName(path.basename(f)))); }
    return tools.listThemes(themeDir);
  });
  handle('markdown-theme-folder', async () => { await fs.mkdir(themeDir, { recursive: true }); await shell.openPath(themeDir); return true; });
  handle('markdown-katex-css', () => tools.katexCss(__dirname));

  // ——— Images ———
  handle('markdown-image-save', async (id, value, extension, options = {}) => {
    const record = mdRecord(id);
    if (!record.path) throw new Error('请先保存文档，再插入粘贴的图片。');
    if (!(value instanceof Uint8Array) || value.byteLength > 40 * 1024 * 1024) throw new Error('图片数据无效或超过 40 MB。');
    const ext = ('.' + String(extension || 'png').toLowerCase().replace(/[^a-z0-9]/g, '')).replace('.jpeg', '.jpg');
    if (!markdownFiles.IMAGE_TYPES[ext]) throw new Error('不支持的图片格式。');
    const folder = tools.imageFolder(record.path, options);
    await fs.mkdir(folder, { recursive: true });
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    const file = await tools.uniqueFile(folder, `image-${stamp}${ext}`);
    await atomicWrite(file, Buffer.from(value), null);
    return markdownFiles.markdownPath(record.path, file);
  });
  // Copies a picked / dropped image into the configured folder (when the option is on).
  handle('markdown-image-import', async (id, files, options = {}) => {
    const record = mdRecord(id); const out = [];
    if (!Array.isArray(files) || files.length > 50) throw new Error('一次最多插入 50 张图片。');
    for (const f of files) {
      if (typeof f !== 'string' || !markdownFiles.IMAGE_TYPES[path.extname(f).toLowerCase()] || !(await fs.stat(f).catch(() => null))?.isFile()) continue;
      const target = options.copy && record.path ? await tools.copyImageInto(f, tools.imageFolder(record.path, options)) : f;
      out.push(markdownFiles.markdownPath(record.path, target));
    }
    return out;
  });
  handle('markdown-pick-image-files', async id => {
    const record = mdRecord(id);
    const result = await dialog.showOpenDialog(win(), { title: T('插入图片'), defaultPath: record.path ? path.dirname(record.path) : undefined, filters: [{ name: T('图片'), extensions: Object.keys(markdownFiles.IMAGE_TYPES).map(e => e.slice(1)) }], properties: ['openFile', 'multiSelections'] });
    return result.canceled ? null : result.filePaths;
  });
  // Copies every local image the document references into the image folder, rewriting links.
  handle('markdown-copy-images', async (id, text, options = {}) => {
    const record = mdRecord(id); if (!record.path) throw new Error('请先保存文档。');
    const dir = tools.imageFolder(record.path, options); let count = 0;
    const seen = new Map();
    const rewrite = async (whole, alt, target, title = '') => {
      const resolved = markdownFiles.resolveLocal(record.path, target);
      if (!resolved || !markdownFiles.IMAGE_TYPES[path.extname(resolved.file).toLowerCase()] || inside(dir, resolved.file) || !(await fs.stat(resolved.file).catch(() => null))?.isFile()) return whole;
      if (!seen.has(resolved.file)) { seen.set(resolved.file, await tools.copyImageInto(resolved.file, dir)); count++; }
      return `![${alt}](${markdownFiles.markdownPath(record.path, seen.get(resolved.file))}${title})`;
    };
    const re = /!\[([^\]]*)\]\((<[^>]+>|[^)\s]+)((?:\s+"[^"]*")?)\)/g; let out = '', last = 0, m;
    while ((m = re.exec(text))) { out += text.slice(last, m.index) + await rewrite(m[0], m[1], m[2], m[3]); last = m.index + m[0].length; }
    return { text: out + text.slice(last), count, folder: dir };
  });
  handle('markdown-image-op', async (id, source, op) => {
    const record = mdRecord(id); const r = markdownFiles.resolveLocal(record.path, source);
    if (!r || !(await fs.stat(r.file).catch(() => null))) throw new Error('图片文件不存在或是远程图片。');
    if (op === 'reveal') { shell.showItemInFolder(r.file); return true; }
    if (op === 'copyPath') return r.file;
    if (op === 'trash') {
      const choice = await dialog.showMessageBox(win(), { type: 'warning', title: T('删除图片文件'), message: `将“${path.basename(r.file)}”移到回收站？`, buttons: [T('移到回收站'), T('取消')], defaultId: 1, cancelId: 1, noLink: true });
      if (choice.response !== 0) return false; await shell.trashItem(r.file); return true;
    }
    throw new Error('不支持的图片操作。');
  });

  // ——— Window / spelling ———
  handle('always-on-top', flag => { const window=win();window.setAlwaysOnTop(!!flag);if(flag&&process.platform==='win32'&&!window.isAlwaysOnTop())window.setAlwaysOnTop(true,'pop-up-menu');return window.isAlwaysOnTop(); });
  handle('spell-replace', word => { win().webContents.replaceMisspelling(String(word)); return true; });
  handle('spell-learn', word => win().webContents.session.addWordToSpellCheckerDictionary(String(word)));
  win().webContents.on('context-menu', (_event, params) => {
    if (params.misspelledWord) command('spell', { word: params.misspelledWord, suggestions: params.dictionarySuggestions.slice(0, 6) });
  });
}
module.exports = { register };
