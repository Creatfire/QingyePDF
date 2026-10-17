// The qingye:// scheme that serves the window: ui/ and vendor/ only, with a strict CSP and the
// MIME types the bundled PDF.js / Markdown / diagram assets need.
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');

const MIME = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ftl': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.pdf': 'application/pdf', '.bcmap': 'application/octet-stream', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2' };
const CSP = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; connect-src 'self' blob: data:; object-src 'none'; base-uri 'none'";

/** Must run before the app is ready, so the renderer may use a standard, secure scheme. */
const registerSchemes = protocol => protocol.registerSchemesAsPrivileged([{ scheme: 'qingye', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true } }]);

/** Serves the window and locks the default session down: no permissions, no network at all. */
function installSession({ protocol, session, root }) {
  protocol.handle('qingye', async request => {
    const url = new URL(request.url);
    const file = path.resolve(root, '.' + decodeURIComponent(url.pathname));
    if (url.hostname !== 'app' || !file.startsWith(root + path.sep) || !['ui', 'vendor'].includes(path.relative(root, file).split(path.sep)[0])) return new Response('Forbidden', { status: 403 });
    try { return new Response(await fs.readFile(file), { headers: { 'Content-Type': MIME[path.extname(file)] || 'application/octet-stream', 'Content-Security-Policy': CSP } }); }
    catch { return new Response('Not found', { status: 404 }); }
  });
  session.defaultSession.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  session.defaultSession.setPermissionCheckHandler(() => false);
  session.defaultSession.webRequest.onBeforeRequest({ urls: ['http://*/*', 'https://*/*'] }, (_details, callback) => callback({ cancel: true }));
}

module.exports = { registerSchemes, installSession, CSP };
