// Annotation & excerpt panel (0.20), shown in the sidebar's 批注 view. Cards with the marked text,
// note, page, colour and tags; filters (keyword, type, colour, tag, pages, excerpt status); batch
// colour / tags / delete / export; clicking a card selects the annotation in the page, selecting
// one in the page highlights its card. Tags are stored in the PDF (backend 'annot-batch').
import { ANNOT_LABEL } from './annot-labels.mjs';
import { linksInto } from './notes-mode.mjs';

export const DEFAULT_TAGS = ['待核实', '重要结论', '引用'];
const PALETTE = ['#ffd400', '#ff6b6b', '#5fbf6f', '#4c8dff', '#b36bff', '#ff9f40'];

/** "1-3,7" → Set of pages; empty → null (all pages). */
export function pageFilter(spec, total = Infinity) {
  const text = String(spec || '').trim(); if (!text) return null;
  const pages = new Set();
  for (const part of text.split(/[,，\s]+/).filter(Boolean)) {
    const m = /^(\d+)(?:-(\d+))?$/.exec(part); if (!m) throw new Error('页码请使用 1-3,5 这样的格式。');
    const from = Number(m[1]), to = Math.min(Number(m[2] || m[1]), total);
    for (let p = from; p <= to; p++) pages.add(p);
  }
  return pages;
}
/** Keys ("page:xref") of the annotations a note already contains: a link to the same page whose box
 *  overlaps the annotation, or (for links without a box) the marked text itself. */
export function excerptedKeys(notes, noteText, source) {
  const done = new Set(); if (!noteText) return done;
  const links = linksInto(noteText, source), flat = noteText.replace(/\s+/g, '');
  const overlap = (a, b) => { const w = Math.min(a[2], b[2]) - Math.max(a[0], b[0]), h = Math.min(a[3], b[3]) - Math.max(a[1], b[1]); if (w <= 0 || h <= 0) return 0; const area = r => Math.max(1e-6, (r[2] - r[0]) * (r[3] - r[1])); return (w * h) / Math.min(area(a), area(b)); };
  const norm = r => [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])];
  for (const n of notes) {
    const rect = n.rect && norm(n.rect);
    const linked = links.some(l => l.page === n.page && (l.rect && rect ? overlap(norm(l.rect), rect) >= 0.5 : false));
    const quoted = n.excerpt && n.excerpt.replace(/\s+/g, '').length >= 6 && flat.includes(n.excerpt.replace(/\s+/g, ''));
    if (linked || quoted) done.add(n.page + ':' + n.xref);
  }
  return done;
}
export function filterNotes(notes, { term = '', type = '', color = '', tag = '', pages = null, status = '' } = {}, excerpted = new Set()) {
  const t = term.trim().toLocaleLowerCase();
  return notes.filter(n => (!type || n.type === type) && (!color || n.color === color)
    && (!tag || (tag === '-' ? !(n.tags || []).length : (n.tags || []).includes(tag)))
    && (!pages || pages.has(n.page))
    && (!status || (status === 'done') === excerpted.has(n.page + ':' + n.xref))
    && (!t || [n.text, n.excerpt, ...(n.tags || [])].join(' ').toLocaleLowerCase().includes(t)));
}

