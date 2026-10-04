// 0.12.0 on a phone-sized touch screen: no keyboard hints, tap / double-tap reading, the selection
// bar, notes mode with stacked panes, region excerpts by touch, library search and references.
import test, { after, before } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { launch, mobileRoot } from './harness.mjs';

const DOCS = '/storage/emulated/0/Documents';
let app, page, cdp, pdfId, mdId;
const put = (file, bytes) => page.evaluate(async ([file, b64]) => { const be = window.qingyeMobile.backend, dir = file.slice(0, file.lastIndexOf('/')); await be.mkdir(dir, true); await be.write(file, Uint8Array.from(atob(b64), c => c.charCodeAt(0))); }, [file, Buffer.from(bytes).toString('base64')]);
const list = dir => page.evaluate(async dir => (await window.qingyeMobile.backend.readdir(dir).catch(() => [])).map(e => e.name), dir);
const wait = (fn, arg, timeout = 30000) => page.waitForFunction(fn, arg, { timeout });
const touch = (type, x, y) => cdp.send('Input.dispatchTouchEvent', { type, touchPoints: type === 'touchEnd' ? [] : [{ x, y }] });
const tap = async (x, y) => { await touch('touchStart', x, y); await touch('touchEnd', x, y); };
// A point of the first PDF page that has no text under it, in window coordinates.
const blankPoint = () => page.evaluate(id => { const s = window.qingye.sessions.get(id), f = s.frame.getBoundingClientRect(), p = s.frame.contentDocument.querySelector('.page[data-page-number="1"]').getBoundingClientRect(); return { x: f.left + p.left + p.width * .5, y: f.top + Math.max(p.top, 0) + 14 }; }, pdfId);

before(async () => {
  app = await launch(); page = app.page; cdp = await page.context().newCDPSession(page);
  await put(DOCS + '/paper.pdf', fs.readFileSync(path.join(mobileRoot, '../ui/sample-guide.pdf')));
  await put(DOCS + '/notes/reading.md', Buffer.from('# Reading notes\n\nQuokka remark in the note.\n'));
  await page.evaluate(async docs => { await window.qingye.addDocuments(await window.qingyeMobile.internals.openFiles([docs + '/paper.pdf', docs + '/notes/reading.md'])); }, DOCS);
  await wait(() => [...window.qingye.sessions.values()].length === 2 && [...window.qingye.sessions.values()].every(s => s.loaded));
  [pdfId, mdId] = await page.evaluate(() => { const all = [...window.qingye.sessions.values()]; return [all.find(s => s.kind !== 'markdown').id, all.find(s => s.kind === 'markdown').id]; });
  await page.evaluate(id => window.qingye.activate(id), pdfId);
  await wait(id => !!window.qingye.sessions.get(id).frame.contentDocument.querySelector('.page[data-page-number="1"] .textLayer span'), pdfId);
});
after(async () => { await app?.close(); });

test('no keyboard hints are shown on a touch screen', async () => {
  const hints = await page.evaluate(() => {
    const found = [], re = /Ctrl\s*\+|Alt\s*\+|Shift\s*\+|(?<![A-Za-z])F1[01](?!\d)/;
    for (const el of document.querySelectorAll('body *')) { if (el.closest('.mdEditorHost, script, style')) continue; for (const name of ['title', 'aria-label', 'placeholder']) { const v = el.getAttribute(name); if (v && re.test(v)) found.push(name + ': ' + v); } }
    const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) if (re.test(n.nodeValue) && !n.parentElement.closest('.mdEditorHost, script, style')) found.push('text: ' + n.nodeValue.trim().slice(0, 60));
    return found;
  });
  assert.deepEqual(hints, []);
  assert.equal(await page.evaluate(() => document.getElementById('openButton').title), '打开文档');
  // The PDF page menu and the notes menu are built on demand: check them when open.
  await page.click('#qmMore');
  const more = await page.locator('#qmMoreMenu button').allTextContents();
  assert.ok(more.includes('笔记模式') && more.includes('全库搜索'), more.join('|'));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('qingye:back')));
  // Help describes gestures.
  await page.evaluate(() => document.getElementById('helpButton').click());
  assert.equal(await page.textContent('#messageTitle'), '触屏操作'); assert.match(await page.textContent('#messageBody'), /轻点页面/); assert.doesNotMatch(await page.textContent('#messageBody'), /Ctrl/);
  await page.evaluate(() => document.getElementById('messageDialog').close());
});

