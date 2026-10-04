// Stand-ins for the Electron objects the shared main-process modules receive through their
// context: app, shell, the window, BrowserWindow (used only to render HTML to PDF / PNG),
// safeStorage and the AI network session.
import { Buffer } from 'buffer';
import path from 'path';
import fs from '../shims/fs-promises.js';
import { paths } from '../shims/env.js';
import { isNative, Native, b64decode, b64encode } from '../shims/backend.js';
import { createHash, randomUUID } from '../shims/crypto.js';
import { sendToRenderer } from './ipc.js';
import { dialog, toast } from './dialogs.js';

const appListeners = new Map();
export const app = {
  isPackaged: true,
  getVersion: () => __APP_VERSION__,
  getPath(name) { return { userData: paths.userData, temp: paths.temp, documents: paths.documents, downloads: path.join(paths.storage, 'Download') }[name] || paths.userData; },
  getAppPath: () => '/__app',
  on(event, listener) { if (!appListeners.has(event)) appListeners.set(event, []); appListeners.get(event).push(listener); },
  emit(event) { for (const listener of appListeners.get(event) || []) { try { listener({ preventDefault() {} }); } catch (error) { console.warn(error); } } },
  exit() { if (isNative) Native.exitApp().catch(() => {}); },
};

async function uniqueIn(folder, name) {
  const parsed = path.parse(name); let candidate = path.join(folder, name), n = 2;
  while (await fs.stat(candidate).catch(() => null)) candidate = path.join(folder, `${parsed.name} (${n++})${parsed.ext}`);
  return candidate;
}
export const shell = {
  async openExternal(url) { if (!/^(https?:|mailto:)/i.test(String(url))) throw new Error('不支持的链接。'); if (isNative) await Native.openExternal({ url: String(url) }); else window.open(String(url), '_blank', 'noopener'); },
  showItemInFolder(file) { toast('文件位置：' + file, 5000); },
  async openPath(target) { toast('位置：' + target, 5000); return ''; },
  // Android has no system recycle bin: deleted files are kept in the app's own trash folder for 30 days.
  async trashItem(file) { await fs.mkdir(paths.trash, { recursive: true }); const target = await uniqueIn(paths.trash, path.basename(file)); await fs.rename(file, target).catch(async error => { if (error.code !== 'EXDEV') throw error; await fs.copyFile(file, target); await fs.rm(file); }); },
};
export async function purgeTrash(maxAgeMs = 30 * 86400000) {
  try { for (const name of await fs.readdir(paths.trash)) { const file = path.join(paths.trash, name), info = await fs.stat(file).catch(() => null); if (info && Date.now() - info.mtimeMs > maxAgeMs) await fs.rm(file, { recursive: true, force: true }); } } catch {}
}

// ——— the "window" ———
let fullscreen = false;
export const mainWindow = {
  isDestroyed: () => false, isMinimized: () => false, isMaximized: () => true, isFocused: () => document.hasFocus(), isFullScreen: () => fullscreen,
  setTitle() {}, setAlwaysOnTop() {}, isAlwaysOnTop: () => false, setTitleBarOverlay() {}, show() {}, focus() {},
  async setFullScreen(value) { fullscreen = !!value; if (isNative) await Native.setImmersive({ enabled: fullscreen }).catch(() => {}); sendToRenderer('command', 'fullscreen-changed', fullscreen); },
  close() { sendToRenderer('command', 'close-app'); },
  webContents: {
    send: (channel, ...args) => sendToRenderer(channel, ...args),
    on() {}, isDestroyed: () => false,
    replaceMisspelling() {}, session: { addWordToSpellCheckerDictionary: () => false },
    cut: () => document.execCommand('cut'), copy: () => document.execCommand('copy'), paste: () => document.execCommand('paste'), pasteAndMatchStyle: () => document.execCommand('paste'),
    selectAll: () => document.execCommand('selectAll'), undo: () => document.execCommand('undo'), redo: () => document.execCommand('redo'),
  },
};

// ——— HTML → PDF / PNG (markdown-ipc.cjs and the converter drive a hidden BrowserWindow) ———
const PAGE_SIZES = { A3: [297, 420], A4: [210, 297], A5: [148, 210], Letter: [215.9, 279.4], Legal: [215.9, 355.6], Tabloid: [279.4, 431.8] };
export class BrowserWindow {
  constructor(options = {}) {
    this.options = options; this.destroyed = false; this.html = ''; this.width = options.width || 900;
    const self = this;
    this.webContents = {
      session: { webRequest: { onBeforeRequest() {} } }, on() {}, setWindowOpenHandler() {},
      async printToPDF(print = {}) {
        if (!isNative) throw new Error('导出 PDF 需要在安卓设备上运行。');
        const size = PAGE_SIZES[print.pageSize] || PAGE_SIZES.A4, margins = print.margins || {};
        let result;
        try { result = await Native.htmlToPdf({ html: self.html, widthMm: print.landscape ? size[1] : size[0], heightMm: print.landscape ? size[0] : size[1], marginMm: Math.round((Number(margins.top) || 0) * 25.4), background: print.printBackground !== false, pageNumbers: !!print.displayHeaderFooter }); }
        catch (error) {
          // Some devices refuse direct PDF output; the system print dialog can still save a PDF.
          await Native.printHtml({ html: self.html, name: '青页 PDF' }).catch(() => { throw error; });
          throw new Error('这台设备不支持直接导出 PDF，已打开系统打印界面：请在打印机列表中选择“另存为 PDF”。');
        }
        try { return await fs.readFile(result.path); } finally { fs.rm(result.path, { force: true }).catch(() => {}); }
      },
      async executeJavaScript() { return 0; },
      async capturePage() {
        if (!isNative) throw new Error('导出图片需要在安卓设备上运行。');
        const result = await Native.htmlToPng({ html: self.html, width: self.width, scripts: !!self.options.webPreferences?.javascript });
        const bytes = await fs.readFile(result.path); fs.rm(result.path, { force: true }).catch(() => {});
        return { toPNG: () => bytes };
      },
    };
  }
  async loadFile(file) { this.html = await fs.readFile(file, 'utf8'); }
  setContentSize(width) { this.width = width; }
  isDestroyed() { return this.destroyed; }
  destroy() { this.destroyed = true; }
}

