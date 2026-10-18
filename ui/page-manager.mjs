// Visual page manager (0.20): a full-window thumbnail grid of the current PDF. Select pages (click,
// Ctrl / Shift + click, Ctrl+A), drag them to a new place, rotate, copy, delete, add blank pages or
// the pages of other PDFs (button or drop a file), then apply everything as one undoable edit
// ('pages-plan'). Splitting, exporting the selected pages and extracting images write new files.
import * as P from './page-plan.mjs';

export function createPageManager({ current, isPdf, applyEdit, api, snapshot, guard, status, addDocuments }) {
  const dialog = document.createElement('dialog');
  dialog.id = 'pageManager'; dialog.className = 'pageManager'; dialog.setAttribute('aria-labelledby', 'pageManagerTitle');
  dialog.innerHTML = `
    <header class="pmHead">
      <div><h2 id="pageManagerTitle">页面管理</h2><p id="pmDoc"></p></div>
      <div class="pmTools" role="toolbar" aria-label="页面操作">
        <button id="pmRotateLeft" data-icon="rotate" title="逆时针旋转 90° · Shift+R">左转</button>
        <button id="pmRotateRight" data-icon="rotate" title="顺时针旋转 90° · R">右转</button>
        <button id="pmDuplicate" data-icon="pages" title="在选中页面后面复制一份 · Ctrl+D">复制</button>
        <button id="pmDelete" data-icon="trash" title="删除选中页面 · Delete">删除</button>
        <span class="pmSep" aria-hidden="true"></span>
        <button id="pmBlank" data-icon="newdoc" title="在选中页面后（或末尾）插入空白页">空白页</button>
        <button id="pmInsert" data-icon="open" title="插入其他 PDF 的全部页面；也可以把 PDF 文件拖进网格">插入 PDF…</button>
        <span class="pmSep" aria-hidden="true"></span>
        <button id="pmUndo" data-icon="undo" class="iconOnly" title="撤销 · Ctrl+Z" aria-label="撤销"></button>
        <button id="pmRedo" data-icon="redo" class="iconOnly" title="重做 · Ctrl+Y" aria-label="重做"></button>
        <button id="pmClose" data-icon="x" class="iconOnly" title="关闭" aria-label="关闭页面管理"></button>
      </div>
    </header>
    <div id="pmGrid" class="pmGrid" role="listbox" aria-multiselectable="true" aria-label="页面缩略图" tabindex="0"></div>
    <section id="pmSplit" class="pmSplit" hidden>
      <label>拆分方式 <select id="pmSplitMode"><option value="every">每 N 页一份</option><option value="ranges">按范围</option><option value="bookmarks">按一级书签</option><option value="selected">每个选中页面一份</option></select></label>
      <label id="pmEveryLabel">每份页数 <input id="pmEvery" type="number" min="1" value="1"></label>
      <label id="pmRangesLabel" hidden>范围 <input id="pmRanges" placeholder="例如 1-3; 4-10; 11"></label>
      <button id="pmSplitRun" class="primary">拆分并保存 ZIP…</button><button id="pmSplitCancel">取消</button>
      <p class="pmHint">拆分作用于当前文档；网格中未应用的修改请先应用。</p>
    </section>
    <footer class="pmFoot">
      <div class="pmStatus"><strong id="pmCount"></strong><span id="pmOrder" title=""></span></div>
      <div class="pmActions">
        <button id="pmSplitOpen" data-icon="pages">拆分…</button>
        <button id="pmExport" data-icon="saveas" title="把选中的页面（未选择时为全部）按当前顺序另存为新 PDF">导出选中页…</button>
        <button id="pmImages" data-icon="file" title="把选中页面（未选择时为全部）里的图片保存为 ZIP">提取图片…</button>
        <button id="pmApply" class="primary" data-icon="save">应用到文档 · 可撤销</button>
      </div>
    </footer>
    <input id="pmFile" type="file" accept=".pdf,application/pdf" multiple hidden>`;
  document.body.append(dialog);
  const $ = id => dialog.querySelector('#' + id), grid = $('pmGrid');

  let s = null, plan = [], selected = new Set(), anchor = null, extras = [], past = [], future = [], dragging = null, observer = null, ticket = 0;
  const pageCount = () => s.app.pagesCount;
  const dirty = () => !P.unchanged(plan, pageCount());
  const commitPlan = next => { past.push(plan); if (past.length > 200) past.shift(); future = []; plan = next; render(); };
  const insertAt = () => { const idx = plan.map((e, i) => (selected.has(e.key) ? i : -1)).filter(i => i >= 0); return idx.length ? Math.max(...idx) + 1 : plan.length; };
  const docOf = e => (e.src ? extras[e.src - 1]?.doc : s.app.pdfDocument);
  const label = e => e.blank ? '空白页' : e.src ? `${extras[e.src - 1]?.name || 'PDF'} · 第 ${e.page + 1} 页` : `第 ${e.page + 1} 页`;

  async function draw(card, e) {
    const canvas = card.querySelector('canvas'), my = ticket;
    if (e.blank) { const ref = await s.app.pdfDocument.getPage(e.like + 1), v = ref.getViewport({ scale: 1 }); canvas.width = 120; canvas.height = Math.round(120 * v.height / v.width); const g = canvas.getContext('2d'); g.fillStyle = '#fff'; g.fillRect(0, 0, canvas.width, canvas.height); return; }
    const page = await docOf(e).getPage(e.page + 1); if (my !== ticket) return;
    const rotation = (page.rotate + (e.rotate || 0)) % 360, base = page.getViewport({ scale: 1, rotation });
    const viewport = page.getViewport({ scale: 150 / Math.max(base.width, base.height), rotation });
    canvas.width = Math.round(viewport.width); canvas.height = Math.round(viewport.height);
    await page.render({ canvasContext: canvas.getContext('2d'), viewport }).promise;
  }
  function render() {
    ticket++; observer?.disconnect();
    observer = new IntersectionObserver(entries => { for (const entry of entries) if (entry.isIntersecting && !entry.target.dataset.drawn) { entry.target.dataset.drawn = '1'; const e = plan.find(x => x.key === entry.target.dataset.key); if (e) draw(entry.target, e).catch(() => { entry.target.title = '缩略图未能加载'; }); } }, { root: grid, rootMargin: '200px' });
    const cards = new Map([...grid.children].map(c => [c.dataset.key + '|' + c.dataset.rotate, c]));
    const next = plan.map((e, i) => {
      let card = cards.get(e.key + '|' + (e.rotate || 0));
      if (!card) {
        card = document.createElement('div'); card.className = 'pmCard'; card.draggable = true; card.dataset.key = e.key; card.dataset.rotate = String(e.rotate || 0);
        card.setAttribute('role', 'option');
        card.innerHTML = '<div class="pmThumb"><canvas width="120" height="160"></canvas></div><span class="pmNum"></span><span class="pmLabel"></span>';
      }
      card.querySelector('.pmNum').textContent = String(i + 1);
      card.querySelector('.pmLabel').textContent = label(e) + (e.rotate ? ` · ${e.rotate}°` : '');
      card.classList.toggle('isSelected', selected.has(e.key)); card.classList.toggle('isInserted', !!e.src || !!e.blank);
      card.setAttribute('aria-selected', String(selected.has(e.key))); card.setAttribute('aria-label', `新第 ${i + 1} 页：${label(e)}`);
      return card;
    });
    grid.replaceChildren(...next);
    for (const card of next) if (!card.dataset.drawn) observer.observe(card);
    const count = plan.length, chosen = selected.size;
    $('pmCount').textContent = `共 ${count} 页` + (chosen ? ` · 已选 ${chosen} 页` : '');
    const order = P.summary(plan, extras.map(x => x.name));
    $('pmOrder').textContent = dirty() ? '最终页序：' + (order.length > 160 ? order.slice(0, 160) + '…' : order) : '尚未修改';
    $('pmOrder').title = dirty() ? order : '';
    $('pmApply').disabled = !dirty(); $('pmUndo').disabled = !past.length; $('pmRedo').disabled = !future.length;
    for (const id of ['pmRotateLeft', 'pmRotateRight', 'pmDuplicate', 'pmDelete']) $(id).disabled = !chosen;
    $('pmSplitOpen').disabled = dirty(); $('pmSplitOpen').title = dirty() ? '请先应用或撤销网格中的修改' : '把当前文档拆分为多个 PDF';
  }
  function select(key, { toggle = false, range = false } = {}) {
    if (range && anchor) { const a = plan.findIndex(e => e.key === anchor), b = plan.findIndex(e => e.key === key); if (!toggle) selected.clear(); for (let i = Math.min(a, b); i <= Math.max(a, b); i++) selected.add(plan[i].key); }
    else if (toggle) { selected.has(key) ? selected.delete(key) : selected.add(key); anchor = key; }
    else { selected = new Set([key]); anchor = key; }
    render();
  }
  const op = fn => guard(async () => { await fn(); });
  $('pmRotateLeft').onclick = () => commitPlan(P.rotate(plan, selected, -90));
  $('pmRotateRight').onclick = () => commitPlan(P.rotate(plan, selected, 90));
  $('pmDuplicate').onclick = () => { const r = P.duplicate(plan, selected); selected = new Set(r.added); commitPlan(r.plan); };
  $('pmDelete').onclick = () => op(() => { commitPlan(P.remove(plan, selected)); selected.clear(); render(); });
  $('pmBlank').onclick = () => { const at = insertAt(), like = plan[Math.max(0, at - 1)]?.src === 0 ? plan[Math.max(0, at - 1)].page : 0, r = P.insertBlank(plan, at, like); selected = new Set(r.added); commitPlan(r.plan); };
  $('pmInsert').onclick = () => $('pmFile').click();
  $('pmFile').onchange = () => op(async () => { const files = [...$('pmFile').files]; $('pmFile').value = ''; await insertFiles(files, insertAt()); });
  $('pmUndo').onclick = () => { if (!past.length) return; future.push(plan); plan = past.pop(); render(); };
  $('pmRedo').onclick = () => { if (!future.length) return; past.push(plan); plan = future.pop(); render(); };
  $('pmClose').onclick = () => close();
  dialog.addEventListener('cancel', event => { event.preventDefault(); close(); });

  async function insertFiles(files, at) {
    const pdfs = files.filter(f => /\.pdf$/i.test(f.name) || f.type === 'application/pdf'); if (!pdfs.length) throw new Error('请选择 PDF 文件。');
    if (extras.length + pdfs.length > 20) throw new Error('一次最多插入 20 个 PDF。');
    let added = [], next = plan;
    for (const file of pdfs) {
      const bytes = new Uint8Array(await file.arrayBuffer());
      const doc = await s.frame.contentWindow.pdfjsLib.getDocument({ data: bytes.slice() }).promise;
      extras.push({ name: file.name, bytes, doc });
      const r = P.insertPages(next, at, extras.length, doc.numPages); next = r.plan; at += doc.numPages; added = added.concat(r.added);
    }
    selected = new Set(added); commitPlan(next); status(`已插入 ${pdfs.length} 个 PDF 的页面，应用后写入文档。`);
  }
  // Only the inserted PDFs that are still used are sent, renumbered 1….
  function payload(entries) {
    const used = [...new Set(entries.filter(e => e.src).map(e => e.src))].sort((a, b) => a - b), map = new Map(used.map((src, i) => [src, i + 1]));
    return { plan: P.serialize(entries.map(e => (e.src ? { ...e, src: map.get(e.src) } : e))), extraPdfs: used.map(src => extras[src - 1].bytes) };
  }
  $('pmApply').onclick = () => op(async () => {
    if (!dirty()) return close(true);
    const order = P.summary(plan, extras.map(x => x.name)), target = s;
    dialog.close();
    const result = await applyEdit(target, { action: 'pages-plan', ...payload(plan) }, '页面管理 · ' + (order.length > 60 ? order.slice(0, 60) + '…' : order));
    if (!result?.canceled) status(result?.note || '页面已整理 · 可撤销');
    for (const x of extras) x.doc?.destroy?.(); extras = [];
  });
  const chosen = () => (selected.size ? plan.filter(e => selected.has(e.key)) : plan);
  $('pmExport').onclick = () => op(async () => {
    const result = await api.toolsJob(s.id, await snapshot(s), { action: 'pages-plan', ...payload(chosen()) });
    if (result?.opened?.length) await addDocuments(result.opened);
    if (result?.path) status('已导出：' + result.path);
  });
  $('pmImages').onclick = () => op(async () => {
    const pages = [...new Set(chosen().filter(e => !e.blank && !e.src).map(e => e.page + 1))];
    if (!pages.length) throw new Error('所选页面里没有本文档的页面。');
    const result = await api.toolsJob(s.id, await snapshot(s), { action: 'pages-images', pages: pages.join(',') });
    status(result?.unchanged ? result.note : result?.path ? '已保存：' + result.path : result?.note || '');
  });
  // ——— split ———
  const syncSplit = () => { const mode = $('pmSplitMode').value; $('pmEveryLabel').hidden = mode !== 'every'; $('pmRangesLabel').hidden = mode !== 'ranges'; };
  $('pmSplitMode').onchange = syncSplit;
  $('pmSplitOpen').onclick = () => { $('pmSplit').hidden = false; syncSplit(); };
  $('pmSplitCancel').onclick = () => { $('pmSplit').hidden = true; };
  $('pmSplitRun').onclick = () => op(async () => {
    const mode = $('pmSplitMode').value, n = pageCount(), stem = s.name.replace(/\.pdf$/i, '');
    let groups, names;
    if (mode === 'every') groups = P.groupsEvery(n, $('pmEvery').value);
    else if (mode === 'ranges') groups = P.groupsFromRanges($('pmRanges').value, n);
    else if (mode === 'selected') { groups = [...new Set(plan.filter(e => selected.has(e.key) && !e.src && !e.blank).map(e => e.page))].map(p => [p]); if (!groups.length) throw new Error('请先选择页面。'); }
    else { const info = await api.toolsJob(s.id, await snapshot(s), { action: 'inspect' }); const parts = P.groupsFromBookmarks(info.data?.toc || [], n); groups = parts.map(p => p.pages); names = parts.map((p, i) => `${String(i + 1).padStart(2, '0')}-${p.name}`); }
    names ??= groups.map(g => `${stem}-第${g[0] + 1}${g.length > 1 ? '-' + (g.at(-1) + 1) : ''}页`);
    const result = await api.toolsJob(s.id, await snapshot(s), { action: 'pages-split', groups, names });
    $('pmSplit').hidden = true; status(result?.path ? `已拆分为 ${groups.length} 个 PDF：${result.path}` : result?.note || '');
  });
  // ——— pointer, drag and keys ———
  grid.addEventListener('click', event => { const card = event.target.closest('.pmCard'); if (!card) { if (event.target === grid) { selected.clear(); render(); } return; } select(card.dataset.key, { toggle: event.ctrlKey || event.metaKey, range: event.shiftKey }); });
  grid.addEventListener('dblclick', event => { const card = event.target.closest('.pmCard'), e = card && plan.find(x => x.key === card.dataset.key); if (e && !e.src && !e.blank) { close(true); s.app.pdfViewer.currentPageNumber = e.page + 1; } });
  const marker = () => grid.querySelectorAll('.dropBefore, .dropAfter').forEach(c => c.classList.remove('dropBefore', 'dropAfter'));
  const dropIndex = event => {
    const card = event.target.closest('.pmCard'); if (!card) return plan.length;
    const box = card.getBoundingClientRect(), index = plan.findIndex(e => e.key === card.dataset.key), after = event.clientX > box.left + box.width / 2;
    marker(); card.classList.add(after ? 'dropAfter' : 'dropBefore'); return index + (after ? 1 : 0);
  };
  grid.addEventListener('dragstart', event => { const card = event.target.closest('.pmCard'); if (!card) return; if (!selected.has(card.dataset.key)) { selected = new Set([card.dataset.key]); anchor = card.dataset.key; render(); } dragging = new Set(selected); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('application/x-qingye-pages', String(dragging.size)); });
  grid.addEventListener('dragend', () => { dragging = null; marker(); });
  grid.addEventListener('dragover', event => { if (dragging || [...(event.dataTransfer?.items || [])].some(i => i.kind === 'file')) { event.preventDefault(); event.stopPropagation(); event.dataTransfer.dropEffect = dragging ? 'move' : 'copy'; dropIndex(event); } });
  grid.addEventListener('dragleave', event => { if (!grid.contains(event.relatedTarget)) marker(); });
  grid.addEventListener('drop', event => {
    event.preventDefault(); event.stopPropagation(); const at = dropIndex(event); marker();
    if (dragging) { commitPlan(P.move(plan, dragging, at)); dragging = null; return; }
    const files = [...(event.dataTransfer?.files || [])]; if (files.length) op(() => insertFiles(files, at));
  });
  dialog.addEventListener('keydown', event => {
    if (event.target.closest('input, select, textarea')) return;
    const mod = event.ctrlKey || event.metaKey, k = event.key.toLowerCase();
    if (mod && k === 'a') { event.preventDefault(); selected = new Set(plan.map(e => e.key)); render(); }
    else if (mod && k === 'z') { event.preventDefault(); event.shiftKey ? $('pmRedo').click() : $('pmUndo').click(); }
    else if (mod && k === 'y') { event.preventDefault(); $('pmRedo').click(); }
    else if (mod && k === 'd' && selected.size) { event.preventDefault(); $('pmDuplicate').click(); }
    else if ((event.key === 'Delete' || event.key === 'Backspace') && selected.size) { event.preventDefault(); $('pmDelete').click(); }
    else if (!mod && k === 'r' && selected.size) { event.preventDefault(); (event.shiftKey ? $('pmRotateLeft') : $('pmRotateRight')).click(); }
  });

  function open(target = current()) {
    if (!target?.loaded || !isPdf(target)) throw new Error('请先打开 PDF。');
    if (target.editBusy || target.saving) throw new Error('文档正在处理，请稍后再试。');
    s = target; plan = P.initialPlan(pageCount()); selected = new Set(); anchor = null; extras = []; past = []; future = [];
    $('pmDoc').textContent = s.name; $('pmSplit').hidden = true; grid.replaceChildren(); render();
    if (!dialog.open) dialog.showModal(); grid.focus();
  }
  async function close(force = false) {
    if (!force && dirty() && !confirm('页面修改尚未应用，确定关闭并放弃这些修改吗？')) return;
    observer?.disconnect(); ticket++; dialog.close();
    for (const x of extras) x.doc?.destroy?.(); extras = [];
  }
  return { open, close, get plan() { return plan; }, get selected() { return [...selected]; }, select, insertFiles, isOpen: () => dialog.open };
}