test('a tap on the page hides the bars, another tap brings them back; a double tap zooms', async () => {
  const visible = sel => page.evaluate(sel => { const n = document.querySelector(sel); return !!n && getComputedStyle(n).display !== 'none'; }, sel);
  const height = () => page.evaluate(id => window.qingye.sessions.get(id).panel.getBoundingClientRect().height, pdfId);
  await page.waitForTimeout(900); // the frames are bound on a timer
  const before = await height(), point = await blankPoint();
  assert.equal(await visible('.titlebar'), true); assert.equal(await visible('#pdfToolbar'), true);
  await tap(point.x, point.y);
  await wait(() => document.body.classList.contains('qyImmersive'));
  assert.equal(await visible('.titlebar'), false); assert.equal(await visible('#pdfToolbar'), false); assert.equal(await visible('.status'), false); assert.equal(await visible('.pager'), false);
  assert.ok(await height() > before + 80, 'the page area grew: ' + before + ' → ' + await height());
  const inside = await blankPoint(); await tap(inside.x, inside.y);
  await wait(() => !document.body.classList.contains('qyImmersive'));
  assert.equal(await visible('.titlebar'), true); assert.equal(await visible('.pager'), true);
  // Double tap: 2× and back to page width; the bars do not toggle.
  const scale = () => page.evaluate(id => window.qingye.sessions.get(id).app.pdfViewer.currentScale, pdfId);
  const base = await scale(), p = await blankPoint();
  await tap(p.x, p.y); await page.waitForTimeout(90); await tap(p.x, p.y);
  await wait(([id, base]) => window.qingye.sessions.get(id).app.pdfViewer.currentScale > base * 1.8, [pdfId, base]);
  await page.waitForTimeout(450); assert.equal(await page.evaluate(() => document.body.classList.contains('qyImmersive')), false);
  const q = await page.evaluate(id => { const s = window.qingye.sessions.get(id), f = s.frame.getBoundingClientRect(); return { x: f.left + f.width / 2, y: f.top + 120 }; }, pdfId);
  await tap(q.x, q.y); await page.waitForTimeout(90); await tap(q.x, q.y);
  await wait(([id, base]) => Math.abs(window.qingye.sessions.get(id).app.pdfViewer.currentScale - base) < base * .05, [pdfId, base]);
  // The Android back button leaves the immersive view first.
  await page.waitForTimeout(450); const r = await blankPoint(); await tap(r.x, r.y); await wait(() => document.body.classList.contains('qyImmersive'));
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('qingye:back')));
  assert.equal(await page.evaluate(() => document.body.classList.contains('qyImmersive')), false); assert.equal(await page.evaluate(() => document.body.dataset.mode), 'pdf');
});

test('notes mode on a phone: stacked in portrait, side by side in landscape', async () => {
  await page.evaluate(([a, b]) => window.qingye.notes.start(a, b), [pdfId, mdId]);
  const boxes = () => page.evaluate(([a, b]) => [a, b].map(id => { const r = window.qingye.sessions.get(id).panel.getBoundingClientRect(); return { left: Math.round(r.left), top: Math.round(r.top), width: Math.round(r.width), height: Math.round(r.height) }; }), [pdfId, mdId]);
  assert.equal(await page.evaluate(() => document.body.classList.contains('notesRows')), true);
  let [pdf, md] = await boxes();
  assert.equal(pdf.width, md.width); assert.ok(Math.abs(pdf.height - md.height) <= 2 && md.top >= pdf.top + pdf.height - 2, JSON.stringify([pdf, md]));
  assert.equal(await page.getAttribute('#notesDivider', 'aria-orientation'), 'horizontal');
  // Dragging the divider with a finger resizes the panes.
  const d = await page.evaluate(() => { const r = document.getElementById('notesDivider').getBoundingClientRect(), v = document.getElementById('viewers').getBoundingClientRect(); return { x: r.left + 24, y: r.top + r.height / 2, top: v.top, height: v.height }; });
  await touch('touchStart', d.x, d.y); await touch('touchMove', d.x, d.top + d.height * .5); await touch('touchMove', d.x, d.top + d.height * .35); await touch('touchEnd', d.x, d.top + d.height * .35);
  assert.ok(Math.abs(await page.evaluate(() => window.qingye.notes.ratio()) - 35) < 3, 'ratio ' + await page.evaluate(() => window.qingye.notes.ratio()));
  [pdf, md] = await boxes(); assert.ok(pdf.height < md.height);
  await page.evaluate(() => window.qingye.notes.setRatio(50));
  // A grab handle instead of the desktop's hover buttons (their commands are under "More").
  assert.equal(await page.evaluate(() => getComputedStyle(document.querySelector('.notesDividerTools')).display), 'none');
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('notesDivider'), '::after').width), '44px');
  await page.setViewportSize({ width: 844, height: 390 }); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.body.classList.contains('notesRows')), false);
  [pdf, md] = await boxes(); assert.ok(Math.abs(pdf.width - md.width) <= 2 && md.left >= pdf.left + pdf.width - 2 && pdf.height === md.height, JSON.stringify([pdf, md]));
  await page.setViewportSize({ width: 390, height: 844 }); await page.waitForTimeout(300);
  assert.equal(await page.evaluate(() => document.body.classList.contains('notesRows')), true);
  // "More" now offers the commands of notes mode.
  await page.click('#qmMore'); await page.click('#qmMoreMenu button:has-text("笔记模式命令")');
  await page.waitForSelector('#notesMenu:popover-open');
  const entries = await page.locator('#notesMenu .menuItem .notesMenuText').allTextContents();
  assert.deepEqual(entries.slice(0, 3), ['摘录选中的文字', '框选区域（公式、图表、表格）', '同步 PDF 批注到笔记']);
  assert.deepEqual((await page.locator('#notesMenu .shortcut').allTextContents()).filter(t => /Ctrl/.test(t)), []);
  const box = await page.locator('#notesMenu').boundingBox(); assert.ok(box.x >= 0 && box.x + box.width <= 390 && box.y >= 0, JSON.stringify(box));
  await page.evaluate(() => document.getElementById('notesMenu').hidePopover());
});

