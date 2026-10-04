// Document tools (0.9.1) against fake PDF and Markdown sessions: the same code serves the in-app
// assistant and the local AI interface, so its limits and confirmations are tested here.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const { createDocTools } = await import('../ui/ai/doc-tools.mjs');
const defs = JSON.parse(readFileSync(new URL('../ui/ai/tools.json', import.meta.url), 'utf8')).tools;

function fakePdf() {
  const pages = ['第一页 青页 介绍\n阅读与批注', '第二页 没有关键词', '第三页 再次提到青页'];
  return { id: 'p1', name: 'guide.pdf', loaded: true, path: 'C:/guide.pdf', frame: { contentWindow: { getSelection: () => ({ toString: () => '选中的 PDF 文字' }) } },
    app: { pagesCount: 3, pdfViewer: { currentPageNumber: 1 }, pdfDocument: {
      getPage: async n => ({ getTextContent: async () => ({ items: [{ str: pages[n - 1], hasEOL: true }] }) }),
      getOutline: async () => [{ title: '第一章', dest: [{ num: 1 }], items: [{ title: '1.1', dest: 'named', items: [] }] }],
      getDestination: async () => [{ num: 2 }], getPageIndex: async ref => ref.num - 1 } } };
}
function fakeMd(text) {
  const s = { id: 'm1', kind: 'markdown', name: 'a.md', loaded: true, headings: [{ level: 1, text: '标题', offset: 0 }, { level: 2, text: '第二节', offset: text.indexOf('## ') }], dirty: false,
    editor: { text, sel: { from: 2, to: 4 }, sourceMode: false, currentSelection() { return this.sel; }, scrolled: null, scrollToOffset(o) { this.scrolled = o; },
      apply(changes) { for (const c of changes) this.text = this.text.slice(0, c.from) + c.insert + this.text.slice(c.to); }, replaceAll(t) { this.text = t; } } };
  return s;
}
function setup() {
  const sessions = new Map(), pdf = fakePdf(), md = fakeMd('# 标题\n\n正文 青页\n\n## 第二节\n\n结尾');
  sessions.set(pdf.id, pdf); sessions.set(md.id, md);
  let active = 'p1', asked = [], answer = true;
  const tools = createDocTools({ sessions, current: () => sessions.get(active), activate: id => { active = id; }, markdown: { setViewMode: () => {} },
    addDocuments: async items => { const n = fakeMd(''); n.id = items[0].id; sessions.set(n.id, n); }, api: { newMarkdown: async () => [{ id: 'new1' }] },
    confirm: async req => { asked.push(req); return answer; } });
  return { tools, pdf, md, sessions, asked, setAnswer: v => { answer = v; }, activate: id => { active = id; } };
}

test('definitions: every tool has a JSON schema and an implementation', async () => {
  const { tools } = setup();
  assert.equal(defs.length, 9);
  for (const d of defs) { assert.equal(d.parameters.type, 'object'); assert.ok(d.description.length > 20); }
  await assert.rejects(tools.run('rm_rf', {}), /未知工具/);
});

test('PDF: list, read pages, selection, outline, search, go to page', async () => {
  const { tools, pdf } = setup();
  const list = await tools.run('list_documents');
  assert.equal(list.active_document_id, 'p1'); assert.deepEqual(list.documents.map(d => d.kind), ['pdf', 'markdown']);
  const r = await tools.run('read_document', { start_page: 2, end_page: 3 });
  assert.deepEqual(r.pages.map(p => p.page), [2, 3]); assert.equal(r.truncated, false);
  const limited = await tools.run('read_document', { max_chars: 200 });
  const junk = await tools.run('read_document', { max_chars: 'x', start_page: 'a', end_page: null });
  assert.deepEqual(junk.pages.map(p => p.page), [1, 2, 3], 'invalid numbers fall back to defaults');
  assert.ok(limited.pages.length >= 1);
  assert.equal((await tools.run('get_selection')).selection, '选中的 PDF 文字');
  const o = await tools.run('get_outline');
  assert.deepEqual(o.outline, [{ level: 1, title: '第一章', page: 1 }, { level: 2, title: '1.1', page: 2 }]);
  const hits = await tools.run('search_document', { query: '青页' });
  assert.deepEqual(hits.matches.map(m => m.page), [1, 3]);
  await assert.rejects(tools.run('search_document', { query: ' ' }), /query/);
  assert.deepEqual(await tools.run('go_to', { page: 99 }), { ok: true, page: 3 }); assert.equal(pdf.app.pdfViewer.currentPageNumber, 3);
  await assert.rejects(tools.run('insert_markdown', { text: 'x' }), /Markdown/);
});

test('Markdown: read range, outline lines, search lines, go to heading', async () => {
  const { tools, md, activate } = setup(); activate('m1');
  const r = await tools.run('read_document', { start_char: 2, end_char: 4 });
  assert.equal(r.text, '标题'); assert.equal(r.truncated, true);
  assert.deepEqual((await tools.run('get_outline')).headings.map(h => h.line), [1, 5]);
  assert.equal((await tools.run('get_selection')).selection, '标题');
  assert.deepEqual((await tools.run('search_document', { query: '青页' })).matches[0].line, 3);
  await tools.run('go_to', { heading: '第二' }); assert.equal(md.editor.scrolled, md.headings[1].offset);
  await assert.rejects(tools.run('go_to', { heading: '不存在' }), e => e.status === 404);
  await assert.rejects(tools.run('read_document', { document_id: 'nope' }), e => e.status === 404);
});

test('writes: panel asks unless disabled, API asks unless allowed, declines are reported', async () => {
  const { tools, md, asked, setAnswer, sessions } = setup();
  await tools.run('insert_markdown', { document_id: 'm1', text: 'A', position: 'end' }, { source: 'panel' });
  assert.equal(asked.length, 1); assert.ok(md.editor.text.endsWith('结尾\n\nA'));
  await tools.run('insert_markdown', { document_id: 'm1', text: 'B', position: 'replace_selection' }, { source: 'panel', confirmEdits: false });
  assert.equal(asked.length, 1); assert.ok(md.editor.text.startsWith('# B\n'));
  setAnswer(false);
  await assert.rejects(tools.run('insert_markdown', { document_id: 'm1', text: 'C' }, { source: 'api', allowEdits: false }), e => e.declined === true);
  assert.equal(asked.at(-1).source, 'api'); assert.ok(!md.editor.text.includes('C'));
  await tools.run('insert_markdown', { document_id: 'm1', text: 'D' }, { source: 'api', allowEdits: true });
  assert.ok(md.editor.text.includes('D'));
  const count = asked.length;
  const created = await tools.run('create_markdown', { title: '纪要', content: '内容' }, { source: 'panel' });
  assert.equal(asked.length, count, 'panel-created documents need no confirmation');
  assert.equal(sessions.get('new1').editor.text, '# 纪要\n\n内容'); assert.equal(created.document.kind, 'markdown');
  await assert.rejects(tools.run('create_markdown', { content: 'x' }, { source: 'api' }), e => e.declined === true);
});