export function createAnnotPanel({ api, snapshot, applyEdit, guard, status, navigate, notesFor, insertNotes, noteText, addDocuments, selectAnnotation, refresh }) {
  let view = null; // { s, notes, selected:Set<key>, filters, excerpted, content, list, count }
  const keyOf = n => n.page + ':' + n.xref;
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const btn = (text, action, parent, extra = {}) => { const b = el('button', extra.className || '', text); b.type = 'button'; if (extra.id) b.id = extra.id; if (extra.title) b.title = extra.title; if (extra.icon) b.dataset.icon = extra.icon; b.onclick = () => guard(action); parent.append(b); return b; };

  async function render(s, { controls, content, alive }) {
    const progress = el('p', 'annotCount', '正在读取批注与摘录…'); controls.append(progress);
    const result = await api.toolsJob(s.id, await snapshot(s), { action: 'inspect', annotations: true }); if (!alive()) return;
    const notes = result.data.notes || []; s.notes = notes;
    const note = notesFor(s), excerpted = note ? excerptedKeys(notes, noteText(note), { id: s.id, path: s.path }) : new Set();
    view = { s, notes, note, excerpted, // Selection does not survive a refresh: each edit saves the document, which renumbers objects,
    // so an old page:xref key could point at a different annotation.
    selected: new Set(), content, progress, filters: view?.s === s ? view.filters : { term: '', type: '', color: '', tag: '', pages: '', status: '' } };
    // ——— filters ———
    const bar = el('div', 'annotFilters'); controls.append(bar);
    const term = el('input'); term.type = 'search'; term.placeholder = '筛选原文、备注或标签'; term.setAttribute('aria-label', '筛选批注'); term.value = view.filters.term; bar.append(term);
    const select = (label, options, value, key) => { const sel = el('select'); sel.setAttribute('aria-label', label); for (const [v, t] of [['', label], ...options]) { const o = el('option', '', t); o.value = v; sel.append(o); } sel.value = value; sel.onchange = () => { view.filters[key] = sel.value; draw(); }; bar.append(sel); return sel; };
    const types = [...new Set(notes.map(n => n.type))];
    select('全部类型', types.map(t => [t, ANNOT_LABEL[t] || t]), view.filters.type, 'type');
    select('全部颜色', [...new Set(notes.map(n => n.color).filter(Boolean))].map(c => [c, c]), view.filters.color, 'color');
    const tags = [...new Set([...DEFAULT_TAGS, ...notes.flatMap(n => n.tags || [])])];
    select('全部标签', [...tags.map(t => [t, t]), ['-', '无标签']], view.filters.tag, 'tag');
    if (note) select('摘录状态', [['done', '已摘录到笔记'], ['todo', '尚未摘录']], view.filters.status, 'status');
    const pages = el('input'); pages.placeholder = '页码，如 1-3,7'; pages.setAttribute('aria-label', '按页码筛选'); pages.value = view.filters.pages; pages.className = 'annotPages'; bar.append(pages);
    term.oninput = () => { view.filters.term = term.value; draw(); };
    pages.oninput = () => { view.filters.pages = pages.value; draw(); };
    // ——— batch actions ———
    const batch = el('div', 'annotBatch'); controls.append(batch);
    const scope = () => { const chosen = view.notes.filter(n => view.selected.has(keyOf(n))); return chosen.length ? chosen : current(); };
    btn('全选筛选结果', () => { for (const n of current()) view.selected.add(keyOf(n)); draw(); }, batch);
    btn('清除选择', () => { view.selected.clear(); draw(); }, batch);
    const colors = el('span', 'annotSwatches'); colors.setAttribute('aria-label', '把选中批注改成这个颜色'); batch.append(colors);
    for (const c of PALETTE) { const b = btn('', () => batchEdit({ color: c }, '批注改色'), colors, { className: 'annotSwatch', title: '改为 ' + c }); b.style.background = c; b.setAttribute('aria-label', '改为 ' + c); }
    const tagMenu = el('select'); tagMenu.setAttribute('aria-label', '标签'); tagMenu.className = 'annotTagMenu';
    for (const [v, t] of [['', '标签…'], ...tags.map(t => ['+' + t, '加标签：' + t]), ['+?', '加新标签…'], ...tags.map(t => ['-' + t, '去掉：' + t])]) { const o = el('option', '', t); o.value = v; tagMenu.append(o); }
    tagMenu.onchange = () => guard(async () => {
      const v = tagMenu.value; tagMenu.value = ''; if (!v) return;
      let tag = v.slice(1); if (tag === '?') { tag = (prompt('新标签名称（最多 40 字）') || '').trim(); if (!tag) return; }
      await batchEdit(v[0] === '+' ? { addTags: [tag] } : { removeTags: [tag] }, (v[0] === '+' ? '加标签：' : '去掉标签：') + tag);
    });
    batch.append(tagMenu);
    btn('删除选中批注', async () => { const items = view.notes.filter(n => view.selected.has(keyOf(n)) && n.xref).map(n => ({ page: n.page, xref: n.xref })); if (!items.length) throw new Error('请先勾选要删除的批注。'); const r = await applyEdit(s, { action: 'annot-delete', items }, `删除 ${items.length} 条批注`); if (!r?.canceled) status(r?.note || '已删除批注，可撤销。'); await refresh(); }, batch, { id: 'deleteAnnotations' });
    const out = el('div', 'annotExport'); controls.append(out);
    btn('将选中批注整理为笔记', async () => {
      const chosen = view.notes.filter(n => view.selected.has(keyOf(n))); if (!chosen.length) throw new Error('请先勾选要整理的批注。');
      const made = await api.notesMarkdown(s.id, chosen);
      const partner = notesFor(s); if (partner && made[0]) { insertNotes(partner, made[0].text.replace(/^# .*\n+/, '')); await api.closeDocument(made[0].id, {}).catch(() => {}); status('已整理到 ' + partner.name + ' · 可撤销，尚未保存'); await refresh(); return; }
      await addDocuments(made);
    }, out, { id: 'notesToMarkdown' });
    for (const [label, format] of [['导出 Markdown', 'md'], ['导出 Word', 'docx']]) btn(label, async () => { const items = scope(); const r = await api.exportNotes(s.id, items, format, await snapshot(s)); if (r?.path) progress.textContent = `已导出 ${items.length} 条：${r.path}`; }, out, { title: '导出勾选的批注；没有勾选时导出当前筛选结果' });
    btn('刷新', () => refresh(), out);
    const list = el('div', 'annotCards'); content.append(list); view.list = list;
    draw();
  }
  function current() { let pages = null; try { pages = pageFilter(view.filters.pages, view.s.app.pagesCount); } catch { pages = new Set(); } return filterNotes(view.notes, { ...view.filters, pages }, view.excerpted); }
  async function batchEdit(change, label) {
    const items = view.notes.filter(n => view.selected.has(keyOf(n)) && n.xref).map(n => ({ page: n.page, xref: n.xref }));
    if (!items.length) throw new Error('请先勾选批注。');
    const r = await applyEdit(view.s, { action: 'annot-batch', items, ...change }, `${label} · ${items.length} 条`);
    if (!r?.canceled) status(r?.note || '已修改批注 · 可撤销');
    await refresh();
  }
  function draw() {
    const { list, notes, selected, excerpted, note } = view, found = current();
    list.replaceChildren();
    view.progress.textContent = `${found.length} / ${notes.length} 条批注` + (selected.size ? ` · 已选 ${selected.size} 条` : '') + ' · 包含未保存修改';
    for (const n of found) {
      const card = el('div', 'annotationSelectRow annotCard'); card.dataset.key = keyOf(n); card.classList.toggle('isSelected', selected.has(keyOf(n)));
      if (n.color) card.style.setProperty('--annot-color', n.color);
      const check = el('input'); check.type = 'checkbox'; check.checked = selected.has(keyOf(n)); check.setAttribute('aria-label', '选择第 ' + n.page + ' 页批注');
      check.onchange = () => { check.checked ? selected.add(keyOf(n)) : selected.delete(keyOf(n)); card.classList.toggle('isSelected', check.checked); view.progress.textContent = `${found.length} / ${notes.length} 条批注` + (selected.size ? ` · 已选 ${selected.size} 条` : '') + ' · 包含未保存修改'; };
      const body = el('button', 'annotCardBody'); body.type = 'button';
      const head = el('span', 'annotCardHead', `第 ${n.page} 页 · ${ANNOT_LABEL[n.type] || n.type}`); body.append(head);
      if (note) head.append(el('em', excerpted.has(keyOf(n)) ? 'annotDone' : 'annotTodo', excerpted.has(keyOf(n)) ? '已摘录' : '未摘录'));
      if (n.excerpt) body.append(el('q', 'annotQuote', n.excerpt));
      if (n.text) body.append(el('span', 'annotNote', n.text));
      if ((n.tags || []).length) { const t = el('span', 'annotTags'); for (const tag of n.tags) t.append(el('i', '', tag)); body.append(t); }
      body.onclick = () => guard(() => navigate(async () => { view.s.app.pdfViewer.currentPageNumber = n.page; await selectAnnotation?.(view.s, n.page, n.xref); }));
      card.append(check, body); list.append(card);
    }
    if (!found.length) list.append(el('p', 'annotEmpty', notes.length ? '没有符合条件的批注。' : '这份文档还没有批注。'));
  }
  // The page selected an annotation: highlight and reveal its card.
  function highlight(s, page, xref) {
    if (!view || view.s !== s || !view.list?.isConnected) return;
    for (const card of view.list.querySelectorAll('.annotCard')) card.classList.toggle('isCurrent', card.dataset.key === page + ':' + xref);
    view.list.querySelector('.annotCard.isCurrent')?.scrollIntoView({ block: 'nearest' });
  }
  return { render, highlight };
}
