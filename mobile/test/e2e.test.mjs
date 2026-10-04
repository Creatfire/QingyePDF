// End-to-end checks of the Android web layer in a phone-sized Chromium. The device is replaced
// by the in-memory storage backend; everything else (shared ui/, bridge, Pyodide backend,
// Tesseract, Pandoc) is the code that ships in the APK. Run: npm run test:e2e (after build:web).
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, mobileRoot } from './harness.mjs';

const DOCS = '/storage/emulated/0/Documents';
let app, page;
const put = (file, bytes) => page.evaluate(async ([file, b64]) => { const be = window.qingyeMobile.backend, dir = file.slice(0, file.lastIndexOf('/')); await be.mkdir(dir, true); await be.write(file, Uint8Array.from(atob(b64), c => c.charCodeAt(0))); }, [file, Buffer.from(bytes).toString('base64')]);
const read = file => page.evaluate(async file => { try { const b = await window.qingyeMobile.backend.read(file); let s = ''; for (let i = 0; i < b.length; i += 0x8000) s += String.fromCharCode.apply(null, b.subarray(i, i + 0x8000)); return btoa(s); } catch { return null; } }, file).then(b64 => b64 === null ? null : Buffer.from(b64, 'base64'));
const browse = async (name, { confirm = true } = {}) => { await page.waitForSelector('.qmFiles[open]'); await page.click(`.qmRow:has-text("${name}")`); if (confirm && await page.locator('.qmFiles[open] .qmConfirm:visible').count()) await page.click('.qmFiles[open] .qmConfirm'); await page.waitForSelector('.qmFiles', { state: 'detached' }); };
const saveAs = async name => { await page.waitForSelector('.qmFiles[open]'); await page.fill('.qmName', name); await page.click('.qmConfirm'); await page.waitForSelector('.qmFiles', { state: 'detached' }); };
const sessions = () => page.evaluate(() => [...window.qingye.sessions.values()].map(s => ({ id: s.id, name: s.name, path: s.path, kind: s.kind || 'pdf', dirty: !!s.dirty })));

before(async () => {
  app = await launch(); page = app.page;
  await put(DOCS + '/scan.pdf', fs.readFileSync(path.join(mobileRoot, '../test/fixtures/mixed-scan.pdf')));
  await put(DOCS + '/guide.pdf', fs.readFileSync(path.join(mobileRoot, '../ui/sample-guide.pdf')));
  await put(DOCS + '/notes/assets/pic.png', Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64'));
  await put(DOCS + '/notes/读书笔记.md', Buffer.from('# 读书笔记\n\n第一段 **重点**。\n\n![图](assets/pic.png)\n\n## 第二节\n\n| 甲 | 乙 |\n|---|---|\n| 1 | 2 |\n'));
});
after(async () => { await app?.close(); });

test('phone chrome: tabs, more menu, no horizontal overflow', async () => {
  assert.equal(await page.evaluate(() => document.documentElement.classList.contains('qyMobile')), true);
  assert.equal(await page.evaluate(() => window.desktop.platform), 'android');
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await page.click('#qmMore');
  assert.ok(await page.locator('#qmMoreMenu button').count() >= 7);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('qingye:back')));
  assert.equal(await page.locator('#qmMoreMenu:popover-open').count(), 0);
});

test('open a PDF through the file browser, edit through the backend, save in place', async () => {
  await page.click('#welcomeOpen');
  await browse('guide.pdf');
  await page.waitForFunction(() => [...window.qingye.sessions.values()].some(s => s.name === 'guide.pdf' && s.loaded), null, { timeout: 30000 });
  const [doc] = (await sessions()).filter(s => s.name === 'guide.pdf');
  assert.equal(doc.path, DOCS + '/guide.pdf');
  const before = await read(doc.path);
  // The same job the page-editing tools send: a text stamp applied as a draft.
  const result = await page.evaluate(async id => {
    const s = window.qingye.sessions.get(id), bytes = new Uint8Array(await s.app.pdfDocument.getData());
    const out = await window.desktop.toolsJob(id, bytes, { action: 'stamp', draft: true, pages: '1', rect: [.1, .1, .6, .2], text: '已审核 青页', size: 16 });
    await window.qingye.replaceDocument(s, out.bytes); window.qingye.syncDirty(s);
    const saved = await window.qingye.saveSession(s, false);
    return { size: out.bytes.length, dirty: s.dirty, saved: saved !== false };
  }, doc.id);
  assert.ok(result.size > before.length, 'stamp adds content');
  const afterSave = await read(doc.path);
  assert.ok(afterSave.length > before.length, 'file on storage was replaced');
  assert.equal(afterSave.subarray(0, 5).toString(), '%PDF-');
});