test('selected text gets a bar with copy, highlight, search and excerpt', async () => {
  await page.evaluate(id => window.qingye.activate(id, { keepFocus: true }), pdfId);
  const quote = await page.evaluate(id => { const s = window.qingye.sessions.get(id), d = s.frame.contentDocument, span = [...d.querySelectorAll('.page[data-page-number="1"] .textLayer span')].find(n => n.textContent.trim().length > 6); const r = d.createRange(); r.selectNodeContents(span); const sel = s.frame.contentWindow.getSelection(); sel.removeAllRanges(); sel.addRange(r); return span.textContent.trim(); }, pdfId);
  await page.waitForSelector('#qmSelection:not([hidden])');
  assert.deepEqual(await page.locator('#qmSelection button').allTextContents(), ['复制', '高亮', '搜索', '摘录到笔记']);
  await page.click('#qmSelection button:has-text("摘录到笔记")');
  await wait(([id, quote]) => window.qingye.sessions.get(id).editor.text.includes(quote.slice(0, 6)), [mdId, quote]);
  const text = await page.evaluate(id => window.qingye.sessions.get(id).editor.text, mdId);
  assert.match(text, /paper\.pdf · 第 1 页\]\(<file:\/\/\/storage\/emulated\/0\/Documents\/paper\.pdf#page=1&rect=/);
  assert.equal(await page.evaluate(() => document.getElementById('qmSelection').hidden), true);
});

test('a region is excerpted by dragging a finger over the page', async () => {
  await page.evaluate(() => window.qingye.notes.pickRegion());
  const r = await page.evaluate(id => { const s = window.qingye.sessions.get(id), f = s.frame.getBoundingClientRect(), p = s.frame.contentDocument.querySelector('.page[data-page-number="1"] .textLayer').getBoundingClientRect(); return { x0: f.left + p.left + p.width * .1, y0: f.top + Math.max(p.top, 0) + 20, x1: f.left + p.left + p.width * .8, y1: f.top + Math.max(p.top, 0) + 150 }; }, pdfId);
  const scrollBefore = await page.evaluate(id => window.qingye.sessions.get(id).frame.contentDocument.getElementById('viewerContainer').scrollTop, pdfId);
  await touch('touchStart', r.x0, r.y0); await touch('touchMove', (r.x0 + r.x1) / 2, (r.y0 + r.y1) / 2); await touch('touchMove', r.x1, r.y1);
  assert.equal(await page.evaluate(id => window.qingye.sessions.get(id).frame.contentDocument.querySelectorAll('.qyRegionBox').length, pdfId), 1);
  await touch('touchEnd', r.x1, r.y1);
  await wait(id => /!\[paper\.pdf 第 1 页\]\(assets\/image-/.test(window.qingye.sessions.get(id).editor.text), mdId);
  assert.equal(await page.evaluate(id => window.qingye.sessions.get(id).frame.contentDocument.getElementById('viewerContainer').scrollTop, pdfId), scrollBefore, 'the page did not scroll while the box was dragged');
  const images = await list(DOCS + '/notes/assets'); assert.equal(images.length, 1); assert.match(images[0], /^image-\d+\.png$/);
  assert.equal(await page.evaluate(() => window.qingye.notes.picking()), false);
  // The bars do not toggle while a region is being picked, and Back cancels picking.
  await page.evaluate(() => window.qingye.notes.pickRegion()); await page.evaluate(() => window.dispatchEvent(new CustomEvent('qingye:back')));
  assert.equal(await page.evaluate(() => window.qingye.notes.picking()), false); assert.equal(await page.evaluate(() => window.qingye.notes.active()), true);
});

test('annotations sync through the WebAssembly backend; the note follows the PDF', async () => {
  await page.evaluate(async id => { const s = window.qingye.sessions.get(id); await window.qingye.applyEdit(s, { action: 'annotation', kind: 'highlight', pages: '1', rect: [.1, .1, .5, .14], text: 'Checked on the phone' }, '高亮'); }, pdfId);
  const made = await page.evaluate(() => window.qingye.notes.syncAnnotations());
  assert.ok(made.added >= 1, JSON.stringify(made));
  assert.match(await page.evaluate(id => window.qingye.sessions.get(id).editor.text, mdId), /Checked on the phone/);
  assert.equal((await page.evaluate(() => window.qingye.notes.syncAnnotations())).added, 0);
  assert.equal(await page.evaluate(id => window.qingye.notes.pageChanged(window.qingye.sessions.get(id), 1, { immediate: true }), pdfId), true);
});

test('library search and reference details work on the phone', async () => {
  await page.evaluate(async id => { await window.qingye.saveSession(window.qingye.sessions.get(id), false); }, mdId);
  await page.click('#qmMore'); await page.click('#qmMoreMenu button:has-text("全库搜索")');
  await page.waitForSelector('#libraryDialog[open]');
  const size = await page.locator('#libraryDialog').boundingBox(); assert.ok(size.width >= 388 && size.height >= 840, 'full screen on a phone: ' + JSON.stringify(size));
  await page.evaluate(() => window.qingye.library.refresh());
  let found = await page.evaluate(() => window.qingye.library.search('quokka'));
  assert.deepEqual(found.documents.map(d => d.name), ['reading.md']);
  const word = await page.evaluate(async id => { const s = window.qingye.sessions.get(id), items = (await (await s.app.pdfDocument.getPage(2)).getTextContent()).items; return items.map(i => i.str).find(t => /^[A-Za-z一-鿿]{3,}$/.test(t.trim())).trim(); }, pdfId);
  found = await page.evaluate(word => window.qingye.library.search(word), word);
  assert.ok(found.documents.some(d => d.name === 'paper.pdf' && d.hits.some(h => h.page === 2)), word + ' → ' + JSON.stringify(found.documents.map(d => [d.name, d.hits.map(h => h.page)])));
  await page.evaluate(() => window.qingye.library.close());
  await page.evaluate(id => window.qingye.citations.open(window.qingye.sessions.get(id)), pdfId);
  await page.waitForSelector('#citationDialog[open]');
  assert.match(await page.inputValue('#citationBibtex'), /^@misc\{[^,]+,\n  title = \{\{.+\}\}/);
  assert.equal(await page.evaluate(() => getComputedStyle(document.getElementById('citationLookup')).display), 'none');
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('qingye:back')));
  assert.equal(await page.locator('#citationDialog[open]').count(), 0);
});

test('the back button leaves notes mode before it leaves the document', async () => {
  assert.equal(await page.evaluate(() => window.qingye.notes.active()), true);
  await page.evaluate(() => window.dispatchEvent(new CustomEvent('qingye:back')));
  assert.equal(await page.evaluate(() => window.qingye.notes.active()), false); assert.notEqual(await page.evaluate(() => document.body.dataset.mode), 'home');
  // A long press on a tab offers notes mode again.
  await page.evaluate(() => [...document.querySelectorAll('#tabs .tab')].find(t => t.textContent.includes('reading.md')).dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, clientX: 120, clientY: 30 })));
  await page.waitForSelector('#notesMenu:popover-open');
  await page.evaluate(() => document.getElementById('notesMenu').hidePopover());
});

test('no script errors were reported', () => {
  const real = app.errors.filter(text => !/favicon|Failed to load resource/.test(text));
  assert.deepEqual(real, []);
});
