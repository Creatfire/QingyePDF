// 0.23 home page: the logic that decides what it shows, and the store behind it.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, readFileSync, existsSync, readdirSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { greetingFor, dateLabel, shelfCount, progressOf, pickReading, chapterForPage, flattenOutline, highlightText, pdfDate, readMarks, groupResults } from '../ui/home.mjs';
const require = createRequire(import.meta.url);
const { createHomeData, notePreview, cleanMarks, MAX_THUMBS } = require('../home-ipc.cjs');
const root = new URL('../', import.meta.url);

test('greeting and date follow the clock and the language', () => {
  assert.equal(greetingFor(2), '夜深了，'); assert.equal(greetingFor(9), '早上好，'); assert.equal(greetingFor(12), '中午好，'); assert.equal(greetingFor(15), '下午好，'); assert.equal(greetingFor(20), '晚上好，');
  const date = new Date(2026, 10, 1);
  assert.equal(dateLabel(date), '11 月 1 日 星期日');
  assert.match(dateLabel(date, 'en'), /November 1/);
});
test('the shelf holds 6, 5, 4 or 3 covers', () => {
  assert.deepEqual([1200, 980, 979, 760, 759, 600, 599, 300].map(shelfCount), [6, 6, 5, 5, 4, 4, 3, 3]);
});
test('the reading card picks the most recent unfinished PDF, then whatever was last open', () => {
  const finished = { id: 'a', kind: 'pdf', page: 10, pages: 10, inRecent: true }, md = { id: 'b', kind: 'markdown', inRecent: true }, reading = { id: 'c', kind: 'pdf', page: 3, pages: 10, inRecent: true }, gone = { id: 'd', kind: 'pdf', page: 3, pages: 10, inRecent: true, missing: true }, pinnedOnly = { id: 'e', kind: 'pdf', page: 0, pages: 0, inRecent: false };
  assert.equal(pickReading([gone, finished, md, reading]).id, 'c');
  assert.equal(pickReading([pinnedOnly, finished, md]).id, 'a');
  assert.equal(pickReading([pinnedOnly]), null);
  assert.equal(progressOf({ page: 34, pages: 120 }), 28); assert.equal(progressOf({ page: 0, pages: 0 }), null); assert.equal(progressOf({ page: 5, pages: 2 }), 100);
});
test('chapter of a page: the last outline entry that starts on or before it', async () => {
  const pages = { one: 1, two: 5, sub: 7 }, outline = await flattenOutline([{ title: 'One', dest: 'one', items: [{ title: 'Nowhere', dest: 'missing' }] }, { title: 'Two', dest: 'two', items: [{ title: 'Sub', dest: 'sub' }] }], async dest => pages[dest] ?? null);
  assert.deepEqual(outline.map(o => o.title), ['One', 'Two', 'Sub']);
  assert.deepEqual([1, 4, 5, 6, 7, 99].map(p => chapterForPage(outline, p)), ['One', 'One', 'Two', 'Two', 'Sub', 'Sub']);
  assert.equal(chapterForPage([], 3), ''); assert.equal(chapterForPage(undefined, 3), '');
});
test('the text under a highlight comes from the items its quads cover', () => {
  const item = (str, x, y, width) => ({ str, transform: [12, 0, 0, 12, x, y], width, height: 12 });
  const quads = [72, 712, 172, 712, 72, 700, 172, 700], items = [item('0123456789', 72, 700, 200), item('other line', 72, 650, 100), item('beside', 400, 700, 60)];
  assert.equal(highlightText(quads, items), '01234');
  assert.equal(highlightText([72, 712, 272, 712, 72, 700, 272, 700, 72, 662, 172, 662, 72, 650, 172, 650], items), '0123456789other line');
  assert.equal(highlightText(quads, []), '');
});
test('PDF dates become timestamps', () => {
  assert.equal(pdfDate("D:20261101135200+08'00'"), Date.UTC(2026, 10, 1, 5, 52));
  assert.equal(pdfDate('D:20261101Z'), Date.UTC(2026, 10, 1));
  assert.equal(pdfDate(null), 0); assert.equal(pdfDate('nonsense'), 0);
});
test('reading marks counts annotations and keeps the newest highlights first', async () => {
  const pagesData = { 1: [{ subtype: 'Link' }, { subtype: 'Text' }], 2: [{ subtype: 'Highlight', quadPoints: [1], overlaidText: ' old ', modificationDate: 'D:20200101' }, { subtype: 'Popup' }], 3: [{ subtype: 'Highlight', quadPoints: [1], overlaidText: 'new', modificationDate: 'D:20260101' }, { subtype: 'Highlight', quadPoints: [], overlaidText: 'no quads' }] };
  const doc = { numPages: 3, getPage: async n => ({ getAnnotations: async () => pagesData[n], getTextContent: async () => ({ items: [] }) }) };
  const marks = await readMarks(doc);
  assert.equal(marks.annotations, 4); assert.deepEqual(marks.highlights.map(h => [h.page, h.text]), [[3, 'new'], [2, 'old']]);
  assert.equal(await readMarks(doc, () => false), null, 'stops when no longer wanted');
});
test('input groups: files, content, excerpts and notes, commands; "/" is commands only', () => {
  let ran = 0;
  const source = {
    books: [{ id: '1', name: 'Atlas of fish.pdf', path: '/a/Atlas of fish.pdf', kind: 'pdf' }, { id: '2', name: 'Other.pdf', path: '/a/Other.pdf', kind: 'pdf' }],
    commands: [{ label: '打印 Atlas', group: '文件', run: () => ran++ }, { label: 'Atlas disabled', group: '文件', enabled: () => false, run() {} }],
    hits: [{ doc: { kind: 'pdf', name: 'Other.pdf' }, hit: { page: 2, before: 'a ', match: 'atlas', after: ' b' } }, { doc: { kind: 'markdown', name: 'n.md' }, hit: { line: 3, before: '', match: 'atlas', after: '' } }],
    marks: [{ text: 'An atlas passage', page: 4, book: { name: 'Other.pdf' } }, { text: 'unrelated', page: 1, book: { name: 'Other.pdf' } }],
  };
  const groups = groupResults('atlas', source);
  assert.deepEqual(groups.map(g => g.title), ['文件', '内容中的匹配', '你的摘录和笔记', '命令']);
  assert.equal(groups[0].rows[0].book.id, '1');
  assert.deepEqual(groups[2].rows.map(r => r.kind), ['mark', 'hit']);
  assert.deepEqual(groups[3].rows.map(r => r.label), ['打印 Atlas'], 'disabled commands stay out');
  assert.deepEqual(groupResults('/atlas', source).map(g => g.title), ['命令']);
  assert.ok(groupResults('/', source)[0].rows.length >= 1, 'a bare slash lists commands');
  assert.deepEqual(groupResults('   ', source), []);
  assert.equal(ran, 0);
});
test('note preview: title, two lines, and the PDF it links back to', () => {
  const p = notePreview("---\ntitle: x\n---\n# 读书 *笔记*\n\n> 第一行 **重点**\n- 第二行 [链接](http://a)\n第三行\n\n```\n# not a heading\n```\n[原文](file:///Users/a/%E8%AF%BB%20%E4%B9%A6.pdf#page=3&rect=1,2,3,4)\n", 'fallback');
  assert.equal(p.title, '读书 笔记'); assert.deepEqual(p.lines, ['第一行 重点', '第二行 链接']);
  assert.equal(p.source.name, '读 书.pdf');
  assert.equal(notePreview('plain text', 'name').title, 'name'); assert.equal(notePreview('', 'name').source, null);
  assert.equal(notePreview('[bad](file://%E0%A4%A#page=1)', 'n').source, null, 'a malformed link is not a source');
});
test('marks from the window are bounded and validated', () => {
  const many = Array.from({ length: 100 }, (_, i) => ({ page: i + 1, text: 'x'.repeat(1000), at: 5 }));
  const clean = cleanMarks({ annotations: -3, highlights: [...many, { page: 0, text: 'bad' }] });
  assert.equal(clean.annotations, 0); assert.equal(clean.highlights.length, 40); assert.equal(clean.highlights[0].text.length, 240);
  assert.deepEqual(cleanMarks(null), { annotations: 0, highlights: [] });
  assert.deepEqual(cleanMarks({ highlights: [{ page: 1.5, text: 'a' }, { page: 1, text: '  ' }, { page: 2, text: 7 }] }).highlights, []);
});
test('home store: at most 30 thumbnails, forgetting removes the files, concurrent writes all land', async () => {
  const directory = mkdtempSync(join(tmpdir(), 'qy-home-'));
  try {
    const store = () => createHomeData({ directory, keyOf: f => f, write: async (file, bytes) => { mkdirSync(join(file, '..'), { recursive: true }); writeFileSync(file, bytes); } });
    const data = store(), jpeg = 'data:image/jpeg;base64,' + Buffer.from('jpeg').toString('base64');
    await assert.rejects(data.putThumb('/x.pdf', 1, 'data:text/html;base64,AAAA'), /格式无效/);
    await assert.rejects(data.putThumb('/x.pdf', 1, 'data:image/jpeg;base64,' + Buffer.alloc(1024 * 1024 + 1).toString('base64')), /过大/);
    await Promise.all(Array.from({ length: MAX_THUMBS + 5 }, (_, n) => data.putThumb(`/doc${n}.pdf`, n + 1, jpeg)));
    assert.equal(readdirSync(join(directory, 'thumbs')).length, MAX_THUMBS);
    await Promise.all(Array.from({ length: 8 }, (_, n) => data.putMarks(`/doc${n}.pdf`, 'sig' + n, { annotations: n, highlights: [{ page: 1, text: 't' + n }] })));
    const saved = JSON.parse(readFileSync(join(directory, 'index.json'), 'utf8'));
    assert.equal(saved.thumbs.length, MAX_THUMBS); assert.equal(saved.marks.length, 8);
    const again = store();
    assert.equal((await again.info('/doc3.pdf')).marks.annotations, 3);
    const kept = saved.thumbs[0].path;
    assert.equal(await again.getThumb(kept), jpeg);
    await again.forget(kept); assert.equal(await again.getThumb(kept), null);
    await again.putThumb('/pinned.pdf', 1, jpeg); await again.putThumb('/other.pdf', 1, jpeg);
    await again.clear(file => file === '/pinned.pdf');
    assert.equal(await again.getThumb('/pinned.pdf'), jpeg); assert.equal(await again.getThumb('/other.pdf'), null);
    await again.clear(); assert.equal(existsSync(join(directory, 'thumbs')), false); assert.deepEqual((await again.info('/doc3.pdf')).marks, null);
  } finally { rmSync(directory, { recursive: true, force: true }); }
});
test('every new home text is translated, and titles stay untranslated', () => {
  const en = JSON.parse(readFileSync(new URL('ui/i18n/en.json', root), 'utf8')), patterns = en.patterns.map(([re]) => new RegExp(re));
  const html = readFileSync(new URL('ui/index.html', root), 'utf8'), section = html.slice(html.indexOf('<section id="home"'), html.indexOf('<div class="dropCue"'));
  const shown = [...section.matchAll(/>([^<>]*[一-鿿][^<>]*)</g)].map(m => m[1].trim());
  for (const attr of section.matchAll(/(?:placeholder|aria-label|title)="([^"]*[一-鿿][^"]*)"/g)) shown.push(attr[1]);
  const home = readFileSync(new URL('ui/home.mjs', root), 'utf8');
  // Quoted literals only: a run of code between two quotes is not a string, and "打开 " prefixes a file name.
  for (const lit of home.matchAll(/'([^'\n]*[一-鿿][^'\n]*)'/g)) if (!/[`$]/.test(lit[1]) && lit[1].trim() !== '打开') shown.push(lit[1]);
  const missing = shown.filter(text => !en.strings[text] && !patterns.some(re => re.test(text)));
  assert.deepEqual(missing, []);
  for (const sample of ['第 34 页，共 120 页', '今天 13:52 读过', '3 个书签', '5 条批注', '从第 34 页继续', '全部 12', '共 8 页', '第 3 / 12 页']) assert.ok(patterns.some(re => re.test(sample)), sample);
  assert.match(home, /own\('h2', 'readingTitle'/); assert.match(home, /e\.setAttribute\('translate', 'no'\)/);
});
test('the home page keeps the type scale and no colour of its own', () => {
  const css = readFileSync(new URL('ui/home.css', root), 'utf8'), own = css.slice(0, css.indexOf('/* 全部文档'));
  assert.match(css, /"Noto Serif SC", "Source Han Serif SC", "Songti SC", serif/);
  for (const size of [12, 13, 15, 19, 28, 40]) assert.match(css, new RegExp(`--t${size}: ${size}px`));
  assert.deepEqual([...own.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0]).filter(c => c !== '#fff'), []);
  assert.match(css, /prefers-reduced-motion: reduce/);
});