// ——— secrets ———
// API keys are stored in the app's private folder, encrypted with a key that the Android
// Keystore protects. Electron's safeStorage is synchronous, so the data key is fetched once at
// start and a SHA-256 counter keystream with an integrity tag is applied in JavaScript.
let dataKey = null;
export async function loadDataKey() { if (!isNative) return; try { dataKey = b64decode((await Native.dataKey()).key); } catch (error) { console.warn('Keystore:', error?.message || error); dataKey = null; } }
const sha = (...parts) => { const h = createHash('sha256'); for (const p of parts) h.update(p); return new Uint8Array(h.digest()); };
function keystream(nonce, length) { const out = new Uint8Array(length), counter = new Uint8Array(4); for (let block = 0, at = 0; at < length; block++, at += 32) { new DataView(counter.buffer).setUint32(0, block); out.set(sha(dataKey, nonce, counter).subarray(0, Math.min(32, length - at)), at); } return out; }
export const safeStorage = {
  isEncryptionAvailable: () => !!dataKey,
  encryptString(text) { const plain = new TextEncoder().encode(String(text)), nonce = globalThis.crypto.getRandomValues(new Uint8Array(16)), stream = keystream(nonce, plain.length), body = plain.map((b, i) => b ^ stream[i]), tag = sha(dataKey, nonce, body, new Uint8Array([1])).subarray(0, 16); return Buffer.concat([Buffer.from(nonce), Buffer.from(tag), Buffer.from(body)]); },
  decryptString(buffer) { const bytes = new Uint8Array(buffer), nonce = bytes.subarray(0, 16), tag = bytes.subarray(16, 32), body = bytes.subarray(32), expected = sha(dataKey, nonce, body, new Uint8Array([1])).subarray(0, 16); if (!dataKey || bytes.length < 32 || expected.some((b, i) => b !== tag[i])) throw new Error('无法解密。'); const stream = keystream(nonce, body.length); return new TextDecoder().decode(body.map((b, i) => b ^ stream[i])); },
};

// ——— network for AI requests ———
// The page itself may not talk to the network (CSP); AI requests run natively, without CORS
// limits, and stream back through plugin events.
const httpJobs = new Map();
let httpListening = false;
function listenHttp() {
  if (httpListening) return; httpListening = true;
  Native.addListener('http', event => {
    const job = httpJobs.get(event.id); if (!job) return;
    if (event.data) job.controller.enqueue(b64decode(event.data));
    if (event.error) { httpJobs.delete(event.id); try { job.controller.error(new TypeError(event.error)); } catch {} }
    else if (event.done) { httpJobs.delete(event.id); try { job.controller.close(); } catch {} }
  });
}
export async function nativeFetch(url, init = {}) {
  if (!isNative) return globalThis.fetch(url, init);
  listenHttp();
  const id = randomUUID(), signal = init.signal;
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
  let controller; const stream = new ReadableStream({ start(c) { controller = c; }, cancel() { httpJobs.delete(id); Native.httpCancel({ id }).catch(() => {}); } });
  httpJobs.set(id, { controller });
  const abort = () => { if (httpJobs.delete(id)) { try { controller.error(new DOMException('The operation was aborted.', 'AbortError')); } catch {} } Native.httpCancel({ id }).catch(() => {}); };
  signal?.addEventListener('abort', abort, { once: true });
  const headers = {}; new Headers(init.headers || {}).forEach((value, name) => { headers[name] = value; });
  let head;
  try { head = await Native.httpStart({ id, url: String(url), method: init.method || 'GET', headers, body: typeof init.body === 'string' ? init.body : init.body ? b64encode(new Uint8Array(init.body)) : '', bodyIsBase64: !!init.body && typeof init.body !== 'string' }); }
  catch (error) { httpJobs.delete(id); if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError'); throw new TypeError(error?.message || 'fetch failed'); }
  if (signal?.aborted) throw new DOMException('The operation was aborted.', 'AbortError');
  const nullBody = [101, 204, 205, 304].includes(head.status);
  return new Response(nullBody ? null : stream, { status: head.status, statusText: head.statusText || '', headers: head.headers || {} });
}
export const session = { fromPartition: () => ({ fetch: nativeFetch }), webRequest: { onBeforeRequest() {} }, addWordToSpellCheckerDictionary: () => false };
export { dialog };
