// Library search (0.11.0): one search box over every PDF and Markdown document in the recent
// list. PDFs are read here with PDF.js (text only, nothing is rendered) and handed to the main
// process, which keeps the index on disk and answers the queries (see library-index.cjs).

const CJK = /[⺀-鿿豈-﫿＀-￯]/;
/** PDF.js text items → the page as one searchable line of text. A line break inside a CJK
 *  sentence is dropped, one between Latin words becomes a space, a hyphenated break is joined. */
export function joinTextItems(items) {
  let out = '';
  for (const item of items || []) {
    const text = typeof item.str === 'string' ? item.str : ''; if (text) out += text;
    if (!item.hasEOL) continue;
    const last = out.at(-1) || '';
    if (last === '-' && /[a-z]-$/i.test(out.slice(-2))) out = out.slice(0, -1);
    else if (last && !CJK.test(last) && !/\s/.test(last)) out += ' ';
  }
  return out.replace(/[ \t ]+/g, ' ').trim();
}
/** Result rows for display: documents with the most hits first; hits keep their order. */
export const summarize = (result, pending = 0) => !result.terms?.length ? '输入关键词，在所有打开过的 PDF 和笔记里搜索' : result.total ? `找到 ${result.total} 处 · ${result.documents.length} 个文档` + (pending ? ` · 还有 ${pending} 个文档正在建立索引` : '') : pending ? `暂未找到，还有 ${pending} 个文档正在建立索引` : '没有找到匹配内容';