test('PDF tools: inspect, export to Word through the save dialog, split to zip', async () => {
  const [doc] = (await sessions()).filter(s => s.name === 'guide.pdf');
  const inspect = await page.evaluate(async id => { const s = window.qingye.sessions.get(id), bytes = new Uint8Array(await s.app.pdfDocument.getData()); return (await window.desktop.toolsJob(id, bytes, { action: 'inspect', page: 1, annotations: true, headings: true })).data; }, doc.id);
  assert.equal(inspect.pages, 7); assert.ok(inspect.toc.length > 5); assert.ok(inspect.blocks.length > 0);
  for (const [request, name, magic] of [[{ action: 'export', format: 'docx', pages: '1-2' }, 'guide-export.docx', 'PK'], [{ action: 'organize', mode: 'split', pages: '1-2' }, 'guide-split.zip', 'PK'], [{ action: 'export', format: 'txt', pages: '1' }, 'guide.txt', null]]) {
    const job = page.evaluate(async ([id, request]) => { const s = window.qingye.sessions.get(id), bytes = new Uint8Array(await s.app.pdfDocument.getData()); return window.desktop.toolsJob(id, bytes, request); }, [doc.id, request]);
    await saveAs(name);
    const out = await job;
    assert.equal(out.path, DOCS + '/' + name);
    const bytes = await read(out.path);
    assert.ok(bytes.length > 100); if (magic) assert.equal(bytes.subarray(0, 2).toString(), magic); else assert.match(bytes.toString('utf8'), /青页/);
  }
});

test('OCR adds a searchable text layer to a scanned page', async () => {
  await page.evaluate(() => document.getElementById('homeButton').click());
  await page.click('#welcomeOpen'); await browse('scan.pdf');
  await page.waitForFunction(() => [...window.qingye.sessions.values()].some(s => s.name === 'scan.pdf' && s.loaded), null, { timeout: 30000 });
  const [doc] = (await sessions()).filter(s => s.name === 'scan.pdf');
  const text = await page.evaluate(async id => {
    const s = window.qingye.sessions.get(id), bytes = new Uint8Array(await s.app.pdfDocument.getData());
    const before = (await window.desktop.toolsJob(id, bytes, { action: 'inspect', page: 2 })).data.blocks.length;
    const ocr = await window.desktop.toolsJob(id, bytes, { action: 'ocr-layer', draft: true, pages: '2' });
    const after = (await window.desktop.toolsJob(id, ocr.bytes, { action: 'inspect', page: 2 })).data.blocks.map(b => b.text).join(' ');
    return { before, after, note: ocr.note };
  }, doc.id);
  assert.equal(text.before, 0);
  assert.match(text.after, /SEARCHABLE/); assert.match(text.after, /OCR/);
});

test('Markdown: open with a relative image, edit, save, version history', async () => {
  await page.evaluate(() => document.getElementById('homeButton').click());
  await page.click('#welcomeOpen'); await page.waitForSelector('.qmFiles[open]'); await page.click('.qmRow:has-text("notes")');
  await browse('读书笔记.md');
  await page.waitForFunction(() => [...window.qingye.sessions.values()].some(s => s.name === '读书笔记.md' && s.loaded), null, { timeout: 30000 });
  const [doc] = (await sessions()).filter(s => s.kind === 'markdown');
  assert.equal(doc.path, DOCS + '/notes/读书笔记.md');
  // The drawer starts closed on a phone and the relative image resolves beside the document.
  assert.equal(await page.evaluate(id => window.qingye.markdown.outlineOpen(window.qingye.sessions.get(id)), doc.id), false);
  await page.waitForFunction(() => [...document.querySelectorAll('.mdDoc img')].some(img => img.src.startsWith('blob:') || img.src.startsWith('data:')), null, { timeout: 10000 });
  const saved = await page.evaluate(async id => { const s = window.qingye.sessions.get(id); s.editor.replaceAll(s.editor.text + '\n新增一行。\n'); window.qingye.syncDirty(s); const dirty = s.dirty; await window.qingye.saveSession(s, false); return { dirty, after: s.dirty, versions: (await window.desktop.mdHistory(id)).length }; }, doc.id);
  assert.equal(saved.dirty, true); assert.equal(saved.after, false); assert.ok(saved.versions >= 1);
  assert.match((await read(doc.path)).toString('utf8'), /新增一行。/);
});

