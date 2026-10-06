// Dialogs and floating UI for the Typora-style features: modal shell, prompt, command palette,
// quick open, preferences (with shortcut editor), version history, emoji picker, word count,
// popup menus and the menu bar.
import { menuItem, menuSep, menuKeys } from '../chrome.mjs';
import { eventCombo, normalizeCombo, findConflicts } from './keys.mjs';
import { THEMES } from './themes.mjs';
import { EMOJI } from './emoji.mjs';
import { countWords } from './commands.mjs';
import { menuModel } from './registry.mjs';

export const el = (tag, cls = '', text = '') => { const e = document.createElement(tag); if (cls) e.className = cls; if (text) e.textContent = text; return e; };
const fmtCombo = c => String(c || '').replace(/Ctrl/g, navigator.platform.startsWith('Mac') ? '⌘' : 'Ctrl');

// ——— Modal shell ———
export function modal({ title, wide = false, body, buttons = [], onClose, noHeader = false }) {
  const back = el('div', 'mdModalBack'), box = el('div', 'mdModal' + (wide ? ' wide' : ''));
  box.setAttribute('role', 'dialog'); box.setAttribute('aria-modal', 'true'); if (title) box.setAttribute('aria-label', title);
  const opener = document.activeElement;
  const close = value => { document.removeEventListener('keydown', onKey, true); back.remove(); if (opener?.isConnected) opener.focus?.({ preventScroll: true }); onClose?.(value); };
  const onKey = e => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(null); } };
  document.addEventListener('keydown', onKey, true);
  if (!noHeader) { const h = el('header'); h.append(el('h3', '', title || '')); const x = el('button'); x.dataset.icon = 'x'; x.setAttribute('aria-label', '关闭'); x.onclick = () => close(null); h.append(x); box.append(h); }
  const content = el('div', 'mdModalBody'); if (body) content.append(...[].concat(body));
  box.append(content);
  if (buttons.length) { const f = el('footer'); for (const b of buttons) { const btn = el('button', b.primary ? 'primary' : '', b.label); btn.onclick = () => b.onClick?.(close); f.append(btn); } box.append(f); }
  back.append(box); back.addEventListener('pointerdown', e => { if (e.target === back) close(null); });
  document.body.append(back);
  (box.querySelector('input,select,textarea') || box.querySelector('button.primary'))?.focus();
  return { close, box, content, back };
}

export function promptText({ title, label, value = '', okLabel = '确定' }) {
  return new Promise(resolve => {
    const input = el('input'); input.type = 'text'; input.value = value; input.setAttribute('aria-label', label || title); input.style.width = '100%';
    const m = modal({ title, body: [label ? el('p', '', label) : '', input], onClose: v => resolve(v), buttons: [{ label: '取消', onClick: c => c(null) }, { label: okLabel, primary: true, onClick: c => c(input.value) }] });
    input.addEventListener('keydown', e => { if (e.key === 'Enter') { e.preventDefault(); m.close(input.value); } });
    input.select();
  });
}
export function confirmBox({ title, text, okLabel = '确定' }) {
  return new Promise(resolve => modal({ title, body: el('p', '', text), onClose: v => resolve(v === true), buttons: [{ label: '取消', onClick: c => c(false) }, { label: okLabel, primary: true, onClick: c => c(true) }] }));
}

// ——— Popup menu (context menus for files / images / spelling) ———
let popup = null;
export function closePopup() { popup?.remove(); popup = null; }
export function popupMenu(x, y, items, { onAfter } = {}) {
  closePopup();
  const box = el('div', 'mdDrop'); box.setAttribute('role', 'menu'); popup = box;
  for (const it of items) {
    if (it === '-') { box.append(menuSep()); continue; }
    const b = menuItem(it.label, { shortcut: it.shortcut, checked: it.checked, role: it.checked !== undefined ? 'menuitemcheckbox' : 'menuitem' });
    b.disabled = !!it.disabled; b.onmousedown = e => e.preventDefault();
    b.onclick = () => { closePopup(); Promise.resolve(it.run()).then(onAfter, onAfter); };
    box.append(b);
  }
  document.body.append(box);
  const r = box.getBoundingClientRect();
  box.style.left = Math.max(8, Math.min(x, innerWidth - r.width - 8)) + 'px'; box.style.top = Math.max(8, Math.min(y, innerHeight - r.height - 8)) + 'px';
  menuKeys(box, closePopup);
  const off = e => { if (!box.contains(e.target)) { closePopup(); document.removeEventListener('pointerdown', off, true); } };
  document.addEventListener('pointerdown', off, true);
  box.querySelector('.menuItem:not(:disabled)')?.focus();
  return box;
}

