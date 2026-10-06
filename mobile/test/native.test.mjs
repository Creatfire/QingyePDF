// The same app, but talking to a JavaScript stand-in for QingyeNativePlugin through Capacitor's
// real native-bridge.js. Covers what only exists on a device: storage permission, real paths,
// chunked writes, "open with", sharing, the back button, Keystore-backed secrets and streamed
// AI requests. The Java plugin itself is not executed here.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, mobileRoot } from './harness.mjs';

const DOCS = '/storage/emulated/0/Documents';
let app, page;
const guide = fs.readFileSync(path.join(mobileRoot, '../ui/sample-guide.pdf')).toString('base64');
const fake = (fn, arg) => page.evaluate(fn, arg);
const text = file => fake(file => { const b = window.fakeNative.get(file); return b ? new TextDecoder().decode(b) : null; }, file);

before(async () => {
  app = await launch({ native: true, prepare: `window.fakeNative.state.granted = false; window.fakeNative.put('${DOCS}/guide.pdf', Uint8Array.from(atob('${guide}'), c => c.charCodeAt(0))); window.fakeNative.put('${DOCS}/笔记 #1.md', new TextEncoder().encode('# 标题\\n\\n正文\\n'));` });
  page = app.page;
});
after(async () => { await app?.close(); });

test('first start asks for file access and switches to shared storage once granted', async () => {
  await page.waitForSelector('.qmMessage[open]');
  assert.match(await page.textContent('.qmMessage h2'), /访问手机上的文件/);
  await page.click('.qmMessage button.primary');
  await page.waitForSelector('.qmMessage', { state: 'detached' });
  assert.equal(await fake(() => window.fakeNative.state.granted), true);
  await page.click('#welcomeOpen'); await page.waitForSelector('.qmFiles[open]');
  assert.equal(await page.locator('.qmNotice:visible').count(), 0);
  assert.ok(await page.locator('.qmRow:has-text("guide.pdf")').count());
});

test('a PDF opens from device storage and saves back in place through chunked writes', async () => {
  await page.click('.qmRow:has-text("guide.pdf")'); await page.click('.qmFiles[open] .qmConfirm');
  await page.waitForFunction(() => [...window.qingye.sessions.values()].some(s => s.name === 'guide.pdf' && s.loaded), null, { timeout: 30000 });
  const result = await page.evaluate(async () => {
    const s = [...window.qingye.sessions.values()].find(s => s.name === 'guide.pdf'), before = window.fakeNative.get(s.path).length;
    const bytes = new Uint8Array(await s.app.pdfDocument.getData());
    const out = await window.desktop.toolsJob(s.id, bytes, { action: 'watermark', draft: true, pages: '', rect: [.2, .4, .8, .6], text: '内部资料', size: 28, opacity: .3 });
    await window.qingye.replaceDocument(s, out.bytes); window.qingye.syncDirty(s); await window.qingye.saveSession(s, false);
    const after = window.fakeNative.get(s.path);
    return { path: s.path, before, after: after.length, head: new TextDecoder().decode(after.subarray(0, 5)), leftovers: [...window.fakeNative.files.keys()].filter(p => p.includes('.qy-')), appends: window.fakeNative.state.calls.filter(c => c === 'write').length };
  });
  assert.equal(result.path, DOCS + '/guide.pdf'); assert.equal(result.head, '%PDF-');
  assert.ok(result.after > 1024 * 1024, 'large enough to need several chunks'); assert.ok(result.appends > 2);
  assert.deepEqual(result.leftovers, []);
});

test('0.13 saves Chinese FreeText with embedded fonts through the native adapter', async () => {
  const fixture = fs.readFileSync(path.join(mobileRoot, '../test/fixtures/cjk-freetext.pdf')).toString('base64');
  const result = await page.evaluate(async b64 => {
    const s = [...window.qingye.sessions.values()].find(s => s.name === 'guide.pdf');
    await window.desktop.save(s.id, Uint8Array.from(atob(b64), c => c.charCodeAt(0)), false, true);
    const bytes = window.fakeNative.get(s.path);
    const embedded = new TextDecoder('latin1').decode(bytes).includes('/FontFile2');
    const { getDocument } = await import('/vendor/pdfjs/build/pdf.mjs');
    const doc = await getDocument({ data: bytes.slice() }).promise;
    const annotations = await (await doc.getPage(1)).getAnnotations();
    const content = annotations.find(a => a.subtype === 'FreeText')?.contentsObj?.str;
    await doc.destroy();
    return { embedded, content };
  }, fixture);
  assert.deepEqual(result, { embedded: true, content: '中文文本框测试' });
});

