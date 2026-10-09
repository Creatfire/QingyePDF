// 首页样式 · 版画格：错版方格。悬停时方块抬起、第二版拉开；按下时压进第二版；进场逐格压印。
import { el, kicker, icon, when, greeting, dateLine, hm, baseName, allTools } from './core.mjs';
import { toolCatalog } from '../tool-catalog.mjs';

export function render(root, ctx) {
  const { snap, actions, launcher, data } = ctx;
  root.className = 'homeLayout hgBento';
  const grid = el('div', 'bGrid'); root.replaceChildren(grid);
  let order = 0;
  const tile = (cls, tag = 'section') => { const t = el(tag, 'bTile ' + cls); t.style.setProperty('--i', order++); grid.append(t); return t; };

  // 1 问候
  const hero = tile('bHero');
  hero.append(kicker('bKicker', { month: 'numeric', day: 'numeric', weekday: 'short' }));
  const h1 = el('h1', 'bTitle'); h1.append(el('span', null, '今天想'), el('span', 'bInk', '读'), el('span', null, '点什么？')); hero.append(h1);
  const tags = el('div', 'bTags'); for (const [t, on] of [['本地', true], ['私密'], ['开源']]) tags.append(el('span', 'bTag' + (on ? ' on' : ''), t)); hero.append(tags);
  const line = el('p', 'bToday'); line.append(el('span', null, '今天已读'), el('b', null, hm(snap.today.m)), el('span', 'bSep', '·'), el('span', null, '新增摘录'), el('b', null, String(snap.today.e)), el('span', 'bSep', '·'), el('span', null, '打开过'), el('b', null, String(snap.today.o)), el('span', null, '份文档'));
  hero.append(line);

  // 2 打开
  const open = tile('bOpen bPress', 'button'); open.type = 'button'; open.onclick = actions.open;
  open.append(icon('open', 'hIcon bOpenIcon'), el('strong', null, '打开文件'), el('small', null, 'PDF / Markdown'), el('kbd', null, 'Ctrl+O'));
  // 3 新建 / 转换
  const stack = el('div', 'bStack'); stack.style.setProperty('--i', order++); grid.append(stack);
  for (const [label, hint, ic, run] of [['新建 Markdown', 'Ctrl+N', 'markdown', actions.newMarkdown], ['文档转换', 'Word · EPUB · MD · PDF', 'convert', actions.convert]]) {
    const b = el('button', 'bTile bSmall bPress'); b.type = 'button'; b.append(icon(ic), el('strong', null, label), el('small', null, hint)); b.onclick = run; stack.append(b);
  }
  // 4 本机
  const local = tile('bLocal');
  local.append(el('p', 'bLabel', '本机'), el('b', 'bBig', String(snap.recent.length)), el('span', 'bNote', '份最近文档，全在本机'), el('b', 'bBig bAmber', '0'), el('span', 'bNote', '次上传'));

  // 5 继续阅读
  const cont = tile('bContinue');
  const item = snap.recent.find(r => !r.md && r.page) || snap.recent[0];
  if (item) {
    const book = el('div', 'bBook' + (item.md ? ' isMd' : '')); book.setAttribute('aria-hidden', 'true');
    for (const side of ['l', 'r']) { const page = el('div', 'bPage ' + side); for (let k = 0; k < 9; k++) page.append(el('i')); book.append(page); }
    const info = el('div', 'bContInfo');
    info.append(el('p', 'bLabel', '继续阅读'), el('h2', null, item.name));
    const ex = snap.excerpts.filter(e => baseName(e.source) === baseName(item.name));
    const meta = el('p', 'bMeta'); if (item.pages) meta.append(el('span', null, `第 ${item.page} / ${item.pages} 页`), el('span', 'bSep', '·')); if (ex.length) meta.append(el('span', null, `${ex.length} 条摘录`), el('span', 'bSep', '·')); meta.append(el('span', null, when(item.opened))); info.append(meta);
    if (item.pages) { const bar = el('div', 'bBar'); const f = el('i'); f.style.width = Math.round(item.progress * 100) + '%'; bar.append(f); info.append(bar); }
    const acts = el('div', 'bActs'); const go = el('button', 'bBtn bPress', '继续读 →'); go.type = 'button'; go.onclick = () => actions.openRecent(item); acts.append(go);
    if (ex[0]) { const j = el('button', 'bBtn amber bPress'); j.type = 'button'; j.append(el('span', null, '↩ '), el('span', null, `第 ${ex[0].page} 页的摘录`)); j.onclick = () => actions.openExcerpt(ex[0]); acts.append(j); }
    info.append(acts); cont.append(book, info);
  } else cont.append(el('p', 'bEmpty', '打开一个 PDF，下次就能从这里接着读。'));

  // 6 工具
  const tools = el('div', 'bTools'); tools.style.setProperty('--i', order++); grid.append(tools);
  toolCatalog.forEach((c, n) => {
    const b = el('button', 'bTile bTool bPress'); b.type = 'button'; b.style.setProperty('--i', order++);
    b.append(el('span', 'bNum', String(n + 1).padStart(2, '0')), icon(c.icon), el('strong', null, c.label), el('small', null, c.note));
    const first = c.tools.find(t => t.action); b.onclick = () => actions.tool({ ...first, category: c.id, key: `${first.action}${first.mode ? ':' + first.mode : ''}` }); tools.append(b);
  });
  const all = el('button', 'bTile bTool bAll bPress'); all.type = 'button'; all.append(el('span', 'bNum', 'Ctrl+K'), icon('search'), el('strong', null, '全部工具'), el('small', null, '搜索任何命令')); all.onclick = () => launcher.open(); tools.append(all);
  const drop = el('button', 'bTile bTool bDrop'); drop.type = 'button'; drop.append(icon('open'), el('strong', null, '拖入 PDF 直接打开')); drop.onclick = actions.open; tools.append(drop);

  // 7 最近
  const recent = tile('bRecent');
  const rh = el('div', 'bRecentHead'); rh.append(el('h2', null, '最近'));
  const chips = el('div', 'bChips'); let filter = 'all';
  const search = el('input', 'bSearch'); search.type = 'search'; search.placeholder = '筛选文件名'; search.setAttribute('aria-label', '筛选最近文件');
  const list = el('div', 'bList');
  const draw = () => {
    const q = search.value.trim().toLowerCase();
    const rows = snap.recent.filter(r => (filter === 'all' || (filter === 'md') === r.md) && (!q || r.name.toLowerCase().includes(q))).slice(0, 8);
    list.replaceChildren(...rows.map(r => {
      const b = el('button', 'bRow'); b.type = 'button'; b.onclick = () => actions.openRecent(r);
      const ic = el('span', 'bDoc' + (r.md ? ' md' : ''), r.md ? 'MD' : ''); const bar = el('span', 'bRowBar'); const f = el('i'); f.style.width = (r.md ? 100 : Math.round(r.progress * 100)) + '%'; bar.append(f);
      b.append(ic, el('span', 'bRowName', r.name), el('span', 'bRowMeta', r.md ? r.folder : r.pages ? `第 ${r.page} / ${r.pages} 页` : r.folder), bar, el('span', 'bRowTime', when(r.opened))); return b;
    }));
    if (!rows.length) list.append(el('p', 'bEmpty', snap.recent.length ? '没有符合条件的文件' : '还没有打开过文件'));
  };
  for (const [k, label] of [['all', '全部'], ['pdf', 'PDF'], ['md', 'Markdown']]) { const b = el('button', 'bChip', label); b.type = 'button'; b.setAttribute('aria-pressed', String(k === filter)); b.onclick = () => { filter = k; for (const x of chips.children) x.setAttribute('aria-pressed', String(x === b)); draw(); }; chips.append(b); }
  search.oninput = draw; rh.append(chips, search); recent.append(rh, list); draw();

  // 8 摘录
  const ex = tile('bExcerpts'); ex.append(el('p', 'bLabel', '最近摘录 · 点页码回到原文'));
  if (!snap.excerpts.length) ex.append(el('p', 'bEmpty', '在笔记模式里摘录 PDF 的句子，它们会出现在这里。'));
  for (const e of snap.excerpts.slice(0, 2)) { const q = el('article', 'bQuote'); q.append(el('p', null, e.quote)); const m = el('div', 'bQuoteMeta'); const s = el('button', 'bSrc bPress'); s.type = 'button'; s.append(el('span', null, '↩ '), el('span', null, `第 ${e.page} 页`)); s.onclick = () => actions.openExcerpt(e); m.append(s, el('span', 'bMono', e.source)); q.append(m); ex.append(q); }

  // 9 转换
  const conv = tile('bConvert bPress', 'button'); conv.type = 'button'; conv.onclick = actions.convert;
  const count = el('b', 'bBig', '—'); const fmts = el('div', 'bFmts');
  conv.append(el('p', 'bLabel', '转换'), count, el('span', 'bNote', '种输出格式'), fmts);
  data.converter().then(info => { if (!info) { count.textContent = '—'; return; } count.textContent = String(info.writers.length + 2); const pick = ['docx', 'epub3', 'html5', 'pdf', 'gfm', 'odt', 'latex', 'rtf'].filter(f => f === 'pdf' || info.writers.includes(f)); fmts.replaceChildren(...pick.map(f => el('span', null, f.replace(/\d$/, '').replace('gfm', 'md').replace('latex', 'tex'))), el('span', null, '…')); });

  // 进场：逐格压印（每格错开 30ms）
  root.classList.add('isEntering'); setTimeout(() => root.classList.remove('isEntering'), 900);
  return { destroy() {} };
}
