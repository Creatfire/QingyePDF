// 首页样式 · 色块：大色块拼贴，深色缝隙像版画的分割线。每块都挂在一个弹簧上：
// 指针滑过时放大、邻近的块被轻轻挤小；按下时收缩，松手后回弹过冲；按住滑过一串块会依次被“按”一下。
import { el, kicker, icon, when, greeting, dateLine, hm, baseName, reduceMotion, springLoop } from './core.mjs';
import { toolCatalog } from '../tool-catalog.mjs';

export function render(root, ctx) {
  const { snap, actions, launcher, data } = ctx;
  root.className = 'homeLayout hgBlocks';
  const grid = el('div', 'kGrid'); root.replaceChildren(grid);
  const blocks = [];
  const block = (cls, tag = 'section', run) => {
    const b = el(tag, 'kBlock ' + cls); if (tag === 'button') b.type = 'button';
    if (run) { b.onclick = run; b.classList.add('kAct'); }
    grid.append(b); blocks.push({ node: b, sc: .9, vs: 0, ts: 1, press: false }); return b;
  };

  // 1 问候（米白）
  const hero = block('kHero');
  hero.append(kicker('kKicker', { month: 'numeric', day: 'numeric', weekday: 'short' }));
  const h1 = el('h1', 'kTitle'); h1.append(el('span', null, '今天想'), el('span', 'kInk', '读'), el('span', null, '点什么？')); hero.append(h1);
  const today = el('p', 'kToday'); today.append(el('span', null, '今天已读'), el('b', null, hm(snap.today.m)), el('span', 'kSep', '/'), el('span', null, '打开'), el('b', null, String(snap.today.o)), el('span', 'kSep', '/'), el('span', null, '摘录'), el('b', null, String(snap.today.e))); hero.append(today);

  // 2 打开（绿）  3 新建（琥珀）  4 0 次上传（深）  5 转换（深）
  const open = block('kOpen kGreen', 'button', actions.open);
  open.append(icon('open', 'hIcon kBigIcon'), el('strong', null, '打开文件'), el('small', null, 'PDF / Markdown · Ctrl+O'));
  const neu = block('kNew kAmber', 'button', actions.newMarkdown);
  neu.append(icon('markdown', 'hIcon kBigIcon'), el('strong', null, '新建笔记'), el('small', null, 'Markdown · Ctrl+N'));
  const local = block('kLocal kDark');
  local.append(el('b', 'kHuge kAmberText', '0'), el('span', null, '次上传'), el('small', null, `${snap.recent.length} 份最近文档，全在本机`));
  const conv = block('kConv kDark', 'button', actions.convert);
  const writers = el('b', 'kHuge', '—'); conv.append(icon('convert', 'hIcon kBigIcon'), el('strong', null, '文档转换'), el('small', null, 'Word · EPUB · Markdown · PDF'));

  // 6 工具清单
  const tools = block('kTools kPaper');
  tools.append(el('p', 'kLabel', '工具'));
  const tl = el('div', 'kToolList');
  toolCatalog.forEach((c, n) => {
    const b = el('button', 'kToolRow'); b.type = 'button';
    b.append(el('span', 'kNum', String(n + 1).padStart(2, '0')), icon(c.icon), el('span', 'kToolName', c.label), el('small', null, c.note));
    const first = c.tools.find(t => t.action); b.onclick = () => actions.tool({ ...first, category: c.id }); tl.append(b);
  });
  const s = el('button', 'kToolRow kSearch'); s.type = 'button'; s.append(el('span', 'kNum', '⌘'), icon('search'), el('span', 'kToolName', '搜索命令'), el('kbd', null, 'Ctrl+K')); s.onclick = () => launcher.open(); tl.append(s);
  const d = el('button', 'kToolRow kDrop'); d.type = 'button'; d.append(el('span', 'kNum', '↓'), icon('open'), el('span', 'kToolName', '拖入 PDF 直接打开')); d.onclick = actions.open; tl.append(d);
  tools.append(tl);

  // 7 继续阅读（米白）
  const cont = block('kCont kCream');
  const item = snap.recent.find(r => !r.md && r.page) || snap.recent[0];
  cont.append(el('p', 'kLabel', '继续阅读'));
  if (item) {
    cont.append(el('h2', 'kContName', item.name));
    const ex = snap.excerpts.filter(e => baseName(e.source) === baseName(item.name));
    const meta = el('p', 'kMeta'); if (item.pages) meta.append(el('span', null, `第 ${item.page} / ${item.pages} 页`), el('span', 'kSep', '·')); meta.append(el('span', null, when(item.opened))); cont.append(meta);
    if (item.pages) { const bar = el('div', 'kBar'); const f = el('i'); f.style.width = Math.round(item.progress * 100) + '%'; bar.append(f); cont.append(bar); }
    const acts = el('div', 'kActs');
    const go = el('button', 'kBtn'); go.type = 'button'; go.append(el('span', null, '继续读 →')); go.onclick = e => { e.stopPropagation(); actions.openRecent(item); }; acts.append(go);
    if (ex[0]) { const j = el('button', 'kBtn amber'); j.type = 'button'; j.append(el('span', null, '↩ '), el('span', null, `第 ${ex[0].page} 页的摘录`)); j.onclick = e => { e.stopPropagation(); actions.openExcerpt(ex[0]); }; acts.append(j); }
    cont.append(acts);
  } else cont.append(el('p', 'kEmpty', '打开一个 PDF，下次就能从这里接着读。'));

  // 8 最近（米白）
  const recent = block('kRecent kPaper');
  recent.append(el('p', 'kLabel', '最近'));
  const list = el('div', 'kList');
  for (const r of snap.recent.slice(0, 6)) {
    const b = el('button', 'kRow'); b.type = 'button'; b.onclick = () => actions.openRecent(r); b.title = r.path;
    b.append(el('span', 'kDoc' + (r.md ? ' md' : ''), r.md ? 'MD' : 'PDF'), el('span', 'kRowName', r.name), el('span', 'kRowTime', when(r.opened)));
    list.append(b);
  }
  if (!snap.recent.length) list.append(el('p', 'kEmpty', '还没有打开过文件'));
  recent.append(list);

  // 9 摘录（绿）
  const exb = block('kEx kGreen');
  exb.append(el('p', 'kLabel', '摘录'));
  const e0 = snap.excerpts[0];
  if (e0) {
    exb.append(el('blockquote', 'kQuote', e0.quote));
    const src = el('button', 'kSrc'); src.type = 'button'; src.append(el('span', null, '↩ '), el('span', null, `第 ${e0.page} 页`), el('span', null, ' · ' + baseName(e0.source))); src.onclick = () => actions.openExcerpt(e0); exb.append(src);
  } else exb.append(el('p', 'kEmpty', '在笔记模式里摘录 PDF 的句子，它们会出现在这里。'));
  exb.append(el('small', 'kFoot', `本周 ${snap.weekExcerpts} 条`));

  // 10 转换数量（琥珀）
  const count = block('kCount kAmber', 'button', actions.convert);
  count.append(writers, el('span', null, '种输出格式'));
  data.converter().then(info => { writers.textContent = info ? String(info.writers.length + 2) : '—'; });

  // 11 书签（深）：最近一份带书签的 PDF
  const bm = block('kMarks kDark');
  const withMarks = snap.recent.find(r => !r.md && r.bookmarks?.length);
  const bl = el('p', 'kLabel'); bl.append(el('span', null, '书签')); if (withMarks) bl.append(el('span', null, ' · ' + baseName(withMarks.name))); bm.append(bl);
  if (withMarks) {
    const ul = el('div', 'kMarkList');
    for (const m of withMarks.bookmarks.slice(0, 5)) { const b = el('button', 'kMark'); b.type = 'button'; b.append(el('span', 'kMarkTitle', m.title || '—'), el('span', 'kMarkPage', 'p.' + m.page)); b.onclick = () => actions.openRecent(withMarks, m.page); ul.append(b); }
    bm.append(ul);
  } else bm.append(el('p', 'kEmpty', '最近的 PDF 里还没有书签。'));

  // ——— 弹簧：滑过放大、邻块让位；按下收缩、松手回弹；按住滑过逐块按压 ———
  const still = reduceMotion();
  const KS = 420, CS = 22; // 欠阻尼：松手会过冲一点再停
  const loop = springLoop(dt => {
    let moving = false;
    for (const b of blocks) {
      const acc = -KS * (b.sc - b.ts) - CS * b.vs; b.vs += acc * dt; b.sc += b.vs * dt;
      b.node.style.scale = b.sc.toFixed(4);
      if (Math.abs(b.sc - b.ts) > .0004 || Math.abs(b.vs) > .0004) moving = true;
    }
    return moving;
  });
  let down = false, hot = null;
  const at = x => blocks.find(b => b.node === x?.closest?.('.kBlock'));
  const retarget = () => { for (const b of blocks) b.ts = b.press ? .94 : b === hot ? 1.025 : hot ? .992 : 1; loop.kick(); };
  grid.addEventListener('pointermove', e => {
    const b = at(e.target);
    if (b !== hot) {
      if (down && hot) { hot.press = false; hot.vs += 1.2; } // 滑出被按住的块：弹回
      hot = b || null;
      if (down && hot) { hot.press = true; hot.vs -= .8; } // 按住滑进新块：按一下
      retarget();
    }
  });
  grid.addEventListener('pointerleave', () => { hot = null; down = false; for (const b of blocks) b.press = false; retarget(); });
  grid.addEventListener('pointerdown', e => { if (e.button !== 0) return; down = true; const b = at(e.target); if (b) { b.press = true; hot = b; } retarget(); });
  addEventListener('pointerup', up);
  function up() { if (!down) return; down = false; for (const b of blocks) if (b.press) { b.press = false; b.vs += 1.6; } retarget(); }
  // 键盘：Enter/空格按下块里的按钮时也压一下
  grid.addEventListener('keydown', e => { if (e.key !== 'Enter' && e.key !== ' ') return; const b = at(e.target); if (b) { b.vs -= 1.4; loop.kick(); } });
  // 进场：各块从 0.9 依次弹开
  if (still) for (const b of blocks) { b.sc = 1; b.node.style.scale = 1; }
  else blocks.forEach((b, i) => { b.node.style.scale = .9; b.node.style.opacity = 0; setTimeout(() => { b.node.style.opacity = ''; b.vs = 1.4; loop.kick(); }, 25 * i); });
  loop.kick();
  return { destroy() { loop.stop(); removeEventListener('pointerup', up); } };
}