// ——— List picker (palette / quick open) ———
function picker({ placeholder, items, render, onPick, empty = '没有匹配项', filter }) {
  const input = el('input', 'mdPaletteInput'); input.type = 'search'; input.placeholder = placeholder; input.setAttribute('aria-label', placeholder);
  const list = el('div', 'mdPaletteList'); list.setAttribute('role', 'listbox');
  const m = modal({ noHeader: true, body: [input, list] });
  m.content.style.padding = '0'; m.box.style.maxHeight = '64vh';
  let shown = [], index = 0;
  const paint = () => {
    const q = input.value.trim().toLowerCase(); shown = filter(items, q).slice(0, 80); index = Math.min(index, Math.max(0, shown.length - 1));
    list.replaceChildren(...(shown.length ? shown.map((it, i) => { const b = render(it); b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(i === index)); b.onmousemove = () => { if (index !== i) { index = i; mark(); } }; b.onclick = () => choose(it); return b; }) : [el('div', 'mdPaletteEmpty', empty)]));
  };
  const mark = () => { [...list.children].forEach((c, i) => c.setAttribute('aria-selected', String(i === index))); list.children[index]?.scrollIntoView?.({ block: 'nearest' }); };
  const choose = it => { m.close(null); if (it) setTimeout(() => onPick(it), 0); };
  input.oninput = () => { index = 0; paint(); };
  input.onkeydown = e => {
    if (e.key === 'ArrowDown') { e.preventDefault(); index = Math.min(shown.length - 1, index + 1); mark(); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); index = Math.max(0, index - 1); mark(); }
    else if (e.key === 'Enter') { e.preventDefault(); if (shown[index]) choose(shown[index]); }
  };
  paint(); return m;
}
const tokens = q => q.split(/\s+/).filter(Boolean);
const subsequence = (text, q) => { let i = 0; for (const c of text) if (c === q[i]) i++; return i === q.length; };

export function openPalette({ reg, x, comboOf, run }) {
  const items = reg.list.filter(c => !c.hidden);
  picker({
    placeholder: '输入命令名称…', items,
    filter: (all, q) => all.filter(c => { const t = (c.label + ' ' + (c.group || '') + ' ' + c.id).toLowerCase(); return tokens(q).every(w => t.includes(w)); }),
    render: c => { const ok = !c.enabled || c.enabled(x()); const b = el('button', 'mdPaletteItem'); b.disabled = !ok; b.append(el('span', 'mdPaletteGroup', c.group || ''), el('span', '', c.label)); const k = comboOf(c.id); if (k) b.append(el('span', 'shortcut', fmtCombo(k))); if (!ok) b.style.opacity = '.5'; return b; },
    onPick: c => run(c.id),
  });
}
export function openQuick({ files, recent, onOpen }) {
  const items = [...files.map(f => ({ ...f, from: 'tree' })), ...recent.filter(r => !files.some(f => f.path.toLowerCase() === r.path.toLowerCase())).map(r => ({ ...r, from: 'recent' }))];
  picker({
    placeholder: '按文件名快速打开…', items, empty: items.length ? '没有匹配的文件' : '还没有可选文件：先打开一个文件夹，或打开过一些文档',
    filter: (all, q) => { if (!q) return all; const ws = tokens(q); return all.filter(f => { const t = (f.name + ' ' + f.path).toLowerCase(); return ws.every(w => t.includes(w) || subsequence(f.name.toLowerCase(), w)); }); },
    render: f => { const b = el('button', 'mdPaletteItem'); const wrap = el('span'); wrap.append(document.createTextNode(f.name)); const s = el('small', '', f.path); wrap.append(s); b.append(wrap); return b; },
    onPick: onOpen,
  });
}

