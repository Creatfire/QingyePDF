// 0.10.0 notes mode: pane choice, excerpt formatting, source links, and the AI tools that work
// across the two panes (list_documents sides, annotate_pdf).
import test from 'node:test';
import assert from 'node:assert/strict';
import { choosePane, clampRatio, fileHref, sourceHref, excerptMarkdown, blockInsertion } from '../ui/notes-mode.mjs';
import { createDocTools, quoteRect } from '../ui/ai/doc-tools.mjs';
import { parseSourceFragment } from '../ui/source-links.mjs';

test('pane choice: a document replaces the pane of its own kind, else the focused pane', () => {
  assert.equal(choosePane(['pdf', 'markdown'], 1, 'pdf'), 0);
  assert.equal(choosePane(['pdf', 'markdown'], 0, 'markdown'), 1);
  assert.equal(choosePane(['markdown', 'pdf'], 0, 'pdf'), 1);
  assert.equal(choosePane(['pdf', 'pdf'], 1, 'pdf'), 1);
  assert.equal(choosePane(['pdf', 'pdf'], 0, 'markdown'), 0);
  assert.equal(choosePane(['markdown', 'markdown'], 1, 'pdf'), 1);
});
test('divider ratio is clamped to 25–75 % and tolerates junk', () => {
  assert.equal(clampRatio(10), 25); assert.equal(clampRatio(90), 75); assert.equal(clampRatio(42.5), 42.5); assert.equal(clampRatio('x'), 50); assert.equal(clampRatio(NaN), 50);
});
test('source links match the annotation-note format and survive odd file names', () => {
  assert.equal(fileHref('E:\\文档\\a b#1.pdf'), 'file:///E:/%E6%96%87%E6%A1%A3/a%20b%231.pdf');
  assert.equal(fileHref('/home/u/读 书.pdf'), 'file:///home/u/%E8%AF%BB%20%E4%B9%A6.pdf');
  const href = sourceHref({ id: 'x', path: 'C:\\docs\\paper.pdf', page: 12 });
  assert.equal(href, 'file:///C:/docs/paper.pdf#page=12');
  assert.deepEqual(parseSourceFragment(new URL(href).hash.slice(1)), { page: 12, rect: null });
  const unsaved = sourceHref({ id: 'doc-1', path: null, page: 3 });
  assert.ok(unsaved.startsWith('#qingye-source-')); assert.deepEqual(JSON.parse(decodeURIComponent(unsaved.slice(15))), { id: 'doc-1', page: 3 });
});
test('excerpt: quoted lines, escaped Markdown, link back to the page', () => {
  const text = excerptMarkdown({ id: 'p', name: 'A_B.pdf', path: '/d/A_B.pdf', page: 2, text: '第一行 *重点*\r\n\r\n  second [line]  ' });
  assert.equal(text, '> 第一行 \\*重点\\*\n> second \\[line\\]\n\n[A\\_B.pdf · 第 2 页](<file:///d/A_B.pdf#page=2>)\n');
});
test('inserted blocks are separated from the surrounding text by blank lines', () => {
  assert.equal(blockInsertion('', 0, 'X\n'), 'X\n');
  assert.equal(blockInsertion('para', 4, 'X\n'), '\n\nX\n');
  assert.equal(blockInsertion('para\n', 5, 'X'), '\nX\n');
  assert.equal(blockInsertion('a\n\nb', 3, 'X'), 'X\n\n');
  assert.equal(blockInsertion('a\n\n\nb', 3, 'X'), 'X\n');
});

// A page whose text is split into runs, with a viewport that flips y like PDF.js does.
const viewport = { width: 600, height: 800, convertToViewportPoint: (x, y) => [x, 800 - y] };
const items = [
  { str: 'An open-source ', transform: [12, 0, 0, 12, 72, 700], width: 90, height: 12 },
  { str: 'home for your documents.', transform: [12, 0, 0, 12, 162, 700], width: 144, height: 12 },
  { str: 'Second line here', transform: [12, 0, 0, 12, 72, 680], width: 96, height: 12 },
];
test('quoteRect: finds a quote across text runs and returns page fractions', () => {
  const rect = quoteRect(items, viewport, 'open-source home');
  assert.ok(rect, 'found');
  const [x0, y0, x1, y1] = rect.map((v, i) => v * (i % 2 ? 800 : 600));
  assert.ok(x0 > 72 && x0 < 100, 'starts inside the first run: ' + x0); assert.ok(x1 > 162 && x1 < 200, 'ends inside the second run: ' + x1);
  assert.ok(y0 < 100 && y0 > 85 && y1 > 100 && y1 < 106, `one line tall: ${y0}–${y1}`);
  assert.equal(quoteRect(items, viewport, 'not on this page'), null); assert.equal(quoteRect(items, viewport, '   '), null);
  // Whitespace and case differences between the model's quote and the PDF runs do not matter.
  assert.ok(quoteRect(items, viewport, 'AN  OPEN-SOURCE\nHOME'));
  const twoLines = quoteRect(items, viewport, 'documents. Second line');
  assert.ok(twoLines[3] - twoLines[1] > 0.03, 'spans both lines');
});