test('new Markdown document is saved through the save dialog; recent list and recovery drafts', async () => {
  await page.evaluate(() => window.qingye.newMarkdown());
  await page.waitForFunction(() => [...window.qingye.sessions.values()].some(s => !s.path && s.kind === 'markdown' && s.loaded));
  const id = (await sessions()).find(s => !s.path && s.kind === 'markdown').id;
  await page.evaluate(id => { const s = window.qingye.sessions.get(id); s.editor.replaceAll('# 草稿\n\n尚未保存的内容\n'); window.qingye.syncDirty(s); }, id);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('qingye:pause')));
  await page.waitForFunction(async () => (await window.qingyeMobile.backend.readdir('/data/qingye/recovery').catch(() => [])).some(e => e.name.endsWith('.md')), null, { timeout: 10000 });
  const saving = page.evaluate(id => window.qingye.saveSession(window.qingye.sessions.get(id), false), id);
  await saveAs('草稿');
  await saving;
  assert.match((await read(DOCS + '/notes/草稿.md') || await read(DOCS + '/草稿.md')).toString('utf8'), /尚未保存的内容/);
  const recent = await page.evaluate(() => window.desktop.recent());
  assert.ok(recent.some(r => r.name === 'guide.pdf')); assert.ok(recent.some(r => r.name === '草稿.md'));
});

test('every backend action of worker.py runs in the WebAssembly engine', async () => {
  const b64 = file => fs.readFileSync(path.join(mobileRoot, file)).toString('base64');
  const log = await page.evaluate(async ({ guide, scan, png }) => {
    const dec = s => Uint8Array.from(atob(s), c => c.charCodeAt(0)), G = dec(guide), S = dec(scan), P = dec(png), run = window.qingyeMobile.runOffline, log = {};
    const go = async (label, args) => { try { const r = await run(args); log[label] = r.files.map(f => f.name).join(',') || (r.unchanged ? 'unchanged' : 'data'); return r; } catch (e) { log[label] = 'ERROR ' + e.message; } };
    const R = [.1, .1, .6, .25];
    for (const [label, request] of Object.entries({
      text: { action: 'text', pages: '1', rect: R, text: '替换文字 abc', size: 14 }, stamp: { action: 'stamp', pages: '1', rect: R, text: '已审核' }, watermark: { action: 'watermark', pages: '', rect: R, text: '机密', opacity: .3 },
      number: { action: 'number', pages: '', rect: [.4, .93, .6, .97], text: '{page} / {total}', size: 10 }, shape: { action: 'shape', pages: '1', rect: R, shape: 'ellipse', fill: true },
      annotation: { action: 'annotation', pages: '1', rect: R, annotation: 'highlight', text: 'x' }, form: { action: 'form', pages: '1', rect: R, text: 'name' }, crop: { action: 'crop', pages: '', rect: [.05, .05, .95, .95] },
      redact: { action: 'redact', pages: '1', rect: R }, flatten: { action: 'flatten' }, compress: { action: 'compress', lossy: true }, sharpen: { action: 'sharpen' }, outline: { action: 'outline', toc: [[1, '第一章', 1], [2, '小节', 2]] },
      rotate: { action: 'organize', mode: 'rotate', pages: '1-2', angle: 90 }, reorder: { action: 'organize', mode: 'reorder', pages: '2,1,1' }, remove: { action: 'organize', mode: 'delete', pages: '7' }, blank: { action: 'organize', mode: 'blank', position: 0 }, split: { action: 'organize', mode: 'split', pages: '1-2' },
      'export-xlsx': { action: 'export', format: 'xlsx', pages: '1' }, 'export-pptx': { action: 'export', format: 'pptx', pages: '1' }, 'export-png': { action: 'export', format: 'png', pages: '1', dpi: 72 }, 'export-svg': { action: 'export', format: 'svg', pages: '1' }, 'export-html': { action: 'export', format: 'html', pages: '1' },
      'notes-export': { action: 'notes-export', notes: [{ page: 1, type: 'Highlight', text: '备注', excerpt: '原文', color: '#ffee00' }] },
    })) await go(label, { bytes: G, request });
    await go('image', { bytes: G, request: { action: 'image', pages: '1', rect: R, keepRatio: true }, assets: [{ name: 'stamp.png', bytes: P }] });
    await go('page-stamp', { bytes: G, request: { action: 'page-stamp', pages: '1', rect: R, stampPage: 1 }, inputs: [S] });
    await go('merge', { bytes: G, request: { action: 'organize', mode: 'merge' }, inputs: [S] });
    await go('compare', { bytes: G, request: { action: 'compare' }, inputs: [S] });
    const locked = await go('encrypt', { bytes: G, request: { action: 'encrypt', userPassword: 'u', ownerPassword: 'o' } });
    await go('decrypt', { bytes: locked.files[0].bytes, request: { action: 'decrypt', password: 'o' } });
    await go('decrypt-with-open-password', { bytes: locked.files[0].bytes, request: { action: 'decrypt', password: 'u' } });
    await go('scan', { bytes: S, request: { action: 'scan', pages: '2', deskew: true, clean: true, gray: true, recognize: true } });
    await go('ocr', { bytes: S, request: { action: 'ocr', pages: '' } });
    await go('import-image', { bytes: P, request: { action: 'import' }, inputName: 'a.png' });
    await go('import-text', { bytes: new TextEncoder().encode('第一行\nsecond line'), request: { action: 'import' }, inputName: 'a.txt' });
    const word = await go('export-docx', { bytes: G, request: { action: 'export', format: 'docx', pages: '1' } });
    await go('import-docx', { bytes: word.files[0].bytes, request: { action: 'import' }, inputName: 'a.docx' });
    const cancel = new AbortController(); setTimeout(() => cancel.abort(), 30);
    await go('cancelled', { bytes: G, request: { action: 'compress', lossy: true }, signal: cancel.signal });
    await go('after-cancel', { bytes: G, request: { action: 'inspect', page: 1 } });
    return log;
  }, { guide: b64('../ui/sample-guide.pdf'), scan: b64('../test/fixtures/mixed-scan.pdf'), png: b64('../ui/icon.png') });
  const expectedErrors = { 'decrypt-with-open-password': /管理密码/, cancelled: /已取消/ };
  for (const [label, outcome] of Object.entries(log)) {
    if (expectedErrors[label]) assert.match(outcome, expectedErrors[label], label);
    else assert.doesNotMatch(outcome, /^ERROR/, `${label}: ${outcome}`);
  }
  assert.equal(log.split, 'result.zip'); assert.equal(log['export-xlsx'], 'result.xlsx'); assert.equal(log.compare, 'result.html'); assert.equal(log['after-cancel'], 'data');
  assert.ok(Object.keys(log).length >= 38);
});

