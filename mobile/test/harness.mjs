// Serves mobile/www and drives it with a phone-sized Chromium (the in-memory storage backend
// stands in for the device).
import http from 'node:http';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright-core';

export const mobileRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const www = path.join(mobileRoot, 'www');
const mime = { '.html': 'text/html; charset=utf-8', '.mjs': 'text/javascript', '.js': 'text/javascript', '.css': 'text/css', '.json': 'application/json', '.ftl': 'text/plain', '.svg': 'image/svg+xml', '.png': 'image/png', '.wasm': 'application/wasm', '.pdf': 'application/pdf', '.ttf': 'font/ttf', '.woff': 'font/woff', '.woff2': 'font/woff2', '.md': 'text/markdown; charset=utf-8', '.traineddata': 'application/octet-stream' };
// A tiny OpenAI-compatible endpoint: lists one model and streams a fixed chat completion.
function fakeModelApi(req, res) {
  const url = new URL(req.url, 'http://x');
  if (url.pathname === '/__ai/v1/models') { res.writeHead(200, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*' }).end(JSON.stringify({ data: [{ id: 'qingye-test-model' }] })); return true; }
  if (url.pathname === '/__ai/v1/chat/completions') {
    if (req.method === 'OPTIONS') { res.writeHead(204, { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': '*' }).end(); return true; }
    res.writeHead(200, { 'Content-Type': 'text/event-stream', 'Access-Control-Allow-Origin': '*' });
    const parts = ['你好', '，这是', '流式', '回答。'];
    let index = 0; const timer = setInterval(() => { if (index < parts.length) res.write(`data: ${JSON.stringify({ choices: [{ delta: { content: parts[index++] } }] })}\n\n`); else { clearInterval(timer); res.end('data: [DONE]\n\n'); } }, 30);
    return true;
  }
  return false;
}
export async function serve() {
  const server = http.createServer(async (req, res) => {
    if (fakeModelApi(req, res)) return;
    const file = path.join(www, decodeURIComponent(new URL(req.url, 'http://x').pathname));
    if (!file.startsWith(www)) { res.writeHead(403).end(); return; }
    try { const body = await fs.readFile(file); res.writeHead(200, { 'Content-Type': mime[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store' }).end(body); }
    catch { res.writeHead(404).end('Not found'); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${server.address().port}/`, close: () => new Promise(resolve => server.close(resolve)) };
}
export async function launch({ width = 390, height = 844, locale = 'zh-CN', native = false, prepare } = {}) {
  const site = await serve();
  const executablePath = process.env.CHROMIUM_PATH || (await fs.stat('/opt/pw-browsers/chromium').then(() => '/opt/pw-browsers/chromium', () => undefined));
  const browser = await chromium.launch({ executablePath, args: ['--no-sandbox'] });
  const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 2, isMobile: true, hasTouch: true, locale, userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Mobile Safari/537.36' });
  // native: the page talks to a JavaScript stand-in for the Android plugin through Capacitor's
  // real native-bridge.js, so the same code path as on a device is exercised.
  if (native) { await context.addInitScript({ path: path.join(mobileRoot, 'test/native-fake.js') }); await context.addInitScript({ path: path.join(mobileRoot, 'node_modules/@capacitor/android/capacitor/src/main/assets/native-bridge.js') }); if (prepare) await context.addInitScript(prepare); }
  const page = await context.newPage();
  // Like Capacitor's local server on the device: /_capacitor_file_/<path> serves a device file.
  if (native) await page.route('**/_capacitor_file_/**', async route => {
    const file = decodeURIComponent(new URL(route.request().url()).pathname.slice('/_capacitor_file_'.length));
    const b64 = await page.evaluate(file => { const bytes = window.fakeNative.get(file); if (!bytes || !(window.fakeNative.state.granted || file.startsWith('/data/') || file.startsWith('/sandbox'))) return null; let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s); }, file).catch(() => null);
    if (b64 === null) await route.fulfill({ status: 404, body: 'Not found' }); else await route.fulfill({ status: 200, contentType: 'application/octet-stream', body: Buffer.from(b64, 'base64') });
  });
  const errors = [];
  page.on('pageerror', error => errors.push('pageerror: ' + error.message));
  page.on('console', message => { if (message.type() === 'error') errors.push('console: ' + message.text()); });
  await page.goto(site.url + 'ui/index.html');
  await page.waitForFunction(() => !!window.qingye, null, { timeout: 30000 });
  return { page, errors, browser, url: site.url, async close() { await browser.close(); await site.close(); } };
}
