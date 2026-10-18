// 0.20 correctness fixes from the 0.19.1 review (docs: CHANGELOG 0.20.0).
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { createDraftRecovery } from '../ui/draft-recovery.mjs';

const require = createRequire(import.meta.url);
const { Recovery } = require('../recovery.cjs');

test('draft recovery: a canceled save keeps the draft available after a crash', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'qingye-020-draft-'));
  try {
    const recovery = new Recovery(folder, 99999999);
    const s = { id: 'a1b2c3d4-0000-4000-8000-000000000001', loaded: true, saving: false, dirty: true, editor: { version: 1, exportHistory: () => '[]' } };
    const sessions = new Map([[s.id, s]]);
    // The main process adds name / kind before writing (main.cjs 'checkpoint').
    const api = { checkpoint: items => recovery.checkpoint(items.map(i => ({ ...i, name: 'note.md', kind: 'markdown' })), s.id) };
    const drafts = createDraftRecovery({ api, sessions, isMd: () => true, viewState: () => ({}), syncDirty() {}, markdown: { text: () => '未保存的笔记' }, status() {}, userError: e => String(e), activeId: () => s.id, isClosing: () => false });
    assert.equal(await drafts.checkpoint(), true);                 // 1. backup
    const first = recovery.entries[0].draft; assert.ok(first);
    s.saving = true; assert.equal(await drafts.checkpoint(), true); // 2. save dialog open
    assert.equal(recovery.entries[0].draft, first, 'draft kept while saving');
    s.saving = false; assert.equal(await drafts.checkpoint(), true); // 3. canceled, content unchanged → no rewrite
    assert.equal(recovery.entries[0].draft, first, 'draft kept after the save was canceled');
    const found = await new Recovery(folder).list();                // 4. crash → next start
    assert.equal(found.length, 1);
    assert.equal(await fs.readFile(path.join(folder, found[0].entries[0].draft), 'utf8'), '未保存的笔记');
  } finally { await fs.rm(folder, { recursive: true, force: true }); }
});

test('library search: snippets of later Markdown paragraphs show the matched text', () => {
  const { searchDocument } = require('../library-index.cjs');
  const text = 'FIRST paragraph here\n\nsecond has the needle inside';
  const { hits } = searchDocument({ kind: 'markdown', pages: [text] }, ['needle']);
  assert.equal(hits.length, 1);
  assert.equal(hits[0].match, 'needle');
  assert.equal(hits[0].line, 3);
  assert.equal(text.slice(hits[0].offset, hits[0].offset + 6), 'needle');
  assert.match(hits[0].before, /second has the $/);
});