test('conversion centre: Markdown to Word and EPUB with the Pandoc engine', async () => {
  const info = await page.evaluate(() => window.desktop.converterInfo());
  assert.match(info.version, /^pandoc 3\./); assert.ok(info.readers.includes('docx')); assert.ok(info.writers.includes('epub3'));
  await page.evaluate(() => document.getElementById('convertButton').click());
  await page.waitForSelector('#converterDialog[open]');
  await page.click('#convertPickInputs'); await page.waitForSelector('.qmFiles[open]');
  await page.click('.qmPlaces button:has-text("文档")'); await page.click('.qmRow:has-text("notes")'); await page.click('.qmRow:has-text("读书笔记.md")'); await page.click('.qmFiles[open] .qmConfirm');
  for (const [to, name] of [['docx', '笔记.docx'], ['epub3', '笔记.epub']]) {
    await page.selectOption('#convertTo', to);
    await page.click('#convertPickOutput'); await saveAs(name);
    await page.click('#convertStart');
    await page.waitForFunction(() => /转换完成|失败/.test(document.getElementById('convertStatus').textContent), null, { timeout: 120000 });
    assert.match(await page.textContent('#convertStatus'), /转换完成/);
    const bytes = await read(DOCS + '/notes/' + name);
    assert.equal(bytes.subarray(0, 2).toString(), 'PK');
    if (to === 'docx') assert.ok(bytes.includes(Buffer.from('media/')), 'the relative image was embedded');
    await page.evaluate(() => { document.getElementById('convertStatus').textContent = ''; });
  }
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('qingye:back')));
  assert.equal(await page.locator('#converterDialog[open]').count(), 0);
});

test('Android back button walks back to the home screen', async () => {
  await page.evaluate(() => document.querySelector('#tabs .tab:nth-child(2) .tabTitle, #tabs .tab:nth-child(2)').click());
  assert.notEqual(await page.evaluate(() => document.body.dataset.mode), 'home');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('qingye:back')));
  assert.equal(await page.evaluate(() => document.body.dataset.mode), 'home');
});

test('no script errors were reported', () => {
  const real = app.errors.filter(text => !/favicon|Failed to load resource/.test(text));
  assert.deepEqual(real, []);
});