export function createLibrary({ api, guard, status, sessions, isMd, addDocuments, activate, searchPdf, userError = error => error?.message || String(error) }) {
  const dialog = document.createElement('dialog'); dialog.id = 'libraryDialog'; dialog.setAttribute('aria-labelledby', 'libraryTitle');
  dialog.innerHTML = `<header class="libraryHead"><h2 id="libraryTitle">全库搜索</h2><button type="button" id="libraryClose" class="iconOnly" data-icon="x" title="关闭" aria-label="关闭"></button></header>
<input id="libraryQuery" type="search" placeholder="搜索所有打开过的 PDF 和笔记；多个词用空格隔开，短语加引号" aria-label="全库搜索关键词" autocomplete="off" spellcheck="false">
<p id="librarySummary" role="status"></p><div id="libraryResults" role="list"></div>
<footer class="libraryFoot"><span id="libraryProgress"></span><span class="spacer"></span><button type="button" id="libraryRebuild" data-icon="refresh" title="删除索引并重新读取全部文档">重建索引</button></footer>`;
  document.body.append(dialog);
  const $ = id => dialog.querySelector('#' + id);
  let pdfjs = null, ticket = 0, searchTimer = 0, pending = 0, indexing = null, lastResult = { terms: [], documents: [], total: 0 };

  async function engine() {
    if (pdfjs) return pdfjs;
    const lib = await import('../vendor/pdfjs/build/pdf.mjs');
    lib.GlobalWorkerOptions.workerSrc = new URL('../vendor/pdfjs/build/pdf.worker.mjs', import.meta.url).href;
    return pdfjs = lib;
  }
  async function pagesOf(doc, alive) {
    const pages = [];
    for (let n = 1; n <= Math.min(doc.numPages, 5000); n++) {
      if (!alive()) return null;
      const page = await doc.getPage(n); pages.push(joinTextItems((await page.getTextContent()).items).slice(0, 200000)); page.cleanup?.();
    }
    return pages;
  }
  /** Reads the text of one PDF: from the open tab when there is one, otherwise from the file. */
  async function extract(item, alive) {
    const open = item.openId && sessions.get(item.openId);
    if (open?.loaded && !isMd(open) && open.app?.pdfDocument) return pagesOf(open.app.pdfDocument, alive);
    const lib = await engine(), bytes = await api.libraryRead(item.id);
    const base = new URL('../vendor/pdfjs/web/', import.meta.url).href;
    const task = lib.getDocument({ data: new Uint8Array(bytes), enableScripting: false, isEvalSupported: false, cMapUrl: base + 'cmaps/', cMapPacked: true, standardFontDataUrl: base + 'standard_fonts/', wasmUrl: base + 'wasm/', stopAtErrors: false });
    let locked = false; task.onPassword = () => { locked = true; task.destroy().catch(() => {}); };
    try { return await pagesOf(await task.promise, alive); }
    catch (error) { throw locked ? new Error('这个 PDF 有打开密码，未加入全库搜索。') : error; }
    finally { await task.destroy().catch(() => {}); }
  }
  /** Brings the index up to date. Resolves with { indexed, skipped }; safe to call repeatedly. */
  function refresh() {
    return indexing ||= (async () => {
      const mine = ticket, alive = () => mine === ticket; let indexed = 0, skipped = 0;
      try {
        const items = await api.libraryStatus(), todo = items.filter(item => item.state === 'stale' && item.kind === 'pdf');
        pending = todo.length; progress(items.length, todo.length);
        for (const item of todo) {
          if (!alive()) break;
          $('libraryProgress').textContent = `正在读取 ${item.name}（剩余 ${pending} 个）`;
          try { const pages = await extract(item, alive); if (!pages) break; await api.libraryPut(item.id, pages); indexed++; }
          // A document that cannot be read (password, damage) is stored empty so it is not retried every time.
          catch (error) { skipped++; await api.libraryPut(item.id, [], userError(error)).catch(() => {}); }
          pending--; if (alive() && dialog.open && $('libraryQuery').value.trim()) await run();
        }
        if (alive()) progress(items.filter(item => item.state !== 'missing').length, 0);
      } finally { pending = 0; indexing = null; }
      return { indexed, skipped };
    })();
  }
  const progress = (count, left) => { $('libraryProgress').textContent = left ? `正在为 ${left} 个文档建立索引…` : `已索引 ${count} 个文档 · 索引只保存在本机`; };

  async function run() {
    const query = $('libraryQuery').value, mine = ++run.sequence;
    const result = query.trim() ? await api.librarySearch(query) : { terms: [], documents: [], total: 0 };
    if (mine !== run.sequence) return; lastResult = result; render(result, query);
  }
  run.sequence = 0;
  function render(result, query) {
    $('librarySummary').textContent = summarize(result, pending);
    const list = $('libraryResults'); list.replaceChildren();
    for (const doc of result.documents) {
      const group = document.createElement('section'); group.className = 'libraryDoc'; group.setAttribute('role', 'listitem');
      const head = document.createElement('button'); head.type = 'button'; head.className = 'libraryDocHead'; head.dataset.icon = doc.kind === 'markdown' ? 'markdown' : 'file'; head.title = doc.path;
      const name = document.createElement('strong'); name.textContent = doc.name; const count = document.createElement('small'); count.textContent = `${doc.total} 处`;
      head.append(name, count); head.onclick = () => guard(() => openHit(doc, doc.hits[0], query)); group.append(head);
      for (const hit of doc.hits) {
        const row = document.createElement('button'); row.type = 'button'; row.className = 'libraryHit';
        const where = document.createElement('span'); where.className = 'libraryWhere'; where.textContent = doc.kind === 'markdown' ? `第 ${hit.line} 行` : `第 ${hit.page} 页`;
        const text = document.createElement('span'); text.className = 'librarySnippet'; const mark = document.createElement('mark'); mark.textContent = hit.match; text.append(hit.before, mark, hit.after);
        row.append(where, text); row.onclick = () => guard(() => openHit(doc, hit, query)); group.append(row);
      }
      if (doc.total > doc.hits.length) { const more = document.createElement('p'); more.className = 'libraryMore'; more.textContent = `其余 ${doc.total - doc.hits.length} 处请打开文档后用 Ctrl+F 查看`; group.append(more); }
      list.append(group);
    }
  }
  /** Opens the document of a hit and goes to it: the PDF page with the term highlighted, or the Markdown paragraph. */
  async function openHit(doc, hit, query) {
    if (!doc.id) throw new Error('这个文档已不在最近列表中。');
    dialog.close();
    const opened = await api.openRecent(doc.id); await addDocuments(opened);
    const s = sessions.get(opened[0]?.id); if (!s?.loaded) throw new Error('文档未能打开。');
    activate(s.id);
    if (isMd(s)) { s.editor.scrollToOffset(Math.min(hit.offset, s.editor.text.length)); status(`已定位到 ${s.name} 第 ${hit.line} 行`); return s; }
    await searchPdf(s, hit.page, lastResult.terms?.[0] || query);
    status(`已定位到 ${s.name} 第 ${hit.page} 页`); return s;
  }

  $('libraryQuery').addEventListener('input', () => { clearTimeout(searchTimer); searchTimer = setTimeout(() => guard(run), 220); });
  $('libraryQuery').addEventListener('keydown', event => {
    if (event.key === 'Enter') { event.preventDefault(); clearTimeout(searchTimer); guard(async () => { await run(); }); }
    if (event.key === 'ArrowDown') { event.preventDefault(); dialog.querySelector('.libraryHit, .libraryDocHead')?.focus(); }
  });
  $('libraryResults').addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp'].includes(event.key)) return; event.preventDefault();
    const rows = [...dialog.querySelectorAll('.libraryHit, .libraryDocHead')], index = rows.indexOf(document.activeElement), next = rows[index + (event.key === 'ArrowDown' ? 1 : -1)];
    if (next) next.focus(); else if (event.key === 'ArrowUp') $('libraryQuery').focus();
  });
  $('libraryClose').onclick = () => dialog.close();
  $('libraryRebuild').onclick = () => guard(async () => { ticket++; await indexing?.catch(() => {}); await api.libraryClear(); $('libraryResults').replaceChildren(); await refresh(); await run(); status('全库搜索的索引已重建'); });
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });

  async function open(query) {
    if (typeof query === 'string') $('libraryQuery').value = query;
    if (!dialog.open) dialog.showModal();
    $('libraryQuery').focus(); $('libraryQuery').select();
    render(lastResult, $('libraryQuery').value);
    const building = refresh().catch(error => { $('libraryProgress').textContent = '索引未完成：' + userError(error); });
    if ($('libraryQuery').value.trim()) await run();
    return building;
  }
  return { open, close: () => dialog.close(), refresh, search: async query => { $('libraryQuery').value = query; await run(); return lastResult; }, openHit: (doc, hit, query) => openHit(doc, hit, query), dialog, get result() { return lastResult; } };
}