// ——— Emoji picker ———
export function openEmoji({ onPick }) {
  const input = el('input'); input.type = 'search'; input.placeholder = '搜索表情，如 smile、heart、rocket'; input.style.width = '100%'; input.setAttribute('aria-label', '搜索表情');
  const grid = el('div', 'mdEmojiGrid');
  const m = modal({ title: '表情与符号', body: [input, grid] });
  const paint = () => {
    const q = input.value.trim().toLowerCase(); const out = [];
    for (const [name, g] of EMOJI) { if (!q || name.includes(q)) out.push([name, g]); if (out.length >= 300) break; }
    grid.replaceChildren(...out.map(([name, g]) => { const b = el('button', '', g); b.title = ':' + name + ':'; b.setAttribute('aria-label', name); b.onclick = () => { m.close(null); onPick(g, name); }; return b; }));
  };
  input.oninput = paint; paint();
}

// ——— Table resize ———
export function openResize({ rows, columns, onApply }) {
  const r = el('input'), c = el('input'); for (const [i, v] of [[r, rows], [c, columns]]) { i.type = 'number'; i.min = '1'; i.value = String(v); }
  const form = el('div', 'mdForm'); form.append(el('label', '', '数据行数（不含表头）'), r, el('label', '', '列数'), c);
  const m = modal({ title: '调整表格大小', body: form, buttons: [{ label: '取消', onClick: x => x(null) }, { label: '应用', primary: true, onClick: x => { x(null); onApply(Number(r.value) || 1, Number(c.value) || 1); } }] });
  form.addEventListener('keydown', e => { if (e.key === 'Enter') { m.close(null); onApply(Number(r.value) || 1, Number(c.value) || 1); } });
}

// ——— Word count popover ———
let pop = null;
export function closePop() { pop?.remove(); pop = null; }
export function openWordCount({ text, selection, anchor }) {
  closePop();
  const stat = t => { const { words, characters, lines } = countWords(t); return { words, characters, chars: t.length, lines, paragraphs: t.split(/\n\s*\n/).filter(p => p.trim()).length, minutes: Math.max(1, Math.round(words / 300)) }; };
  const all = stat(text), sel = selection ? stat(selection) : null;
  const box = el('div', 'mdPop'); box.setAttribute('role', 'dialog'); box.setAttribute('aria-label', '字数统计');
  box.append(el('h4', '', sel ? '字数统计（含选中内容）' : '字数统计'));
  const table = el('table'); const head = el('tr'); head.append(el('td'), el('td', '', '全文')); if (sel) head.append(el('td', '', '选中')); table.append(head);
  for (const [label, key, unit] of [['字数', 'words', ''], ['字符数（不含空白）', 'characters', ''], ['字符数（含空白）', 'chars', ''], ['行数', 'lines', ''], ['段落数', 'paragraphs', ''], ['预计阅读', 'minutes', ' 分钟']]) {
    const tr = el('tr'); tr.append(el('td', '', label), el('td', '', all[key].toLocaleString('zh-CN') + unit)); if (sel) tr.append(el('td', '', sel[key].toLocaleString('zh-CN') + unit)); table.append(tr);
  }
  box.append(table, el('p', 'mdPopHint', '中文按字计数，英文按词计数；代码与公式也计入。按 Esc 关闭。'));
  document.body.append(box); pop = box;
  const r = anchor?.getBoundingClientRect?.() || { left: innerWidth - 340, top: innerHeight - 40 };
  const b = box.getBoundingClientRect();
  box.style.left = Math.max(8, Math.min(r.left, innerWidth - b.width - 8)) + 'px'; box.style.top = Math.max(8, r.top - b.height - 8) + 'px';
  const off = e => { if (e.type === 'keydown' ? e.key === 'Escape' : !box.contains(e.target)) { closePop(); document.removeEventListener('pointerdown', off, true); document.removeEventListener('keydown', off, true); } };
  setTimeout(() => { document.addEventListener('pointerdown', off, true); document.addEventListener('keydown', off, true); });
}

