// Pure-logic checks that run in plain Node: the Pandoc command-line translation and the
// crypto / storage shims that stand in for Node modules inside the WebView.
import test from 'node:test';
import assert from 'node:assert/strict';
import nodeCrypto from 'node:crypto';
import { parseArguments, extensionLines } from '../src/pandoc/args.js';
import { createHash } from '../src/shims/crypto.js';

test('pandoc arguments: the desktop converter command line', () => {
  const { options, inputs } = parseArguments(['--toc-depth=2', '--from', 'markdown+emoji', '--to', 'html5', '--standalone', '--toc', '--number-sections', '--citeproc', '--mathml', '--embed-resources', '--resource-path', '/a:/b', '--output', '/tmp/out.html', '/docs/in.md', '/docs/two.md']);
  assert.deepEqual(inputs, ['/docs/in.md', '/docs/two.md']);
  assert.equal(options.from, 'markdown+emoji'); assert.equal(options.to, 'html5'); assert.equal(options['output-file'], '/tmp/out.html');
  assert.equal(options.standalone, true); assert.equal(options['table-of-contents'], true); assert.equal(options['number-sections'], true);
  assert.equal(options['toc-depth'], 2); assert.equal(options['embed-resources'], true);
  assert.deepEqual(options['html-math-method'], { method: 'mathml' });
  assert.deepEqual(options['resource-path'], ['/a', '/b']);
  assert.deepEqual(options.filters, [{ type: 'citeproc' }]);
});
test('pandoc arguments: short options, metadata, filters and lists', () => {
  const { options, inputs } = parseArguments(['-f', 'docx', '-t', 'gfm+footnotes', '--wrap=none', '--extract-media', 'x.assets', '-M', 'title=标题', '-V', 'lang=zh-CN', '-L', 'a.lua', '--css', 'a.css', '-c', 'b.css', '--bibliography=r.bib', '-s', 'in.docx']);
  assert.deepEqual(inputs, ['in.docx']);
  assert.equal(options.from, 'docx'); assert.equal(options.to, 'gfm+footnotes'); assert.equal(options.wrap, 'none'); assert.equal(options['extract-media'], 'x.assets');
  assert.deepEqual(options.metadata, { title: '标题' }); assert.deepEqual(options.variables, { lang: 'zh-CN' });
  assert.deepEqual(options.filters, [{ type: 'lua', path: 'a.lua' }]); assert.deepEqual(options.css, ['a.css', 'b.css']); assert.deepEqual(options.bibliography, ['r.bib']);
  assert.equal(options.standalone, true);
});
test('pandoc arguments: queries and unsupported options', () => {
  assert.deepEqual(parseArguments(['--version']), { query: 'version' });
  assert.deepEqual(parseArguments(['--list-input-formats']), { query: 'input-formats' });
  assert.deepEqual(parseArguments(['--list-extensions=markdown']), { query: 'extensions-for-format', format: 'markdown' });
  for (const args of [['--filter', 'x'], ['--pdf-engine=xelatex'], ['-d', 'defaults.yaml'], ['--data-dir', '/x']]) assert.throws(() => parseArguments(args), error => error.unsupported === true);
  assert.throws(() => parseArguments(['--to']), /缺少取值/);
  assert.equal(extensionLines({ b: false, a: true }), '+a\n-b\n');
});
test('crypto shim matches Node for SHA-256 and SHA-1', () => {
  for (const size of [0, 1, 55, 56, 63, 64, 65, 1000, 70000]) {
    const bytes = new Uint8Array(size).map((_, i) => (i * 31 + size) & 255);
    for (const name of ['sha256', 'sha1']) assert.equal(createHash(name).update(bytes).digest('hex'), nodeCrypto.createHash(name).update(bytes).digest('hex'), `${name} ${size}`);
  }
  assert.equal(createHash('sha256').update('青页').update(' PDF').digest('hex'), nodeCrypto.createHash('sha256').update('青页 PDF').digest('hex'));
});
