export const process = { platform: 'android', pid: 1, env: {}, argv: [], versions: {}, resourcesPath: '/__app', execPath: '', cwd: () => '/', kill() { const error = new Error('ESRCH'); error.code = 'ESRCH'; throw error; }, nextTick: (fn, ...args) => queueMicrotask(() => fn(...args)), on() {}, once() {}, off() {} };
export { Buffer } from 'buffer';
// Node timers are objects with unref(); browser timers are numbers. The shared modules call
// timer.unref() on long timeouts, which has no meaning in a WebView.
if (typeof Number.prototype.unref !== 'function') Object.defineProperty(Number.prototype, 'unref', { value() { return this; }, configurable: true, writable: true });
