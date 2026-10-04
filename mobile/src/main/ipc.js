// In-process replacement for Electron IPC: the "main process" modules and the renderer share
// one WebView, so invoke() calls the registered handler directly.
const handlers = new Map(), listeners = new Map(), mainListeners = new Map();
let resolveReady; const ready = new Promise(resolve => { resolveReady = resolve; });
// Electron copies IPC arguments into the main process. Here the handlers share the page, but
// bytes produced inside the PDF viewer frame belong to that frame's realm and would fail
// `instanceof Uint8Array`; they are re-wrapped (not copied) as this realm's typed arrays.
const tag = value => Object.prototype.toString.call(value);
function localize(value, depth) {
  if (!value || typeof value !== 'object' || depth > 4) return value;
  if (ArrayBuffer.isView(value)) return value instanceof Uint8Array ? value : new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  if (tag(value) === '[object ArrayBuffer]') return new Uint8Array(value);
  if (Array.isArray(value)) return Array.from(value, item => localize(item, depth + 1));
  if (tag(value) === '[object Object]') { const out = {}; for (const key of Object.keys(value)) out[key] = localize(value[key], depth + 1); return out; }
  return value;
}
export const mainReady = () => resolveReady();
export function handle(channel, callback) { if (handlers.has(channel)) throw new Error('Duplicate handler: ' + channel); handlers.set(channel, callback); }
export async function invoke(channel, ...args) {
  await ready;
  const handler = handlers.get(channel);
  if (!handler) throw new Error(`安卓版暂不支持此操作（${channel}）。`);
  return handler(...args.map(arg => localize(arg, 0)));
}
// main → renderer
export function sendToRenderer(channel, ...args) { for (const listener of listeners.get(channel) || []) { try { listener({}, ...args); } catch (error) { console.error(error); } } }
export const ipcRenderer = {
  invoke,
  send(channel, ...args) { ready.then(() => { for (const listener of mainListeners.get(channel) || []) listener({}, ...args); }); },
  sendSync(channel) { const sync = syncHandlers.get(channel); return sync ? sync() : null; },
  on(channel, listener) { if (!listeners.has(channel)) listeners.set(channel, new Set()); listeners.get(channel).add(listener); return ipcRenderer; },
  removeListener(channel, listener) { listeners.get(channel)?.delete(listener); return ipcRenderer; },
};
const syncHandlers = new Map();
export const ipcMain = {
  handle,
  on(channel, listener) { if (!mainListeners.has(channel)) mainListeners.set(channel, new Set()); mainListeners.get(channel).add(listener); },
  onSync(channel, callback) { syncHandlers.set(channel, callback); },
};
export const hasHandler = channel => handlers.has(channel);