test('"open with" from another app, a file name with # in it, share and Markdown save', async () => {
  await page.evaluate(path => window.fakeNative.emit('open', { paths: [path] }), DOCS + '/笔记 #1.md');
  await page.waitForFunction(() => [...window.qingye.sessions.values()].some(s => s.name === '笔记 #1.md' && s.loaded), null, { timeout: 15000 });
  await page.evaluate(async () => { const s = [...window.qingye.sessions.values()].find(s => s.name === '笔记 #1.md'); s.editor.replaceAll(s.editor.text + '\n追加。\n'); window.qingye.syncDirty(s); await window.qingye.saveSession(s, false); });
  assert.match(await text(DOCS + '/笔记 #1.md'), /追加。/);
  await page.click('#qmMore'); await page.click('#qmMoreMenu button:has-text("分享当前文档")');
  await page.waitForFunction(() => window.fakeNative.state.shared.length === 1);
  assert.deepEqual(await fake(() => window.fakeNative.state.shared[0]), { path: DOCS + '/笔记 #1.md', mime: 'text/markdown' });
});

test('Markdown export to PDF goes through the native renderer', async () => {
  const job = page.evaluate(async () => { const s = [...window.qingye.sessions.values()].find(s => s.name === '笔记 #1.md'); return window.desktop.mdExportPdf(s.id, '<html><body><h1>标题</h1></body></html>', { pageSize: 'A4', margin: 20 }); });
  await page.waitForSelector('.qmFiles[open]'); await page.fill('.qmName', '导出.pdf'); await page.click('.qmFiles[open] .qmConfirm');
  assert.equal((await job).path, DOCS + '/导出.pdf');
  assert.match(await text(DOCS + '/导出.pdf'), /^%PDF-/);
});

test('AI: the key is stored encrypted and a reply streams through the native network path', async () => {
  const out = await page.evaluate(async base => {
    const state = await window.desktop.aiState();
    const saved = await window.desktop.aiUpsert({ name: '测试', type: 'openai', baseUrl: base + '__ai/v1', apiKey: 'sk-test-secret-123456', model: 'qingye-test-model' });
    const id = saved.id || saved.connection?.id || (await window.desktop.aiState()).connections[0].id;
    const models = await window.desktop.aiModels(id).catch(e => 'ERR ' + e.message);
    let streamed = '';
    const off = window.desktop.onAiEvent((job, data) => { if (data.delta) streamed += data.delta; });
    const reply = await window.desktop.aiChat('job-1', { connectionId: id, model: 'qingye-test-model', messages: [{ role: 'user', content: '你好' }] }).catch(e => ({ error: e.message }));
    off();
    const stored = new TextDecoder().decode(window.fakeNative.get('/data/user/0/org.qingye.pdf/files/qingye/ai-config.json') || new Uint8Array());
    return { encrypted: state.encrypted, models, streamed, reply, stored };
  }, app.url);
  assert.equal(out.encrypted, true);
  assert.equal(out.streamed, '你好，这是流式回答。', JSON.stringify(out.reply).slice(0, 300) + ' ' + JSON.stringify(out.models).slice(0, 200));
  assert.ok(out.stored.includes('enc:'), 'the key is written encrypted'); assert.ok(!out.stored.includes('sk-test-secret-123456'));
});

test('back button: document → home → leave the app without closing tabs', async () => {
  await page.evaluate(() => window.fakeNative.emit('back', {}));
  assert.equal(await page.evaluate(() => document.body.dataset.mode), 'home');
  await page.evaluate(() => window.fakeNative.emit('back', {}));
  await page.waitForFunction(() => window.fakeNative.state.background === 1);
  assert.equal(await page.evaluate(() => window.qingye.sessions.size), 2);
});

test('no script errors were reported', () => {
  assert.deepEqual(app.errors.filter(message => !/Failed to load resource/.test(message)), []);
});
