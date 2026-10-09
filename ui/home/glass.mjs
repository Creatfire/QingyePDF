// 首页样式 · 玻璃：磨砂玻璃面板，一束随指针移动（空闲时缓慢环绕）的光照亮玻璃的高光与边缘。
import { el, icon, when, fmtSize, greeting, dateLine, hm, reduceMotion, allTools, toolHistory, baseName } from './core.mjs';
import { toolCatalog } from '../tool-catalog.mjs';

export function render(root, ctx) {
  const { snap, actions, launcher } = ctx;
  root.className = 'homeLayout hgGlass';
  const light = el('div', 'gLight'); light.setAttribute('aria-hidden', 'true');
  const main = el('div', 'gMain'), side = el('aside', 'gSide');
  root.replaceChildren(light, main, side);

  // ——— 问候与启动 ———
  const head = el('header', 'gHead');
  const sub = el('p', 'gSub'); sub.append(el('span', null, dateLine()), el('span', 'gDot', '·'), el('span', null, '今天已打开'), el('b', null, String(snap.today.o)), el('span', null, '个文件'));
  head.append(el('h1', 'gGreet', greeting()), sub);
  const row = el('div', 'gLaunch');
  const search = el('button', 'gSearch gPane'); search.type = 'button';
  search.append(icon('search'), el('span', 'gSearchText', '打开文件、搜索最近、运行工具…'), el('kbd', null, 'Ctrl'), el('kbd', null, 'K'));
  search.onclick = () => launcher.open();
  const open = el('button', 'gOpen'); open.type = 'button'; open.append(icon('open'), el('span', null, '打开'), el('kbd', null, 'Ctrl O')); open.onclick = actions.open;
  const neu = el('button', 'gNew gPane'); neu.type = 'button'; neu.append(icon('newdoc'), el('span', null, '新建'), el('kbd', null, 'Ctrl N')); neu.onclick = actions.newMarkdown;
  row.append(search, open, neu);
  const chips = el('div', 'gChips');
  if (snap.recent[0]) { const c = el('button', 'gChip'); c.append(el('span', null, '最近：'), el('span', null, snap.recent[0].name)); c.onclick = () => actions.openRecent(snap.recent[0]); chips.append(c); }
  const tools = allTools(), used = toolHistory.top(2).map(k => tools.find(t => t.key === k)).filter(Boolean);
  for (const t of used.length ? used : [tools.find(t => t.mode === 'merge'), tools.find(t => t.action === 'ocr')]) { const c = el('button', 'gChip'); c.append(el('span', null, '工具：'), el('span', null, t.label)); c.onclick = () => actions.tool(t); chips.append(c); }
  { const c = el('button', 'gChip'); c.append(el('span', null, '转换：'), el('span', null, '文档转换中心')); c.onclick = actions.convert; chips.append(c); }
  main.append(head, row, chips);

  // ——— 继续 ———
  const cont = el('section', 'gContinue'); cont.append(sectionTitle('继续', '上次停下的位置'));
  const cards = el('div', 'gCards');
  const items = snap.continueItems.length ? snap.continueItems : snap.recent.slice(0, 3);
  if (!items.length) cards.append(emptyPane('还没有打开过文件', '打开一个 PDF 或 Markdown，它会出现在这里。'));
  items.forEach((item, i) => {
    const card = el('article', 'gCard gPane' + (i === 0 ? ' isFirst' : ''));
    const thumb = el('div', 'gThumb' + (item.md ? ' isMd' : '')); thumb.setAttribute('aria-hidden', 'true'); for (let k = 0; k < 9; k++) thumb.append(el('i'));
    const info = el('div', 'gCardInfo');
    const meta = el('div', 'gMeta'); meta.append(el('span', 'gBadge' + (item.md ? ' md' : ''), item.md ? 'MD' : 'PDF'), el('span', null, when(item.opened)));
    if (item.open) meta.append(el('span', 'gOpenDot', '已打开'));
    info.append(meta, el('h3', null, item.name), el('p', 'gFolder', item.folder));
    if (!item.md && item.pages) {
      const p = el('div', 'gProg'); const pct = Math.round(item.progress * 100);
      p.append(el('span', null, `第 ${item.page} / ${item.pages} 页`), el('span', null, pct + '%'));
      const bar = el('div', 'gBar'); const fill = el('i'); fill.style.width = pct + '%'; bar.append(fill);
      info.append(p, bar);
    } else if (!item.md && item.page) info.append(el('p', 'gFolder', `读到第 ${item.page} 页`));
    const go = el('button', 'gGo'); go.type = 'button'; go.textContent = '继续 →'; go.onclick = () => actions.openRecent(item);
    info.append(go); card.append(thumb, info); cards.append(card);
  });
  cont.append(cards); main.append(cont);

  // ——— 最近文件 ———
  const recent = el('section', 'gRecent gPane');
  const rh = el('div', 'gRecentHead'); const rt = el('h2', null, '最近文件'); const rc = el('span', 'gMuted'); rc.append(el('span', null, 'PDF 与 Markdown'), el('span', 'gDot', '·'), el('span', null, String(snap.recent.length)));
  const seg = el('div', 'gSeg'); let filter = 'all';
  const table = el('div', 'gTable'); table.setAttribute('role', 'table');
  const draw = () => {
    let list = snap.recent; if (filter === 'pinned') list = list.filter(r => r.pinned); if (filter === 'folder') list = [...list].sort((a, b) => a.folder.localeCompare(b.folder));
    const headRow = el('div', 'gRow gRowHead'); headRow.append(el('span'), el('span', null, '名称'), el('span', null, '位置'), el('span', null, '大小'), el('span', null, '修改'), el('span'));
    table.replaceChildren(headRow, ...list.slice(0, 12).map(item => {
      const r = el('div', 'gRow'); r.setAttribute('role', 'row'); r.tabIndex = 0; r.onclick = () => actions.openRecent(item); r.onkeydown = e => { if (e.key === 'Enter') actions.openRecent(item); };
      const name = el('span', 'gName'); name.append(el('b', null, item.name), el('span', 'gBadge' + (item.md ? ' md' : ''), item.md ? 'MD' : 'PDF')); if (item.open) name.append(el('i', 'gLive'));
      const loc = el('span', 'gLoc'); loc.append(icon('file'), el('span', null, item.folder));
      const star = el('button', 'gStar' + (item.pinned ? ' on' : '')); star.type = 'button'; star.setAttribute('aria-label', '固定'); star.setAttribute('aria-pressed', String(item.pinned)); star.textContent = '★';
      star.onclick = e => { e.stopPropagation(); actions.togglePin(item); item.pinned = !item.pinned; draw(); };
      const doc = el('span', 'gDoc' + (item.md ? ' md' : '')); doc.setAttribute('aria-hidden', 'true');
      r.append(doc, name, loc, el('span', 'gMono', fmtSize(item.size)), el('span', 'gMono', when(item.opened)), star); return r;
    }));
    if (list.length === 0) table.append(el('p', 'gEmptyLine', filter === 'pinned' ? '点每行右侧的星标即可固定文件' : '还没有打开过文件'));
  };
  for (const [k, label] of [['all', '全部'], ['pinned', '已固定'], ['folder', '按文件夹']]) { const b = el('button', null, label); b.type = 'button'; b.setAttribute('aria-pressed', String(k === filter)); b.onclick = () => { filter = k; for (const x of seg.children) x.setAttribute('aria-pressed', String(x === b)); draw(); }; seg.append(b); }
  rh.append(rt, rc, seg); recent.append(rh, table); draw(); main.append(recent);

  // ——— 活动 ———
  const act = el('section', 'gPane gActivity');
  const ah = el('div', 'gSideHead'); ah.append(el('h2', null, '活动'), el('span', 'gMuted', '最近 17 周'));
  const legend = el('span', 'gLegend'); legend.append(el('span', null, '少')); for (let l = 0; l < 5; l++) legend.append(el('i', 'lv' + l)); legend.append(el('span', null, '多')); ah.append(legend);
  const grid = el('div', 'gHeat'); grid.setAttribute('role', 'img'); grid.setAttribute('aria-label', '最近 17 周的阅读活动');
  const days = snap.days, max = Math.max(1, ...days.map(d => d.m + d.o * 5));
  // Columns are weeks (Monday first); the last column ends today.
  const pad = (days[0].date.getDay() + 6) % 7; for (let i = 0; i < pad; i++) grid.append(el('i', 'lvx'));
  days.forEach((d, i) => { const v = d.m + d.o * 5, lv = v === 0 ? 0 : Math.min(4, 1 + Math.floor(v / max * 3.99)); const c = el('i', 'lv' + lv + (i === days.length - 1 ? ' isToday' : '')); c.title = `${d.date.getMonth() + 1}/${d.date.getDate()} · ${d.o} · ${hm(d.m)}`; grid.append(c); });
  const tip = el('div', 'gTip'); tip.append(el('span', null, '今天'), el('span', 'gDot', '·'), el('b', null, String(snap.today.o)), el('span', null, '个文件'), el('span', 'gDot', '·'), el('b', null, hm(snap.today.m)));
  const stats = el('div', 'gStats');
  const week = snap.week;
  stats.append(stat(String(snap.weekOpens), '本周打开', week.map(d => d.o)), stat(hm(snap.weekMinutes), '本周阅读', week.map(d => d.m)), stat(String(snap.weekExcerpts), '新摘录', week.map(d => d.e)), stat('0', '次上传', week.map(() => 0), true));
  act.append(ah, grid, tip, stats); side.append(act);

  // ——— 常用文件夹 ———
  const fold = el('section', 'gPane gFolders'); const fh = el('div', 'gSideHead'); fh.append(el('h2', null, '常用文件夹')); fold.append(fh);
  const fmax = Math.max(1, ...snap.folders.map(f => f.count));
  if (!snap.folders.length) fold.append(el('p', 'gEmptyLine', '打开过的文件所在的文件夹会列在这里'));
  for (const f of snap.folders) { const r = el('div', 'gFolderRow'); const bar = el('div', 'gFolderBar'); const fill = el('i'); fill.style.width = (f.count / fmax * 100) + '%'; bar.append(fill); r.append(icon('open', 'hIcon gFolderIcon'), el('span', 'gFolderName', f.name), bar, el('span', 'gCount', String(f.count))); r.onclick = () => launcher.open(f.name.split('/').pop()); fold.append(r); }
  side.append(fold);

  // ——— 最近摘录 ———
  const ex = el('section', 'gPane gExcerpts'); const eh = el('div', 'gSideHead'); eh.append(el('h2', null, '最近摘录'), el('span', 'gMuted', '点来源跳回原处')); ex.append(eh);
  if (!snap.excerpts.length) ex.append(el('p', 'gEmptyLine', '在笔记模式里摘录 PDF 的句子，它们会出现在这里。'));
  for (const e of snap.excerpts.slice(0, 3)) {
    const q = el('article', 'gQuote'); q.append(el('p', null, e.quote));
    const m = el('div', 'gQuoteMeta'); const src = el('button', 'gSrc'); src.type = 'button'; src.append(el('span', null, '↩ '), el('span', null, baseName(e.source)), el('span', null, ` p.${e.page}`)); src.onclick = () => actions.openExcerpt(e);
    m.append(src, el('span', 'gBadge', 'PDF'), el('span', 'gMuted gTime', when(e.time))); q.append(m); ex.append(q);
  }
  side.append(ex);

  // ——— 光源 ———
  let lx = innerWidth * .7, ly = innerHeight * .25, tx = lx, ty = ly, idle = 0, raf = 0, pointerSeen = 0;
  const onMove = e => { tx = e.clientX; ty = e.clientY; pointerSeen = performance.now(); };
  root.addEventListener('pointermove', onMove);
  const tick = t => {
    if (performance.now() - pointerSeen > 2500) { idle += 0.004; const r = root.getBoundingClientRect(); tx = r.left + r.width * (0.5 + 0.38 * Math.cos(idle * 1.3)); ty = r.top + r.height * (0.4 + 0.3 * Math.sin(idle * 2.1)); }
    lx += (tx - lx) * 0.08; ly += (ty - ly) * 0.08;
    root.style.setProperty('--lx', lx.toFixed(1) + 'px'); root.style.setProperty('--ly', ly.toFixed(1) + 'px');
    raf = requestAnimationFrame(tick);
  };
  if (!reduceMotion()) raf = requestAnimationFrame(tick); else { root.style.setProperty('--lx', lx + 'px'); root.style.setProperty('--ly', ly + 'px'); }
  return { destroy() { cancelAnimationFrame(raf); root.removeEventListener('pointermove', onMove); } };
}
function sectionTitle(title, hint) { const h = el('div', 'gSection'); h.append(el('h2', null, title), el('span', 'gMuted', hint)); return h; }
function emptyPane(title, hint) { const p = el('div', 'gPane gEmpty'); p.append(el('b', null, title), el('span', null, hint)); return p; }
function stat(value, label, series, amber) {
  const s = el('div', 'gStat' + (amber ? ' isAmber' : '')); s.append(el('b', null, value), el('span', null, label));
  const w = 80, h = 22, max = Math.max(1, ...series), pts = series.map((v, i) => `${(i / (series.length - 1) * w).toFixed(1)},${(h - 2 - v / max * (h - 4)).toFixed(1)}`).join(' ');
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg'); svg.setAttribute('viewBox', `0 0 ${w} ${h}`); svg.setAttribute('preserveAspectRatio', 'none'); svg.setAttribute('aria-hidden', 'true');
  const line = document.createElementNS(svg.namespaceURI, 'polyline'); line.setAttribute('points', pts); svg.append(line); s.append(svg); return s;
}
