// Markdown editor: pure parsing / styling / command behaviour (no DOM, no Electron).
import test from 'node:test';
import assert from 'node:assert/strict';
import { analyze, md } from '../ui/markdown/parser.mjs';
import { styleSource } from '../ui/markdown/source-style.mjs';
import * as C from '../ui/markdown/commands.mjs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const files = require('../markdown-files.cjs');

const run = (text, result) => ({ text: C.applyChanges(text, result.changes), sel: result.selection });
const at = (text, marker = '|') => { const i = text.indexOf(marker); return { text: text.slice(0, i) + text.slice(i + 1), sel: { from: i, to: i } }; };
const range = text => { const a = text.indexOf('['), b = text.indexOf(']') - 1; return { text: text.replace('[', '').replace(']', ''), sel: { from: a, to: b } }; };
const unhtml = h => h.replace(/<[^>]+>/g, '').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

test('block analysis splits top-level blocks, list items and uncovered lines', () => {
  const doc = '---\na: 1\n---\n\n# T\n\ntext $x$\n\n- a\n- [x] b\n\n1. one\n1. two\n\n```js\nx\n```\n\n$$\ny\n$$\n\n| a | b |\n|---|---|\n| 1 | 2 |\n\n[r]: http://x';
  const { blocks, headings } = analyze(doc);
  assert.deepEqual(blocks.map(b => b.kind), ['frontMatter', 'heading', 'paragraph', 'listItem', 'listItem', 'listItem', 'listItem', 'fence', 'math', 'table', 'raw']);
  assert.deepEqual(blocks.filter(b => b.ordered).map(b => b.number), [1, 2]);
  assert.equal(blocks[4].task, true);
  assert.deepEqual(headings.map(h => [h.level, h.text]), [[1, 'T']]);
  for (const b of blocks) assert.equal(doc.slice(b.from, b.to).trim(), doc.slice(b.from, b.to), 'blocks are trimmed');
});

