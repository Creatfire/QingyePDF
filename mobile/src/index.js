// Entry of the Android bridge bundle. Loaded as a classic script before ui/app.mjs so that
// window.desktop exists when the shared interface starts.
import { ipcMain } from './main/ipc.js';
import { start } from './main/start.js';
import { installMobileUi } from './ui/mobile-ui.js';

ipcMain.onSync('window-style-sync', () => ({ style: 'windows', drawnCaption: false, vibrancy: false, acrylicSupported: false, relaunched: false, saved: { style: 'windows', vibrancy: false } }));
require('../../preload.cjs');
start().catch(error => { console.error(error); document.addEventListener('DOMContentLoaded', () => { const box = document.createElement('pre'); box.style.cssText = 'position:fixed;inset:0;z-index:99999;margin:0;padding:24px;background:#fff;color:#b00020;white-space:pre-wrap;font:14px/1.5 system-ui'; box.textContent = '青页 PDF 启动失败\n\n' + (error?.stack || error); document.body.append(box); }); });
installMobileUi();
// Plain-browser runs (development, automated tests) get access to the in-memory storage.
import { backend, isNative } from './shims/backend.js';
import { internals } from './main/start.js';
import { runOffline } from './main/offline.js';
if (!isNative) window.qingyeMobile = { backend, internals, runOffline };
