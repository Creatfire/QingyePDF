// 0.14 Pandoc integration: editor dialect, import writer, Word export with diagrams / [toc] /
// themed reference document. Real-engine tests run when the bundled Pandoc is present.
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createRequire } from 'node:module';
import { preparePandocMarkdown, htmlImageToPandoc, DOCX_TOC_FIELD } from '../ui/markdown/pandoc-prep.mjs';

const require = createRequire(import.meta.url);
const bridge = require('../pandoc-markdown.cjs');
const engine = require('../pandoc-engine.cjs');
const pandoc = engine.bundledPath();
const hasPandoc = await fs.stat(pandoc).then(() => true, () => false);
const tmp = () => fs.mkdtemp(path.join(os.tmpdir(), 'qy-p014-'));

test('preparePandocMarkdown: diagrams become image references, code and front matter stay', () => {
  const src = '---\ntitle: T\n---\n\n[toc]\n\n```mermaid\ngraph TD; A-->B\n```\n\n```js\n[toc]\n<img src="x.png">\n```\n\n- item\n\n  ```sequence\n  A->B: hi\n  ```\n\n`<img src="code.png">` and <img src="a b.png" style="zoom:50%">';
  const docx = preparePandocMarkdown(src, { target: 'docx' });
  assert.deepEqual(docx.diagrams.map(d => [d.file, d.lang, d.source]), [['qy-diagram-1.png', 'mermaid', 'graph TD; A-->B'], ['qy-diagram-2.png', 'sequence', 'A->B: hi']]);
  assert.match(docx.text, /^---\ntitle: T\n---\n/);
  assert.ok(docx.text.includes('```{=openxml}\n' + DOCX_TOC_FIELD + '\n```'));
  assert.ok(docx.text.includes('![](qy-diagram-1.png)') && docx.text.includes('  ![](qy-diagram-2.png)'));
  assert.ok(docx.text.includes('```js\n[toc]\n<img src="x.png">\n```'), 'fenced code is copied verbatim');
  assert.ok(docx.text.includes('`<img src="code.png">`'), 'inline code is untouched');
  assert.ok(docx.text.includes('![](<a b.png>){width=50%}'));
  assert.equal(docx.toc, false);
  const epub = preparePandocMarkdown('[TOC]\n\ntext', { target: 'epub' });
  assert.equal(epub.toc, true); assert.equal(epub.text, '\ntext');
  assert.equal(preparePandocMarkdown('~~~~\n```\n~~~~').text, '~~~~\n```\n~~~~', 'a shorter inner fence does not close the block');
  const boxed = preparePandocMarkdown('```mermaid\na\n```\n\n> [!WARNING]\n> 小心\n>\n> ```mermaid\n> b\n> ```\n\n后文');
  assert.equal(boxed.text, '![](qy-diagram-1.png)\n\n::: {.warning}\n::: title\n警告\n:::\n小心\n\n![](qy-diagram-2.png)\n:::\n\n后文');
  assert.deepEqual(boxed.diagrams.map(d => d.source), ['a', 'b']);
});

test('htmlImageToPandoc: Typora resize syntax', () => {
  assert.equal(htmlImageToPandoc('<img src="a.png" width="300">'), '![](a.png){width=300px}');
  assert.equal(htmlImageToPandoc("<img alt='图 [1]' src='a.png' style='zoom: 0.5'>"), '![图 \\[1\\]](a.png){width=50%}');
  assert.equal(htmlImageToPandoc('<img src="a.png" width="bogus">'), '![](a.png)');
  assert.equal(htmlImageToPandoc('<img alt="x">'), '<img alt="x">');
});

test('withDialect drops unknown reader extensions one at a time', async () => {
  const seen = [];
  const out = await bridge.withDialect(bridge.PANDOC_FROM, async from => {
    seen.push(from);
    if (from.includes('+mark')) throw new Error('Unknown extension: mark');
    if (from.includes('+alerts')) throw new Error('Unknown extension: alerts');
    return 'ok';
  });
  assert.equal(out, 'ok');
  assert.deepEqual(seen, [bridge.PANDOC_FROM, bridge.PANDOC_FROM_LEGACY, bridge.PANDOC_FROM_LEGACY.replace('+alerts', '')]);
  await assert.rejects(bridge.withDialect(bridge.PANDOC_FROM, async () => { throw new Error('boom'); }), /boom/);
  assert.equal(bridge.readerFor({ smart: true }).startsWith('markdown+'), true);
});