function setup({ confirm = async () => true } = {}) {
  const sessions = new Map(), edits = [];
  const page = { getTextContent: async () => ({ items }), getViewport: () => viewport };
  const pdf = { id: 'p1', name: 'paper.pdf', path: '/d/paper.pdf', loaded: true, dirty: false, app: { pagesCount: 3, pdfViewer: { currentPageNumber: 1 }, pdfDocument: { getPage: async () => page, getOutline: async () => [] } }, frame: { contentWindow: { getSelection: () => ({ toString: () => '' }) } } };
  const md = { id: 'm1', name: 'notes.md', path: '/d/notes.md', kind: 'markdown', loaded: true, dirty: false, headings: [], editor: { text: '# Notes\n', sourceMode: false, currentSelection: () => ({ from: 0, to: 0 }) } };
  sessions.set(pdf.id, pdf); sessions.set(md.id, md);
  let split = ['p1', 'm1'], active = 'm1';
  const tools = createDocTools({ sessions, current: () => sessions.get(active), activate: id => { active = id; }, markdown: { setViewMode() {} }, addDocuments: async () => {}, api: {}, confirm,
    applyEdit: async (s, request, label) => { edits.push({ id: s.id, request, label }); return {}; }, notes: { ids: () => split } });
  return { tools, edits, pdf, md, sessions, leave: () => { split = null; } };
}
test('AI tools: both panes are reported with their side', async () => {
  const { tools, leave } = setup();
  const list = await tools.run('list_documents');
  assert.deepEqual(list.notes_mode, { left_document_id: 'p1', right_document_id: 'm1' });
  assert.deepEqual(list.documents.map(d => d.pane), ['left', 'right']); assert.equal(list.active_document_id, 'm1');
  leave();
  const single = await tools.run('list_documents');
  assert.equal(single.notes_mode, undefined); assert.equal(single.documents[0].pane, undefined);
});
test('annotate_pdf: confirmation, one undoable backend edit, validation', async () => {
  const asked = [];
  const { tools, edits } = setup({ confirm: async request => { asked.push(request); return asked.length === 1; } });
  const done = await tools.run('annotate_pdf', { document_id: 'p1', page: 1, quote: 'open-source home', comment: 'Key claim' }, { source: 'panel' });
  assert.equal(done.ok, true); assert.equal(done.kind, 'highlight'); assert.equal(done.saved, false);
  assert.equal(asked.length, 1); assert.match(asked[0].preview, /open-source home[\s\S]*Key claim/);
  assert.equal(edits.length, 1);
  const { request } = edits[0];
  assert.equal(request.action, 'annotation'); assert.equal(request.annotation, 'highlight'); assert.equal(request.pages, '1'); assert.equal(request.text, 'Key claim');
  assert.equal(request.rect.length, 4); assert.ok(request.rect.every(v => v >= 0 && v <= 1)); assert.match(request.color, /^#[0-9a-f]{6}$/i);
  // Declined by the user: nothing is applied.
  await assert.rejects(tools.run('annotate_pdf', { document_id: 'p1', page: 1, quote: 'Second line', kind: 'underline' }, { source: 'panel' }), error => error.declined === true);
  assert.equal(edits.length, 1);
  // The user turned confirmations off: applied directly.
  await tools.run('annotate_pdf', { document_id: 'p1', page: 2, quote: 'Second line', kind: 'strikeout' }, { source: 'panel', confirmEdits: false });
  assert.equal(edits.length, 2); assert.equal(edits[1].request.annotation, 'strikeout'); assert.equal(asked.length, 2);
  await assert.rejects(tools.run('annotate_pdf', { document_id: 'p1', page: 1, quote: 'absent text' }, { source: 'panel', confirmEdits: false }), /找不到这段原文/);
  await assert.rejects(tools.run('annotate_pdf', { document_id: 'p1', page: 9, quote: 'Second line' }, { source: 'panel', confirmEdits: false }), /页码超出范围/);
  await assert.rejects(tools.run('annotate_pdf', { document_id: 'm1', page: 1, quote: 'Notes' }, { source: 'panel', confirmEdits: false }), /只能批注 PDF/);
  // External programs need the "allow edits" switch, exactly like insert_markdown.
  await assert.rejects(tools.run('annotate_pdf', { document_id: 'p1', page: 1, quote: 'Second line' }, { source: 'api', allowEdits: false }), error => error.declined === true);
});