// ——— Version history ———
export async function openVersions({ list, read, onRestore }) {
  const versions = await list();
  const body = el('div');
  if (!versions.length) body.append(el('p', '', '还没有历史版本。每次保存都会为已保存的文件留下一个本地快照（最多保留 40 个，内容相同的不重复记录）。'));
  const m = modal({ title: '浏览所有版本', wide: true, body, buttons: [{ label: '关闭', onClick: c => c(null) }] });
  const preview = el('pre'); preview.style.cssText = 'max-height:38vh;overflow:auto;white-space:pre-wrap;font:12px var(--md-mono, monospace);background:var(--surface-2);padding:10px;border-radius:8px;margin-top:10px';
  preview.hidden = true;
  for (const v of versions) {
    const row = el('div', 'mdVersionRow'); const when = new Date(v.time);
    row.append(el('span', '', when.toLocaleString('zh-CN')), el('small', '', `${(v.size / 1024).toFixed(1)} KB`), el('span', 'spacer'));
    const pv = el('button', '', '预览'), rs = el('button', '', '恢复此版本');
    pv.onclick = async () => { preview.textContent = await read(v.name); preview.hidden = false; };
    rs.onclick = async () => { const text = await read(v.name); m.close(null); onRestore(text, when); };
    row.append(pv, rs); body.append(row);
  }
  body.append(preview);
}

