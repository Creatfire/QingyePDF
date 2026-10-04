// Notes mode (0.10.0): two open documents side by side — any mix of PDF and Markdown.
// 0.11.0 adds the two-way link: excerpts carry their place in the PDF, regions can be cut out as
// pictures, annotations are collected into the note and the note follows the page being read.
// A pane is only a view slot: both documents stay ordinary tabs, so saving, undo, drafts and
// recovery are untouched. The pane that was clicked last is the focused one and is what
// current() returns; the PDF toolbar keeps serving the PDF of a PDF + Markdown pair.
// Desktop only: the Android build never calls start().

const MIN_RATIO = 25, MAX_RATIO = 75, PAIRS_KEY = 'qingye.notes.pairs';

// ——— pure helpers (unit tested) ———
export const clampRatio = value => Math.max(MIN_RATIO, Math.min(MAX_RATIO, Number.isFinite(Number(value)) ? Number(value) : 50));
/** Which pane a document that is not in the split replaces: the pane showing the same kind of
 *  document, otherwise (both panes the same kind, or none matching) the focused pane. */
export function choosePane(kinds, focusIndex, newKind) {
  const matches = [0, 1].filter(index => kinds[index] === newKind);
  return matches.length === 1 ? matches[0] : focusIndex === 1 ? 1 : 0;
}
/** file: URL of a local path, as Node's pathToFileURL writes it (drive letter kept, segments encoded). */
export function fileHref(path) {
  const normal = String(path).replace(/\\/g, '/');
  const encoded = normal.split('/').map((part, index) => index === 0 && /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part)).join('/');
  return 'file://' + (encoded.startsWith('/') ? '' : '/') + encoded;
}
/** Link back to a PDF page, in the format annotation notes use (see notes-markdown.cjs). */
export function sourceHref({ id, path, page, rect }) {
  // rect (0.11.0): the passage's box in PDF coordinates, so the link leads back to the exact place.
  const box = Array.isArray(rect) && rect.length === 4 && rect.every(v => typeof v === 'number' && Number.isFinite(v)) ? rect.map(v => Math.round(v * 1000) / 1000) : null;
  if (!path) return '#qingye-source-' + encodeURIComponent(JSON.stringify(box ? { id, page, rect: box } : { id, page }));
  const params = new URLSearchParams({ page: String(page) }); if (box) params.set('rect', box.join(','));
  return fileHref(path) + '#' + params;
}
const escapeMd = text => String(text).replace(/[\\`*_{}\[\]<>#]/g, '\\$&');
/** A quoted passage followed by a link to where it came from. */
export function excerptMarkdown({ id, name, path, page, text, rect }) {
  const quote = String(text).replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean).map(line => '> ' + escapeMd(line)).join('\n');
  return `${quote}\n\n[${escapeMd(name)} · 第 ${page} 页](<${sourceHref({ id, path, page, rect })}>)\n`;
}
/** Text to insert at `at` so that the block stands on its own paragraph. */
export function blockInsertion(original, at, block) {
  const before = original.slice(0, at), after = original.slice(at);
  const lead = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const trail = !after || after.startsWith('\n\n') ? '\n' : after.startsWith('\n') ? '\n' : '\n\n';
  return lead + block.replace(/\n+$/, '') + trail;
}


// ——— two-way links between a note and its PDF (0.11.0) ———
const sameFile = (a, b) => { try { return decodeURIComponent(a).toLowerCase() === decodeURIComponent(b).toLowerCase(); } catch { return a === b; } };
/** Every link in a note that points at a PDF page: [{ offset, href, base, id, page, rect }]. */
export function sourceLinks(text) {
  const found = [], pattern = /\]\(<?((file:\/\/[^)>\s#]*)#(page=\d+[^)>\s]*)|#qingye-source-([^)>\s]+))>?\)/g;
  for (let m; (m = pattern.exec(String(text)));) {
    try {
      if (m[4]) { const point = JSON.parse(decodeURIComponent(m[4])); if (Number.isInteger(point.page) && point.page > 0) found.push({ offset: m.index, href: m[1], base: '', id: point.id, page: point.page, rect: Array.isArray(point.rect) ? point.rect : null }); continue; }
      const params = new URLSearchParams(m[3]), page = Number(params.get('page')), rect = params.get('rect')?.split(',').map(Number);
      if (Number.isInteger(page) && page > 0) found.push({ offset: m.index, href: m[1], base: m[2], id: null, page, rect: rect?.length === 4 && rect.every(Number.isFinite) ? rect : null });
    } catch { /* a malformed link is simply not a source link */ }
  }
  return found;
}
/** The links of a note that point into this PDF. */
export const linksInto = (text, { id, path }) => sourceLinks(text).filter(link => link.base ? !!path && sameFile(link.base, fileHref(path)) : link.id === id);
/** Where the excerpt that ends with the link at `offset` begins (its quote or picture). */
export function excerptStart(text, offset) {
  let start = text.lastIndexOf('\n', offset - 1) + 1, pos = start;
  while (pos > 0) {
    const lineStart = text.lastIndexOf('\n', pos - 2) + 1, line = text.slice(lineStart, pos - 1);
    if (line.trim() && !/^\s*(>|!\[)/.test(line)) break;
    pos = lineStart; if (line.trim()) start = lineStart;
  }
  return start;
}
/** Offset in the note to show for a PDF page: the first excerpt of that page, otherwise the
 *  last excerpt of the nearest earlier page; null when the note has nothing up to that page. */
export function pageAnchor(links, page) {
  const exact = links.filter(link => link.page === page);
  if (exact.length) return Math.min(...exact.map(link => link.offset));
  const earlier = links.filter(link => link.page < page); if (!earlier.length) return null;
  const nearest = Math.max(...earlier.map(link => link.page));
  return Math.max(...earlier.filter(link => link.page === nearest).map(link => link.offset));
}
/** Markdown for the annotations of a PDF that the note does not contain yet. */
export function annotationsMarkdown(source, annotations, existing = '') {
  const parts = []; let added = 0, skipped = 0; const seen = new Set();
  for (const n of annotations) {
    const href = sourceHref({ id: source.id, path: source.path, page: n.page, rect: n.rect });
    if (existing.includes(href) || seen.has(href)) { skipped++; continue; }
    seen.add(href); added++;
    const quote = String(n.excerpt || '').replace(/\r\n?/g, '\n').split('\n').map(line => line.trim()).filter(Boolean).map(line => '> ' + escapeMd(line)).join('\n');
    if (quote) parts.push(quote, '');
    if (String(n.text || '').trim()) parts.push(escapeMd(String(n.text).trim()).replace(/\r?\n/g, '  \n'), '');
    parts.push(`[${escapeMd(source.name)} · 第 ${n.page} 页${n.type ? ' · ' + escapeMd(n.type) : ''}](<${href}>)`, '');
  }
  return { text: parts.join('\n'), added, skipped };
}
/** A picture cut out of a PDF page, followed by the link back to that region. */
export function regionMarkdown({ id, name, path, page, rect, image }) {
  return `![${escapeMd(name)} 第 ${page} 页](${/[\s()]/.test(image) ? '<' + image + '>' : image})\n\n[${escapeMd(name)} · 第 ${page} 页 · 区域](<${sourceHref({ id, path, page, rect })}>)\n`;
}
/** Normalises a dragged box (fractions of the page, any corner order) or returns null when it is too small. */
export function regionBox(box) {
  if (!Array.isArray(box) || box.length !== 4 || box.some(v => typeof v !== 'number' || !Number.isFinite(v))) return null;
  const clamp = v => Math.max(0, Math.min(1, v)), x0 = clamp(Math.min(box[0], box[2])), x1 = clamp(Math.max(box[0], box[2])), y0 = clamp(Math.min(box[1], box[3])), y1 = clamp(Math.max(box[1], box[3]));
  return x1 - x0 < .01 || y1 - y0 < .01 ? null : [x0, y0, x1, y1];
}

export function createNotesMode({ sessions, isMd, activeId, activate, endCompare, api, guard, status, markdown, addDocuments, onChange, inspect, save, imageOptions, cite, orientation = () => 'columns' }) {
  const $ = id => document.getElementById(id);
  let split = null; // { ids: [left, right], ratio }
  const kind = id => isMd(sessions.get(id)) ? 'markdown' : 'pdf';
  const has = id => !!split && split.ids.includes(id);
  const valid = () => !!split && split.ids.every(id => sessions.has(id)) && split.ids[0] !== split.ids[1];
  const partnerId = id => has(id) ? split.ids.find(other => other !== id) : null;
  const partner = id => { const other = partnerId(id); return other ? sessions.get(other) : null; };

  // ——— divider ———
  const divider = document.createElement('div'); divider.id = 'notesDivider'; divider.hidden = true;
  divider.setAttribute('role', 'separator'); divider.setAttribute('aria-orientation', 'vertical'); divider.setAttribute('aria-label', '调整左右窗格宽度'); divider.tabIndex = 0;
  const swapButton = document.createElement('button'); swapButton.type = 'button'; swapButton.dataset.icon = 'compare'; swapButton.title = '交换左右窗格'; swapButton.setAttribute('aria-label', '交换左右窗格');
  const closeButton = document.createElement('button'); closeButton.type = 'button'; closeButton.dataset.icon = 'x'; closeButton.title = '退出笔记模式'; closeButton.setAttribute('aria-label', '退出笔记模式');
  const controls = document.createElement('div'); controls.className = 'notesDividerTools'; const tool = (icon, label, action) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.icon = icon; b.title = label; b.setAttribute('aria-label', label); b.onclick = () => guard(action); return b; };
  const syncButton = tool('link', '滚动联动：翻页时笔记跟到对应摘录', () => setSync(!syncOn));
  const regionButton = tool('crop', '框选区域摘录到笔记 · Ctrl+Shift+U', () => pickRegion());
  const annotationsButton = tool('comment', '把 PDF 批注同步到笔记', () => syncAnnotations());
  controls.append(regionButton, annotationsButton, syncButton, swapButton, closeButton); divider.append(controls);
  $('viewers').append(divider);
  swapButton.onclick = () => swap(); closeButton.onclick = () => end();
  for (const button of [regionButton, annotationsButton, syncButton, swapButton, closeButton]) button.addEventListener('pointerdown', event => event.stopPropagation());
  const setRatio = value => { if (!split) return; split.ratio = clampRatio(value); layout(activeId()); };
  divider.addEventListener('pointerdown', event => {
    if (event.button !== 0 || !split) return;
    event.preventDefault(); divider.setPointerCapture(event.pointerId); document.body.classList.add('notesResizing');
    const box = $('viewers').getBoundingClientRect();
    const move = e => setRatio(rows() ? (e.clientY - box.top) / box.height * 100 : (e.clientX - box.left) / box.width * 100);
    const stop = () => { divider.removeEventListener('pointermove', move); divider.removeEventListener('pointerup', stop); divider.removeEventListener('pointercancel', stop); document.body.classList.remove('notesResizing'); resized(); };
    divider.addEventListener('pointermove', move); divider.addEventListener('pointerup', stop); divider.addEventListener('pointercancel', stop);
  });
  divider.addEventListener('dblclick', event => { if (event.target === divider) { setRatio(50); resized(); } });
  divider.addEventListener('keydown', event => { if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return; event.preventDefault(); setRatio(split.ratio + (['ArrowLeft', 'ArrowUp'].includes(event.key) ? -2 : 2)); resized(); });
  // A narrow upright screen (a phone held in portrait) stacks the panes instead of putting them side by side.
  const rows = () => orientation() === 'rows';
  addEventListener('resize', () => { if (split) { layout(activeId()); resized(); } });
  // PDF panes re-fit their page width after the divider moves.
  const resized = () => { if (split) onChange?.('resize', split.ids); };

  /** Called by activate(id) before it shows anything. Keeps the split consistent and, when a
   *  document outside the split is activated, puts it into the matching pane. */
  function place(id) {
    if (!split) return;
    if (!valid()) { split = null; return; }
    if (id === null || split.ids.includes(id) || !sessions.has(id)) return;
    const focus = Math.max(0, split.ids.indexOf(activeId()));
    split.ids[choosePane(split.ids.map(kind), focus, kind(id))] = id;
    rememberPair();
  }
  /** The ids to show for activate(id): both panes, or null for the ordinary single view. */
  const shown = id => valid() && id !== null && split.ids.includes(id) ? split.ids : null;
  function layout(id) {
    const ids = shown(id);
    const stacked = !!ids && rows();
    document.body.classList.toggle('notesMode', !!ids); document.body.classList.toggle('notesRows', stacked);
    divider.hidden = !ids; divider.setAttribute('aria-orientation', stacked ? 'horizontal' : 'vertical');
    for (const s of sessions.values()) {
      const index = ids ? ids.indexOf(s.id) : -1, panel = s.panel; if (!panel) continue;
      panel.classList.toggle('noteLeft', index === 0); panel.classList.toggle('noteRight', index === 1); panel.classList.toggle('noteFocus', index >= 0 && s.id === id);
      const start = index === 1 ? split.ratio + '%' : '', size = index === 0 ? split.ratio + '%' : index === 1 ? (100 - split.ratio) + '%' : '';
      panel.style.left = stacked ? '' : start; panel.style.width = stacked ? '' : size; panel.style.top = stacked ? start : ''; panel.style.height = stacked ? size : '';
    }
    if (ids) { divider.style.left = stacked ? '' : split.ratio + '%'; divider.style.top = stacked ? split.ratio + '%' : ''; divider.setAttribute('aria-valuenow', String(Math.round(split.ratio))); }
    const button = $('notesButton'); if (button) { button.setAttribute('aria-pressed', String(!!split)); }
    const pdf = ids && pdfOfSplit(); regionButton.hidden = annotationsButton.hidden = syncButton.hidden = !pdf; syncButton.setAttribute('aria-pressed', String(syncOn));
  }

  function start(leftId, rightId) {
    if (leftId === rightId) throw new Error('同一个文档不能同时放在左右两侧。');
    if (!sessions.get(leftId)?.loaded || !sessions.get(rightId)?.loaded) throw new Error('文档尚未加载完成，请稍后再试。');
    endCompare?.();
    split = { ids: [leftId, rightId], ratio: split?.ratio || 50 };
    rememberPair();
    // Half a window is too narrow for a Markdown outline beside the text: it becomes a drawer.
    for (const id of split.ids) { const s = sessions.get(id); if (isMd(s) && markdown.outlineOpen?.(s)) markdown.toggleOutline(s, false); }
    // The right pane (usually the notes) gets the focus: that is where typing continues.
    activate(rightId); resized();
    status('笔记模式：点击任一侧即可在其中操作；Ctrl+\\ 退出');
  }
  function end() {
    if (!split) return; stopPicking();
    const keep = split.ids.includes(activeId()) ? activeId() : split.ids[0];
    split = null; activate(sessions.has(keep) ? keep : null); onChange?.('resize', [keep]);
  }
  function swap() { if (!split) return; split.ids.reverse(); split.ratio = 100 - split.ratio; activate(activeId()); resized(); }
  /** A split document was closed: leave notes mode, the caller activates what remains. */
  function closed(id) { if (has(id)) { stopPicking(); split = null; } }

  // ——— remembered pairs: "this PDF was last read next to that note" ———
  const readPairs = () => { try { const value = JSON.parse(localStorage.getItem(PAIRS_KEY) || '{}'); return value && typeof value === 'object' ? value : {}; } catch { return {}; } };
  function rememberPair() {
    if (!split) return; const [a, b] = split.ids.map(id => sessions.get(id));
    if (!a?.path || !b?.path) return;
    const pairs = readPairs(); pairs[a.path] = b.path; pairs[b.path] = a.path;
    const keys = Object.keys(pairs); for (const key of keys.slice(0, Math.max(0, keys.length - 200))) delete pairs[key];
    try { localStorage.setItem(PAIRS_KEY, JSON.stringify(pairs)); } catch {}
  }
  const rememberedPath = s => (s?.path && readPairs()[s.path]) || null;

  // ——— entry menu ———
  const menu = document.createElement('section'); menu.id = 'notesMenu'; menu.className = 'menuPopover'; menu.setAttribute('popover', 'auto'); menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', '笔记模式');
  document.body.append(menu);
  const entry = (label, icon, action, hint) => { const b = document.createElement('button'); b.type = 'button'; b.className = 'menuItem'; b.setAttribute('role', 'menuitem'); b.dataset.icon = icon; const text = document.createElement('span'); text.className = 'notesMenuText'; text.textContent = label; b.append(text); if (hint) { const small = document.createElement('small'); small.className = 'shortcut'; small.textContent = hint; if (!/^(Ctrl|Alt|Shift)\+/.test(hint)) small.setAttribute('translate', 'no'); b.append(small); } b.onclick = () => { menu.hidePopover(); guard(action); }; return b; };
  const heading = text => { const h = document.createElement('div'); h.className = 'menuLabel'; h.textContent = text; return h; };
  async function newNote(base) {
    const created = await api.newMarkdown(); await addDocuments(created);
    const note = sessions.get(created[0].id); if (!note?.loaded) throw new Error('无法新建笔记。');
    // A new note starts with a title naming what it is about.
    if (!isMd(base)) { note.editor.replaceAll(`# ${base.name.replace(/\.pdf$/i, '')} 笔记\n\n`); note.editor.setCaret?.(note.editor.text.length); }
    return note;
  }
  async function openRemembered(path) {
    const open = [...sessions.values()].find(s => s.path === path); if (open) return open;
    const recent = (await api.recent()).find(item => item.path === path); if (!recent) throw new Error('上次搭配的文档不在最近列表中，请手动打开它。');
    const opened = await api.openRecent(recent.id); await addDocuments(opened);
    return sessions.get(opened[0]?.id) || [...sessions.values()].find(s => s.path === path);
  }
  function openMenu(anchor) {
    const base = sessions.get(activeId());
    menu.replaceChildren();
    if (split) {
      const pdf = pdfOfSplit();
      if (pdf) menu.append(heading('摘录到笔记'), entry('摘录选中的文字', 'quote', () => excerptSelection(pdf), 'Ctrl+Shift+E'), entry('框选区域（公式、图表、表格）', 'crop', () => pickRegion(pdf), 'Ctrl+Shift+U'),
        entry('同步 PDF 批注到笔记', 'comment', () => syncAnnotations(pdf)), entry(syncOn ? '关闭滚动联动' : '开启滚动联动', 'link', () => setSync(!syncOn), syncOn ? '已开启' : '已关闭'));
      if (pdf && cite) menu.append(entry('引用信息 / BibTeX…', 'info', () => cite(pdf)));
      menu.append(heading('笔记模式'), entry('交换左右窗格', 'compare', swap), entry('退出笔记模式', 'x', end, 'Ctrl+\\'));
    }
    else if (!base?.loaded) { const note = document.createElement('p'); note.className = 'notesMenuNote'; note.textContent = '先打开一个 PDF 或 Markdown 文档，再进入笔记模式。'; menu.append(heading('笔记模式'), note); }
    else {
      menu.append(heading('左侧：' + base.name), heading('右侧打开'));
      const others = [...sessions.values()].filter(s => s.loaded && s.id !== base.id);
      const remembered = rememberedPath(base);
      if (remembered && !others.some(s => s.path === remembered)) menu.append(entry('上次搭配的文档', 'history', async () => { const other = await openRemembered(remembered); if (other) start(base.id, other.id); }, remembered.replace(/^.*[\\/]/, '')));
      menu.append(entry('新建一份笔记', 'newdoc', async () => { const note = await newNote(base); start(base.id, note.id); }, 'Markdown'));
      for (const other of others) menu.append(entry(other.name, isMd(other) ? 'markdown' : 'file', () => start(base.id, other.id), other.path && other.path === remembered ? '上次搭配' : ''));
      menu.append(entry('打开其他文件…', 'open', async () => { const opened = await api.open(); if (!opened.length) return; await addDocuments(opened); const other = sessions.get(opened[0].id); if (other && other.id !== base.id) start(base.id, other.id); }));
    }
    const box = anchor.getBoundingClientRect();
    menu.style.top = Math.round(box.bottom + 6) + 'px'; menu.style.right = Math.max(8, Math.round(innerWidth - box.right)) + 'px'; menu.style.left = 'auto';
    menu.showPopover();
  }
  /** The shortcut leaves notes mode directly; the title-bar button (showMenu) offers its commands. */
  function toggle(anchor = $('notesButton'), showMenu = false) { if (menu.matches(':popover-open')) { menu.hidePopover(); return; } if (split && !showMenu) { end(); return; } openMenu(anchor); }
  /** Right-click on a tab: put that document beside the current one. */
  function tabMenu(id, x, y) {
    const target = sessions.get(id), base = sessions.get(activeId()); if (!target?.loaded) return;
    menu.replaceChildren(heading(target.name));
    if (has(id)) menu.append(entry('交换左右窗格', 'compare', swap), entry('退出笔记模式', 'x', end));
    else if (base?.loaded && base.id !== id) menu.append(entry('在右侧打开（笔记模式）', 'double', () => start(base.id, id)), entry('在左侧打开（笔记模式）', 'double', () => start(id, base.id)));
    else menu.append(entry('在右侧新建一份笔记', 'newdoc', async () => { activate(id); const note = await newNote(target); start(id, note.id); }));
    menu.style.top = Math.round(y) + 'px'; menu.style.left = Math.round(Math.min(x, innerWidth - 260)) + 'px'; menu.style.right = 'auto';
    menu.showPopover();
  }

  // ——— working across the panes ———
  /** The Markdown document beside this PDF, if any. */
  const notesFor = s => { const other = partner(s?.id); return other?.loaded && isMd(other) && !isMd(s) ? other : null; };
  /** Inserts a block of Markdown into the note at its cursor, as one undoable edit. */
  function insertBlock(note, block, { atEnd = false } = {}) {
    if (note.readonly || note.editor.sourceMode) markdown.setViewMode(note, 'live');
    const editor = note.editor, at = atEnd ? editor.text.length : Math.min(editor.text.length, editor.currentSelection().to), insert = blockInsertion(editor.text, at, block);
    editor.apply([{ from: at, to: at, insert }], { from: at + insert.length, to: at + insert.length }, { group: 'notes', activate: false });
    editor.scrollToOffset?.(at + insert.length);
  }
  const needNote = s => { const note = notesFor(s); if (!note) throw new Error('请先进入笔记模式，并在另一侧打开一份 Markdown 笔记。'); return note; };
  /** The PDF of a PDF + Markdown split. */
  const pdfOfSplit = () => valid() ? split.ids.map(id => sessions.get(id)).find(s => notesFor(s)) || null : null;
  function excerpt(s, text, page, rect) {
    const note = needNote(s);
    if (!String(text || '').trim()) throw new Error('请先在 PDF 中选中要摘录的文字。');
    insertBlock(note, excerptMarkdown({ id: s.id, name: s.name, path: s.path, page, text, rect }));
    status(`已摘录到 ${note.name} · 可撤销，尚未保存`);
  }

  // ——— 0.11.0: excerpts that know where they came from ———
  /** A box in CSS pixels of the page's layer → PDF coordinates [x0, y0, x1, y1]. */
  function pdfRect(view, layerBox, [x0, y0, x1, y1]) {
    const k = view.viewport.width / (layerBox.width || view.viewport.width), a = view.viewport.convertToPdfPoint(x0 * k, y0 * k), b = view.viewport.convertToPdfPoint(x1 * k, y1 * k);
    return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[0], b[0]), Math.max(a[1], b[1])];
  }
  const pageLayer = view => view.div.querySelector('.textLayer') || view.div.querySelector('.canvasWrapper') || view.div;
  /** The current text selection of a PDF: { text, page, rect } (rect is null when it cannot be measured). */
  function selectionSource(s, page) {
    const selection = s.frame.contentWindow.getSelection(), text = selection?.toString() || '';
    const node = selection?.anchorNode, element = (node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('.page');
    const number = page || Number(element?.dataset.pageNumber) || s.app.pdfViewer.currentPageNumber, view = s.app.pdfViewer.getPageView(number - 1);
    let rect = null;
    if (selection?.rangeCount && view?.viewport) {
      const box = pageLayer(view).getBoundingClientRect(); let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
      for (const r of selection.getRangeAt(0).getClientRects()) { if (r.width < 1 || r.height < 1 || r.bottom < box.top || r.top > box.bottom) continue; x0 = Math.min(x0, r.left); y0 = Math.min(y0, r.top); x1 = Math.max(x1, r.right); y1 = Math.max(y1, r.bottom); }
      if (Number.isFinite(x0)) rect = pdfRect(view, box, [x0 - box.left, y0 - box.top, x1 - box.left, y1 - box.top]);
    }
    return { text, page: number, rect };
  }
  function excerptSelection(s = pdfOfSplit(), page) { if (!s) throw new Error('请先进入笔记模式，并在另一侧打开一份 Markdown 笔记。'); const source = selectionSource(s, page); excerpt(s, source.text, source.page, source.rect); }

  /** Cuts a region out of a PDF page (fractions of the page) and puts the picture into the note. */
  async function excerptRegion(s, page, box) {
    const note = needNote(s), region = regionBox(box); if (!region) throw new Error('框选的区域太小，请重新拖动。');
    // Pictures are stored beside the note, so the note needs a place on disk first.
    if (!note.path && !(await save?.(note)) || !note.path) throw new Error('区域摘录的图片保存在笔记旁的文件夹里，请先保存这份笔记。');
    const view = s.app.pdfViewer.getPageView(page - 1); if (!view) throw new Error('页码无效。');
    const pdfPage = view.pdfPage || await s.app.pdfDocument.getPage(page), rotation = view.viewport.rotation, base = pdfPage.getViewport({ scale: 1, rotation });
    const [x0, y0, x1, y1] = region;
    // Sharp enough to read formulas: about 1600 px across, within 1.5×–4× and a 16-megapixel page.
    const scale = Math.max(1, Math.min(4, Math.max(1.5, 1600 / ((x1 - x0) * base.width)), Math.sqrt(16e6 / (base.width * base.height))));
    const viewport = pdfPage.getViewport({ scale, rotation }), canvas = document.createElement('canvas');
    canvas.width = Math.max(1, Math.round((x1 - x0) * viewport.width)); canvas.height = Math.max(1, Math.round((y1 - y0) * viewport.height));
    const context = canvas.getContext('2d'); context.fillStyle = '#fff'; context.fillRect(0, 0, canvas.width, canvas.height);
    await pdfPage.render({ canvasContext: context, viewport, transform: [1, 0, 0, 1, -Math.round(x0 * viewport.width), -Math.round(y0 * viewport.height)], background: 'rgba(0,0,0,0)' }).promise;
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png')); if (!blob) throw new Error('无法生成区域图片。');
    const image = await api.mdImageSave(note.id, new Uint8Array(await blob.arrayBuffer()), 'png', imageOptions?.() || {});
    const w = view.viewport.width, h = view.viewport.height, rect = pdfRect(view, { width: w }, [x0 * w, y0 * h, x1 * w, y1 * h]);
    insertBlock(note, regionMarkdown({ id: s.id, name: s.name, path: s.path, page, rect, image }));
    status(`已把第 ${page} 页的区域摘录到 ${note.name} · 可撤销，尚未保存`);
    return { image, rect, width: canvas.width, height: canvas.height };
  }
  /** Lets the user drag a box on a PDF page; Esc cancels. */
  let picking = null;
  function stopPicking() { picking?.(); picking = null; }
  function pickRegion(s = pdfOfSplit()) {
    if (!s) throw new Error('请先进入笔记模式，并在另一侧打开一份 Markdown 笔记。'); needNote(s); stopPicking();
    const doc = s.frame.contentDocument, root = doc.documentElement;
    // The viewer's content policy forbids inline <style>; a constructed sheet is allowed.
    if (!doc.qyRegionSheet) { const sheet = new s.frame.contentWindow.CSSStyleSheet(); sheet.replaceSync('html.qyRegionPicking,html.qyRegionPicking *{cursor:crosshair!important;user-select:none!important;-webkit-user-select:none!important;touch-action:none!important}.qyRegionBox{position:absolute;z-index:90;border:2px solid #249d75;background:rgba(36,157,117,.14);pointer-events:none;box-sizing:border-box}'); doc.adoptedStyleSheets = [...doc.adoptedStyleSheets, sheet]; doc.qyRegionSheet = sheet; }
    root.classList.add('qyRegionPicking');
    let drag = null;
    const fraction = event => { const b = drag.bounds; return [(event.clientX - b.left) / b.width, (event.clientY - b.top) / b.height]; };
    const paint = event => { const [x, y] = fraction(event), [x0, y0] = drag.from, c = v => Math.max(0, Math.min(1, v)); Object.assign(drag.box.style, { left: c(Math.min(x, x0)) * 100 + '%', top: c(Math.min(y, y0)) * 100 + '%', width: (c(Math.max(x, x0)) - c(Math.min(x, x0))) * 100 + '%', height: (c(Math.max(y, y0)) - c(Math.min(y, y0))) * 100 + '%' }); };
    const down = event => {
      if (event.button !== 0) return; const page = event.target.closest?.('.page'); if (!page) return;
      event.preventDefault(); event.stopImmediatePropagation();
      const view = s.app.pdfViewer.getPageView(Number(page.dataset.pageNumber) - 1), layer = pageLayer(view), box = doc.createElement('div'); box.className = 'qyRegionBox'; layer.append(box);
      drag = { page: Number(page.dataset.pageNumber), bounds: layer.getBoundingClientRect(), box }; drag.from = fraction(event); paint(event);
    };
    const move = event => { if (!drag) return; event.preventDefault(); event.stopImmediatePropagation(); paint(event); };
    const up = event => {
      if (!drag) return; event.preventDefault(); event.stopImmediatePropagation();
      const [x, y] = fraction(event), { page, from } = drag; stopPicking();
      guard(() => excerptRegion(s, page, [from[0], from[1], x, y]));
    };
    const key = event => { if (event.key === 'Escape') { event.preventDefault(); event.stopImmediatePropagation(); stopPicking(); status('已取消区域摘录'); } };
    const block = event => event.preventDefault();
    doc.addEventListener('pointerdown', down, true); doc.addEventListener('pointermove', move, true); doc.addEventListener('pointerup', up, true); doc.addEventListener('keydown', key, true); doc.addEventListener('selectstart', block, true); document.addEventListener('keydown', key, true);
    picking = () => { drag?.box.remove(); drag = null; root.classList.remove('qyRegionPicking'); doc.removeEventListener('pointerdown', down, true); doc.removeEventListener('pointermove', move, true); doc.removeEventListener('pointerup', up, true); doc.removeEventListener('keydown', key, true); doc.removeEventListener('selectstart', block, true); document.removeEventListener('keydown', key, true); };
    status('在 PDF 页面上拖动鼠标框选要摘录的区域 · Esc 取消');
  }

  /** Puts every annotation of the PDF that the note does not have yet at the end of the note. */
  async function syncAnnotations(s = pdfOfSplit()) {
    if (!s) throw new Error('请先进入笔记模式，并在另一侧打开一份 Markdown 笔记。'); const note = needNote(s);
    status('正在读取 PDF 批注…');
    const annotations = await inspect(s), made = annotationsMarkdown({ id: s.id, name: s.name, path: s.path }, annotations, note.editor.text);
    if (!made.added) { status(annotations.length ? `笔记里已经有全部 ${annotations.length} 条批注` : '这份 PDF 还没有批注'); return made; }
    insertBlock(note, made.text, { atEnd: true });
    status(`已同步 ${made.added} 条批注到 ${note.name}` + (made.skipped ? `（${made.skipped} 条已在笔记中）` : '') + ' · 可撤销，尚未保存');
    return made;
  }

  // Scroll sync: while the PDF is being read, the note follows to the excerpts of the page shown.
  let syncOn = true, syncTimer = 0, lastAnchor = '', scrollTicket = 0;
  try { syncOn = localStorage.getItem('qingye.notes.sync') !== 'off'; } catch {}
  function setSync(on) { syncOn = !!on; try { localStorage.setItem('qingye.notes.sync', syncOn ? 'on' : 'off'); } catch {} syncButton.setAttribute('aria-pressed', String(syncOn)); status(syncOn ? '滚动联动已开启：翻页时笔记跟到对应摘录' : '滚动联动已关闭'); }
  function scrollNote(note, offset) {
    const editor = note.editor, at = excerptStart(editor.text, offset);
    if (editor.sourceMode) { editor.scrollSourceTo?.(at); return; }
    const element = editor.elementAt?.(at) || editor.blocks?.find(b => b.from >= at)?.el; if (!element) return;
    const scroller = editor.scroller, gap = () => element.getBoundingClientRect().top - scroller.getBoundingClientRect().top - 16;
    scroller.scrollTo({ top: Math.max(0, gap() + scroller.scrollTop), behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth' });
    // Pictures above the excerpt may still be loading and push it down: correct the position once they have.
    const ticket = ++scrollTicket, settle = left => setTimeout(() => { if (ticket !== scrollTicket || !element.isConnected) return; const off = gap(); if (Math.abs(off) > 24 && (off < 0 || scroller.scrollTop < scroller.scrollHeight - scroller.clientHeight - 2)) scroller.scrollBy({ top: off, behavior: 'instant' }); if (left) settle(left - 1); }, 450);
    settle(2);
    element.classList.add('notesSyncFlash'); setTimeout(() => element.classList.remove('notesSyncFlash'), 1200);
  }
  /** Called when a PDF shows another page. Only follows while the PDF pane is the one in use. */
  function pageChanged(s, page, { immediate = false } = {}) {
    if (!syncOn || !has(s.id) || activeId() !== s.id) return false;
    const note = notesFor(s); if (!note) return false;
    const run = () => { if (!has(s.id) || !note.loaded) return; const offset = pageAnchor(linksInto(note.editor.text, s), page); if (offset == null) return; const key = note.id + ':' + offset; if (key === lastAnchor) return; lastAnchor = key; scrollNote(note, offset); };
    clearTimeout(syncTimer); if (immediate) run(); else syncTimer = setTimeout(run, 200);
    return true;
  }
  return { rows, has, shown, place, layout, start, end, swap, closed, toggle, tabMenu, partner, notesFor, insertBlock, excerpt, excerptSelection, selectionSource, excerptRegion, pickRegion, stopPicking, picking: () => !!picking, syncAnnotations, pageChanged, setSync, syncing: () => syncOn, pdfOfSplit, active: () => !!split, ids: () => split ? [...split.ids] : null, ratio: () => split?.ratio ?? null, setRatio, menu };
}
