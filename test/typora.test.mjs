// Typora-style Markdown features: syntax extensions, pure commands, key handling, themes, HTML→Markdown,
// export helpers and the main-process tools (folder tree, history, Pandoc when installed).
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { md, analyze } from '../ui/markdown/parser.mjs';
import * as C from '../ui/markdown/commands.mjs';
import { eventCombo, normalizeCombo, effectiveKeys, findConflicts } from '../ui/markdown/keys.mjs';
import { scopeThemeCss } from '../ui/markdown/themes.mjs';
import { makeZip, crc32 } from '../ui/markdown/zip.mjs';
import { searchEmoji, EMOJI } from '../ui/markdown/emoji.mjs';
import { buildRegistry, menuModel } from '../ui/markdown/registry.mjs';
const require = createRequire(import.meta.url);
const tools = require('../markdown-tools.cjs');
const { createHash } = require('node:crypto');
const fsp = await import('node:fs/promises'), os = await import('node:os'), path = await import('node:path');

const html = text => md.render(text, { taskIndex: 0 });
const apply = (text, r) => C.applyChanges(text, r.changes);

test('offline diagram assets match their pinned upstream manifest and license texts', async () => {
  const base = new URL('../vendor/diagrams/', import.meta.url);
  const entries = JSON.parse(await fsp.readFile(new URL('SOURCES.json', base), 'utf8'));
  for (const entry of entries) {
    assert.ok(entry.version && entry.source.startsWith('https://'));
    assert.equal(createHash('sha256').update(await fsp.readFile(new URL(entry.file, base))).digest('hex'), entry.sha256, entry.file);
  }
  assert.ok(entries.some(e => e.file === 'flowchart.min.js' && e.version === '1.18.0'));
  assert.ok(entries.some(e => e.file === 'sequence-diagram-raphael-min.js' && e.version === '2.0.1'));
  assert.match(await fsp.readFile(new URL('LICENSES/js-sequence-diagrams.txt', base), 'utf8'), /Redistribution and use in source and binary forms/);
  for (const kind of ['sequence', 'flow', 'flowchart']) {
    const rendered = html('```' + kind + '\n<script>alert(1)</script>\n```');
    assert.match(rendered, /mdMermaidSource/); assert.doesNotMatch(rendered, /<script>/);
  }
});

