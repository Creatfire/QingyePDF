const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const engine = require('../pandoc-engine.cjs');

test('0.9.3 window state: a late initial reply does not override native focus/maximize events', async () => {
  const { applyWindowStyle } = await import('../ui/window-style.mjs');
  const previous = global.document, classes = new Set(); let answer;
  const element = () => ({ setAttribute() {}, append() {}, prepend() {}, addEventListener() {} });
  global.document = { body: { classList: { add: name => classes.add(name), toggle: (name, on) => on ? classes.add(name) : classes.delete(name) } }, createElement: element, getElementById: element };
  try {
    const style = applyWindowStyle({ platform: 'win32', windowStyle: { style: 'macos' }, windowState: () => new Promise(resolve => { answer = resolve; }) });
    style.maximized(true); style.focused(false); answer({ maximized: false, focused: true }); await Promise.resolve(); await Promise.resolve();
    assert.ok(classes.has('windowMaximized')); assert.ok(classes.has('windowInactive'));
    style.focused(true); assert.ok(!classes.has('windowInactive'));
  } finally { if (previous === undefined) delete global.document; else global.document = previous; }
});

test('0.9.3 batch: separate files, duplicate names, existing targets, failure continuation and cancellation', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qingye-093-'));
  try {
    const a = path.join(dir, '甲'), b = path.join(dir, '乙'), out = path.join(dir, '输出');
    await Promise.all([a, b, out].map(p => fs.mkdir(p)));
    const one = path.join(a, '同名.md'), two = path.join(b, '同名.md'), missing = path.join(dir, 'missing.md');
    await fs.writeFile(one, '# Alpha\n\nFirst document'); await fs.writeFile(two, '# Beta\n\nSecond document');
    await fs.writeFile(path.join(out, '同名.html'), 'existing');
    const result = await engine.convertBatch({ inputs: [one, missing, two], directory: out, to: 'html5' });
    assert.equal(result.succeeded, 2); assert.equal(result.failed, 1);
    assert.equal(await fs.readFile(path.join(out, '同名.html'), 'utf8'), 'existing');
    const first = await fs.readFile(result.items[0].path, 'utf8'), second = await fs.readFile(result.items[2].path, 'utf8');
    assert.match(first, /Alpha/); assert.doesNotMatch(first, /Beta/); assert.match(second, /Beta/); assert.notEqual(result.items[0].path, result.items[2].path);
    const controller = new AbortController();
    const canceled = await engine.convertBatch({ inputs: [one, two], directory: out, to: 'html5', signal: controller.signal, onItem: item => { if (item.status === 'success') controller.abort(); } });
    assert.equal(canceled.succeeded, 1); assert.equal(canceled.canceled, 1);
    assert.ok((await fs.stat(canceled.items[0].path)).size > 0);
    assert.equal((await fs.readdir(out)).filter(n => n.startsWith('.qingye-convert-')).length, 0);
  } finally { assert.equal(path.dirname(dir), os.tmpdir()); assert.ok(path.basename(dir).startsWith('qingye-093-')); await fs.rm(dir, { recursive: true, force: true }); }
});

test('0.9.3 references: PDF/Markdown positions, forged links and closed/changed documents', async () => {
  const { createDocTools } = await import('../ui/ai/doc-tools.mjs');
  const { findReference } = await import('../ui/ai/references.mjs');
  const pdf = { id: 'pdf', name: 'a.pdf', path: 'a.pdf', loaded: true, app: { pagesCount: 2, pdfViewer: { currentPageNumber: 1 }, pdfDocument: { getPage: async () => ({ getTextContent: async () => ({ items: [{ str: 'Evidence' }] }) }) } } };
  const md = { id: 'md', name: 'b.md', path: 'b.md', kind: 'markdown', loaded: true, editor: { text: '# Heading\n\nEvidence', scrollToOffset(offset) { this.scrolled = offset; } } };
  const sessions = new Map([[pdf.id, pdf], [md.id, md]]); let active;
  const tools = createDocTools({ sessions, current: () => pdf, activate: id => { active = id; } });
  const read = await tools.run('read_document', { start_page: 2 }); const ref = read.references[0];
  assert.equal(ref.page, 2); assert.equal(findReference(ref.href, [{ references: read.references }]), ref);
  assert.equal(findReference('#qingye-ref-forged', [{ references: read.references }]), null);
  await tools.followReference(ref); assert.equal(active, 'pdf'); assert.equal(pdf.app.pdfViewer.currentPageNumber, 2);
  const found = await tools.run('search_document', { document_id: 'md', query: 'evidence' });
  await tools.followReference(found.references[0]); assert.equal(active, 'md'); assert.equal(md.editor.scrolled, 11);
  md.editor.text = '# Changed'; await assert.rejects(tools.followReference(found.references[0]), /位置已变化/);
  sessions.delete('pdf'); await assert.rejects(tools.followReference(ref), /已关闭/);
});

test('0.9.3 batch IPC: native directory tokens and document output protection', async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qingye-093-ipc-'));
  try {
    const input = path.join(dir, 'a.md'); await fs.writeFile(input, 'safe');
    const handlers = new Map(), documents = new Map([['open', { path: path.join(dir, 'a.html') }]]);
    require('../converter-ipc.cjs').register({ app: { getPath: () => dir, on() {} }, handle: (name, fn) => handlers.set(name, fn), getWindow: () => null,
      dialog: { showOpenDialog: async (_window, options) => ({ canceled: false, filePaths: options.properties.includes('openDirectory') ? [dir] : [input] }) },
      shell: {}, documents, key: p => path.resolve(p).toLowerCase(), command() {} });
    const files = await handlers.get('converter-pick-inputs')(), output = await handlers.get('converter-pick-directory')();
    const config = { jobId: 'batch', mode: 'batch', inputs: [files[0].token], output: output.token, to: 'html5' };
    await assert.rejects(handlers.get('converter-run')({ ...config, output: dir }), /选择已失效/);
    const protectedResult = await handlers.get('converter-run')(config); assert.equal(protectedResult.failed, 1); assert.match(protectedResult.items[0].error, /已打开/);
    await assert.rejects(fs.stat(path.join(dir, 'a.html')), { code: 'ENOENT' });
    documents.clear(); const valid = await handlers.get('converter-run')(config); assert.equal(valid.succeeded, 1);
  } finally { assert.equal(path.dirname(dir), os.tmpdir()); assert.ok(path.basename(dir).startsWith('qingye-093-ipc-')); await fs.rm(dir, { recursive: true, force: true }); }
});
