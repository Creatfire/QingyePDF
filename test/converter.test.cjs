const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const engine = require('../pandoc-engine.cjs');
const tools = require('../markdown-tools.cjs');
async function temporary(use) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qy-converter-'));
  try { return await use(dir); } finally { const actual = path.resolve(dir); assert.equal(path.dirname(actual).toLowerCase(), path.resolve(os.tmpdir()).toLowerCase()); assert.ok(path.basename(actual).startsWith('qy-converter-')); await fs.rm(actual, { recursive: true, force: true }); }
}
test('bundled Pandoc is found without a system installation and provides its full format lists', async () => {
  const info = await engine.describe(); assert.equal(info.bundled, true); assert.equal(info.version, 'pandoc 3.12'); assert.equal(info.readers.length, 51); assert.equal(info.writers.length, 76); assert.ok(info.help.includes('--lua-filter')); assert.ok(info.help.includes('--citeproc'));
  const found = await tools.findPandoc(); assert.equal(found.bundled, true); assert.equal(found.path, engine.bundledPath());
});
test('direct engine conversion covers DOCX, ODT, EPUB and Markdown round trips with Chinese paths', () => temporary(async dir => {
  const input = path.join(dir, '输入文档.md'); await fs.writeFile(input, '# 青页测试\n\n**bold** and formula $x^2$.\n\n- one\n- two\n');
  for (const to of ['docx', 'odt', 'epub3']) {
    const target = path.join(dir, '输出文件.' + engine.extension(to)); const result = await engine.convertFile({ inputs: [input], target, from: 'markdown', to }); assert.ok(result.bytes > 500);
    const reread = await engine.run(engine.bundledPath(), ['--to', 'markdown', target]); assert.match(reread.stdout.toString(), /青页测试/); assert.match(reread.stdout.toString(), /bold/);
  }
}));
test('citation processing and Lua filters execute through the original engine', () => temporary(async dir => {
  const input = path.join(dir, 'citations.md'), bib = path.join(dir, 'refs.bib'), lua = path.join(dir, 'filter.lua'), target = path.join(dir, 'citations.html');
  await fs.writeFile(input, '# Before\n\nCitation [@smith2024].\n'); await fs.writeFile(bib, '@book{smith2024,author={Smith, Alice},title={A Book},year={2024}}'); await fs.writeFile(lua, 'function Header(el) el.content = pandoc.Inlines { pandoc.Str("Filtered") }; return el end');
  await engine.convertFile({ inputs: [input], target, from: 'markdown', to: 'html5', citeproc: true, extraArgs: ['--bibliography', bib, '--lua-filter', lua] }); const html = await fs.readFile(target, 'utf8'); assert.match(html, /Filtered/); assert.match(html, /Smith/); assert.match(html, /id="refs"/); assert.doesNotMatch(html, /\[@smith2024\]/);
}));
test('templates, defaults and metadata remain handled by Pandoc without implementing substitutes', () => temporary(async dir => {
  const input = path.join(dir, 'input.md'), template = path.join(dir, 'page.html'), defaults = path.join(dir, 'defaults.yaml'), target = path.join(dir, 'output.html');
  await fs.writeFile(input, 'body text'); await fs.writeFile(template, '$title$|$body$'); await fs.writeFile(defaults, 'metadata:\n  title: Engine title\n');
  await engine.convertFile({ inputs: [input], target, from: 'markdown', to: 'html5', extraArgs: ['--defaults', defaults, '--template', template] }); assert.equal((await fs.readFile(target, 'utf8')).trim(), 'Engine title|<p>body text</p>');
}));
test('custom Lua readers and writers pass through the advanced format route', () => temporary(async dir => {
  const input = path.join(dir, 'input.md'), reader = path.join(dir, 'reader.lua'), writer = path.join(dir, 'writer.lua'), target = path.join(dir, 'output.txt');
  await fs.writeFile(input, 'input'); await fs.writeFile(reader, 'function Reader(input, opts) return pandoc.Pandoc({pandoc.Para({pandoc.Str("CustomReader")})}) end');
  await fs.writeFile(writer, 'function Writer(doc, opts) return "CustomWriter:" .. pandoc.write(doc, "plain") end');
  await assert.rejects(engine.convertFile({ inputs: [input], target, from: 'auto', to: 'custom' }), /指定写出器/);
  await engine.convertFile({ inputs: [input], target, from: 'auto', to: 'custom', standalone: false, extraArgs: ['--from', reader, '--to', writer] }); assert.equal((await fs.readFile(target, 'utf8')).trim(), 'CustomWriter:CustomReader');
}));
test('conversion cannot overwrite inputs and failures or concurrent changes retain the existing target', () => temporary(async dir => {
  const input = path.join(dir, 'input.md'), target = path.join(dir, 'output.html'); await fs.writeFile(input, 'original input'); await fs.writeFile(target, 'original output');
  await assert.rejects(engine.convertFile({ inputs: [input], target: input, to: 'html5' }), /不能覆盖输入/); assert.equal(await fs.readFile(input, 'utf8'), 'original input');
  await assert.rejects(engine.convertFile({ inputs: [input], target, to: 'html5', extraArgs: ['--invalid-qingye-option'] })); assert.equal(await fs.readFile(target, 'utf8'), 'original output');
  await assert.rejects(engine.convertFile({ inputs: [input], target, to: 'html5', onProgress: text => { if (text === '正在保存输出…') require('node:fs').writeFileSync(target, 'external change'); } }), /其他程序修改/); assert.equal(await fs.readFile(target, 'utf8'), 'external change'); assert.equal((await fs.readdir(dir)).filter(s => s.startsWith('.qingye-convert-')).length, 0);
}));
test('process cancellation and bounded output do not leave a partial conversion file', async () => {
  const controller = new AbortController(); const running = engine.run(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], { signal: controller.signal }); setTimeout(() => controller.abort(), 100); await assert.rejects(running, /已取消/);
  await assert.rejects(engine.run(process.execPath, ['-e', 'process.stdout.write("x".repeat(10000))'], { maxBytes: 100 }), /大小限制/);
  await temporary(async dir => { const input = path.join(dir, 'input.md'), target = path.join(dir, 'output.html'); await fs.writeFile(input, 'text'); await fs.writeFile(target, 'keep'); const c = new AbortController(); c.abort(); await assert.rejects(engine.convertFile({ inputs: [input], target, to: 'html5', signal: c.signal }), /已取消/); assert.equal(await fs.readFile(target, 'utf8'), 'keep'); });
});
test('advanced parameters are arrays of literal arguments and cannot redirect the main output', () => {
  assert.deepEqual(engine.validateExtra(['--metadata=title:A & B']), ['--metadata=title:A & B']);
  for (const args of ['--toc', ['--output=outside.html'], ['-ooutside'], ['--server'], ['--help'], ['--']]) assert.throws(() => engine.validateExtra(args));
});
test('IPC accepts only tokens granted by native file selections', () => temporary(async dir => {
  const input = path.join(dir, 'input.md'), target = path.join(dir, 'output.html'); await fs.writeFile(input, 'safe content'); const handlers = new Map();
  require('../converter-ipc.cjs').register({ app: { getPath: () => dir, on() {} }, handle: (key, fn) => handlers.set(key, fn), getWindow: () => null, dialog: { showOpenDialog: async () => ({ canceled: false, filePaths: [input] }), showSaveDialog: async () => ({ canceled: false, filePath: target }) }, shell: {}, documents: new Map(), key: p => path.resolve(p).toLowerCase(), command() {} });
  const ins = await handlers.get('converter-pick-inputs')(), out = await handlers.get('converter-pick-output')('html5', ins[0].token);
  await assert.rejects(handlers.get('converter-run')({ jobId: 'bad', inputs: [input], output: out.token, to: 'html5' }), /选择已失效/);
  await handlers.get('converter-run')({ jobId: 'valid', inputs: [ins[0].token], output: out.token, to: 'html5' }); assert.match(await fs.readFile(target, 'utf8'), /safe content/);
}));
