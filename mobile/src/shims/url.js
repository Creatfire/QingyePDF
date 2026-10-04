export function fileURLToPath(value) { const url = new URL(String(value)); if (url.protocol !== 'file:') throw new TypeError('The URL must be of scheme file'); return decodeURIComponent(url.pathname); }
export function pathToFileURL(path) { return new URL('file://' + String(path).split('/').map(part => encodeURIComponent(part)).join('/')); }
export const URL = globalThis.URL, URLSearchParams = globalThis.URLSearchParams;
export default { fileURLToPath, pathToFileURL, URL, URLSearchParams };