test('inline extensions: highlight, sub/sup, emoji, and strikethrough stays intact', () => {
  const h = html('==hi== H~2~O x^2^ ~~gone~~ :smile:');
  assert.match(h, /<mark>hi<\/mark>/); assert.match(h, /H<sub>2<\/sub>O/); assert.match(h, /x<sup>2<\/sup>/);
  assert.match(h, /<s>gone<\/s>/); assert.match(h, /😄/);
  assert.doesNotMatch(html('a == b'), /<mark>/);
});
test('footnotes, [TOC] and GitHub alerts render', () => {
  const doc = '[TOC]\n\n# A\n\n## B\n\ntext[^1]\n\n> [!WARNING]\n> careful\n\n[^1]: the note\n';
  const h = html(doc);
  assert.match(h, /class="mdToc"/); assert.match(h, /mdFootnoteRef/); assert.match(h, /mdFootnoteDef/); assert.match(h, /mdAlert-WARNING/i);
  assert.match(html('> plain quote'), /<blockquote/);
});
test('analyze exposes document info for footnotes and headings', () => {
  const { info, blocks } = analyze('# T\n\nx[^a]\n\n[^a]: d\n');
  assert.ok(info); assert.ok(blocks.some(b => b.kind === 'footnoteDef'));
});
test('pure commands: underline, highlight, sub/sup, comment, clear format', () => {
  const sel = (t, from, to) => ({ text: t, sel: { from, to } });
  let { text, sel: s } = sel('hello', 0, 5);
  assert.equal(apply(text, C.toggleWrap(text, s, '<u>', '</u>')), '<u>hello</u>');
  assert.equal(apply(text, C.toggleWrap(text, s, '==', '==')), '==hello==');
  const wrapped = '==hello==';
  assert.equal(apply(wrapped, C.toggleWrap(wrapped, { from: 2, to: 7 }, '==', '==')), 'hello', 'toggles off');
  assert.equal(C.clearFormatText('**a** _b_ ==c== `d`').replace(/`/g, ''), 'a b c d');
});
test('footnote / TOC / front matter / alert / heading shifts', () => {
  const r = C.insertFootnote('word', { from: 4, to: 4 });
  assert.match(apply('word', r), /word\[\^1\]/); assert.match(apply('word', r), /\[\^1\]: /);
  assert.match(apply('x', C.insertToc('x', { from: 0, to: 0 })), /\[TOC\]/);
  assert.ok(apply('body\n', C.insertFrontMatter('body\n', { from: 0, to: 0 })).startsWith('---\n'));
  assert.match(apply('t', C.insertAlert('t', { from: 0, to: 1 }, 'TIP')), /> \[!TIP\]/);
  assert.equal(apply('## A', C.shiftHeading('## A', { from: 0, to: 0 }, 1)), '# A');
  assert.equal(apply('# A', C.shiftHeading('# A', { from: 0, to: 0 }, -1)), '## A');
});
test('table editing keeps a rectangular table', () => {
  const t = '| a | b |\n| --- | --- |\n| 1 | 2 |\n| 3 | 4 |\n';
  const rows = r => r.trim().split('\n').map(l => l.split('|').length);
  for (const op of ['rowBelow', 'colAfter', 'deleteRow', 'colLeft', 'format']) {
    const out = apply(t, C.tableEdit(t, t.indexOf('4'), op));
    const w = rows(out); assert.ok(w.every(x => x === w[0]), op + ' rectangular');
  }
  assert.equal(C.tableInfo(t, 2).columns, 2);
  const resized = apply(t, C.tableEdit(t, 2, 'resize', [3, 4]));
  assert.equal(resized.trim().split('\n').length, 5); assert.equal(resized.split('\n')[0].split('|').length, 6);
  assert.match(apply(t, C.tableEdit(t, 2, 'align', 'center')), /:-+:/);
});
test('semantic selection helpers', () => {
  assert.deepEqual(C.wordRange('hello world', 2), { from: 0, to: 5 });
  assert.deepEqual(C.lineRange('a\nbcd\ne', 3), { from: 2, to: 5 });
});
test('key combos normalise, resolve, disable defaults and report conflicts', () => {
  assert.equal(eventCombo({ ctrlKey: true, shiftKey: true, code: 'KeyH', key: 'H' }), 'Ctrl+Shift+H');
  assert.equal(normalizeCombo('shift+ctrl+h'), 'Ctrl+Shift+H');
  const cmds = [{ id: 'a', keys: ['Ctrl+B'] }, { id: 'b', keys: ['Ctrl+I'] }];
  const e = effectiveKeys(cmds, { a: 'Ctrl+Alt+B' });
  assert.equal(e.map.get('Ctrl+Alt+B'), 'a'); assert.ok(e.disabled.has('Ctrl+B')); assert.ok(!e.map.has('Ctrl+B'));
  assert.equal(findConflicts(cmds, { a: 'Ctrl+I' }).length, 1);
});
test('registry: every menu entry exists and default shortcuts are unique', () => {
  const H = new Proxy({}, { get: () => () => {} });
  const reg = buildRegistry(H), ids = new Set(reg.list.map(c => c.id));
  assert.equal(ids.size, reg.list.length, 'unique ids');
  const walk = items => { for (const it of items) { if (it === '-') continue; if (Array.isArray(it)) { if (typeof it[1] !== 'string') walk(it[1]); continue; } assert.ok(ids.has(it), 'menu item ' + it); } };
  for (const [, items] of menuModel(reg)) walk(items);
  const seen = new Map();
  for (const c of reg.list) for (const k of c.keys) { const n = normalizeCombo(k); assert.ok(!seen.has(n), `duplicate default ${n}: ${c.id}/${seen.get(n)}`); seen.set(n, c.id); }
  assert.ok(reg.list.length > 140);
});
test('theme CSS from #write/body is scoped to the document only', () => {
  const css = scopeThemeCss('#write h1 { color: red } body { background: #fff } @media print { #write p { margin: 0 } }', '.mdPanel[data-mdtheme="custom"]');
  assert.match(css, /\.mdPanel\[data-mdtheme="custom"\] \.mdDoc h1/);
  assert.doesNotMatch(css, /(^|\})\s*body/);
});
test('emoji table and zip writer', async () => {
  assert.ok(EMOJI.size > 500); assert.equal(searchEmoji('smile', 3)[0][0], 'smile');
  assert.equal(crc32(new TextEncoder().encode('123456789')), 0xcbf43926);
  const zip = await makeZip([{ name: 'a.txt', data: new TextEncoder().encode('hi') }]);
  assert.equal(new DataView(zip.buffer.slice(zip.byteOffset, zip.byteOffset + zip.byteLength)).getUint32(0, true), 0x04034b50);
});
test('folder tree lists only Markdown, prunes empty folders and skips hidden/vendor dirs', async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'qy-tree-'));
  try {
    for (const f of ['a.md', 'b.txt', 'sub/c.markdown', 'empty/x.png', 'node_modules/n.md', '.hidden/h.md']) { await fsp.mkdir(path.dirname(path.join(dir, f)), { recursive: true }); await fsp.writeFile(path.join(dir, f), 'x'); }
    const names = tools.flattenTree(await tools.listTree(dir)).map(f => path.relative(dir, f.path).split(path.sep).join('/'));
    assert.deepEqual(names.sort(), ['a.md', 'sub/c.markdown']);
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});
test('version history dedupes, caps and refuses path tricks', async () => {
  const base = await fsp.mkdtemp(path.join(os.tmpdir(), 'qy-hist-')), file = path.join(base, 'doc.md');
  try {
    assert.equal(await tools.snapshot(base, file, 'one'), true); assert.equal(await tools.snapshot(base, file, 'one'), false);
    await new Promise(r => setTimeout(r, 5)); await tools.snapshot(base, file, 'two', { keep: 2 }); await new Promise(r => setTimeout(r, 5)); await tools.snapshot(base, file, 'three', { keep: 2 });
    const list = await tools.listVersions(base, file); assert.equal(list.length, 2);
    assert.equal(await tools.readVersion(base, file, list[0].name), 'three');
    await assert.rejects(() => tools.readVersion(base, file, '../../x.md'), /无效/);
  } finally { await fsp.rm(base, { recursive: true, force: true }); }
});
test('image folders, custom themes and file-name safety', async () => {
  assert.equal(tools.imageFolder('/d/a.md', { mode: 'named' }), path.join('/d', 'a.assets'));
  assert.equal(tools.imageFolder('/d/a.md', { mode: 'custom', folder: 'img' }), path.join('/d', 'img'));
  assert.equal(tools.safeFileName('a/b:c*.md'), 'a_b_c_.md');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'qy-theme-'));
  try { await fsp.writeFile(path.join(dir, 't.css'), '#write{}'); assert.equal((await tools.listThemes(dir))[0].name, 't'); await assert.rejects(() => tools.readTheme(dir, '../t.css'), /无效/); } finally { await fsp.rm(dir, { recursive: true, force: true }); }
  assert.equal(tools.decodeWith(Buffer.from([0xc4, 0xe3, 0xba, 0xc3]), 'gbk').text, '你好');
});
test('Pandoc round trip when Pandoc is installed (skipped otherwise)', async t => {
  const info = await tools.findPandoc(); if (!info.found) return t.skip('pandoc not installed');
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'qy-pandoc-'));
  try {
    const out = path.join(dir, 'o.odt'); await tools.pandocExport(info.path, { format: 'odt', text: '# T\n\nhello ==x==\n', out, cwd: dir });
    assert.ok((await fsp.stat(out)).size > 500);
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});

test('Typora sequence / flow diagrams convert to Mermaid', async () => {
  const { sequenceToMermaid, flowToMermaid } = await import('../ui/markdown/diagrams-legacy.mjs');
  const seq = sequenceToMermaid('Title: Demo\nAlice->Bob: Hello Bob\nNote right of Bob: Bob thinks\nBob-->Alice: I am good\nAlice->>Bob: open\nThe Big Server->Bob: x');
  assert.match(seq, /^sequenceDiagram/); assert.match(seq, /title Demo/); assert.match(seq, /Alice->>Bob: Hello Bob/);
  assert.match(seq, /Bob-->>Alice/); assert.match(seq, /Alice-\)Bob/); assert.match(seq, /participant P\d+ as The Big Server/); assert.match(seq, /Note right of Bob: Bob thinks/);
  const flow = flowToMermaid('st=>start: Start\nop=>operation: Your Operation\ncond=>condition: Yes or No?\ne=>end\n\nst->op->cond\ncond(yes)->e\ncond(no)->op');
  assert.match(flow, /^flowchart TD/); assert.match(flow, /st\(\["Start"\]\)/); assert.match(flow, /cond\{"Yes or No\?"\}/);
  assert.match(flow, /cond -->\|yes\| e/); assert.match(flow, /cond -->\|no\| op/); assert.match(flow, /st --> op/);
  assert.throws(() => flowToMermaid('a=>bogus: x'), /未知/); assert.throws(() => sequenceToMermaid('nonsense'), /无法识别/);
  assert.match(md.render('```sequence\nA->B: hi\n```'), /class="mdMermaid" data-kind="sequence"/);
});

test('Pandoc without the mark extension: retried once without +mark (0.8)', { skip: process.platform === 'win32' && 'uses a POSIX shell stand-in for pandoc' }, async () => {
  const dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'qy-oldpandoc-'));
  try {
    const fake = path.join(dir, 'pandoc'), log = path.join(dir, 'calls.txt');
    await fsp.writeFile(fake, `#!/bin/sh\necho "$2" >> "${log}"\ncase "$2" in *+mark*) echo "Unknown extension: mark" >&2; exit 23;; esac\ncat > /dev/null\nexit 0\n`, { mode: 0o755 });
    await tools.pandocExport(fake, { format: 'odt', text: '# T\n', out: path.join(dir, 'o.odt') });
    const calls = (await fsp.readFile(log, 'utf8')).trim().split('\n');
    assert.deepEqual(calls, [tools.PANDOC_FROM, tools.PANDOC_FROM_LEGACY]);
    await fsp.writeFile(fake, `#!/bin/sh\necho "other failure" >&2\nexit 2\n`, { mode: 0o755 });
    await assert.rejects(tools.pandocExport(fake, { format: 'odt', text: '# T\n', out: path.join(dir, 'o.odt') }), /other failure/);
  } finally { await fsp.rm(dir, { recursive: true, force: true }); }
});