test('rendering: math, tasks, tables, code highlighting, front matter', () => {
  const html = md.render('- [x] done\n\n$$\na^2\n$$\n\ninline $b_1$ and $5 and $6\n\n```python\ndef f(): pass\n```\n', {});
  assert.match(html, /class="mdTask" data-task="0" checked/);
  assert.match(html, /class="mdMathBlock"><span class="katex-display">/);
  assert.match(html, /class="mdMath"/);
  assert.match(html, /\$5 and \$6/, 'currency amounts are not math');
  assert.match(html, /hljs-keyword">def</);
  assert.match(md.render('---\ntitle: x\n---\n', {}), /mdFrontMatter/);
  const diagram = md.render('```mermaid\nflowchart LR\n  A[<b>x</b>] --> B\n```\n', {});
  assert.match(diagram, /class="mdMermaid"/);
  assert.match(diagram, /<pre class="mdMermaidSource"><code>flowchart LR\n  A\[&lt;b&gt;x&lt;\/b&gt;\] --&gt; B/, 'diagram source is carried as escaped text');
});

test('live source styling preserves the exact text', () => {
  const samples = [['# H **b** `c` $x$ #', 'heading'], ['a *e* __s__ ~~d~~ [l](u "t") ![i](a b.png) <br> \\* https://x.org/a.', 'paragraph'], ['- [ ] t\n- [x] d', 'listItem'], ['> q\n> > n', 'blockquote'], ['```js\nconst a = "<b>";\n```', 'fence'], ['$$\n\\frac{a}{b}\n$$', 'math'], ['| a | b \\| c |\n|:--|--:|\n| `x|y` | $z$ |', 'table'], ['- item\n  ```py\n  x=1\n  ```', 'listItem']];
  for (const [src, kind] of samples) assert.equal(unhtml(styleSource(src, kind)), src, kind);
});

test('inline formatting toggles', () => {
  let { text, sel } = range('say [hello] now');
  let r = run(text, C.toggleInline(text, sel, '**'));
  assert.equal(r.text, 'say **hello** now'); assert.equal(r.text.slice(r.sel.from, r.sel.to), 'hello');
  r = run(r.text, C.toggleInline(r.text, r.sel, '**'));
  assert.equal(r.text, 'say hello now');
  ({ text, sel } = range('[ spaced ]'));
  assert.equal(run(text, C.toggleInline(text, sel, '*')).text, ' *spaced* ');
  ({ text, sel } = at('ab|cd'));
  r = run(text, C.toggleInline(text, sel, '`'));
  assert.equal(r.text, 'ab``cd'); assert.equal(r.sel.from, 3);
});

test('headings, quotes and lists toggle per line', () => {
  let { text, sel } = at('para|graph');
  assert.equal(run(text, C.setHeading(text, sel, 2)).text, '## paragraph');
  assert.equal(run('## x', C.setHeading('## x', { from: 3, to: 3 }, 2)).text, 'x');
  assert.equal(run('### x', C.setHeading('### x', { from: 4, to: 4 }, 1)).text, '# x');
  const lines = 'a\nb\nc';
  assert.equal(run(lines, C.toggleLinePrefix(lines, { from: 0, to: 5 }, 'ordered')).text, '1. a\n2. b\n3. c');
  assert.equal(run('- a\n- b', C.toggleLinePrefix('- a\n- b', { from: 0, to: 7 }, 'bullet')).text, 'a\nb');
  assert.equal(run('- a', C.toggleLinePrefix('- a', { from: 1, to: 1 }, 'task')).text, '- [ ] a');
  assert.equal(run('x', C.toggleLinePrefix('x', { from: 0, to: 0 }, 'quote')).text, '> x');
});

test('block insertion keeps blank-line separation', () => {
  let r = run('text', C.insertTable('text', { from: 4, to: 4 }));
  assert.match(r.text, /^text\n\n\| 列 1 \| 列 2 \| 列 3 \|\n\| --- \| --- \| --- \|/);
  assert.equal(r.text.slice(r.sel.from, r.sel.to), '列 1');
  r = run('a\n\nb', C.insertMathBlock('a\n\nb', { from: 2, to: 2 }));
  assert.equal(r.text, 'a\n\n$$\n\n$$\n\nb'); assert.equal(r.sel.from, 6);
  r = run('x', C.insertCodeBlock('x', { from: 0, to: 1 }));
  assert.equal(r.text, '```\nx\n```');
});

test('tables: format, navigate, add rows and columns', () => {
  const t = '|a|中文|\n|:-|-:|\n|1|2|';
  const f = run(t, C.formatTable(t, 1));
  assert.equal(f.text, '| a   | 中文 |\n| :-- | ---: |\n| 1   |    2 |');
  let nav = run(f.text, C.tableNavigate(f.text, 2, 1));
  assert.equal(nav.text.slice(nav.sel.from, nav.sel.to), '中文');
  nav = run(nav.text, C.tableNavigate(nav.text, nav.sel.from, 1));
  assert.equal(nav.text.slice(nav.sel.from, nav.sel.to), '1');
  const last = nav.text.lastIndexOf('2');
  const grown = run(nav.text, C.tableNavigate(nav.text, last, 1));
  assert.equal(grown.text.split('\n').length, 4, 'Tab in the last cell adds a row');
  const col = run(f.text, C.tableAddColumn(f.text, 2));
  assert.match(col.text.split('\n')[0], /列 3/);
});

test('Enter: new paragraph, list continuation, list exit, fence auto-close, code newline', () => {
  const doc = 'hello world';
  let a = analyze(doc).blocks[0];
  let r = run(doc, C.enter(doc, a, { from: 5, to: 5 }));
  assert.equal(r.text, 'hello\n\nworld'); assert.equal(r.sel.from, 7);
  const list = '- [ ] one';
  a = analyze(list).blocks[0];
  r = run(list, C.enter(list, a, { from: list.length, to: list.length }));
  assert.equal(r.text, '- [ ] one\n- [ ] ');
  const exit = '1. one\n2. ';
  a = analyze(exit).blocks[0];
  assert.equal(run(exit, C.enter(exit, { ...a, kind: 'listItem' }, { from: exit.length, to: exit.length })).text, '1. one\n');
  const numbered = '9. nine';
  r = run(numbered, C.enter(numbered, analyze(numbered).blocks[0], { from: 7, to: 7 }));
  assert.equal(r.text, '9. nine\n10. ');
  const fence = '```py';
  r = run(fence, C.enter(fence, analyze(fence).blocks[0], { from: 5, to: 5 }));
  assert.equal(r.text, '```py\n\n```'); assert.equal(r.sel.from, 6);
  const code = '```\nx\n```';
  r = run(code, C.enter(code, analyze(code).blocks[0], { from: 5, to: 5 }));
  assert.equal(r.text, '```\nx\n\n```');
  const header = '| a | b |';
  r = run(header, C.enter(header, analyze(header).blocks[0], { from: header.length, to: header.length }));
  assert.equal(r.text.split('\n').length, 3); assert.match(r.text, /\| --- \| --- \|/);
  r = run('text', C.enter('text', analyze('text').blocks[0], { from: 4, to: 4 }, { shift: true }));
  assert.equal(r.text, 'text  \n');
});

test('task toggling, search and replacement expansion, word count', () => {
  const doc = '- [ ] a\n- [x] b';
  const block = { from: 0, to: doc.length };
  assert.equal(C.applyChanges(doc, C.toggleTask(doc, block, 1).changes), '- [ ] a\n- [ ] b');
  const m = C.findMatches('Foo foo food', { query: 'foo', wholeWord: true });
  assert.deepEqual(m.map(x => x.from), [0, 4]);
  assert.equal(C.findMatches('a', { query: '(', regex: true }).error.startsWith('正则表达式无效'), true);
  const r = C.findMatches('2026-09-29', { query: '(\\d+)-(\\d+)', regex: true });
  assert.equal(C.expandReplacement(r[0], '$2/$1', true), '09/2026');
  assert.deepEqual(C.countWords('你好 world, it’s fine'), { words: 5, characters: 16, lines: 1 });
});

test('file encoding round trips: BOM, CRLF, UTF-16, GBK notice', () => {
  const utf8 = Buffer.from('﻿# 标题\r\n\r\n正文\r\n');
  const decoded = files.decodeMarkdown(utf8);
  assert.equal(decoded.text, '# 标题\n\n正文\n');
  assert.deepEqual(files.encodeMarkdown(decoded.text, decoded), utf8);
  const utf16 = Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from('a\nb', 'utf16le')]);
  assert.deepEqual(files.encodeMarkdown(files.decodeMarkdown(utf16).text, files.decodeMarkdown(utf16)), utf16);
  const gbk = files.decodeMarkdown(Buffer.from([0xc4, 0xe3, 0xba, 0xc3]));
  assert.equal(gbk.text, '你好'); assert.match(gbk.notice, /UTF-8/);
  assert.throws(() => files.decodeMarkdown(Buffer.from([0x61, 0, 0x62])), /二进制/);
  assert.equal(files.markdownPath('/d/doc.md', '/d/assets/a b.png'), '<assets/a b.png>');
  assert.equal(files.resolveLocal('/d/doc.md', 'https://x.org/a.png'), null);
});

test('recovery keeps Markdown drafts as .md files and lists them', async () => {
  const os = await import('node:os'), fsp = await import('node:fs/promises'), path = await import('node:path');
  const { Recovery } = require('../recovery.cjs');
  const folder = await fsp.mkdtemp(path.join(os.tmpdir(), 'qingye-md-recovery-'));
  try {
    const abandoned = new Recovery(folder, 999999999);
    await abandoned.checkpoint([{ id: 'a', kind: 'markdown', name: 'n.md', path: null, hash: null, dirty: true, text: '# 草稿\n', state: {} }], 'a');
    const draft = abandoned.entries[0].draft;
    assert.match(draft, /\.md$/);
    assert.equal(await fsp.readFile(path.join(folder, draft), 'utf8'), '# 草稿\n');
    await abandoned.checkpoint([{ id: 'a', kind: 'markdown', name: 'n.md', path: null, hash: null, dirty: true, state: {} }], 'a');
    assert.equal(abandoned.entries[0].draft, draft, 'unchanged dirty draft is kept');
    const found = await new Recovery(folder).list();
    assert.equal(found[0].entries[0].draft, draft);
  } finally { await fsp.rm(folder, { recursive: true, force: true }); }
});