// ——— Preferences ———
const FIELDS = {
  general: [
    ['h', '编辑'], ['check', 'autoPair', '自动配对括号和引号'], ['check', 'smartPaste', '智能粘贴：把网页 / Word 中的格式转换为 Markdown'], ['check', 'copyMarkdown', '复制时默认使用 Markdown 源码'],
    ['check', 'emoji', '键入 : 后自动补全表情'], ['check', 'spellcheck', '键入时检查拼写（使用系统拼写检查器）'], ['check', 'smartPunctuation', '智能标点（仅渲染时转换引号、破折号，不改动源码）'],
    ['check', 'preserveBreaks', '保留单个换行符（渲染为 <br>）'],
    ['h', '保存'], ['check', 'finalNewline', '保存时在文末保证一个换行符'], ['check', 'autoSave', '自动保存已有路径的文件'], ['number', 'autoSaveSeconds', '自动保存间隔（秒）', 5, 600],
  ],
  appearance: [
    ['h', '主题'], ['theme'], ['h', '字体与排版'], ['text', 'fontFamily', '正文字体（留空使用主题字体）'], ['number', 'fontSize', '字号（px）', 12, 32], ['number', 'lineHeight', '行高', 1.2, 2.6, 0.05], ['number', 'pageWidth', '页面宽度（px）', 480, 1600, 10],
    ['check', 'indentFirstLine', '首行缩进两个字符'], ['check', 'showBr', '显示 <br/> 换行标签'],
    ['h', '界面'], ['check', 'openInReadMode', '打开已有文件时先进入阅读模式（双击或按 E 开始编辑）'], ['check', 'menubar', '显示菜单（文件、编辑……）'], ['check', 'statusBar', '显示状态栏'], ['check', 'highlightHeading', '在大纲中高亮当前标题'], ['select', 'outlineMode', '大纲显示方式', [['tree', '可折叠层级'], ['flat', '平铺（无折叠）']]],
  ],
  images: [
    ['h', '插入本地图片'], ['select', 'imageInsert', '插入或拖入图片时', [['none', '不处理（保留原路径）'], ['assets', '复制到 ./assets'], ['named', '复制到 ./文档名.assets'], ['custom', '复制到自定义文件夹']]],
    ['text', 'imageFolder', '自定义文件夹（相对文档或绝对路径）'], ['check', 'preferRelative', '优先使用相对路径'],
    ['note', '粘贴的剪贴板图片没有原文件，会按上面的位置保存（选择“不处理”时保存到 ./assets）。文档需要先保存。'],
  ],
  export: [
    ['h', 'PDF'], ['select', 'pdfPageSize', '纸张', [['A4', 'A4'], ['A3', 'A3'], ['A5', 'A5'], ['Letter', 'Letter'], ['Legal', 'Legal']]], ['select', 'pdfMargin', '页边距', [['normal', '标准（20 mm）'], ['narrow', '窄（10 mm）'], ['wide', '宽（30 mm）'], ['none', '无']]],
    ['check', 'pdfLandscape', '横向'], ['check', 'pdfHeaderFooter', '页脚显示页码'], ['check', 'pdfBackground', '打印背景色'],
    ['h', '文档转换引擎（内置 Pandoc）'], ['text', 'pandocPath', '自定义 Pandoc 路径（留空使用内置引擎）'], ['pandocProbe'],
    ['note', 'Word、ePub、LaTeX、RTF、HTML、PDF、图片、纯文本由青页自己生成，不需要 Pandoc。'],
  ],
};
export function openPrefs({ prefs, reg, tab = 'general', pandocInfo, customThemes, onTheme, onReset, commandKeys }) {
  const tabs = [['general', '通用'], ['appearance', '外观'], ['images', '图像'], ['export', '导出'], ['keys', '快捷键']];
  const bar = el('div', 'mdPrefTabs'); bar.setAttribute('role', 'tablist');
  const pane = el('div');
  const m = modal({ title: '偏好设置', wide: true, body: [bar, pane], buttons: [{ label: '恢复默认', onClick: () => { onReset(); paint(); } }, { label: '完成', primary: true, onClick: c => c(null) }] });
  m.content.style.padding = '0'; pane.style.padding = '14px 16px';
  let current = tab;
  function keysPane() {
    const wrap = el('div'); const filter = el('input', 'mdKeyFilter'); filter.type = 'search'; filter.placeholder = '筛选命令'; filter.setAttribute('aria-label', '筛选命令');
    wrap.append(filter, el('p', 'mdPopHint', '点击输入框后直接按下新的组合键；Backspace 清除（取消绑定）。与系统全局操作相同的组合键（如保存、新建、查找）由应用处理，不在此列。'));
    const rows = el('div'); wrap.append(rows);
    const paintRows = () => {
      const q = filter.value.trim().toLowerCase(), over = prefs.get('shortcuts'), conflicts = new Set(findConflicts(reg.list.filter(c => !c.displayOnly), over).flatMap(([, a, b]) => [a, b]));
      rows.replaceChildren(...reg.list.filter(c => !c.displayOnly && (!q || (c.label + c.id).toLowerCase().includes(q))).map(c => {
        const row = el('div', 'mdKeyRow'); row.append(el('span', '', c.label));
        const input = el('input'); input.type = 'text'; input.readOnly = true; input.value = fmtCombo(commandKeys(c.id)); input.placeholder = '未设置'; input.setAttribute('aria-label', c.label + ' 快捷键');
        if (conflicts.has(c.id)) { input.classList.add('isConflict'); input.title = '与其他命令冲突'; }
        input.onkeydown = e => {
          if (e.key === 'Tab') return;
          e.preventDefault(); e.stopPropagation();
          if (e.key === 'Backspace' || e.key === 'Delete') { prefs.setShortcut(c.id, ''); paintRows(); return; }
          if (e.key === 'Escape') { input.blur(); return; }
          const combo = eventCombo(e); if (!combo || !/Ctrl|Alt|F\d|Shift/.test(combo)) return;
          const normalized=normalizeCombo(combo);
          const conflict=findConflicts(reg.list.filter(item=>!item.displayOnly),{...prefs.get('shortcuts'),[c.id]:normalized}).find(([key,a,b])=>key===normalized&&(a===c.id||b===c.id));
          if(conflict){const other=reg.get(conflict[1]===c.id?conflict[2]:conflict[1]);input.classList.add('isConflict');input.title='快捷键已由“'+(other?.label||'其他命令')+'”使用；请换一个组合键。';const hint=wrap.querySelector('.mdPopHint');hint.textContent=input.title;hint.setAttribute('role','alert');return;}
          prefs.setShortcut(c.id, normalized); paintRows();
        };
        const back = el('button', '', '↺'); back.title = '恢复默认'; back.setAttribute('aria-label', '恢复默认'); back.disabled = over[c.id] === undefined; back.onclick = () => { prefs.setShortcut(c.id, null); paintRows(); };
        row.append(input, back); return row;
      }));
    };
    filter.oninput = paintRows; paintRows(); return wrap;
  }
  function form(fields) {
    const f = el('div', 'mdForm');
    for (const fd of fields) {
      const [type, key, label, a, b, step] = fd;
      if (type === 'h') { f.append(el('h5', '', key)); continue; }
      if (type === 'note') { const p = el('p', 'mdPopHint', key); p.style.gridColumn = '1 / -1'; f.append(p); continue; }
      if (type === 'theme') {
        const sel = el('select'); sel.setAttribute('aria-label', '主题');
        for (const [id, name] of THEMES) sel.append(new Option(name, id));
        for (const t of customThemes()) sel.append(new Option('自定义：' + t.name, 'custom:' + t.id));
        sel.value = prefs.get('theme') === 'custom' ? 'custom:' + prefs.get('customTheme') : prefs.get('theme');
        sel.onchange = () => onTheme(sel.value);
        f.append(el('label', '', '主题'), sel); continue;
      }
      if (type === 'pandocProbe') {
        const b2 = el('button', '', '检测 Pandoc'), out = el('span', 'mdPopHint'); b2.onclick = async () => { out.textContent = '检测中…'; const info = await pandocInfo(); out.textContent = info.found ? `已找到：${info.version}（${info.path}）` : '未找到 Pandoc。'; };
        const row = el('div'); row.style.cssText = 'grid-column:1/-1;display:flex;gap:10px;align-items:center'; row.append(b2, out); f.append(row); continue;
      }
      if (type === 'check') { const row = el('label', 'mdCheckRow'); const i = el('input'); i.type = 'checkbox'; i.checked = !!prefs.get(key); i.onchange = () => prefs.set(key, i.checked); row.append(i, document.createTextNode(label)); f.append(row); continue; }
      const l = el('label', '', label); let input;
      if (type === 'select') { input = el('select'); for (const [v, t] of a) input.append(new Option(t, v)); input.value = prefs.get(key); input.onchange = () => prefs.set(key, input.value); }
      else if (type === 'number') { input = el('input'); input.type = 'number'; input.min = a; input.max = b; if (step) input.step = step; input.value = prefs.get(key); input.onchange = () => { const v = Math.max(a, Math.min(b, Number(input.value) || a)); input.value = v; prefs.set(key, v); }; }
      else { input = el('input'); input.type = 'text'; input.value = prefs.get(key) || ''; input.onchange = () => prefs.set(key, input.value.trim()); }
      input.setAttribute('aria-label', label); f.append(l, input);
    }
    return f;
  }
  function paint() {
    bar.replaceChildren(...tabs.map(([id, name]) => { const b = el('button', '', name); b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(id === current)); b.onclick = () => { current = id; paint(); }; return b; }));
    pane.replaceChildren(current === 'keys' ? keysPane() : form(FIELDS[current]));
  }
  paint();
  return m;
}

