const { app, BrowserWindow, ipcMain, dialog, Menu, protocol, shell, session, safeStorage } = require('electron');
const { T, TF, setLanguage, getLanguage, chromiumLocale } = require('./i18n-main.cjs');
const { createAssociations } = require('./file-associations.cjs');
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pdfBytes, digest, fingerprint, atomicWrite, samplePdf } = require('./core.cjs');
const { runOffline, waitForAbort } = require('./offline.cjs');
const { spawn } = require('node:child_process');
const { Recovery } = require('./recovery.cjs');
const { createDiagnostics } = require('./diagnostics.cjs');
const markdownFiles = require('./markdown-files.cjs');
const { createLibraryIndex } = require('./library-index.cjs');
const {notesMarkdown,normalizeNotes}=require('./notes-markdown.cjs');
const bootStarted=performance.now();
let recovery;
const recoveryTokens=new Map();
const runningJobs=new Map();
const canceledJobs=new Set();

protocol.registerSchemesAsPrivileged([{ scheme: 'qingye', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);
const smoke = process.argv.includes('--smoke-test')||process.argv.includes('--edit-smoke')||process.argv.includes('--markdown-smoke')||process.argv.includes('--conversion-smoke')||process.argv.includes('--basic-smoke')||process.argv.includes('--fix-smoke')||process.argv.includes('--fix-close-smoke')||process.argv.includes('--features-smoke')||process.argv.includes('--notes-smoke')||process.argv.includes('--links-smoke')||process.argv.includes('--fix013-smoke');
const safety = process.argv.includes('--safety-smoke');
const safetyRole = process.env.QINGYE_SAFETY_ROLE || 'main';
const benchmark=process.argv.includes('--startup-benchmark');
const firstRunTest=process.argv.includes('--first-run-test');
// Independent manual/AI test sessions may use their own profile without changing the user's data.
if (process.env.QINGYE_PROFILE_DIR) {
  const profile = process.env.QINGYE_PROFILE_DIR;
  if (!path.isAbsolute(profile)) throw new Error('QINGYE_PROFILE_DIR must be an absolute directory.');
  require('node:fs').mkdirSync(profile, { recursive: true }); app.setPath('userData', profile);
}
const smokeRoot=path.resolve(process.env.QINGYE_SMOKE_ROOT||process.env.PORTABLE_EXECUTABLE_DIR||process.cwd());
if (benchmark) app.setPath('userData',path.join(smokeRoot,'test-output','benchmark-profile-'+process.pid));
if (smoke) app.setPath('userData', path.join(smokeRoot, 'test-output', 'profile'));
// Crash/verify drill children share one profile so the verifier sees the crashed session's drafts.
if (safety) app.setPath('userData', path.join(smokeRoot, 'test-output', safetyRole === 'main' ? 'safety-profile' : 'safety-drill-profile'));
// Each safety run starts from a clean profile; this runs before Electron opens
// the directory. The drill profile is shared by the crash and verify children,
// so only the first (crash) child may wipe it.
if (safety && safetyRole !== 'verify') { try { require('node:fs').rmSync(path.join(smokeRoot, 'test-output', safetyRole === 'main' ? 'safety-profile' : 'safety-drill-profile'), { recursive: true, force: true }); } catch {} }
if (smoke || safety) app.disableHardwareAcceleration();
const diagnostics=createDiagnostics({directory:smoke||safety||benchmark?path.join(smokeRoot,'test-output'):path.join(app.getPath('userData'),'logs'),mode:process.argv.includes('--edit-smoke')?'edit-smoke':process.argv.includes('--markdown-smoke')?'markdown-smoke':smoke?'smoke':safety?'safety':benchmark?'benchmark':'reader',version:app.getVersion()});
let failing=false;
function fail(phase,error,details={}){
  if(failing)return;failing=true;console.error(error);
  try{diagnostics.failure(phase,error,details);}catch(writeError){console.error('Cannot write failure report:',writeError);}
  if(recovery)Promise.race([recovery.queue.catch(()=>{}),new Promise(resolve=>setTimeout(resolve,3000))]).then(()=>app.exit(1));else app.exit(1);
}
process.on('uncaughtException',error=>fail('uncaught-exception',error));
process.on('unhandledRejection',error=>fail('unhandled-rejection',error));
if(smoke||safety||benchmark)setTimeout(()=>fail('test-timeout',new Error('验证超时。'),{timeoutMs:420000}),420000).unref();
// Display language chosen in Settings (stored with the reading state); default Simplified Chinese.
// Without a saved choice Chromium keeps the system locale, so "follow system" works in the renderer.
// Automated test runs always use Simplified Chinese (their assertions are written against it).
{
  let saved = null;
  try { saved = JSON.parse(require('node:fs').readFileSync(path.join(app.getPath('userData'), 'reading-state.json'), 'utf8')).language || null; } catch {}
  if (smoke || safety || benchmark) saved = 'zh-CN';
  setLanguage(saved || 'zh-CN');
  if (saved) app.commandLine.appendSwitch('lang', chromiumLocale(getLanguage()));
}
// Window style (0.9.2): "windows" keeps the native caption buttons; "macos" draws traffic lights,
// larger radii and translucent surfaces. The window frame is chosen at creation, so a change made in
// Settings is saved here and takes effect after a restart. Automated runs always use the Windows style.
// On a Mac the MacOS look (with the system's own traffic lights) is the default.
const isMac = process.platform === 'darwin';
const normalizeWindowStyle = value => ({ style: value?.style === 'macos' || (isMac && value?.style !== 'windows') ? 'macos' : 'windows', vibrancy: !!value?.vibrancy });
// Acrylic backgroundMaterial needs Windows 11 22H2 (build 22621) or later.
const acrylicSupported = process.platform === 'win32' && Number(require('node:os').release().split('.')[2] || 0) >= 22621;
let windowStyle = normalizeWindowStyle(null);
{
  try { windowStyle = normalizeWindowStyle(JSON.parse(require('node:fs').readFileSync(path.join(app.getPath('userData'), 'reading-state.json'), 'utf8')).windowStyle); } catch {}
  if (smoke || safety || benchmark) windowStyle = normalizeWindowStyle({ style: 'windows' });
}
const drawnCaption = windowStyle.style === 'macos' && process.platform !== 'darwin';
const windowAcrylic = drawnCaption && windowStyle.vibrancy && acrylicSupported;
const relaunched = process.argv.includes('--qingye-relaunch');
let relaunchOnClose = false;
let finishingClose = false;
let converterLifecycle;
let loadComplete;
let window, allowClose = false, rendererReady = false;
const singleInstance = smoke || safety || benchmark || process.argv.includes('--new-window') || app.requestSingleInstanceLock();
if (!singleInstance) app.quit();
const pdfArguments = args => args.filter(arg => !arg.startsWith('-') && (path.extname(arg).toLowerCase() === '.pdf' || markdownFiles.isMarkdown(arg)));
let pendingFiles = pdfArguments(process.argv.slice(app.isPackaged ? 1 : 2));
// macOS hands over documents (Finder "Open with", dropping on the Dock icon) through this event,
// possibly before the window exists.
app.on('open-file', async (event, file) => {
  event.preventDefault();
  if (!pdfArguments([file]).length) return;
  if (rendererReady) { command('opened', await openFiles([file])); if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); } }
  else pendingFiles.push(file);
});
app.on('second-instance', async (_event, argv) => {
  const files = pdfArguments(argv.slice(1));
  if (rendererReady) command('opened', await openFiles(files)); else pendingFiles.push(...files);
  if (window) { if (window.isMinimized()) window.restore(); window.show(); window.focus(); }
});
// Pixel size from the image header itself; used to size image-stamp selections.
function imageDimensions(header) {
  const b = header;
  if (b.length >= 24 && b.readUInt32BE(0) === 0x89504e47) return { width: b.readUInt32BE(16), height: b.readUInt32BE(20) };
  if (b.length >= 26 && b[0] === 0x42 && b[1] === 0x4d) return { width: Math.abs(b.readInt32LE(18)), height: Math.abs(b.readInt32LE(22)) };
  if (b.length >= 30 && b.toString('ascii', 0, 4) === 'RIFF' && b.toString('ascii', 8, 12) === 'WEBP') {
    const chunk = b.toString('ascii', 12, 16);
    if (chunk === 'VP8X') return { width: 1 + b.readUIntLE(24, 3), height: 1 + b.readUIntLE(27, 3) };
    if (chunk === 'VP8 ') return { width: b.readUInt16LE(26) & 0x3fff, height: b.readUInt16LE(28) & 0x3fff };
    if (chunk === 'VP8L' && b.length >= 25) { const bits = b.readUInt32LE(21); return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 }; }
  }
  if (b.length > 4 && b[0] === 0xff && b[1] === 0xd8) {
    let at = 2;
    while (at + 9 < b.length) {
      if (b[at] !== 0xff) { at++; continue; }
      const marker = b[at + 1];
      if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) return { height: b.readUInt16BE(at + 5), width: b.readUInt16BE(at + 7) };
      if (marker === 0xd8 || (marker >= 0xd0 && marker <= 0xd9)) { at += 2; continue; }
      at += 2 + b.readUInt16BE(at + 2);
    }
  }
  return null;
}
const documents = new Map(), closedDocuments=new Map(), recentTokens = new Map(), assetTokens = new Map(), batchTokens = new Map();
let preferences = { schemaVersion: 1, recent: [] };
let preferenceQueue = Promise.resolve();
const key = file => path.resolve(file).toLowerCase();
const metadata = record => ({ id: record.id, name: record.name, path: record.path, state: record.state, kind: record.kind || 'pdf', ...(record.kind === 'markdown' ? { eol: record.eol, encoding: record.encoding } : {}) });
const preferencesPath = () => path.join(app.getPath('userData'), 'reading-state.json');
function persist() {
  const content = JSON.stringify(preferences, null, 2);
  preferenceQueue = preferenceQueue.catch(() => {}).then(async () => {
    await fs.mkdir(app.getPath('userData'), { recursive: true });
    const tmp = preferencesPath() + `.${process.pid}.tmp`;
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
    color: typeof state.color === 'string' ? state.color.slice(0,30) : 'light',
    paper: /^#[\da-fA-F]{6}$/.test(state.paper) ? state.paper : '#f0f4f5',
    ink: /^#[\da-fA-F]{6}$/.test(state.ink) ? state.ink : '#111111',
    preserveImages: !!state.preserveImages,
    brightness: Math.max(.5,Math.min(1.5,Number(state.brightness)||1)),
    contrast: Math.max(.5,Math.min(1.5,Number(state.contrast)||1)),
    crop: Array.isArray(state.crop) && state.crop.length === 4 ? state.crop.map(x => Math.max(0, Math.min(40, Number(x) || 0))) : [0, 0, 0, 0],
    reflow: !!state.reflow,
    fontSize: Math.max(14, Math.min(36, Number(state.fontSize) || 20)),
    bookmarks: Array.isArray(state.bookmarks) ? state.bookmarks.filter(b=>Number.isInteger(b.page)&&b.page>0&&typeof b.title==='string').slice(0,10000).map(b=>({page:Math.min(1000000,b.page),title:b.title.slice(0,200)})) : [],
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
        documents.set(record.id, record); remember(record); watchMarkdown(record);
        opened.push({ ...metadata(record), text: decoded.text, notice: decoded.notice });
        continue;
      }
      const bytes = pdfBytes(await fs.readFile(file));
      record = { id: randomUUID(), name: path.basename(file), path: file, hash: digest(bytes), state: preferences.recent.find(r => key(r.path) === key(file))?.state || {} };
      documents.set(record.id, record);
      remember(record);
      opened.push({ ...metadata(record), bytes });
    } catch (error) {
      if (smoke || safety) throw error;
      await dialog.showMessageBox(window, { type: 'error', title: T('无法打开文件'), message: path.basename(String(candidate)), detail: error.message });
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
// External-change detection for open Markdown files.
const markdownWatchers = new Map();
function unwatchMarkdown(id) { markdownWatchers.get(id)?.close(); markdownWatchers.delete(id); }
function watchMarkdown(record) {
  unwatchMarkdown(record.id);
  if (record.kind === 'markdown' && record.path) markdownWatchers.set(record.id, markdownFiles.createWatcher(record.path, () => checkMarkdown(record, true).catch(() => {})));
}
async function checkMarkdown(record, notify) {
  if (!record || record.kind !== 'markdown' || !record.path || record.saving || !documents.has(record.id)) return 'same';
  const actual = await fingerprint(record.path);
  if (actual === record.hash || record.saving) return 'same';
  const state = actual === null ? 'deleted' : 'changed';
  if (notify && record.notified !== (actual || 'deleted')) { record.notified = actual || 'deleted'; command('file-changed', { id: record.id, state }); }
  return state;
}
function handle(channel, callback) {
  ipcMain.handle(channel, async (event, ...args) => {
    if (event.sender !== window?.webContents || event.senderFrame !== window.webContents.mainFrame || event.senderFrame.url !== 'qingye://app/ui/index.html') throw new Error('非法调用来源。');
    return callback(...args);
  });
}
function command(name, data) { window?.webContents.send('command', name, data); }

app.whenReady().then(async () => {
  if (!singleInstance) return;
  recovery=new Recovery(path.join(app.getPath('userData'),'recovery'));
  // First-ever launch on this machine: the portable exe has just spent time
  // extracting its runtime before our code could show anything.
  const firstRun = await fs.readFile(preferencesPath()).then(() => false, error => error.code === 'ENOENT');
  try { const data = JSON.parse(await fs.readFile(preferencesPath(), 'utf8')); if (data.schemaVersion === 1 && Array.isArray(data.recent)){preferences.recent = data.recent.filter(r => typeof r.path === 'string').slice(0, 30);if(typeof data.language==='string')preferences.language=data.language;if(data.windowStyle)preferences.windowStyle=normalizeWindowStyle(data.windowStyle);preferences.stamps=Array.isArray(data.stamps)?data.stamps.slice(0,100):[];} } catch {}
  const mime = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ftl': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.pdf': 'application/pdf', '.bcmap': 'application/octet-stream', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2' };
  protocol.handle('qingye', async request => {
    const url = new URL(request.url);
    const file = path.resolve(__dirname, '.' + decodeURIComponent(url.pathname));
    if (url.hostname !== 'app' || !file.startsWith(__dirname + path.sep) || !['ui', 'vendor'].includes(path.relative(__dirname, file).split(path.sep)[0])) return new Response('Forbidden', { status: 403 });
    try { return new Response(await fs.readFile(file), { headers: {
      'Content-Type': mime[path.extname(file)] || 'application/octet-stream',
      'Content-Security-Policy': "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; connect-src 'self' blob: data:; object-src 'none'; base-uri 'none'",
    } }); } catch { return new Response('Not found', { status: 404 }); }
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
  // Custom title bar: the renderer draws brand and tabs; Windows keeps native caption
  // buttons (snap layouts, accessibility) through the themed title bar overlay.
  // In the MacOS style the renderer draws the traffic lights itself (no overlay), and with
  // "window vibrancy" the page background is transparent over Windows 11 acrylic.
  const titleBar = dark => ({ color: dark ? '#0e1512' : '#eef3f0', symbolColor: dark ? '#cfe0d6' : '#2a3a33', height: 40 });
  window = new BrowserWindow({ width: 1360, height: 940, minWidth: 920, minHeight: 640, show: false, title: T('青页 PDF'), icon: path.join(__dirname, 'ui', 'icon.png'), backgroundColor: windowAcrylic ? '#00000000' : drawnCaption ? '#ececef' : '#eef3f0',
    titleBarStyle: 'hidden', ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 12 } } : drawnCaption ? {} : { titleBarOverlay: titleBar(false) }), ...(windowAcrylic ? { backgroundMaterial: 'acrylic' } : {}), autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, spellcheck: true, offscreen: (smoke || safety) && !process.argv.includes('--markdown-smoke') } });
  window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
  window.webContents.on('will-navigate', event => event.preventDefault());
  window.webContents.on('context-menu',async (_event,params)=>{
    if(!params.isEditable||!params.frame)return;
    // Markdown supplies its own menu (including spelling suggestions); do not cover it
    // with the generic native text menu when Chromium emits the spelling event.
    // The renderer opens #mdContextMenu synchronously in its own contextmenu handler, so by the time this
    // event arrives the Markdown menu is visible (or focus is inside a Markdown panel).
    if(params.frame===window.webContents.mainFrame && await params.frame.executeJavaScript(`(()=>{const hit=document.elementFromPoint(${Number(params.x) || 0},${Number(params.y) || 0});return !!hit?.closest?.('.mdPanel');})()`).catch(()=>false))return;
    const flags=params.editFlags || {};
    Menu.buildFromTemplate([
      {id:'text-undo',label:T('撤销'),role:'undo',enabled:flags.canUndo},{id:'text-redo',label:T('重做'),role:'redo',enabled:flags.canRedo},{type:'separator'},
      {id:'text-cut',label:T('剪切'),role:'cut',enabled:flags.canCut},{id:'text-copy',label:T('复制'),role:'copy',enabled:flags.canCopy},{id:'text-paste',label:T('粘贴'),role:'paste',enabled:flags.canPaste},{type:'separator'},
      {id:'text-select-all',label:T('全选'),role:'selectAll',enabled:flags.canSelectAll}
    ]).popup({window,frame:params.frame});
  });
  window.webContents.on('render-process-gone',(_event,details)=>fail('render-process-gone',new Error('Reader process exited: '+details.reason),details));
  window.webContents.on('did-fail-load',(_event,code,description,url,isMainFrame)=>{if(isMainFrame&&code!==-3)fail('page-load',new Error(description),{code,url});});
  window.on('close', event => { if (!allowClose) { event.preventDefault(); command('close-app'); } });
  window.once('ready-to-show', () => { if (!smoke&&!safety&&!benchmark&&!firstRunTest) window.show(); });
  const send = action => () => command(action);
  const about = async () => dialog.showMessageBox(window, { type: 'info', icon: path.join(__dirname, 'ui', 'icon.png'), title: T('青页 PDF'), message: T('青页 PDF ') + app.getVersion(), detail: T('开源 · 本地阅读 · 无会员\n多标签、搜索、目录、高亮、文本、墨迹与签名。\n阅读引擎：Mozilla PDF.js 6.3.289。\n本版本按 AGPL-3.0 开源。') });
  // Command on a Mac, Ctrl elsewhere. Tab switching keeps the Control key on every platform
  // (Command+Tab is the system's application switcher).
  const buildAppMenu = () => Menu.setApplicationMenu(Menu.buildFromTemplate([
    ...(isMac ? [{ label: T('青页 PDF'), submenu: [
      { label: T('关于青页 PDF'), click: about }, { type: 'separator' },
      { role: 'services', label: T('服务') }, { type: 'separator' },
      { role: 'hide', label: T('隐藏青页 PDF') }, { role: 'hideOthers', label: T('隐藏其他') }, { role: 'unhide', label: T('全部显示') }, { type: 'separator' },
      { label: T('退出青页 PDF'), accelerator: 'Cmd+Q', click: () => window.close() },
    ] }] : []),
    { label: T('文件'), submenu: [
      { label: T('打开…'), accelerator: 'CmdOrCtrl+O', click: send('open') },
      { label: T('新建 Markdown'), accelerator: 'CmdOrCtrl+N', click: send('new-markdown') },
      { label: T('保存'), accelerator: 'CmdOrCtrl+S', click: send('save') },
      { label: T('另存为…'), accelerator: 'CmdOrCtrl+Shift+S', click: send('save-as') },
      { type: 'separator' }, { label: T('关闭标签'), accelerator: 'CmdOrCtrl+W', click: send('close-tab') },
      ...(isMac ? [] : [{ label: T('退出'), accelerator: 'Alt+F4', click: () => window.close() }]),
    ] },
    // Without these roles the standard editing shortcuts do nothing in text fields on a Mac.
    ...(isMac ? [{ label: T('编辑'), submenu: [
      { role: 'undo', label: T('撤销') }, { role: 'redo', label: T('重做') }, { type: 'separator' },
      { role: 'cut', label: T('剪切') }, { role: 'copy', label: T('复制') }, { role: 'paste', label: T('粘贴') }, { role: 'selectAll', label: T('全选') },
    ] }] : []),
    { label: T('阅读'), submenu: [
      { label: T('查找'), accelerator: 'CmdOrCtrl+F', click: send('find') },
      { label: T('下一标签'), accelerator: 'Ctrl+Tab', click: send('next-tab') },
      { label: T('上一标签'), accelerator: 'Ctrl+Shift+Tab', click: send('previous-tab') },
      { label: T('打印…'), accelerator: 'CmdOrCtrl+P', click: send('print') },
      { role: 'togglefullscreen', label: T('全屏'), accelerator: isMac ? 'Ctrl+Cmd+F' : 'F11' },
    ] },
    ...(isMac ? [{ role: 'windowMenu', label: T('窗口') }] : []),
    { label: T('帮助'), submenu: [...(isMac ? [] : [{ label: T('关于青页 PDF'), click: about }]), { label: T('使用帮助'), click: send('help') }] },
  ]));
  buildAppMenu();
  handle('app-version',()=>app.getVersion());
  // ——— Settings (0.8.2): language, file associations, data ———
  const associations = createAssociations({ app, shell });
  handle('set-language', async (code, explicit) => { const next = setLanguage(code); const stored = explicit ? next : undefined; if (preferences.language !== stored) { preferences.language = stored; await persist(); } buildAppMenu(); if (window) window.setTitle(T('青页 PDF')); return next; });
  handle('assoc-status', () => associations.status());
  handle('assoc-register', kinds => associations.register(Array.isArray(kinds) ? kinds.filter(k => typeof k === 'string') : undefined));
  handle('assoc-unregister', () => associations.unregister());
  handle('assoc-choose', kind => associations.choose(String(kind)));
  handle('assoc-open-settings', () => associations.openSettings());
  handle('recent-clear', async () => { preferences.recent = []; recentTokens.clear(); await persist(); return true; });
  handle('open-data-folder', async () => { const error = await shell.openPath(app.getPath('userData')); if (error) throw new Error(error); return true; });
  handle('open', async () => {
    const result = await dialog.showOpenDialog(window, { title: T('打开文档'), filters: [{ name: T('PDF 与 Markdown'), extensions: ['pdf', ...markdownFiles.MARKDOWN_EXTENSIONS.map(e => e.slice(1))] }, { name: T('PDF 文档'), extensions: ['pdf'] }, { name: T('Markdown 文档'), extensions: markdownFiles.MARKDOWN_EXTENSIONS.map(e => e.slice(1)) }], properties: ['openFile', 'multiSelections'] });
    return result.canceled ? [] : openFiles(result.filePaths);
  });
  handle('drop', files => openFiles(Array.isArray(files) ? files : []));
  handle('checkpoint',async (items,activeId) => {
    if(!Array.isArray(items)||items.length>64)throw new Error('恢复标签数量过多。');
    const entries=items.filter(item=>documents.has(item.id)).map(item=>{const r=documentById(item.id);remember(r,item.state);const markdown=r.kind==='markdown';return {id:r.id,name:r.name,path:r.path,hash:r.hash,state:r.state,dirty:!!item.dirty,...(markdown?{kind:'markdown'}:{}),...(markdown&&typeof item.text==='string'?{text:item.text}:!markdown&&item.bytes?{bytes:pdfBytes(item.bytes)}:{})};});
    await recovery.checkpoint(entries,activeId);await persist();return true;
  });
  handle('recovery-list',async () => {
    const found=await recovery.list();return found.map(item=>{const token=randomUUID();recoveryTokens.set(token,item);return {token,updated:item.updated,names:item.entries.map(e=>e.name),drafts:item.entries.filter(e=>e.draft).length};});
  });
  handle('last-session-count',async () => ((await recovery.last()).entries||[]).length);
  handle('restore-session',async token => {
    const item=token?recoveryTokens.get(token):await recovery.last();if(!item)throw new Error('恢复记录已失效。');
    const opened=[];
    for(const entry of item.entries){
      if(entry.draft&&entry.draft.endsWith('.md')){
        const text=await fs.readFile(path.join(recovery.folder,entry.draft),'utf8');
        const unchanged=entry.path&&!Array.from(documents.values()).some(r=>r.path&&key(r.path)===key(entry.path))&&await fingerprint(entry.path).catch(()=>null)===entry.hash;
        let meta={encoding:'utf-8',bom:false,eol:'\n'};
        if(unchanged){try{const d=markdownFiles.decodeMarkdown(await fs.readFile(entry.path));meta={encoding:d.encoding,bom:d.bom,eol:d.eol};}catch{}}
        const record={id:randomUUID(),kind:'markdown',name:entry.name,path:unchanged?entry.path:null,hash:unchanged?entry.hash:null,...meta,state:entry.state||{}};
        documents.set(record.id,record);watchMarkdown(record);opened.push({...metadata(record),text,recovered:true,wasActive:entry.id===item.activeId});
      }else if(entry.draft){
        const bytes=pdfBytes(await fs.readFile(path.join(recovery.folder,entry.draft)));
        const unchanged=entry.path&&!Array.from(documents.values()).some(r=>r.path&&key(r.path)===key(entry.path))&&await fingerprint(entry.path).catch(()=>null)===entry.hash;
        const record={id:randomUUID(),name:entry.name,path:unchanged?entry.path:null,hash:unchanged?entry.hash:null,state:entry.state||{}};
        documents.set(record.id,record);opened.push({...metadata(record),bytes,recovered:true,wasActive:entry.id===item.activeId});
      }else if(entry.path)opened.push(...(await openFiles([entry.path])).map(info=>({...info,wasActive:entry.id===item.activeId})));
    }
    // Remove the abandoned manifest only after the recovered drafts are durably checkpointed.
    if(token){await recovery.checkpoint([...recovery.entries.filter(e=>documents.has(e.id)),...opened.filter(info=>info.bytes||typeof info.text==='string').map(info=>{const r=documentById(info.id);return {...metadata(r),hash:r.hash,dirty:!!info.recovered,...(info.recovered?(typeof info.text==='string'?{text:info.text}:{bytes:info.bytes}):{})};})],opened.at(-1)?.id);await recovery.remove(item);recoveryTokens.delete(token);}
    return opened;
  });
  handle('discard-recovery',async token => {const item=recoveryTokens.get(token);if(item){await recovery.remove(item);recoveryTokens.delete(token);}return true;});
  handle('finish-session',async (items,activeId) => {await recovery.finish(items.map(i=>documents.get(i.id)||closedDocuments.get(i.id)).filter(Boolean).map(metadata),activeId);return true;});
  handle('export-notes',async (id,notes,format,value) => {
    const r=documentById(id);if(!Array.isArray(notes)||notes.length>100000)throw new Error('批注数据无效。');
    const safe=normalizeNotes(notes);
    const text=format==='docx'?'':notesMarkdown(r,safe);
    const ext=format==='docx'?'.docx':'.md';let bytes=Buffer.from(text);
    if(format==='docx'){const result=await runOffline({bytes:pdfBytes(value),request:{action:'notes-export',notes:safe},packaged:app.isPackaged,resources:process.resourcesPath});bytes=result.files[0].bytes;}
    if(smoke)return {bytes};
    const selected=await dialog.showSaveDialog(window,{title:T('导出批注摘录'),defaultPath:path.parse(r.name).name+'-批注'+ext,filters:[{name:ext.slice(1),extensions:[ext.slice(1)]}]});if(selected.canceled)return {canceled:true};
    const target=selected.filePath.toLowerCase().endsWith(ext)?selected.filePath:selected.filePath+ext;await atomicWrite(target,bytes,await fingerprint(target));return {path:target};
  });
  handle('title-bar-theme', dark => { if (process.platform !== 'darwin' && !drawnCaption && typeof window.setTitleBarOverlay === 'function') { try { window.setTitleBarOverlay(titleBar(!!dark)); } catch {} } return true; });
  handle('window-state', () => ({ maximized: window.isMaximized(), fullscreen: window.isFullScreen(), focused: window.isFocused() }));
  // Window style (0.9.2): saved choice, drawn caption buttons, restart to apply.
  handle('set-window-style', async value => {
    if (!value || typeof value !== 'object') throw new Error('界面风格参数无效。');
    preferences.windowStyle = normalizeWindowStyle(value); await persist();
    return preferences.windowStyle;
  });
  handle('window-control', action => {
    if (action === 'minimize') window.minimize();
    else if (action === 'maximize') { if (window.isMaximized()) window.unmaximize(); else window.maximize(); }
    else if (action === 'close') window.close();
    else throw new Error('未知的窗口操作。');
    return true;
  });
  handle('relaunch-on-close', value => { relaunchOnClose = !!value; return relaunchOnClose; });
  for (const [name, value] of [['maximize', true], ['unmaximize', false]]) window.on(name, () => command('window-maximized', value));
  for (const [name, value] of [['focus', true], ['blur', false]]) window.on(name, () => command('window-focus', value));
  // On Windows the transition events fire before isFullScreen() flips, so the
  // state must be taken from the event itself, not queried. (Found by the 0.8.0 build smoke test.)
  for (const [name, fullscreen] of [['enter-full-screen', true], ['leave-full-screen', false]]) window.on(name, () => command('fullscreen-changed', fullscreen));
  handle('fullscreen', () => { window.setFullScreen(!window.isFullScreen()); return window.isFullScreen(); });
  handle('exit-fullscreen', () => { if (window.isFullScreen()) window.setFullScreen(false); });
  handle('pick-asset', async kind => {
    const filters = kind === 'import' ? [{name:T('可转换文件'),extensions:['docx','xlsx','pptx','txt','html','htm','epub','xps','cbz','svg','png','jpg','jpeg','tif','tiff','bmp','webp']}] : [{name:T('图片'),extensions:['png','jpg','jpeg','bmp','webp']}];
    const result = await dialog.showOpenDialog(window,{title:kind==='import'?'导入并转换为 PDF':'选择图片印章',filters,properties:['openFile']});
    if(result.canceled) return null;
    const file=await fs.realpath(result.filePaths[0]);
    if(!filters[0].extensions.includes(path.extname(file).slice(1).toLowerCase())) throw new Error('文件类型不支持。');
    const token=randomUUID(); assetTokens.set(token,{path:file,kind});
    let dims=null;
    if(kind==='image'){
      const handle=await fs.open(file,'r');const header=Buffer.alloc(131072);
      try { const {bytesRead}=await handle.read(header,0,header.length,0); dims=imageDimensions(header.subarray(0,bytesRead)); }
      finally { await handle.close(); }
    }
    return {token,name:path.basename(file),...(dims?{width:dims.width,height:dims.height}:{})};
  });
  handle('stamp-library',async (action,value) => {
    preferences.stamps ||= [];
    if(action==='list')return preferences.stamps.map(s=>({id:s.id,name:s.name,kind:s.kind}));
    if(action==='remove'){const stamp=preferences.stamps.find(s=>s.id===value);preferences.stamps=preferences.stamps.filter(s=>s.id!==value);if(stamp?.file)await fs.rm(path.join(app.getPath('userData'),'stamps',stamp.file),{force:true});await persist();return true;}
    if(action==='load'){const stamp=preferences.stamps.find(s=>s.id===value);if(!stamp)throw new Error('印章不存在。');if(stamp.kind==='image'){const token=randomUUID();assetTokens.set(token,{path:path.join(app.getPath('userData'),'stamps',stamp.file),kind:'image'});return {kind:'image',asset:{token,name:stamp.name,...(stamp.width?{width:stamp.width,height:stamp.height}:{})}};}return {kind:'stamp',settings:stamp.settings};}
    if(action!=='add'||preferences.stamps.length>=100)throw new Error('印章库最多保存 100 项。');
    const id=randomUUID(),stamp={id,name:String(value.name||'常用印章').slice(0,60),kind:value.kind==='image'?'image':'stamp'};
    if(stamp.kind==='image'){const asset=assetTokens.get(value.assetToken);if(!asset||asset.kind!=='image')throw new Error('请先选择图片印章。');const folder=path.join(app.getPath('userData'),'stamps');await fs.mkdir(folder,{recursive:true});stamp.file=id+path.extname(asset.path);await fs.copyFile(asset.path,path.join(folder,stamp.file));if(Number(value.width)>0&&Number(value.height)>0){stamp.width=Math.round(value.width);stamp.height=Math.round(value.height);}}
    else stamp.settings={text:String(value.text||'').slice(0,1000),size:Math.max(6,Math.min(100,Number(value.size)||18)),color:/^#[\da-fA-F]{6}$/.test(value.color)?value.color:'#b91c1c',opacity:Math.max(.05,Math.min(1,Number(value.opacity)||1))};
    preferences.stamps.push(stamp);await persist();return {id,name:stamp.name,kind:stamp.kind};
  });
  handle('batch-folder',async () => {
    if(smoke||safety){const token=randomUUID(),folder=path.join(smokeRoot,'test-output','batch-'+token);await fs.mkdir(folder,{recursive:true});batchTokens.set(token,folder);return token;}
    const result=await dialog.showOpenDialog(window,{title:T('选择批量输出目录'),properties:['openDirectory','createDirectory']});
    if(result.canceled) return null;
    const token=randomUUID();batchTokens.set(token,result.filePaths[0]);return token;
  });
  handle('new-window',async id => {
    const record=documentById(id);
    if(!record.path) throw new Error('请先保存文档，再在新窗口中打开。');
    const executable = app.isPackaged ? (process.env.PORTABLE_EXECUTABLE_FILE || process.execPath) : process.execPath;
    const args = [...(app.isPackaged?[]:[app.getAppPath()]),'--new-window',record.path];
    await new Promise((resolve,reject) => { const child=spawn(executable,args,{detached:true,windowsHide:true,stdio:'ignore'});child.once('error',reject);child.once('spawn',()=>{child.unref();resolve();}); });
    return true;
  });
  handle('cancel-job',id=>{if(typeof id!=='string'||!/^[\da-f-]{36}$/i.test(id))throw new Error('任务编号无效。');if(runningJobs.has(id))runningJobs.get(id).abort();else{canceledJobs.add(id);setTimeout(()=>canceledJobs.delete(id),30000);}return true;});
  handle('tools-job',async (id,value,request) => {
    let record;
    const assets=[],inputs=[];
    if(request?.action==='import') {
      const asset=assetTokens.get(request.assetToken);
      if(!asset || asset.kind!=='import') throw new Error('请先选择导入文件。');
      value=await fs.readFile(asset.path); record={name:path.basename(asset.path),path:asset.path};
    } else record=documentById(id);
    if(value?.byteLength>512*1024*1024) throw new Error('单文件处理目前支持最大 512 MB。');
    if(request?.action==='image') {
      const asset=assetTokens.get(request.assetToken);
      if(!asset || asset.kind!=='image') throw new Error('请先选择印章图片。');
      assets.push({name:path.basename(asset.path),bytes:await fs.readFile(asset.path)});
    }
    for(const item of request?.mergeInputs || []) { documentById(item.id); inputs.push(pdfBytes(item.bytes)); }
    const safe={...request}; delete safe.mergeInputs;
    const jobId=typeof request.jobId==='string'?request.jobId.slice(0,80):randomUUID();if(runningJobs.has(jobId))throw new Error('任务编号重复。');const controller=new AbortController();runningJobs.set(jobId,controller);if(canceledJobs.delete(jobId))controller.abort();
    try {
    const result=await runOffline({bytes:value,request:safe,packaged:app.isPackaged,resources:process.resourcesPath,assets,inputs,inputName:record.name,signal:controller.signal,onProgress:data=>window.webContents.send('job-progress',jobId,data)});
    if(controller.signal.aborted) throw new Error('任务已取消。');
    if(request.action==='inspect') return {data:result.data,note:result.note};
    if(result.unchanged)return {unchanged:true,note:result.note};
    const output=result.files[0]; if(!output) throw new Error('处理未生成文件。');
    if(request.draft){
      if(!['organize','outline','text','stamp','image','watermark','shape','annotation','crop','sharpen','ocr-layer'].includes(request.action)||path.extname(output.name)!=='.pdf')throw new Error('此操作不支持文档草稿。');
      return {bytes:output.bytes,note:result.note};
    }
    // Integration tests exercise IPC and actual engine output without native picker interaction.
    if(smoke&&!request.batchToken&&!process.argv.includes('--fix013-smoke')) return {bytes:output.bytes,extension:path.extname(output.name),note:result.note};
    const extension=path.extname(output.name);
    let target;
    if(request.batchToken) {
      const folder=batchTokens.get(request.batchToken);if(!folder) throw new Error('批量目录授权已失效。');
      const stem=path.parse(record.name).name.replace(/[<>:"/\\|?*\x00-\x1f]/g,'_');
      target=path.join(folder,stem+'-'+request.action+extension);
      let suffix=2;while(await fingerprint(target))target=path.join(folder,stem+'-'+request.action+' ('+(suffix++)+')'+extension);
    } else {
      const selected=await waitForAbort(dialog.showSaveDialog(window,{title:T('导出处理结果'),defaultPath:path.join(record.path?path.dirname(record.path):app.getPath('documents'),path.parse(record.name).name+'-'+request.action+extension),filters:[{name:extension.slice(1).toUpperCase(),extensions:[extension.slice(1)]}]}),controller.signal);
      if(selected.canceled) return {canceled:true};
      target=selected.filePath;if(path.extname(target).toLowerCase()!==extension) target+=extension;
      if([...documents.values()].some(d=>d.path && key(d.path)===key(target))) throw new Error('输出不能覆盖正在打开的文档，请使用新的文件名。');
    }
    const hash=request.batchToken?null:await fingerprint(target);
    if(controller.signal.aborted) throw new Error('任务已取消。');
    await atomicWrite(target,output.bytes,hash);
    return {path:target,note:result.note,opened:extension==='.pdf' && request.action!=='encrypt' && !request.batchToken ? await openFiles([target]):[]};
    } finally { runningJobs.delete(jobId); }
  });
  handle('recent', () => preferences.recent.map(item => {
    let token = [...recentTokens].find(([, file]) => file === item.path)?.[0];
    if (!token) { token = randomUUID(); recentTokens.set(token, item.path); }
    return { id: token, name: item.name, path: item.path, opened: Number(item.opened) || 0, page: item.state?.kind === 'markdown' ? 0 : Number(item.state?.page) || 0 };
  }));
  // Home page: remove one entry from the recent list (the file itself is untouched).
  handle('recent-remove', async id => { const file = recentTokens.get(id); if (!file) return false; preferences.recent = preferences.recent.filter(r => key(r.path) !== key(file)); recentTokens.delete(id); await persist(); return true; });
  handle('open-recent', id => { const file = recentTokens.get(id); if (!file) throw new Error('最近文件不存在。'); return openFiles([file]); });
  handle('example', async () => {
    // The home page opens the illustrated feature guide (ui/sample-guide.pdf, built by
    // scripts/sample-guide/build.py). Automated smoke runs keep the small two-page fixture
    // their assertions were written against.
    const guide = smoke || safety || benchmark ? null : await fs.readFile(path.join(__dirname, 'ui', isMac ? 'sample-guide-mac.pdf' : 'sample-guide.pdf')).catch(() => fs.readFile(path.join(__dirname, 'ui', 'sample-guide.pdf'))).catch(() => null);
    const record = { id: randomUUID(), name: guide ? '青页 PDF 使用示例.pdf' : '青页 PDF · 使用示例.pdf', path: null, hash: null, state: {} };
    documents.set(record.id, record);
    return [{ ...metadata(record), bytes: guide ? new Uint8Array(guide) : samplePdf() }];
  });
  handle('save', async (id, value, saveAs, embedFonts, password) => {
    const record = documentById(id);
    if (record.kind === 'markdown') throw new Error('Markdown 文档请使用 Markdown 保存。');
    if (record.saving) throw new Error('文档正在保存。');
    record.saving = true;
    try {
      let bytes = pdfBytes(value);
      if(embedFonts===true){const normalized=await runOffline({bytes,request:{action:'normalize-annotations',password:typeof password==='string'?password:''},packaged:app.isPackaged,resources:process.resourcesPath});if(!normalized.unchanged)bytes=normalized.files[0].bytes;}
      let target = record.path, expected = record.hash;
      if (saveAs || !target) {
        const result = await dialog.showSaveDialog(window, { title: T('另存为 PDF'), defaultPath: target || record.name, filters: [{ name: T('PDF 文档'), extensions: ['pdf'] }] });
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
      // Reading history failure must not turn a successful PDF write into a reported failure.
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
  // ——— 0.11.0: library search across the recent list, and reference details ———
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
    const selected = await dialog.showSaveDialog(window, { title: T('导出'), defaultPath: path.join(app.getPath('documents'), base), filters: [{ name: ext.slice(1).toUpperCase(), extensions: [ext.slice(1)] }] });
    if (selected.canceled) return { canceled: true };
    const target = selected.filePath.toLowerCase().endsWith(ext) ? selected.filePath : selected.filePath + ext;
    if ([...documents.values()].some(d => d.path && key(d.path) === key(target))) throw new Error('输出不能覆盖正在打开的文档，请使用新的文件名。');
    await atomicWrite(target, Buffer.from(text, 'utf8'), await fingerprint(target)); return { path: target };
  });
  handle('notes-markdown', (id,notes) => {const record=documentById(id);if(record.kind==='markdown')throw new Error('请选择 PDF 批注。');return newMarkdown(path.parse(record.name).name+'-批注笔记.md',notesMarkdown(record,notes)).map(info=>({...info,unsaved:true}));});
  handle('markdown-example', async () => newMarkdown('Markdown 示例.md', await fs.readFile(path.join(__dirname, 'ui', 'markdown', 'sample.md'), 'utf8')));
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
        const result = await dialog.showSaveDialog(window, { title: T('另存为 Markdown'), defaultPath: target || path.join(app.getPath('documents'), record.name), filters: [{ name: T('Markdown 文档'), extensions: ['md', 'markdown'] }, { name: T('所有文件'), extensions: ['*'] }] });
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
      watchMarkdown(record); remember(record); mdCtx?.snapshotOnSave?.(record, text);
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
  handle('markdown-asset', async (id, source) => { const record = documentById(id); return markdownFiles.readAsset(record.path, source); });
  handle('markdown-open-link', async (id, href) => {
    const record = documentById(id), value = String(href || '').trim();
    if (/^(https?:|mailto:)/i.test(value)) { await shell.openExternal(value); return { external: true }; }
    if (value.startsWith('#')) return { anchor: decodeURIComponent(value.slice(1)) };
    const resolved = markdownFiles.resolveLocal(record.path, value);
    if (!resolved) throw new Error(record.path ? '无法解析此链接。' : '请先保存文档，再打开相对路径链接。');
    if (key(resolved.file) === key(record.path || '')) return { anchor: resolved.fragment };
    if (!(await fs.stat(resolved.file).catch(() => null))?.isFile()) throw new Error('链接指向的文件不存在：' + resolved.file);
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
    const paths = [];
    for (const file of files) if (typeof file === 'string' && markdownFiles.IMAGE_TYPES[path.extname(file).toLowerCase()] && (await fs.stat(file).catch(() => null))?.isFile()) paths.push(markdownFiles.markdownPath(record.path, file));
    return paths;
  });
  const mdIpc = require('./markdown-ipc.cjs'); const mdCtx = { handle, getWindow: () => window, dialog, shell, app, BrowserWindow, documents, documentById, openFiles, atomicWrite, fingerprint, digest, preferences, persist, watchMarkdown, key, command };
  mdIpc.register(mdCtx);
  converterLifecycle = require('./converter-ipc.cjs').register(mdCtx);
  require('./ai-ipc.cjs').register({ ...mdCtx, session, safeStorage, ipcMain, testMode: smoke || safety || benchmark });
  handle('edit-command', command => { if (!['cut', 'copy', 'paste', 'selectAll', 'pasteAndMatchStyle', 'undo', 'redo'].includes(command)) throw new Error('不支持的编辑命令。'); window.webContents[command](); return true; });
  window.on('focus', () => { for (const record of documents.values()) checkMarkdown(record, true).catch(() => {}); });
  handle('close-choice', async name => {
    const result = await dialog.showMessageBox(window, { type: 'question', title: T('保存修改'), message: TF('“{name}”有未保存的修改。', { name: String(name).slice(0, 200) }), buttons: [T('保存'), T('不保存'), T('取消')], defaultId: 0, cancelId: 2, noLink: true });
    return ['save', 'discard', 'cancel'][result.response];
  });
  handle('confirm-discard-edit',async name=>{const result=await dialog.showMessageBox(window,{type:'question',title:T('未应用的页面编辑'),message:name?TF('“{name}”的页面编辑尚未应用。是否放弃并继续？',{name:String(name).slice(0,200)}):T('当前页面编辑尚未应用。是否放弃并继续？'),buttons:[T('继续编辑'),T('放弃未应用内容')],defaultId:0,cancelId:0,noLink:true});return result.response===1;});
  handle('remember', async (id, state) => {const record=documents.get(id);if(record){remember(record, state); await persist();} });
  handle('close-document', async (id, state) => { const record = documentById(id); if (record.saving) throw new Error('正在保存，请稍后关闭。'); remember(record, state); unwatchMarkdown(id);closedDocuments.set(id,record); documents.delete(id);await recovery.checkpoint(recovery.entries.filter(e=>e.id!==id),null); await persist().catch(error => console.warn('Reading state:', error.message)); });
  ipcMain.on('finish-close', async event => { if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || finishingClose) return; finishingClose = true; await converterLifecycle?.shutdown(); await preferenceQueue.catch(() => {}); allowClose = true;
    // "Restart now" in Settings → Interface style. The portable exe runs from a temporary folder, so
    // restart the portable launcher instead; --qingye-relaunch restores the tabs that were just closed.
    if (relaunchOnClose && !smoke && !safety && !benchmark) { const portable = process.env.PORTABLE_EXECUTABLE_FILE; app.relaunch(portable ? { execPath: portable, args: ['--qingye-relaunch'] } : { args: [...(app.isPackaged ? [] : [app.getAppPath()]), '--qingye-relaunch'] }); }
    window.close(); });
  // Read synchronously by preload.cjs so the first frame already has the right style.
  ipcMain.on('window-style-sync', event => {
    if (event.sender !== window?.webContents) { event.returnValue = null; return; }
    event.returnValue = { style: windowStyle.style, drawnCaption, vibrancy: windowAcrylic, acrylicSupported, relaunched, saved: preferences.windowStyle || windowStyle };
  });
  ipcMain.on('ready', async event => {
    if (event.sender !== window.webContents || event.senderFrame !== window.webContents.mainFrame || rendererReady) return;
    rendererReady = true;
    console.log('Startup ready (ms):',Math.round(performance.now()-bootStarted));
    if(benchmark){await loadComplete;await fs.mkdir(path.join(smokeRoot,'test-output'),{recursive:true});await fs.writeFile(path.join(smokeRoot,'test-output','startup-timing.json'),JSON.stringify({mainReadyMs:Math.round(performance.now()-bootStarted),version:app.getVersion(),cachedRuntime:process.execPath,runId:diagnostics.runId}));diagnostics.success();allowClose=true;app.quit();return;}
    if (smoke) {
      if(process.argv.includes('--fix013-smoke')){try{await require('./test/fixes013-smoke.cjs').run({window,app,dialog,openFiles,samplePdf,output:path.join(smokeRoot,'test-output/fixes013')});diagnostics.success();app.exit(0);}catch(error){fail('fixes013',error);}return;}
      if(process.argv.includes('--links-smoke')){try{await require('./test/links011-smoke.cjs').run({window,app,dialog,openFiles,samplePdf,output:path.join(smokeRoot,'test-output/links011')});diagnostics.success();app.exit(0);}catch(error){fail('links011',error);}return;}
      if(process.argv.includes('--notes-smoke')){try{await require('./test/notes010-smoke.cjs').run({window,app,dialog,openFiles,samplePdf,output:path.join(smokeRoot,'test-output/notes010')});diagnostics.success();app.exit(0);}catch(error){fail('notes010',error);}return;}
      if(process.argv.includes('--features-smoke')){try{await require('./test/features094-smoke.cjs').run({window,app,dialog,openFiles,samplePdf,output:path.join(smokeRoot,'test-output/features094')});diagnostics.success();app.exit(0);}catch(error){fail('features094',error);}return;}
      if (process.argv.includes('--fix-smoke') || process.argv.includes('--fix-close-smoke')) {
        const close = process.argv.includes('--fix-close-smoke');
        try { await require(close ? './test/fix-close093-smoke.cjs' : './test/fix093-smoke.cjs').run({ window, app, dialog, diagnostics, openFiles, samplePdf, output: path.join(smokeRoot, close ? 'test-output/fix-close' : 'test-output/fixes') }); if (!close) { diagnostics.success(); app.exit(0); } }
        catch (error) { fail('fixes093', error); }
        return;
      }
      if (process.argv.includes('--basic-smoke')) {
        try { await require('./test/basic093-smoke.cjs').run({ window, app, dialog, openFiles, samplePdf, output: path.join(smokeRoot, 'test-output/basic093') }); diagnostics.success(); app.exit(0); }
        catch (error) { fail('basic093', error); }
        return;
      }
      if (process.argv.includes('--conversion-smoke')) {
        try { await require('./test/conversion-smoke.cjs').run({ window, app, dialog, documents, diagnostics, output: path.join(smokeRoot, 'test-output/conversion') }); app.exit(0); }
        catch (error) { fail('conversion-integration', error); }
        return;
      }
      try { diagnostics.stage('integration');if(process.argv.includes('--markdown-smoke')){const output=path.join(smokeRoot,'test-output');const result=await require('./test/markdown-smoke.cjs').run({window,openFiles,documents,app,output,recoveryFolder:recovery.folder});await fs.writeFile(path.join(output,'markdown-result.json'),JSON.stringify({...result,runId:diagnostics.runId},null,2));diagnostics.success();app.exit(0);return;}if(process.argv.includes('--edit-smoke')){const output=path.join(smokeRoot,'test-output');const result=await require('./test/editing-smoke.cjs').run(window,output);await fs.writeFile(path.join(output,'editing-result.json'),JSON.stringify({...result,runId:diagnostics.runId},null,2));diagnostics.success();app.exit(0);return;}await require('./test/smoke.cjs').run({ window, openFiles, documents, samplePdf, atomicWrite, app, recovery, diagnostics }); }
      catch (error) { fail('integration',error); }
    } else if (safety) {
      try { diagnostics.stage('safety'); await require('./test/safety-smoke.cjs').run({ window, openFiles, documents, samplePdf, app, recovery, diagnostics, role: safetyRole }); }
      catch (error) { fail('safety',error); }
    } else {
      if (firstRun) { await persist(); command('first-run'); }
      if (pendingFiles.length) command('opened', await openFiles(pendingFiles));
      pendingFiles = [];
      if(firstRunTest){await new Promise(resolve=>setTimeout(resolve,150));const displayed=await window.webContents.executeJavaScript("document.getElementById('messageDialog').open&&document.getElementById('messageTitle').textContent.includes('首次启动')");await fs.mkdir(path.join(smokeRoot,'test-output'),{recursive:true});await fs.writeFile(path.join(smokeRoot,'test-output','first-run-result.json'),JSON.stringify({firstRun,displayed,version:app.getVersion()}));app.exit(0);}
    }
  });
  loadComplete=window.loadURL('qingye://app/ui/index.html');await loadComplete;
}).catch(error => fail('startup',error));
app.on('window-all-closed', () => app.quit());
app.on('before-quit', event => {
  if (!converterLifecycle?.busy) return;
  event.preventDefault();
  converterLifecycle.shutdown().then(() => app.quit()).catch(error => fail('conversion-shutdown', error));
});
