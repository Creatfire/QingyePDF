const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const engine = require('../pandoc-engine.cjs');
const { atomicWrite } = require('../core.cjs');

async function temporary(fn) {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qy-fix093-'));
  try { await fn(dir); }
  finally { assert.equal(path.dirname(dir), os.tmpdir()); assert.ok(path.basename(dir).startsWith('qy-fix093-')); await fs.rm(path.toNamespacedPath(dir), { recursive: true, force: true }); }
}

test('fix long input/output paths without a long child cwd; relative resources and template still work', () => temporary(async dir => {
  let long = dir; while (long.length < 380) long = path.join(long, 'long-path-component-123');
  await fs.mkdir(long, { recursive: true }); const input = path.join(long, 'document.md'), template = path.join(long, 'template.html'), out = path.join(long, 'output.html');
  await fs.writeFile(input, '# Long path\n\nRESOURCE-MARKER\n\n![local](image.svg)');
  await fs.writeFile(path.join(long, 'image.svg'), '<svg xmlns="http://www.w3.org/2000/svg" width="10" height="10"><rect width="10" height="10"/></svg>');
  await fs.writeFile(template, '<html>FIX-TEMPLATE:$body$</html>');
  const result = await engine.convertFile({ inputs: [input], target: out, to: 'html5', extraArgs: ['--template', 'template.html', '--embed-resources'] });
  assert.ok(result.bytes > 100); const html = await fs.readFile(out, 'utf8'); assert.match(html, /FIX-TEMPLATE/); assert.match(html, /RESOURCE-MARKER/); assert.match(html, /data:image\/svg/);
  await engine.convertFile({ inputs: [input], target: path.join(dir, 'short.html'), to: 'html5' });
  const shortInput = path.join(dir, 'short.md'); await fs.writeFile(shortInput, 'SHORT');
  await engine.convertFile({ inputs: [shortInput], target: path.join(long, 'short-input.html'), to: 'html5' });
  assert.match(await fs.readFile(path.join(long, 'short-input.html'), 'utf8'), /SHORT/);
  if (process.platform === 'win32') await assert.rejects(engine.run(engine.bundledPath(), ['--version'], { cwd: long }), /工作目录路径过长/);
}));

test('exclusive publication never overwrites a concurrently created target', () => temporary(async dir => {
  const target = path.join(dir, 'existing.html'); await fs.writeFile(target, 'keep');
  await assert.rejects(atomicWrite(target, Buffer.from('replace'), null, { exclusive: true }), { code: 'EEXIST' });
  assert.equal(await fs.readFile(target, 'utf8'), 'keep'); assert.deepEqual(await fs.readdir(dir), ['existing.html']);
}));

test('implicit AI tools stay bound to their turn document, even after close or tab switch', async () => {
  const { createDocTools } = await import('../ui/ai/doc-tools.mjs');
  const first = { id: 'first', path: '/one.md', loaded: true, kind: 'markdown', name: 'one.md', editor: { text: 'FIRST' } }, second = { id: 'second', path: '/two.md', loaded: true, kind: 'markdown', name: 'two.md', editor: { text: 'SECOND' } };
  const sessions = new Map([[first.id, first], [second.id, second]]);
  const tools = createDocTools({ sessions, current: () => second, activate() {} });
  assert.equal((await tools.run('read_document', {}, { defaultDocumentId: first.id })).text, 'FIRST');
  sessions.delete(first.id);
  await assert.rejects(tools.run('read_document', {}, { defaultDocumentId: first.id }), e => e.status === 404);
  assert.equal((await tools.run('read_document', { document_id: second.id }, { defaultDocumentId: first.id })).text, 'SECOND');
  await assert.rejects(tools.run('read_document', {}, { defaultDocumentId: null }), e => e.status === 404);
  const restored = { ...first, id: 'restored' }; sessions.set(restored.id, restored);
  assert.equal(tools.resolve(first.id, first.path).id, restored.id);
  await assert.rejects(tools.run('read_document', {}, { defaultDocumentId: first.id }), e => e.status === 404, 'in-flight tools must not fall back even if the path was reopened');
  assert.equal((await tools.run('read_document', {}, { defaultDocumentId: tools.resolve(first.id, first.path).id })).text, 'FIRST');
});

test('conversion shutdown waits for cancellation and cleanup before allowing process exit', () => temporary(async dir => {
  const input = path.join(dir, 'large.md'); await fs.writeFile(input, '# Large\n\n' + 'line of text\n'.repeat(250000));
  const handlers = new Map(); let stop, started;
  const running = new Promise(resolve => { started = resolve; });
  const lifecycle = require('../converter-ipc.cjs').register({ app: { getPath: () => dir, on() {} }, handle: (name, fn) => handlers.set(name, fn), getWindow: () => null,
    dialog: { showOpenDialog: async (_w, options) => ({ canceled: false, filePaths: options.properties.includes('openDirectory') ? [dir] : [input] }) }, shell: {}, documents: new Map(), key: p => path.resolve(p).toLowerCase(),
    command: (name, value) => { if (name === 'converter-progress' && value.text === '正在转换文档…') started(); } });
  const ins = await handlers.get('converter-pick-inputs')(), out = await handlers.get('converter-pick-directory')();
  const job = handlers.get('converter-run')({ jobId: 'close-test', mode: 'batch', inputs: ins.map(i => i.token), output: out.token, to: 'html5' });
  await running; assert.equal(lifecycle.busy, true); await lifecycle.shutdown(); assert.equal(lifecycle.busy, false);
  assert.equal((await job).canceled, 1); assert.ok(!(await fs.readdir(dir)).some(n => n.startsWith('.qy-') || n.endsWith('.html')));
  await assert.rejects(handlers.get('converter-run')({ jobId: 'after-close', inputs: [], output: out.token, mode: 'batch', to: 'html5' }), /程序正在关闭/);
}));