test('library search: long notes are indexed in full; cut documents are reported; old indexes rebuild', async () => {
  const { createLibraryIndex, indexPages, search, LIMITS, INDEX_VERSION } = require('../library-index.cjs');
  const long = 'x'.repeat(LIMITS.pageChars + 1000) + ' tailword';
  assert.equal(indexPages([long], 'markdown').truncated, null, 'a 200k+ note is not cut');
  const pdf = indexPages([long], 'pdf');
  assert.equal(pdf.pages[0].length, LIMITS.pageChars); assert.deepEqual(pdf.truncated, { indexedChars: LIMITS.pageChars });
  const huge = indexPages(['y'.repeat(LIMITS.documentChars + 10)], 'markdown');
  assert.equal(huge.truncated.indexedChars, LIMITS.documentChars);
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qingye-020-index-'));
  try {
    const file = path.join(dir, 'note.md'); await fs.writeFile(file, long);
    const index = createLibraryIndex({ directory: path.join(dir, 'index') });
    await index.put(file, { kind: 'markdown', pages: [long] });
    const found = await index.find('tailword', [file]);
    assert.equal(found.total, 1); assert.deepEqual(found.truncated, []);
    // An index file written by 0.19 (version 1) is stale and gets rebuilt.
    const [name] = await fs.readdir(path.join(dir, 'index')); const p = path.join(dir, 'index', name);
    await fs.writeFile(p, JSON.stringify({ ...JSON.parse(await fs.readFile(p, 'utf8')), version: 1 }));
    assert.equal(await createLibraryIndex({ directory: path.join(dir, 'index') }).state(file), 'stale');
    assert.equal(INDEX_VERSION, 2);
    assert.deepEqual(search([{ name: 'big.pdf', path: 'b', kind: 'pdf', pages: ['abc'], truncated: { indexedChars: 3 } }], 'zzz').truncated, [{ name: 'big.pdf', path: 'b', indexedChars: 3 }]);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('office: a canceled open is canceled on the cache path too', async () => {
  const office = require('../office-convert.cjs');
  const crypto = require('node:crypto');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qingye-020-office-'));
  try {
    // A stand-in engine file: the cache hit returns before LibreOffice would run.
    const program = path.join(dir, 'resources', 'libreoffice', 'program'); await fs.mkdir(program, { recursive: true });
    await fs.writeFile(path.join(program, process.platform === 'win32' ? 'soffice.com' : 'soffice'), '');
    const file = path.join(dir, 'a.docx'), source = Buffer.from('word'); await fs.writeFile(file, source);
    const cacheDir = path.join(dir, 'cache'); await fs.mkdir(cacheDir);
    await fs.writeFile(path.join(cacheDir, crypto.createHash('sha256').update(source).digest('hex') + '.pdf'), '%PDF-1.4 cached');
    const options = { packaged: true, resources: path.join(dir, 'resources'), profileDir: path.join(dir, 'profile'), cacheDir };
    assert.equal((await office.toPdf(file, options)).cached, true, 'cache works');
    const controller = new AbortController(); controller.abort();
    await assert.rejects(office.toPdf(file, { ...options, signal: controller.signal }), { code: 'OFFICE_CANCELED' });
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('compare: identical dense pages are equal; oversized differences are reported, not faked', async () => {
  const { diffTokens } = await import('../ui/compare-diff.mjs');
  const tokens = n => Array.from({ length: n }, (_, i) => ({ text: 't' + i, rect: [0, 0, 1, 1] }));
  const same = diffTokens(tokens(2500), tokens(2500));
  assert.ok(same && same.every(op => op[0] === '='), 'identical 2,500-token pages are equal');
  const edited = tokens(2500); edited[1200] = { text: 'changed', rect: [0, 0, 1, 1] };
  assert.deepEqual(diffTokens(tokens(2500), edited).filter(op => op[0] !== '='), [['-', 1200], ['+', 1200]]);
  const other = Array.from({ length: 2500 }, (_, i) => ({ text: 'u' + i, rect: [0, 0, 1, 1] }));
  assert.equal(diffTokens(tokens(2500), other), null, 'too large to compare → null (caller marks the page incomplete)');
});

test('conversion center: Office → PDF uses the layout engine unless reflow or Pandoc arguments are chosen', async t => {
  const engine = require('../pandoc-engine.cjs');
  if (!(await fs.stat(engine.bundledPath()).then(() => true, () => false))) return t.skip('bundled Pandoc not prepared');
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qingye-020-convert-'));
  try {
    const input = path.join(dir, 'a.docx'); await fs.writeFile(input, 'x');
    const seen = [];
    const layoutPdf = async file => { seen.push(path.basename(file)); return Buffer.from('%PDF-1.7 laid out'); };
    const result = await engine.convertFile({ inputs: [input], target: path.join(dir, 'a.pdf'), to: 'pdf-chromium', layoutPdf });
    assert.equal(result.engine, 'libreoffice');
    assert.equal(await fs.readFile(path.join(dir, 'a.pdf'), 'utf8'), '%PDF-1.7 laid out');
    assert.deepEqual(seen, ['a.docx']);
    // Not an Office target (or layoutPdf declines) → the normal Pandoc path runs.
    const md = path.join(dir, 'b.md'); await fs.writeFile(md, '# Title');
    const html = await engine.convertFile({ inputs: [md], target: path.join(dir, 'b.html'), to: 'html', layoutPdf });
    assert.notEqual(html.engine, 'libreoffice'); assert.deepEqual(seen, ['a.docx']);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
