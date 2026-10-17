// The application window and everything that belongs to the shell around the page: the native text
// context menu, the application menu, the custom title bar (Windows / MacOS interface styles) and
// the window controls the renderer drives.
'use strict';
const path = require('node:path');
const { app, BrowserWindow, Menu, dialog, shell, ipcMain } = require('electron');

/**
 * @param ctx T, command, fail, preferences, persist, normalizeWindowStyle, style (applied at
 *   startup), isMac, acrylicSupported, offscreen, showOnReady, relaunched, canClose.
 */
function createWindowShell(ctx) {
  const { T, command, fail, preferences, persist, normalizeWindowStyle, isMac, offscreen, acrylicSupported, relaunched, canClose } = ctx;
  let style = ctx.style;
  let window, relaunchOnClose = false;
  const drawnCaption = () => style.style === 'macos' && process.platform !== 'darwin';
  const acrylic = () => drawnCaption() && style.vibrancy && acrylicSupported;
  // Windows keeps native caption buttons (snap layouts, accessibility) through the themed title bar
  // overlay. In the MacOS style the renderer draws the traffic lights itself (no overlay), and with
  // "window vibrancy" the page background is transparent over Windows 11 acrylic.
  const titleBar = dark => ({ color: dark ? '#0e1512' : '#eef3f0', symbolColor: dark ? '#cfe0d6' : '#2a3a33', height: 40 });
  const send = action => () => command(action);

  function create() {
    window = new BrowserWindow({ width: 1360, height: 940, minWidth: 920, minHeight: 640, show: false, title: T('青页 PDF'), icon: path.join(__dirname, 'ui', 'icon.png'), backgroundColor: acrylic() ? '#00000000' : drawnCaption() ? '#ececef' : '#eef3f0',
      titleBarStyle: 'hidden', ...(process.platform === 'darwin' ? { trafficLightPosition: { x: 14, y: 12 } } : drawnCaption() ? {} : { titleBarOverlay: titleBar(false) }), ...(acrylic() ? { backgroundMaterial: 'acrylic' } : {}), autoHideMenuBar: true, webPreferences: { preload: path.join(__dirname, 'preload.cjs'), nodeIntegration: false, contextIsolation: true, sandbox: true, spellcheck: true, offscreen } });
    window.webContents.setWindowOpenHandler(({ url }) => { if (/^https?:\/\//i.test(url)) shell.openExternal(url); return { action: 'deny' }; });
    window.webContents.on('will-navigate', event => event.preventDefault());
    window.webContents.on('context-menu', async (_event, params) => {
      if (!params.isEditable || !params.frame) return;
      // Markdown supplies its own menu (including spelling suggestions); do not cover it
      // with the generic native text menu when Chromium emits the spelling event.
      // The renderer opens #mdContextMenu synchronously in its own contextmenu handler, so by the time this
      // event arrives the Markdown menu is visible (or focus is inside a Markdown panel).
      if (params.frame === window.webContents.mainFrame && await params.frame.executeJavaScript(`(()=>{const hit=document.elementFromPoint(${Number(params.x) || 0},${Number(params.y) || 0});return !!hit?.closest?.('.mdPanel');})()`).catch(() => false)) return;
      const flags = params.editFlags || {};
      Menu.buildFromTemplate([
        { id: 'text-undo', label: T('撤销'), role: 'undo', enabled: flags.canUndo }, { id: 'text-redo', label: T('重做'), role: 'redo', enabled: flags.canRedo }, { type: 'separator' },
        { id: 'text-cut', label: T('剪切'), role: 'cut', enabled: flags.canCut }, { id: 'text-copy', label: T('复制'), role: 'copy', enabled: flags.canCopy }, { id: 'text-paste', label: T('粘贴'), role: 'paste', enabled: flags.canPaste }, { type: 'separator' },
        { id: 'text-select-all', label: T('全选'), role: 'selectAll', enabled: flags.canSelectAll },
      ]).popup({ window, frame: params.frame });
    });
    window.webContents.on('render-process-gone', (_event, details) => fail('render-process-gone', new Error('Reader process exited: ' + details.reason), details));
    window.webContents.on('did-fail-load', (_event, code, description, url, isMainFrame) => { if (isMainFrame && code !== -3) fail('page-load', new Error(description), { code, url }); });
    window.on('close', event => { if (!canClose()) { event.preventDefault(); command('close-app'); } });
    window.once('ready-to-show', () => { if (ctx.showOnReady) window.show(); });
    for (const [name, value] of [['maximize', true], ['unmaximize', false]]) window.on(name, () => command('window-maximized', value));
    for (const [name, value] of [['focus', true], ['blur', false]]) window.on(name, () => command('window-focus', value));
    // On Windows the transition events fire before isFullScreen() flips, so the
    // state must be taken from the event itself, not queried. (Found by the 0.8.0 build smoke test.)
    for (const [name, fullscreen] of [['enter-full-screen', true], ['leave-full-screen', false]]) window.on(name, () => command('fullscreen-changed', fullscreen));
    return window;
  }
  const about = async () => dialog.showMessageBox(window, { type: 'info', icon: path.join(__dirname, 'ui', 'icon.png'), title: T('青页 PDF'), message: T('青页 PDF ') + app.getVersion(), detail: T('开源 · 本地阅读 · 无会员\n多标签、搜索、目录、高亮、文本、墨迹与签名。\n阅读引擎：Mozilla PDF.js 6.3.289。\n本版本按 AGPL-3.0 开源。') });
  // Command on a Mac, Ctrl elsewhere. Tab switching keeps the Control key on every platform
  // (Command+Tab is the system's application switcher).
  function rebuildMenu() {
    Menu.setApplicationMenu(Menu.buildFromTemplate([
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
  }
  function register(handle) {
    handle('title-bar-theme', dark => { if (process.platform !== 'darwin' && !drawnCaption() && typeof window.setTitleBarOverlay === 'function') { try { window.setTitleBarOverlay(titleBar(!!dark)); } catch {} } return true; });
    handle('window-state', () => ({ maximized: window.isMaximized(), fullscreen: window.isFullScreen(), focused: window.isFocused() }));
    // Window style (0.9.2): saved choice, drawn caption buttons, restart to apply.
    // The window frame cannot change while it is open, so `style` keeps the applied value and only
    // the saved preference is updated here; preload reads the applied one (window-style-sync below).
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
    handle('fullscreen', () => { window.setFullScreen(!window.isFullScreen()); return window.isFullScreen(); });
    handle('exit-fullscreen', () => { if (window.isFullScreen()) window.setFullScreen(false); });
    handle('edit-command', command => { if (!['cut', 'copy', 'paste', 'selectAll', 'pasteAndMatchStyle', 'undo', 'redo'].includes(command)) throw new Error('不支持的编辑命令。'); window.webContents[command](); return true; });
    // Read synchronously by preload.cjs so the first frame already has the right style.
    ipcMain.on('window-style-sync', event => {
      if (event.sender !== window?.webContents) { event.returnValue = null; return; }
      event.returnValue = { style: style.style, drawnCaption: drawnCaption(), vibrancy: acrylic(), acrylicSupported, relaunched, saved: preferences.windowStyle || style };
    });
  }
  return { create, register, rebuildMenu, getWindow: () => window, relaunchRequested: () => relaunchOnClose };
}

module.exports = { createWindowShell };
