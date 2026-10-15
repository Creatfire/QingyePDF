// 0.14 equation numbering and \eqref / \ref (KaTeX has \tag only).
import test from 'node:test';
import assert from 'node:assert/strict';
import { numberBlock, resolveRefs } from '../ui/markdown/math-numbers.mjs';

globalThis.window ??= globalThis;
const parser = await import('../ui/markdown/parser.mjs');

test('numberBlock: modes, explicit tags, notag and labels', () => {
  assert.deepEqual(numberBlock('E=mc^2 \\label{e}', 'none', 1), { tex: 'E=mc^2 ', next: 1, labels: [] });
  assert.deepEqual(numberBlock('E=mc^2 \\label{e}', 'ams', 4), { tex: 'E=mc^2 \\tag{4}', next: 5, labels: [['e', '4']] });
  assert.deepEqual(numberBlock('a=b', 'ams', 1).next, 1, 'plain $$ without label is unnumbered under AMS');
  assert.deepEqual(numberBlock('a=b', 'all', 2), { tex: 'a=b \\tag{2}', next: 3, labels: [] });
  assert.deepEqual(numberBlock('a=b \\notag', 'all', 2), { tex: 'a=b ', next: 2, labels: [] });
  assert.deepEqual(numberBlock('a=b \\tag{*} \\label{s}', 'all', 2), { tex: 'a=b \\tag{*} ', next: 2, labels: [['s', '*']] });
  const eq = numberBlock('\\begin{equation}a=b\\label{x}\\end{equation}', 'ams', 7);
  assert.equal(eq.tex, '\\begin{equation*}a=b \\tag{7}\\end{equation*}'); assert.deepEqual(eq.labels, [['x', '7']]);
  const align = numberBlock('\\begin{align}a&=b\\label{p}\\\\c&=d\\notag\\\\e&=f\\end{align}', 'all', 1);
  assert.equal(align.tex, '\\begin{align*}a&=b \\tag{1}\\\\c&=d\\\\e&=f \\tag{2}\\end{align*}');
  assert.equal(align.next, 3); assert.deepEqual(align.labels, [['p', '1']]);
  assert.equal(numberBlock('\\begin{align}a&=b\\\\\\end{align}', 'all', 1).tex, '\\begin{align*}a&=b \\tag{1}\\\\\\end{align*}', 'a trailing \\\\ adds no row number');
  const nested = numberBlock('\\begin{align}x&=\\begin{pmatrix}1\\\\2\\end{pmatrix}\\end{align}', 'ams', 1);
  assert.equal(nested.next, 2, 'nested environments get a single number');
});

test('resolveRefs: \\eqref and \\ref become text; unknown keys do not error', () => {
  assert.equal(resolveRefs('见 \\eqref{e} 与 \\ref{e}', { e: '3' }), '见 \\text{(3)} 与 \\text{3}');
  assert.equal(resolveRefs('\\eqref{none}', {}), '\\text{(?)}');
  assert.equal(resolveRefs('x^2', { e: '1' }), 'x^2');
});

test('pandoc-prep: numbers beside the equation and plain-text references for Word', async () => {
  const { preparePandocMarkdown } = await import('../ui/markdown/pandoc-prep.mjs');
  const src = '见 \\eqref{b}。\n\n$$a=1 \\label{a}$$\n\n$$\nb=2\n\\label{b}\n$$\n\n$$x$$ 行内\n\n```tex\n\\eqref{a}\n```\n';
  const { text } = preparePandocMarkdown(src, { mathNumbering: 'all' });
  assert.equal(text, '见 (2)。\n\n$$\na=1 \\qquad (1)\n$$\n\n$$\nb=2 \\qquad (2)\n$$\n\n$$x$$ 行内\n\n```tex\n\\eqref{a}\n```\n');
  assert.ok(!preparePandocMarkdown('$$a\\label{q}$$', { mathNumbering: 'none' }).text.includes('label'), 'labels never reach Pandoc');
});

test('parser: numbers in document order, references resolve, per-block render keeps numbers', () => {
  parser.setRenderOptions({ mathNumbering: 'all' });
  try {
    const text = '$$a=1 \\label{one}$$\n\n段落\n\n$$\nb=2\n\\label{two}\n$$\n\n如 $\\eqref{two}$ 所示\n';
    const html = parser.renderDocumentHtml(text);
    assert.equal((html.match(/class="tag"/g) || []).length, 2);
    assert.ok(!/mdMathError|katex-error/.test(html), 'no KaTeX errors for \\label / \\eqref');
    assert.match(html, /\(2\)/);
    const { blocks, references, info } = parser.analyze(text);
    assert.deepEqual(info.math.labels, { one: '1', two: '2' });
    const second = blocks.find(b => b.kind === 'math' && text.slice(b.from, b.to).includes('b=2'));
    assert.equal(second.mathStart, 2);
    const alone = parser.renderBlockHtml(text.slice(second.from, second.to), second, references, info);
    assert.match(alone, /<span class="mord">2<\/span>/, 'a block rendered alone still shows (2)');
  } finally { parser.setRenderOptions({ mathNumbering: 'none' }); }
});
