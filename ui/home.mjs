// The home page (0.23): one input for files, content and commands; the document being read; a shelf
// of recent documents; notes and excerpts; the common tools. Search goes through the library index
// (library.mjs) and the command list of the palette (paletteCommands in app.mjs); there is no second
// search here. Data comes from the main process (home-ipc.cjs).
import { rankItems } from './tool-registry.mjs';
import { when } from './recent-list.mjs';
import { current as currentLanguage, onChange as onLanguage, shortcutText } from './i18n/i18n.mjs';

export const greetingFor = hour => hour < 6 ? '夜深了，' : hour < 11 ? '早上好，' : hour < 14 ? '中午好，' : hour < 18 ? '下午好，' : '晚上好，';
export const dateLabel = (date, language = 'zh-CN') => language === 'zh-CN' ? `${date.getMonth() + 1} 月 ${date.getDate()} 日 ${new Intl.DateTimeFormat('zh-CN', { weekday: 'long' }).format(date)}` : new Intl.DateTimeFormat(language, { month: 'long', day: 'numeric', weekday: 'long' }).format(date);
/** 6 covers on a wide page, then 5, 4 and 3 as the window narrows. */
export const shelfCount = width => width >= 980 ? 6 : width >= 760 ? 5 : width >= 600 ? 4 : 3;
export const progressOf = book => book.pages > 0 ? Math.max(0, Math.min(100, Math.round((book.page || 1) / book.pages * 100))) : null;
const unfinished = book => book.kind === 'pdf' && (!book.pages || (book.page || 1) < book.pages);
/** The most recent unfinished PDF; failing that, whatever was open last. */
export const pickReading = books => { const present = books.filter(b => b.inRecent && !b.missing); return present.find(unfinished) || present[0] || null; };
/** The chapter a page belongs to: the last outline entry that starts on or before it. */
export function chapterForPage(outline, page) {
  let found = '';
  for (const entry of outline || []) if (entry.page <= page) found = entry.title;
  return found;
}
/** Outline → [{ title, page }], in reading order. Entries without a page are left out. */
export async function flattenOutline(items, resolvePage, limit = 2000) {
  const out = [];
  async function walk(list) {
    for (const item of list || []) {
      if (out.length >= limit) return;
      const page = await resolvePage(item.dest).catch(() => null);
      if (Number.isInteger(page) && page > 0 && item.title) out.push({ title: String(item.title).slice(0, 200), page });
      await walk(item.items);
    }
  }
  await walk(items);
  return out.sort((a, b) => a.page - b.page);
}
/** Does this quadrilateral list cover a text item? Quads are 8 numbers each, in PDF coordinates. */
function coversItem(quads, item) {
  const [, , , , x, y] = item.transform, height = Math.abs(item.height || item.transform[3]) || 1, width = item.width || 0, midY = y + height / 2;
  for (let i = 0; i + 7 < quads.length; i += 8) {
    const xs = [quads[i], quads[i + 2], quads[i + 4], quads[i + 6]], ys = [quads[i + 1], quads[i + 3], quads[i + 5], quads[i + 7]];
    if (midY < Math.min(...ys) || midY > Math.max(...ys)) continue;
    if (x + width >= Math.min(...xs) && x <= Math.max(...xs)) return true;
  }
  return false;
}
/** The part of a text item inside the quads, assuming even character widths. */
function textInQuads(quads, item) {
  const str = item.str || '', [, , , , x] = item.transform, width = item.width || 0; if (!str || !width) return str;
  let from = str.length, to = 0;
  const y = item.transform[5], height = Math.abs(item.height || item.transform[3]) || 1, midY = y + height / 2;
  for (let i = 0; i + 7 < quads.length; i += 8) {
    const xs = [quads[i], quads[i + 2], quads[i + 4], quads[i + 6]], ys = [quads[i + 1], quads[i + 3], quads[i + 5], quads[i + 7]];
    if (midY < Math.min(...ys) || midY > Math.max(...ys)) continue;
    from = Math.min(from, Math.max(0, Math.round((Math.min(...xs) - x) / width * str.length)));
    to = Math.max(to, Math.min(str.length, Math.round((Math.max(...xs) - x) / width * str.length)));
  }
  return to > from ? str.slice(from, to) : '';
}
export function highlightText(quads, items) {
  let out = '';
  for (const item of items || []) if (typeof item.str === 'string' && item.transform && coversItem(quads, item)) out += textInQuads(quads, item);
  return out.replace(/\s+/g, ' ').trim();
}
/** "D:20261101135200+08'00'" → milliseconds, or 0. */
export function pdfDate(value) {
  const m = /^D:(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?(?:([+\-Z])(\d{2})?'?(\d{2})?)?/.exec(String(value || '')); if (!m) return 0;
  const utc = Date.UTC(Number(m[1]), Number(m[2] || 1) - 1, Number(m[3] || 1), Number(m[4] || 0), Number(m[5] || 0), Number(m[6] || 0));
  const offset = (m[7] === '+' ? 1 : m[7] === '-' ? -1 : 0) * (Number(m[8] || 0) * 60 + Number(m[9] || 0)) * 60000;
  return utc - offset;
}
const MARK_PAGE_LIMIT = 1500, MARK_SIZE_LIMIT = 100 * 1024 * 1024, SKIP_ANNOTATIONS = new Set(['Link', 'Widget', 'Popup']);
/** Counts a PDF's annotations and reads the text under its highlights. Nothing is rendered. */
export async function readMarks(doc, alive = () => true) {
  let annotations = 0; const highlights = [];
  for (let n = 1; n <= Math.min(doc.numPages, MARK_PAGE_LIMIT); n++) {
    if (!alive()) return null;
    const page = await doc.getPage(n), notes = (await page.getAnnotations()).filter(a => !SKIP_ANNOTATIONS.has(a.subtype));
    annotations += notes.length;
    const marked = notes.filter(a => a.subtype === 'Highlight' && a.quadPoints?.length);
    if (marked.length) {
      const items = (await page.getTextContent()).items;
      for (const a of marked) { const text = a.overlaidText?.trim() || highlightText(a.quadPoints, items) || a.contentsObj?.str?.trim(); if (text) highlights.push({ page: n, text, at: pdfDate(a.modificationDate) }); }
    }
  }
  return { annotations, highlights: highlights.sort((a, b) => b.at - a.at || b.page - a.page) };
}
/** Result groups of the input, in the order Enter walks them. A leading "/" searches commands only. */
export function groupResults(query, { books = [], commands = [], hits = [], marks = [] } = {}) {
  const text = String(query || '').trim(), onlyCommands = text.startsWith('/'), term = onlyCommands ? text.slice(1).trim() : text;
  const usable = commands.filter(c => !c.enabled || c.enabled());
  const commandRows = rankItems(usable, term, c => [c.label, c.keys, c.group]).slice(0, onlyCommands ? 12 : 4);
  if (onlyCommands) return [{ title: '命令', rows: commandRows.map(c => ({ kind: 'command', command: c, label: c.label, detail: c.group, shortcut: c.shortcut, icon: c.icon })) }];
  if (!term) return [];
  const lower = term.toLowerCase(), noteHits = hits.filter(h => h.doc.kind === 'markdown'), pdfHits = hits.filter(h => h.doc.kind !== 'markdown');
  const files = rankItems(books, term, b => [b.name, b.path]).slice(0, 5).map(b => ({ kind: 'file', book: b, label: b.name, detail: b.path, icon: b.kind === 'markdown' ? 'markdown' : 'file' }));
  const hitRow = h => ({ kind: 'hit', doc: h.doc, hit: h.hit, label: `${h.hit.before}${h.hit.match}${h.hit.after}`.trim(), detail: `${h.doc.name} · ${h.doc.kind === 'markdown' ? `第 ${h.hit.line} 行` : `第 ${h.hit.page} 页`}`, match: h.hit, icon: h.doc.kind === 'markdown' ? 'markdown' : 'file' });
  const markRows = marks.filter(m => m.text.toLowerCase().includes(lower)).slice(0, 3).map(m => ({ kind: 'mark', mark: m, label: m.text, detail: `${m.book.name} · 第 ${m.page} 页`, icon: 'highlight' }));
  return [
    { title: '文件', rows: files },
    { title: '内容中的匹配', rows: pdfHits.slice(0, 5).map(hitRow) },
    { title: '你的摘录和笔记', rows: [...markRows, ...noteHits.slice(0, 3).map(hitRow)] },
    { title: '命令', rows: commandRows.map(c => ({ kind: 'command', command: c, label: c.label, detail: c.group, shortcut: c.shortcut, icon: c.icon })) },
  ].filter(group => group.rows.length);
}

export function createHome({ api, guard, status, sessions, isMd, $, open, newMarkdown, addDocuments, activate, commands, library, workspaces, notes }) {
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  // Titles, quotes and note text belong to the user's documents; the translator leaves them alone.
  const own = (tag, cls, text) => { const e = el(tag, cls, text); e.setAttribute('translate', 'no'); return e; };
  let feed = { books: [], collections: [] }, noteList = [], filter = 'all', perRow = 6, scanning = false, ticket = 0;

  function clock() {
    const now = new Date();
    $('greeting').textContent = greetingFor(now.getHours());
    $('homeDate').textContent = dateLabel(now, currentLanguage());
  }
  const openBook = async book => { const opened = await api.openRecent(book.id); await addDocuments(opened); return opened[0] ? sessions.get(opened[0].id) : null; };
  const loaded = async s => { for (let n = 0; n < 400 && s && !s.loaded; n++) await new Promise(r => setTimeout(r, 25)); return s?.loaded ? s : null; };
  async function openAtPage(book, page) {
    const s = await loaded(await openBook(book)); if (!s) throw new Error('文档未能打开。');
    activate(s.id); if (!isMd(s) && page) s.app.pdfViewer.currentPageNumber = Math.min(page, s.app.pagesCount);
    return s;
  }
  /** The note read next to this PDF last time, or a note that links back to it. */
  const noteFor = book => {
    const remembered = notes()?.rememberedPath?.({ path: book.path });
    return (remembered && feed.books.find(b => b.path === remembered)) || feed.books.find(b => noteList.some(n => n.id === b.id && n.source?.path === book.path)) || null;
  };
  async function openWithNote(book, note) {
    const left = await loaded(await openBook(book)), right = await loaded(await openBook(note));
    if (!left || !right) throw new Error('文档未能打开。');
    notes().start(left.id, right.id);
  }

  // ——— covers ———
  async function fillThumb(cover, book) {
    if (!book.hasThumb || !api.homeThumb) return;
    const src = await api.homeThumb(book.id).catch(() => null); if (!src || !cover.isConnected) return;
    cover.replaceChildren(); cover.className = 'bookCover hasThumb' + (cover.classList.contains('readingThumb') ? ' readingThumb' : ''); const img = el('img', 'pageThumb'); img.alt = ''; img.src = src; cover.append(img, progressBar(book));
  }
  function progressBar(book) { const bar = el('span', 'coverProgress'); bar.setAttribute('aria-hidden', 'true'); const fill = el('i'); fill.style.width = (progressOf(book) ?? 0) + '%'; bar.append(fill); return bar; }
  const excelLike = book => /^(xls|xlsx|xlsm|xlsb|ods|csv|et)$/.test(book.ext);
  const badgeOf = book => book.kind === 'markdown' ? 'MD' : book.kind === 'pdf' ? 'PDF' : excelLike(book) ? (book.ext === 'csv' ? 'CSV' : 'XLS') : /^(ppt|pptx|pptm|pps|ppsx|odp|dps)$/.test(book.ext) ? 'PPT' : 'DOC';
  /** A type cover: what a document looks like before there is a page image, or when it has none. */
  function typeCover(book, cover) {
    cover.classList.add('typeCover', 'kind-' + book.kind); if (excelLike(book)) cover.classList.add('isSheet');
    const note = noteList.find(n => n.id === book.id);
    cover.append(own('span', 'coverTitle', note?.title || book.name.replace(/\.[^.]+$/, '')));
    if (excelLike(book)) { const grid = el('span', 'sheetLines'); grid.setAttribute('aria-hidden', 'true'); cover.append(grid); }
    else if (note?.lines[0]) cover.append(own('span', 'coverSub', note.lines[0]));
    const badge = el('span', 'coverBadge', badgeOf(book)); badge.setAttribute('translate', 'no'); cover.append(badge);
  }
  function makeCover(book, cls) { const cover = el('span', 'bookCover ' + (cls || '')); cover.setAttribute('aria-hidden', 'true'); typeCover(book, cover); if (book.kind === 'pdf') guard(() => fillThumb(cover, book)); return cover; }

  // ——— 正在读 ———
  function renderReading() {
    const box = $('homeReading'), empty = $('homeEmpty'), book = pickReading(feed.books);
    box.replaceChildren(); box.hidden = !book; empty.hidden = !!book; if (!book) return;
    const thumb = makeCover(book, 'readingThumb');
    const body = el('div', 'readingBody');
    const eyebrow = el('p', 'readingEyebrow'); eyebrow.append(el('span', 'readingLabel', '正在读'));
    const home = feed.collections.find(c => c.ids.includes(book.id)); if (home) eyebrow.append(own('span', 'readingTag', home.name));
    const title = own('h2', 'readingTitle', book.name.replace(/\.[^.]+$/, '')); title.id = 'homeReadingTitle'; title.title = book.path;
    body.append(eyebrow, title);
    if (book.chapter) body.append(own('p', 'readingChapter', book.chapter));
    const percent = progressOf(book);
    if (percent != null) {
      const line = el('div', 'readingProgress'), bar = el('span', 'readingBar'), fill = el('i'); fill.style.width = percent + '%'; bar.append(fill);
      bar.setAttribute('role', 'progressbar'); bar.setAttribute('aria-valuenow', String(percent)); bar.setAttribute('aria-valuemin', '0'); bar.setAttribute('aria-valuemax', '100');
      bar.setAttribute('aria-label', '阅读进度');
      line.append(bar, el('span', 'readingPercent', percent + '%')); body.append(line);
    }
    const facts = el('p', 'readingFacts'), fact = text => { if (facts.childElementCount) facts.append(el('span', 'dot', ' · ')); facts.append(el('span', '', text)); };
    if (book.pages) fact(`第 ${book.page || 1} 页，共 ${book.pages} 页`);
    else if (book.kind === 'markdown') fact('Markdown');
    if (book.opened) fact(`${when(book.opened)} 读过`);
    if (book.bookmarks) fact(`${book.bookmarks} 个书签`);
    if (book.annotations) fact(`${book.annotations} 条批注`);
    if (facts.childElementCount) body.append(facts);
    const quote = book.highlights.find(h => h.page === (book.page || 1));
    if (quote) { const q = own('blockquote', 'readingQuote', quote.text); body.append(q); }
    const actions = el('div', 'readingActions');
    const go = el('button', 'primary', book.pages ? `从第 ${book.page || 1} 页继续` : '继续阅读'); go.type = 'button'; go.id = 'homeContinue';
    go.onclick = () => guard(() => openAtPage(book, book.page)); actions.append(go);
    const note = book.kind === 'pdf' && noteFor(book);
    if (note) { const pair = el('button', 'readingPair', '和笔记并排'); pair.type = 'button'; pair.dataset.icon = 'double'; pair.title = note.name; pair.onclick = () => guard(() => openWithNote(book, note)); actions.append(pair); }
    body.append(actions);
    const openThumb = el('button', 'readingThumbButton'); openThumb.type = 'button'; openThumb.setAttribute('aria-label', '打开 ' + book.name); openThumb.onclick = go.onclick; openThumb.append(thumb);
    box.append(openThumb, body);
  }

  // ——— 书架 ———
  function renderFilters() {
    const box = $('shelfFilters'); box.replaceChildren();
    const chip = (key, label, color) => {
      const b = key === 'all' || key === 'pinned' ? el('button', 'shelfChip', label) : own('button', 'shelfChip', label); b.type = 'button'; b.setAttribute('aria-pressed', String(filter === key));
      if (color != null) { b.style.setProperty('--chip', `var(--chip-${color % 4})`); b.classList.add('hasDot'); }
      b.onclick = () => { filter = key; renderFilters(); renderShelf(); }; box.append(b);
    };
    if (filter !== 'all' && filter !== 'pinned' && !feed.collections.some(c => c.id === filter)) filter = 'all';
    chip('all', '全部'); chip('pinned', '已固定');
    feed.collections.forEach((c, i) => chip(c.id, c.name, i));
    const add = el('button', 'shelfChip shelfAdd', '＋'); add.type = 'button'; add.title = '把打开的标签保存为合集'; add.setAttribute('aria-label', '把打开的标签保存为合集');
    add.onclick = () => guard(async () => { if (![...sessions.values()].some(s => s.loaded && (s.path || s.converted))) { status('先打开文档，再把它们保存为合集。'); return; } await workspaces().save(); await refresh(); });
    box.append(add);
  }
  const shelfBooks = () => {
    if (filter === 'all') return feed.books.filter(b => b.inRecent);
    if (filter === 'pinned') return feed.books.filter(b => b.pinned);
    const collection = feed.collections.find(c => c.id === filter);
    return feed.books.filter(b => collection?.ids.includes(b.id));
  };
  function bookLine(book) {
    if (book.missing) return '文件不在原位置';
    if (book.kind === 'markdown') return book.opened ? when(book.opened) : 'Markdown';
    if (book.kind === 'office') return '以 PDF 打开';
    if (book.pages) return book.page > 1 ? `第 ${book.page} / ${book.pages} 页` : `共 ${book.pages} 页`;
    return book.opened ? when(book.opened) : 'PDF';
  }
  function renderShelf() {
    const box = $('shelfBooks'), books = shelfBooks().slice(0, perRow); box.replaceChildren(); box.style.setProperty('--shelf-n', perRow);
    $('shelfEmpty').hidden = !!books.length; box.hidden = !books.length;
    if (!books.length) { $('shelfEmpty').textContent = filter === 'pinned' ? '还没有固定的文档。在标签上单击右键可以固定。' : filter === 'all' ? '打开过的文档会排在这里。' : '这个合集里还没有文档。'; return; }
    const plate = el('span', 'shelfPlate'); plate.setAttribute('aria-hidden', 'true'); box.append(plate);
    for (const [column, book] of books.entries()) {
      const item = el('button', 'bookItem' + (book.missing ? ' isMissing' : '')); item.type = 'button'; item.title = book.path; item.style.gridColumn = String(column + 1); item.setAttribute('aria-label', `打开 ${book.name}`);
      item.onclick = () => guard(() => openBook(book));
      const text = el('span', 'bookCaption'); text.append(own('span', 'bookName', book.name.replace(/\.[^.]+$/, '')), el('span', 'bookLine', bookLine(book)));
      item.append(makeCover(book), text); box.append(item);
    }
  }

  // ——— 笔记 / 摘录 ———
  function renderNotes() {
    const box = $('homeNotes'); box.replaceChildren(); const count = noteList.length;
    $('homeNotesAll').textContent = `全部 ${count}`; $('homeNotesAll').hidden = !count;
    if (!count) { box.append(el('p', 'columnEmpty', '还没有笔记。Markdown 文档会列在这里。')); return; }
    for (const note of noteList.slice(0, 3)) {
      const book = feed.books.find(b => b.id === note.id), row = el('button', 'columnRow noteRow'); row.type = 'button'; row.title = note.path;
      row.onclick = () => guard(() => book && openBook(book));
      row.append(own('strong', 'noteTitle', note.title));
      if (note.lines.length) row.append(own('span', 'noteLines', note.lines.join(' ')));
      const meta = el('span', 'rowMeta'); meta.append(el('span', '', when(note.opened)));
      if (note.source) { meta.append(el('span', 'dot', ' · ')); meta.append(own('span', 'rowSource', note.source.name)); }
      row.append(meta); box.append(row);
    }
  }
  const allMarks = () => feed.books.filter(b => !b.missing).flatMap(book => book.highlights.map(h => ({ ...h, book }))).sort((a, b) => b.at - a.at || b.book.opened - a.book.opened);
  function markRow(mark) {
    const row = el('button', 'columnRow markRow'); row.type = 'button'; row.title = `${mark.book.name} · 第 ${mark.page} 页`;
    row.onclick = () => { if ($('allMarksDialog').open) $('allMarksDialog').close(); guard(() => openAtPage(mark.book, mark.page)); };
    row.append(own('span', 'markText', mark.text));
    const meta = el('span', 'rowMeta'); meta.append(own('span', 'rowSource', mark.book.name.replace(/\.[^.]+$/, '')), el('span', 'dot', ' · '), el('span', '', `第 ${mark.page} 页`));
    row.append(meta); return row;
  }
  function renderMarks() {
    const box = $('homeMarks'), marks = allMarks(); box.replaceChildren();
    $('homeMarksAll').textContent = `全部 ${marks.length}`; $('homeMarksAll').hidden = !marks.length;
    if (!marks.length) { box.append(el('p', 'columnEmpty', '还没有摘录。你在 PDF 里的高亮会列在这里。')); return; }
    box.append(...marks.slice(0, 3).map(markRow));
  }

  function render() { clock(); renderReading(); renderFilters(); renderShelf(); renderNotes(); renderMarks(); }
  /** Reads highlights from the documents that changed. One at a time, and only while the home page shows. */
  async function scan() {
    if (scanning || !library()?.withPdf || !api.homeMarksPut) return;
    scanning = true; const mine = ++ticket, alive = () => mine === ticket && document.body.dataset.mode === 'home';
    try {
      for (const book of feed.books.filter(b => b.kind === 'pdf' && !b.missing && b.sig !== b.marksSig && b.size <= MARK_SIZE_LIMIT)) {
        if (!alive()) return;
        const openSession = [...sessions.values()].find(s => s.path === book.path && s.loaded && !isMd(s));
        let marks;
        try { marks = await library().withPdf({ id: book.id, openId: openSession?.id }, doc => readMarks(doc, alive)); }
        catch { marks = { annotations: 0, highlights: [] }; } // unreadable or locked: not retried until the file changes
        if (!marks) return;
        await api.homeMarksPut(book.id, book.sig, marks);
        // A refresh may have replaced the list while this document was being read.
        const shown = feed.books.find(b => b.id === book.id);
        if (shown) Object.assign(shown, { annotations: marks.annotations, highlights: marks.highlights.slice(0, 40), marksSig: book.sig });
        if (alive()) { renderMarks(); if (pickReading(feed.books)?.id === book.id) renderReading(); }
      }
    } finally { scanning = false; }
  }
  async function refresh() {
    if (!api.homeFeed) { feed = { books: (await api.recent()).map(b => ({ ...b, inRecent: true, highlights: [] })), collections: [] }; render(); return; }
    const [next, previews] = await Promise.all([api.homeFeed(), api.homeNotes().catch(() => [])]);
    feed = next; noteList = previews; render();
    scan().catch(console.warn);
  }

  // ——— thumbnails and chapters, from the open document ———
  /** Resolves a PDF's outline once, so the chapter of the current page can be read at any time. */
  function trackDocument(s) {
    const doc = s.app.pdfDocument;
    s.outlineRead ||= (async () => {
      const items = await doc.getOutline(); if (!items?.length) return;
      s.outlineFlat = await flattenOutline(items, async dest => {
        const target = typeof dest === 'string' ? await doc.getDestination(dest) : dest; if (!Array.isArray(target)) return null;
        return typeof target[0] === 'number' ? target[0] + 1 : await doc.getPageIndex(target[0]) + 1;
      });
    })().catch(console.warn);
  }
  const chapterOf = s => chapterForPage(s.outlineFlat, s.app?.pdfViewer?.currentPageNumber || 1);
  /** Renders the current page small and stores it. Encrypted documents stay out of the cache. */
  async function capture(s) {
    if (!api.homeThumbPut || !s?.loaded || isMd(s) || !(s.path || s.converted) || s.saving) return false;
    const doc = s.app?.pdfDocument, viewer = s.app?.pdfViewer; if (!doc || !viewer) return false;
    const number = viewer.currentPageNumber;
    if (s.thumbCaptured === number && !s.dirty) return false;
    const info = await doc.getMetadata().catch(() => null); if (info?.info?.EncryptFilterName) return false;
    const page = await doc.getPage(number), base = page.getViewport({ scale: 1, rotation: (page.rotate + viewer.pagesRotation) % 360 });
    const scale = Math.min(472 / base.width, 640 / base.height), viewport = page.getViewport({ scale, rotation: (page.rotate + viewer.pagesRotation) % 360 });
    const canvas = s.frame.contentDocument.createElement('canvas'); canvas.width = Math.ceil(viewport.width); canvas.height = Math.ceil(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
    if (!await api.homeThumbPut(s.id, number, canvas.toDataURL('image/jpeg', .78))) return false;
    s.thumbCaptured = number;
    return true;
  }
  /** Best effort, for a tab about to close: never holds the close up for long. */
  const captureSoon = s => Promise.race([capture(s).catch(console.warn), new Promise(r => setTimeout(r, 800))]);
  function captureAndShow(s) { capture(s).then(done => { if (done && document.body.dataset.mode === 'home') return refresh(); }).catch(console.warn); }

  // ——— the one input ———
  const input = $('homeOmniInput'), list = $('homeOmniList');
  let hits = [], rows = [], index = 0, searchTimer = 0, searching = null, sequence = 0, indexed = false;
  const closeList = () => { list.hidden = true; input.setAttribute('aria-expanded', 'false'); input.removeAttribute('aria-activedescendant'); };
  function draw() {
    const groups = groupResults(input.value, { books: feed.books, commands: commands(), hits, marks: allMarks() });
    rows = groups.flatMap(g => g.rows); index = Math.max(0, Math.min(index, rows.length - 1));
    list.replaceChildren();
    if (!input.value.trim()) { closeList(); return; }
    list.hidden = false; input.setAttribute('aria-expanded', 'true');
    if (!rows.length) {
      if (!searching) { const p = el('p', 'omniEmpty', '没有找到匹配内容'); list.append(p); }
      input.removeAttribute('aria-activedescendant'); return;
    }
    let n = 0;
    for (const group of groups) {
      const box = el('div', 'omniGroup'); box.setAttribute('role', 'group'); box.setAttribute('aria-label', group.title); box.append(el('div', 'omniGroupTitle', group.title));
      for (const row of group.rows) {
        const at = n++, option = el('div', 'omniRow'); option.id = 'omni-' + at; option.setAttribute('role', 'option'); option.setAttribute('aria-selected', String(at === index));
        if (row.icon) option.dataset.icon = row.icon;
        const text = el('span', 'omniText');
        const label = row.kind === 'command' ? el('span', 'omniLabel', row.label) : own('span', 'omniLabel');
        if (row.match) { const mark = el('mark', '', row.match.match); label.append(row.match.before, mark, row.match.after); }
        else if (row.kind !== 'command') label.textContent = row.label;
        text.append(label, row.kind === 'command' ? el('span', 'omniDetail', row.detail) : own('span', 'omniDetail', row.detail));
        option.append(text);
        if (row.shortcut) { const k = el('kbd', '', shortcutText(row.shortcut)); option.append(k); }
        option.onpointermove = () => { if (index !== at) { index = at; mark(); } };
        option.onmousedown = event => event.preventDefault(); // keeps focus in the input until the click runs
        option.onclick = () => runAt(at);
        box.append(option);
      }
      list.append(box);
    }
    mark();
  }
  function mark() {
    for (const option of list.querySelectorAll('.omniRow')) option.setAttribute('aria-selected', String(option.id === 'omni-' + index));
    const option = list.querySelector('#omni-' + index); if (!option) return;
    input.setAttribute('aria-activedescendant', option.id); option.scrollIntoView({ block: 'nearest' });
  }
  async function runRow(row) {
    const query = input.value.trim();
    input.value = ''; hits = []; closeList(); input.blur();
    if (row.kind === 'file') await openBook(row.book);
    else if (row.kind === 'mark') await openAtPage(row.mark.book, row.mark.page);
    else if (row.kind === 'hit') await library().openHit(row.doc, row.hit, query);
    else await row.command.run();
  }
  function runAt(n) { const row = rows[n]; if (row) guard(() => runRow(row)); }
  function search() {
    const query = input.value.trim(), mine = ++sequence;
    if (!query || query.startsWith('/') || !library()) { hits = []; searching = null; draw(); return null; }
    if (!indexed) { indexed = true; library().refresh().catch(console.warn); }
    return searching = (async () => {
      const result = await library().search(query).catch(() => ({ documents: [] }));
      if (mine !== sequence) return;
      hits = result.documents.flatMap(doc => doc.hits.slice(0, 2).map(hit => ({ doc, hit }))); searching = null; draw();
    })();
  }
  input.addEventListener('input', () => { index = 0; clearTimeout(searchTimer); draw(); searchTimer = setTimeout(search, 180); });
  input.addEventListener('focus', () => { if (input.value.trim()) draw(); });
  input.addEventListener('blur', () => { indexed = false; setTimeout(() => { if (document.activeElement !== input) closeList(); }, 120); });
  input.addEventListener('keydown', event => {
    if (event.isComposing) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (rows.length) { index = (index + (event.key === 'ArrowDown' ? 1 : -1) + rows.length) % rows.length; mark(); } }
    else if (event.key === 'Enter') {
      event.preventDefault(); clearTimeout(searchTimer);
      // Enter before the content search answered waits for it only when nothing else matched yet.
      guard(async () => { if (!rows.length && input.value.trim()) await search(); runAt(index); });
    } else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); input.value = ''; hits = []; closeList(); }
  });
  for (const k of document.querySelectorAll('.homeHero kbd')) k.textContent = shortcutText(k.textContent);
  const focus = (text = '') => { $('home').scrollTo({ top: 0 }); input.focus(); if (text) { input.value = text; input.dispatchEvent(new Event('input')); } else input.select(); };

  // ——— everything else on the page ———
  $('homeEmptyOpen').onclick = () => guard(open);
  $('homeEmptyNote').onclick = () => newMarkdown();
  const allDocs = $('allDocsDialog');
  $('shelfAll').onclick = () => allDocs.showModal();
  $('homeNotesAll').onclick = () => { allDocs.querySelector('[data-filter="markdown"]').click(); allDocs.showModal(); };
  $('homeMarksAll').onclick = () => { $('allMarksList').replaceChildren(...allMarks().map(markRow)); $('allMarksDialog').showModal(); };
  $('allMarksClose').onclick = () => $('allMarksDialog').close();
  $('allMarksDialog').addEventListener('click', event => { if (event.target === $('allMarksDialog')) $('allMarksDialog').close(); });
  $('allDocsClose').onclick = () => { allDocs.close(); refresh().catch(console.warn); };
  allDocs.addEventListener('click', event => { if (event.target === allDocs) allDocs.close(); });
  allDocs.addEventListener('close', () => { allDocs.querySelector('[data-filter="all"]').click(); refresh().catch(console.warn); });
  // The number of covers follows the width of the page, not the window: the rail takes part of it.
  new ResizeObserver(entries => { const next = shelfCount(entries[0].contentRect.width); if (next !== perRow) { perRow = next; renderShelf(); } }).observe($('homeShelf'));
  onLanguage(() => clock());

  return { refresh, render, focus, capture, captureSoon, captureAndShow, trackDocument, chapterOf, get feed() { return feed; }, get rows() { return rows; }, scan };
}