// ——— Menu bar ———
// getState(): the live context for enabled/checked; comboOf(id): shortcut label; run(id): executes.
export function buildMenubar({ reg, comboOf, x, run, dynamic, extras = [] }) {
  const bar = el('div', 'mdMenubar'); bar.setAttribute('role', 'menubar');
  let open = null, chain = [];
  const closeAll = () => { for (const c of chain) c.remove(); chain = []; if (open) { open.setAttribute('aria-expanded', 'false'); open = null; } };
  const outside = e => { if (!bar.contains(e.target) && !chain.some(c => c.contains(e.target))) closeAll(); };
  document.addEventListener('pointerdown', outside, true); window.addEventListener('blur', closeAll);

  const build = (items, level) => {
    const box = el('div', 'mdDrop' + (level ? ' mdSub' : '')); box.setAttribute('role', 'menu');
    box.onmousedown = e => e.preventDefault();
    let subOpen = null;
    const add = (node, sub) => {
      node.onmouseenter = () => { if (subOpen && subOpen.node !== node) { closeFrom(level + 1); subOpen = null; } if (sub && !node.disabled) openSub(node, sub); };
      box.append(node);
    };
    const closeFrom = lvl => { while (chain.length > lvl + 1) chain.pop().remove(); };
    const openSub = (node, sub) => {
      closeFrom(level + 1); subOpen = { node };
      const s = build(sub, level + 1); document.body.append(s); chain.push(s);
      const r = node.getBoundingClientRect(), b = s.getBoundingClientRect();
      s.style.left = (r.right + b.width + 8 > innerWidth ? Math.max(8, r.left - b.width - 2) : r.right - 2) + 'px'; s.style.top = Math.max(8, Math.min(r.top - 5, innerHeight - b.height - 8)) + 'px';
      return s;
    };
    for (const it of items) {
      if (it === '-') { box.append(menuSep()); continue; }
      if (Array.isArray(it) && typeof it[1] === 'string') { // dynamic
        const list = dynamic(it[1]);
        if (!list.length) { const b = menuItem('（空）'); b.disabled = true; add(b); continue; }
        add(menuItem(it[0] === 'recent' ? '打开最近文件' : '自定义主题', {}), list.map(d => ({ dyn: d })));
        const last = box.lastChild; last.classList.add('hasSub'); last.onclick = () => openSub(last, list.map(d => ({ dyn: d })));
        continue;
      }
      if (Array.isArray(it)) {
        const b = menuItem(it[0], {}); b.classList.add('hasSub'); b.setAttribute('aria-haspopup', 'menu'); add(b, it[1]); b.onclick = () => openSub(b, it[1]); continue;
      }
      if (it.dyn) { const b = menuItem(it.dyn.label, { checked: it.dyn.checked, role: it.dyn.checked !== undefined ? 'menuitemcheckbox' : 'menuitem' }); b.onclick = () => { closeAll(); it.dyn.run(); }; add(b); continue; }
      const c = reg.get(it); if (!c) continue;
      const ctx = x();
      const ok = !c.enabled || c.enabled(ctx);
      const checked = c.checked ? !!c.checked(ctx) : undefined;
      const b = menuItem(level ? (c.label2 || c.label) + (c.pandoc ? '（Pandoc）' : '') : c.label, { shortcut: fmtCombo(comboOf(c.id)), checked, role: checked !== undefined ? 'menuitemcheckbox' : 'menuitem' });
      b.disabled = !ok; b.onclick = () => { closeAll(); run(c.id); }; add(b);
    }
    menuKeys(box, () => { closeAll(); });
    box.addEventListener('keydown', e => {
      const t = document.activeElement;
      if (e.key === 'ArrowRight' && t?.classList.contains('hasSub')) { e.preventDefault(); t.click(); chain.at(-1)?.querySelector('.menuItem:not(:disabled)')?.focus(); }
      else if (e.key === 'ArrowLeft' && level > 0) { e.preventDefault(); const parent = chain[level - 1]; chain.pop().remove(); parent?.querySelector('.hasSub:focus, .hasSub')?.focus(); }
    });
    return box;
  };
  const openTop = (btn, items) => {
    if (open === btn) { closeAll(); return; }
    closeAll(); open = btn; btn.setAttribute('aria-expanded', 'true');
    const box = build(items, 0); document.body.append(box); chain = [box];
    const r = btn.getBoundingClientRect(); box.style.left = Math.min(r.left, innerWidth - box.offsetWidth - 8) + 'px'; box.style.top = r.bottom + 2 + 'px';
    box.querySelector('.menuItem:not(:disabled)')?.focus({ preventScroll: true });
  };
  const model = menuModel(reg);
  const tops = [];
  for (const [name, items] of model) {
    const b = el('button', 'mdMenuTop', name); b.setAttribute('role', 'menuitem'); b.setAttribute('aria-haspopup', 'menu'); b.setAttribute('aria-expanded', 'false');
    b.onmousedown = e => e.preventDefault();
    b.onclick = () => openTop(b, items);
    b.onmouseenter = () => { if (open && open !== b) openTop(b, items); };
    b.onkeydown = e => { if (e.key === 'ArrowDown' || e.key === 'Enter' || e.key === ' ') { e.preventDefault(); openTop(b, items); } else if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') { e.preventDefault(); const i = tops.indexOf(b); tops[(i + (e.key === 'ArrowRight' ? 1 : tops.length - 1)) % tops.length].focus(); } };
    tops.push(b); bar.append(b);
  }
  bar.append(el('span', 'spacer'), ...extras);
  bar.destroy = () => { closeAll(); document.removeEventListener('pointerdown', outside, true); window.removeEventListener('blur', closeAll); };
  return bar;
}