test('themeStyles writes explicit Latin / East Asian fonts, size and heading colour', () => {
  const xml = '<w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:asciiTheme="minorHAnsi" w:eastAsiaTheme="minorEastAsia" /><w:sz w:val="24" /><w:szCs w:val="24" /></w:rPr></w:rPrDefault></w:docDefaults>'
    + '<w:style w:type="paragraph" w:styleId="Heading1"><w:rPr><w:rFonts w:asciiTheme="majorHAnsi"\n w:eastAsiaTheme="majorEastAsia" /><w:color w:val="0F4761" w:themeColor="accent1" /></w:rPr></w:style>';
  const out = bridge.themeStyles(xml, { latin: 'Georgia', cjk: 'SimSun', headingCjk: 'SimHei', color: '#15201b', headingColor: '#1d7a57', sizePt: 12 });
  assert.match(out, /<w:rPrDefault><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:eastAsia="SimSun" w:cs="Georgia"\/><w:sz w:val="24"\/><w:szCs w:val="24"\/><w:color w:val="15201B"\/>/);
  assert.match(out, /Heading1"><w:rPr><w:rFonts w:ascii="Georgia" w:hAnsi="Georgia" w:eastAsia="SimHei" w:cs="Georgia"\/><w:color w:val="1D7A57"\/>/);
});

test('wordFonts / docxStyle map CSS font stacks to Word fonts', async () => {
  globalThis.window ??= globalThis;
  const { wordFonts, docxStyle } = await import('../ui/markdown/export-pandoc.mjs');
  assert.deepEqual(wordFonts('"Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI",system-ui,sans-serif'), { latin: 'Segoe UI', cjk: 'Microsoft YaHei' });
  assert.deepEqual(wordFonts('Georgia,"Times New Roman","Noto Serif SC",SimSun,serif'), { latin: 'Georgia', cjk: 'SimSun' });
  assert.deepEqual(wordFonts('serif'), { latin: 'Cambria', cjk: 'SimSun' });
  const style = docxStyle('newsprint', { fontSize: 18 });
  assert.equal(style.sizePt, 13.5); assert.equal(style.headingColor, '#7a1f1f');
});

test('real Pandoc: CJK line breaks, alerts, [toc], diagrams and themed styles in Word', { skip: !hasPandoc && 'bundled Pandoc not prepared' }, async () => {
  const dir = await tmp();
  try {
    const src = '# 标题\n\n[toc]\n\n这是第一行中文\n紧接着的第二行。\n\n> [!NOTE]\n> 提示框内容\n\n==高亮== H~2~O，"引号"\n\n```mermaid\ngraph TD; A-->B\n```\n\n$$E=mc^2$$\n\n脚注[^1]\n\n[^1]: 脚注内容\n';
    const prep = preparePandocMarkdown(src, { target: 'docx' });
    // 1×1 PNG stands in for the renderer's diagram output.
    const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64');
    const reference = await bridge.referenceDocx(pandoc, { latin: 'Georgia', cjk: 'SimSun', headingColor: '#1d7a57', sizePt: 12 });
    const { bytes } = await bridge.exportDocument(pandoc, { format: 'docx', text: prep.text, files: [{ name: 'qy-diagram-1.png', data: png }], reference });
    const entries = Object.fromEntries(bridge.readZip(bytes).map(e => [e.name, e.data]));
    const doc = entries['word/document.xml'].toString('utf8'), styles = entries['word/styles.xml'].toString('utf8');
    const text = [...doc.matchAll(/<w:t(?: [^>]*)?>([^<]*)<\/w:t>/g)].map(m => m[1]).join('').replace(/&quot;/g, '"').replace(/&amp;/g, '&');
    assert.ok(text.includes('这是第一行中文紧接着的第二行。'), 'no space inserted between CJK lines');
    assert.ok(!text.includes('[!NOTE]') && text.includes('注意提示框内容') && !text.includes('Note'), 'alert box with the Chinese title');
    assert.ok(text.includes('"引号"'), 'quotes kept as typed (-smart)');
    assert.match(doc, /TOC \\o "1-3"/); assert.match(doc, /<m:oMath/); assert.match(doc, /w:footnoteReference/); assert.match(doc, /w:highlight/);
    assert.ok(Object.keys(entries).some(n => /^word\/media\/.+\.png$/.test(n)), 'diagram image embedded');
    assert.match(styles, /w:eastAsia="SimSun"/); assert.match(styles, /w:color w:val="1D7A57"/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('real Pandoc: import writes editor-native Markdown', { skip: !hasPandoc && 'bundled Pandoc not prepared' }, async () => {
  const dir = await tmp();
  try {
    const { bytes } = await bridge.exportDocument(pandoc, { format: 'docx', text: '==高亮== H~2~O x^2^\n\n$$E=mc^2$$\n\n| a | b |\n|---|---|\n| 1 | 2 |\n' });
    const file = path.join(dir, 'in.docx'); await fs.writeFile(file, bytes);
    const md = await bridge.pandocImport(pandoc, file);
    assert.match(md, /==高亮==/); assert.match(md, /H~2~O/); assert.match(md, /x\^2\^/); assert.match(md, /\$\$E = mc\^\{2\}\$\$/); assert.match(md, /\| a +\| b +\|/);
    assert.doesNotMatch(md, /<span|<sub>|<sup>|```\s*math/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('real Pandoc: converter center reads .md with the editor dialect', { skip: !hasPandoc && 'bundled Pandoc not prepared' }, async () => {
  const dir = await tmp();
  try {
    const input = path.join(dir, 'a.md'), target = path.join(dir, 'a.txt');
    await fs.writeFile(input, '第一行\n第二行\n');
    await engine.convertFile({ inputs: [input], target, to: 'plain', standalone: false });
    assert.equal((await fs.readFile(target, 'utf8')).trim(), '第一行第二行');
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});
