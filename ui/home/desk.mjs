// 首页样式 · 桌面：最近的文档像纸张摊在桌上，便签是最近的摘录。纸张钉在上沿，指针扫过会按速度晃动，
// 可以拖动（拖动时随速度倾斜，松手后摆回），位置记在本机。底部工具盘随指针放大。
import { el, kicker, icon, when, greeting, dateLine, baseName, reduceMotion, springLoop } from './core.mjs';
import { toolCatalog } from '../tool-catalog.mjs';

const KEY = 'qingye.home.desk.v1';
const hash = s => { let h = 2166136261; for (const c of String(s)) h = Math.imul(h ^ c.charCodeAt(0), 16777619); return (h >>> 0) / 4294967295; };
// 纸张两排排在左侧约 2/3，便签在右侧一列；位置是可用范围（桌宽 - 物件宽）的比例
const SLOTS = [[.01, .03], [.21, .07], [.41, .01], [.04, .92], [.24, .98], [.44, .90]];
const NOTE_SLOTS = [[.70, .06], [.93, .30], [.72, .86]];

export function render(root, ctx) {
  const { snap, actions, launcher } = ctx;
  root.className = 'homeLayout hgDesk';
  const left = el('div', 'dLeft'), desk = el('div', 'dDesk'), tray = el('nav', 'dTray');
  tray.setAttribute('aria-label', '工具盘');
  root.replaceChildren(left, desk, tray);

  left.append(kicker('dKicker', { month: 'numeric', day: 'numeric' }));
  const h1 = el('h1', 'dTitle'); h1.append(el('span', null, '今天想'), el('br'), el('span', 'dInk', '读'), el('span', null, '点什么？')); left.append(h1);
  const open = el('button', 'dOpen'); open.type = 'button'; open.append(icon('open', 'hIcon dOpenIcon'), el('strong', null, '打开文件'), el('small', null, 'PDF / MD · Ctrl+O · 或直接拖进来')); open.onclick = actions.open; left.append(open);
  const row = el('div', 'dRow');
  for (const [label, ic, run] of [['新建笔记', 'markdown', actions.newMarkdown], ['转换', 'convert', actions.convert]]) { const b = el('button', 'dSmall'); b.type = 'button'; b.append(icon(ic), el('span', null, label)); b.onclick = run; row.append(b); }
  left.append(row);

  desk.append(el('p', 'dLabel dLabelDocs', '桌上 · 最近打开的文档'));
  if (snap.excerpts.length) desk.append(el('p', 'dLabel dLabelNotes', '便签 · 最近摘录'));
  if (!snap.recent.length) desk.append(el('p', 'dEmpty', '桌上还空着。打开一个 PDF 或 Markdown，它会放到这里。'));

  // ——— 纸张与便签 ———
  let saved = {}; try { saved = JSON.parse(localStorage.getItem(KEY) || '{}'); } catch {}
  const items = [];
  const notesByNote = name => snap.excerpts.filter(e => e.note === name).map(e => e.quote);
  snap.recent.slice(0, 6).forEach((r, i) => {
    const card = el('div', 'dItem dCard' + (r.md ? ' isMd' : ''));
    if (r.md) {
      const screen = el('div', 'dScreen'); screen.append(el('b', null, '# ' + baseName(r.name)));
      const lines = notesByNote(r.name); for (const q of (lines.length ? lines : ['', '', '']).slice(0, 3)) screen.append(el('span', null, q ? '> ' + q.slice(0, 14) + '…' : '-'));
      card.append(screen);
    } else { const lines = el('div', 'dLines'); for (let k = 0; k < 9; k++) lines.append(el('i')); card.append(lines); }
    const meta = el('span', 'dMeta'); meta.append(el('span', null, r.md ? 'MD · ' : 'PDF · '), el('span', null, !r.md && r.pages ? `${r.page}/${r.pages}` : when(r.opened)));
    card.append(el('strong', 'dName', baseName(r.name)), meta);
    const bar = el('span', 'dBar'); const f = el('i'); f.style.width = (r.md ? 100 : Math.round(r.progress * 100)) + '%'; bar.append(f); card.append(bar);
    card.title = r.path; card.setAttribute('role', 'button'); card.tabIndex = 0; card.setAttribute('aria-label', '打开 ' + r.name);
    items.push(place(card, r.path, SLOTS[i], () => actions.openRecent(r)));
  });
  snap.excerpts.slice(0, 3).forEach((e, i) => {
    const note = el('div', 'dItem dNote n' + (i % 2)); note.append(el('i', 'dTape'), el('p', null, e.quote));
    const src = el('span', 'dSrc'); src.append(el('span', null, '↩ '), el('span', null, `第 ${e.page} 页`), el('span', null, ' · ' + baseName(e.source))); note.append(src);
    note.setAttribute('role', 'button'); note.tabIndex = 0; note.setAttribute('aria-label', '回到原文 ' + e.source);
    items.push(place(note, 'note:' + e.quote.slice(0, 40), NOTE_SLOTS[i], () => actions.openExcerpt(e)));
  });

  function place(node, key, slot, activate) {
    desk.append(node);
    const s = saved[key], h = hash(key);
    const it = { node, key, activate, fx: s?.x ?? Math.min(.86, slot[0] + (h - .5) * .04), fy: s?.y ?? Math.min(1, slot[1] + (hash(key + 'y') - .5) * .06), rest: s?.r ?? (h - .5) * 12, a: 0, va: 0, sc: 1, vs: 0, ts: 1, drag: null, z: 0 };
    it.a = it.rest - 8; // 进场：从更斜的角度摆回来
    node.addEventListener('keydown', e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); activate(); } });
    return it;
  }
  let zTop = 10;
  const size = () => desk.getBoundingClientRect();
  function apply(it) {
    const r = size(), w = it.node.offsetWidth, h = it.node.offsetHeight;
    const x = it.fx * Math.max(1, r.width - w), y = it.fy * Math.max(1, r.height - h);
    it.node.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${it.a.toFixed(2)}deg) scale(${it.sc.toFixed(3)})`;
  }
  // 摆：角加速度 = -K·偏角 - C·角速度（欠阻尼，会来回摆几下）；缩放用临界阻尼的弹簧。
  const K = 70, C = 5.2, KS = 380, CS = 30;
  const loop = springLoop(dt => {
    let moving = false;
    for (const it of items) {
      if (!it.drag) { const acc = -K * (it.a - it.rest) - C * it.va; it.va += acc * dt; it.a += it.va * dt; }
      const accS = -KS * (it.sc - it.ts) - CS * it.vs; it.vs += accS * dt; it.sc += it.vs * dt;
      apply(it);
      if (it.drag || Math.abs(it.a - it.rest) > .02 || Math.abs(it.va) > .02 || Math.abs(it.sc - it.ts) > .0005 || Math.abs(it.vs) > .0005) moving = true;
    }
    return moving;
  });
  for (const it of items) {
    const n = it.node;
    n.addEventListener('pointerenter', () => { it.ts = 1.04; n.style.zIndex = ++zTop; loop.kick(); });
    n.addEventListener('pointerleave', () => { if (!it.drag) it.ts = 1; loop.kick(); });
    n.addEventListener('pointermove', e => {
      if (it.drag) {
        const d = it.drag, r = size(), w = n.offsetWidth, h = n.offsetHeight;
        const dx = e.clientX - d.lastX; d.lastX = e.clientX; d.moved += Math.abs(e.clientX - d.x0) + Math.abs(e.clientY - d.y0) > 6 ? 1 : 0;
        it.fx = Math.max(0, Math.min(1, (e.clientX - r.left - d.ox) / Math.max(1, r.width - w)));
        it.fy = Math.max(0, Math.min(1, (e.clientY - r.top - d.oy) / Math.max(1, r.height - h)));
        it.a += (Math.max(-18, Math.min(18, it.rest - dx * 1.6)) - it.a) * .25; // 拖动时朝运动方向倾斜
        loop.kick(); return;
      }
      // 扫过：水平速度推动纸张，越靠下推得越多（钉子在上沿）
      const b = n.getBoundingClientRect(), lever = Math.max(.2, Math.min(1, (e.clientY - b.top) / b.height));
      it.va += Math.max(-60, Math.min(60, e.movementX)) * 9 * lever; loop.kick();
    });
    n.addEventListener('pointerdown', e => {
      if (e.button !== 0) return; n.setPointerCapture(e.pointerId); n.style.zIndex = ++zTop; n.classList.add('isLifted');
      const b = n.getBoundingClientRect(), r = size(); const x = it.fx * Math.max(1, r.width - n.offsetWidth) + r.left, y = it.fy * Math.max(1, r.height - n.offsetHeight) + r.top;
      it.drag = { ox: e.clientX - x, oy: e.clientY - y, x0: e.clientX, y0: e.clientY, lastX: e.clientX, moved: 0 }; it.ts = 1.08; loop.kick();
    });
    const end = () => {
      if (!it.drag) return; const moved = it.drag.moved > 0; it.drag = null; it.ts = 1.04; n.classList.remove('isLifted'); loop.kick();
      if (!moved) { it.ts = .96; loop.kick(); setTimeout(() => it.activate(), 90); return; }
      saved[it.key] = { x: +it.fx.toFixed(4), y: +it.fy.toFixed(4), r: +it.rest.toFixed(2) }; try { localStorage.setItem(KEY, JSON.stringify(saved)); } catch {}
    };
    n.addEventListener('pointerup', end); n.addEventListener('pointercancel', end);
  }
  const ro = new ResizeObserver(() => { for (const it of items) apply(it); }); ro.observe(desk);
  requestAnimationFrame(() => { for (const it of items) { if (reduceMotion()) it.a = it.rest; apply(it); } loop.kick(); });

  // ——— 工具盘：指针附近的按钮放大（像 Dock） ———
  tray.append(el('span', 'dTrayLabel', '工具盘'));
  const buttons = [];
  for (const c of toolCatalog) { const b = el('button', 'dTool'); b.type = 'button'; b.append(icon(c.icon), el('span', null, c.label)); const first = c.tools.find(t => t.action); b.onclick = () => actions.tool({ ...first, category: c.id }); b.title = c.note; tray.append(b); buttons.push(b); }
  const all = el('button', 'dTool dAll'); all.type = 'button'; all.append(icon('search'), el('span', null, 'Ctrl+K')); all.onclick = () => launcher.open(); all.title = '全部工具'; tray.append(all); buttons.push(all);
  tray.addEventListener('pointermove', e => { if (reduceMotion()) return; for (const b of buttons) { const r = b.getBoundingClientRect(), d = Math.abs(e.clientX - (r.left + r.width / 2)); b.style.setProperty('--mag', (1 + .28 * Math.max(0, 1 - d / 150)).toFixed(3)); } });
  tray.addEventListener('pointerleave', () => { for (const b of buttons) b.style.setProperty('--mag', 1); });
  return { destroy() { loop.stop(); ro.disconnect(); } };
}
