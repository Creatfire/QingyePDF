// Typora-style host layer: preferences, command registry wiring, menu bar, sidebar panes, table
// and image bars, modes, themes, export, file operations and keyboard shortcuts.
import { createPrefs } from './prefs.mjs';
import { buildRegistry } from './registry.mjs';
import { effectiveKeys, eventCombo, normalizeCombo } from './keys.mjs';
import { scopeThemeCss } from './themes.mjs';
import { setRenderOptions } from './parser.mjs';
import { buildExport, isPandocFormat, FORMAT_INFO } from './export.mjs';
import * as D from './typora-dialogs.mjs';
import { el } from './typora-dialogs.mjs';

const MARGINS = { normal: 20, narrow: 10, wide: 30, none: 0 };
const isMd = p => /\.(md|markdown|mdown|mkdn?|mdwn)$/i.test(p || '');
const baseName = p => String(p).replace(/^.*[\\/]/, '').replace(/^<|>$/g, '').replace(/\.[^.]+$/, '');

export function createTypora(deps) {
  const { api, guard, status, message, sessions, getVisible, host, addDocuments, app } = deps;
  const prefs = createPrefs();
  let customCss = '', customThemes = [], folder = null, onTop = false, renderKey = '';
  const collapsedDirs = new Set();
  const styleTag = document.head.appendChild(el('style')); styleTag.id = 'mdCustomTheme';

  // ——— Host helper object used by the command registry ———
  const ctxOf = s => ({ s, ed: s.editor, H });
  const H = {
    api, prefs, app,
    get ed() { return getVisible()?.editor; },
    togglePref: name => prefs.toggle(name),
    openFind: (s, replace) => host.openFind(s, replace),
    setSource: (s, on) => host.setSource(s, on),
    print: s => host.print(s),
    reload: s => guard(() => host.reload(s)),
    setMode(s, kind, on) {
      if (kind === 'readonly') { host.setViewMode(s, on ? 'read' : 'live'); return; }
      if (kind === 'focus') prefs.set('focusMode', on);
      else if (kind === 'typewriter') prefs.set('typewriterMode', on);
      status(({ focus: '专注模式', typewriter: '打字机模式' })[kind] + (on ? '：开' : '：关'));
    },
    pickImage: s => guard(() => pickImage(s)),
    emojiPicker: s => D.openEmoji({ onPick: g => { s.editor.focus(); s.editor.run('insertText', g); } }),
    resizeTable: s => { const t = s.editor.tableState(); if (t) D.openResize({ rows: t.rows, columns: t.columns, onApply: (r, c) => { s.editor.focus(); s.editor.run('tableResize', [r, c]); } }); },
    customImageFolder: () => guard(async () => { const v = await D.promptText({ title: '自定义图片文件夹', label: '相对文档或绝对路径：', value: prefs.get('imageFolder') || 'assets' }); if (v) { prefs.set('imageFolder', v.trim()); prefs.set('imageInsert', 'custom'); } }),
    copyAllImages: s => guard(async () => {
      if (!s.path) throw new Error('请先保存文档。');
      const r = await api.mdCopyImages(s.id, s.editor.text, imageOptions());
      if (r.count) { s.editor.replaceAll(r.text); status(`已复制 ${r.count} 张图片，并更新了链接 · 可撤销`); } else status('没有需要复制的本地图片');
    }),
    openFolder: s => guard(async () => { const t = await api.mdOpenFolder(null); if (t) { setFolder(t); H.showSidebar(s, 'files'); } }),
    openQuickly: () => guard(async () => {
      if (!folder && getVisible()?.path) { try { setFolder(await api.mdOpenFolder(getVisible().id)); } catch {} }
      const files = flatten(folder?.tree), recent = (await api.recent()).filter(r => isMd(r.path));
      D.openQuick({ files, recent, onOpen: f => guard(() => f.from === 'tree' ? openPath(f.path) : openRecent(f.id)) });
    }),
    saveAll: () => guard(async () => {
      let n = 0; for (const s of sessions) if (s.kind === 'markdown' && s.path && host.isDirty(s)) { if (await app.save(s, false)) n++; }
      const untitled = [...sessions].filter(s => s.kind === 'markdown' && !s.path && host.isDirty(s)).length;
      status(n ? `已保存 ${n} 个文件` + (untitled ? `；${untitled} 个未命名文档需要单独“另存为”` : '') : untitled ? '未命名文档需要单独“另存为”' : '没有需要保存的文件');
    }),
    fileOp: (s, op, arg) => guard(() => fileOp({ id: s.id }, op, arg, s)),
    versions: s => guard(() => D.openVersions({ list: () => api.mdHistory(s.id), read: name => api.mdHistoryRead(s.id, name), onRestore: (text, when) => { s.editor.replaceAll(text); status(`已恢复 ${when.toLocaleString('zh-CN')} 的版本 · 可撤销`); } })),
    importFile: () => guard(async () => {
      const r = await api.mdPandocImport(prefs.get('pandocPath')); if (!r) return;
      const docs = await api.newMarkdown(); await addDocuments(docs);
      const s = [...sessions].find(x => x.id === docs[0].id); s?.editor?.replaceAll(r.text); status('已导入：' + r.name + ' · 请保存为 .md 文件');
    }),
    revealInTree: s => guard(async () => { if (!folder) setFolder(await api.mdOpenFolder(s.id)); H.showSidebar(s, 'files'); requestAnimationFrame(() => s.ui.files.list.querySelector('.isCurrent')?.scrollIntoView({ block: 'center' })); }),
    setEol: (s, eol) => guard(async () => { await api.mdSetEol(s.id, eol); s.eol = eol; s.forceDirty = true; host.changed(s); status('换行符将在下次保存时改为 ' + (eol === '\r\n' ? 'CRLF' : 'LF')); }),
    reopenEncoding: (s, enc) => guard(async () => { const r = await api.mdReopenEncoding(s.id, enc); s.editor.replaceAll(r.text); s.savedText = r.text; s.encodingLabel = enc.toUpperCase(); host.changed(s); status('已用 ' + enc.toUpperCase() + ' 重新读取文件'); }),
    exportAs: (s, fmt) => guard(() => exportAs(s, fmt)),
    openPrefs: (s, tab) => D.openPrefs({ prefs, reg, tab, pandocInfo: () => api.mdPandocInfo(prefs.get('pandocPath')), customThemes: () => customThemes, onTheme: v => { if (v.startsWith('custom:')) H.setCustomTheme(v.slice(7)); else H.setTheme(v); }, onReset: () => prefs.reset(), commandKeys: id => comboOf(id) }),
    toggleSidebar: s => host.toggleOutline(s),
    sidebarOpen: s => !s.ui.outline.hidden,
    sidebarTab: () => prefs.get('sidebarTab'),
    showSidebar(s, tab) { prefs.set('sidebarTab', tab); host.toggleOutline(s, true); syncSidebar(s); },
    outlineFold: (s, on) => { s.folded = on ? new Set(s.headings.filter((h, i) => s.headings[i + 1] && s.headings[i + 1].level > h.level).map(h => h.offset)) : new Set(); host.renderOutline(s); },
    alwaysOnTop: () => guard(async () => { onTop = await api.alwaysOnTop(!onTop); status(onTop ? '窗口已置顶' : '已取消置顶'); }),
    isOnTop: () => onTop,
    zoom: delta => prefs.set('zoom', delta === 0 ? 1 : Math.max(0.5, Math.min(2.5, Math.round((prefs.get('zoom') + delta) * 100) / 100))),
    wordCount: s => D.openWordCount({ text: s.editor.text, selection: s.editor.selectedSource().text, anchor: s.ui.stats }),
    palette: s => D.openPalette({ reg, x: () => ctxOf(s), comboOf, run: id => runCommand(s, id) }),
    setTheme: id => { prefs.set('theme', id); },
    setCustomTheme: id => guard(async () => { prefs.set('customTheme', id); prefs.set('theme', 'custom'); await loadCustomCss(); }),
    themeFolder: () => guard(() => api.mdThemeFolder()),
    themeImport: () => guard(async () => { customThemes = await api.mdThemeImport(); status(customThemes.length ? `主题文件夹中有 ${customThemes.length} 个自定义主题，可在“主题”菜单选择` : '未导入主题'); }),
    quickStart: () => message('Markdown 快速入门', '· 直接输入 Markdown，块内实时显示格式；Ctrl+/ 切换源码模式。\n· Ctrl+Shift+P 打开命令面板，可搜索所有命令；Ctrl+P 快速打开文件。\n· 右上角切换“阅读 / 编辑 / 源码”：阅读模式只看排版，双击正文或按 E 开始编辑。\n· F8 专注模式，F9 打字机模式。\n· 表格里点击即出现表格工具条；点击图片可调整宽度。\n· 快捷键都能在“偏好设置 → 快捷键”中修改。\n· 打开“帮助 → Markdown 语法参考”查看所有语法。'),
  };
  const reg = buildRegistry(H);

  // ——— Shortcuts ———
  let eff = effectiveKeys(reg.list, prefs.get('shortcuts'));
  const rebuildKeys = () => { eff = effectiveKeys(reg.list, prefs.get('shortcuts')); };
  function comboOf(id) { const o = prefs.get('shortcuts')[id]; return o !== undefined ? o : (reg.get(id)?.keys || [])[0] || ''; }
  function runCommand(s, id) {
    const c = reg.get(id); if (!c || !s?.editor) return;
    const x = ctxOf(s);
    if (c.enabled && !c.enabled(x)) { status('此命令在当前位置不可用'); return; }
    if (!s.editor.root.contains(document.activeElement) && !c.noFocus && !/^(open|new|save|palette|preferences|export|theme|help)/.test(id)) s.editor.focus();
    return guard(async () => { await c.run(x); refreshBars(s); });
  }
  // Returned to the editor: an action function for a resolved combo, a no-op for a default combo the user has moved, else null.
  function resolveShortcut(e) {
    const combo = normalizeCombo(eventCombo(e)); if (!combo) return null;
    const s = getVisible(); if (!s) return null;
    const id = eff.map.get(combo);
    if (id) { const c = reg.get(id); if (!c) return null; if (c.displayOnly && prefs.get('shortcuts')[id] === undefined) return null; return () => runCommand(s, id); }
    if (eff.disabled.has(combo)) return () => {};
    return null;
  }
  // Same combos when focus is outside the editor (sidebar, body) while a Markdown tab is showing.
  document.addEventListener('keydown', e => {
    const s = getVisible(); if (!s || e.defaultPrevented || e.isComposing) return;
    if (e.target.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable="plaintext-only"], .mdModal')) return;
    const id = eff.map.get(normalizeCombo(eventCombo(e))); const c = id && reg.get(id);
    if (!c || (c.displayOnly && prefs.get('shortcuts')[id] === undefined)) return;
    if (!/^(openQuickly|palette|toggleSidebar|view|focusMode|typewriterMode|readonly|preferences|wordCount|sourceMode|zoom|new)/.test(id)) return;
    e.preventDefault(); e.stopPropagation(); runCommand(s, id);
  }, true);

  // ——— Prefs → UI ———
  function imageOptions() { const mode = prefs.get('imageInsert'); return { mode: mode === 'none' ? 'assets' : mode, folder: prefs.get('imageFolder') || 'assets', root: prefs.get('imageRoot') || '', copy: mode !== 'none' }; }
  async function loadCustomCss() {
    if (prefs.get('theme') !== 'custom' || !prefs.get('customTheme')) { customCss = ''; styleTag.textContent = ''; return; }
    try { customCss = await api.mdThemeRead(prefs.get('customTheme')); styleTag.textContent = scopeThemeCss(customCss, '.mdPanel[data-mdtheme="custom"]'); } catch (error) { customCss = ''; styleTag.textContent = ''; status('无法加载自定义主题：' + error.message); }
  }
  function applyEditor(s) {
    const ed = s.editor; if (!ed) return;
    ed.setReadonly(!!s.readonly); ed.setFocusMode(prefs.get('focusMode')); ed.setTypewriterMode(prefs.get('typewriterMode'));
    ed.setSpellcheck(prefs.get('spellcheck'));
    s.ui.panel.classList.toggle('isReadonly', !!s.readonly);
  }
  function setReadonly(s, on) { s.readonly = !!on; applyEditor(s); host.syncMode(s); }
  function applyPanel(s) {
    const p = s.ui.panel, v = k => prefs.get(k);
    p.dataset.mdtheme = v('theme'); p.style.setProperty('--md-size', v('fontSize') + 'px'); p.style.setProperty('--md-lh', String(v('lineHeight'))); p.style.setProperty('--md-width', v('pageWidth') + 'px'); p.style.setProperty('--md-zoom', String(v('zoom')));
    if (v('fontFamily')) { p.dataset.font = 'custom'; p.style.setProperty('--md-user-font', v('fontFamily')); } else { delete p.dataset.font; p.style.removeProperty('--md-user-font'); }
    p.classList.toggle('indentFirst', !!v('indentFirstLine')); p.classList.toggle('showBr', !!v('showBr'));
    p.classList.toggle('noMenubar', !v('menubar')); p.classList.toggle('noStatus', !v('statusBar'));
    applyEditor(s); syncSidebar(s);
  }
  let autoTimer = 0;
  function applyAuto() {
    clearInterval(autoTimer); autoTimer = 0;
    if (prefs.get('autoSave')) autoTimer = setInterval(() => { for (const s of sessions) if (s.kind === 'markdown' && s.loaded && s.path && !s.saving && host.isDirty(s) && !s.editor.readonly) app.save(s, false).catch(() => {}); }, Math.max(5, prefs.get('autoSaveSeconds') || 30) * 1000);
  }
  prefs.onChange(async name => {
    rebuildKeys();
    if (name === '*' || name === 'theme' || name === 'customTheme') await loadCustomCss();
    const key = JSON.stringify([prefs.get('smartPunctuation'), prefs.get('preserveBreaks')]);
    if (key !== renderKey) { renderKey = key; setRenderOptions({ smartPunctuation: prefs.get('smartPunctuation'), preserveBreaks: prefs.get('preserveBreaks') }); for (const s of sessions) if (s.editor) s.editor.refreshAll(); }
    for (const s of sessions) if (s.ui) applyPanel(s);
    if (name === 'autoSave' || name === 'autoSaveSeconds' || name === '*') applyAuto();
    if (name === 'outlineMode' || name === '*') for (const s of sessions) if (s.ui) host.renderOutline(s);
  });

  // ——— Sidebar panes (outline / files / recent) ———
  function setFolder(tree) { folder = tree; for (const s of sessions) if (s.ui) renderFiles(s); }
  const flatten = (tree, out = []) => { for (const n of tree?.children || []) n.type === 'file' ? out.push(n) : flatten(n, out); return out; };
  async function openPath(file) { const docs = await api.mdOpenPath(file); if (docs?.length) await addDocuments(docs); }
  async function openRecent(id) { const docs = await api.openRecent(id); if (docs?.length) await addDocuments(docs); }
  function syncSidebar(s) {
    const tab = prefs.get('sidebarTab') === 'files' ? 'files' : 'outline';
    for (const b of s.ui.sideTabs.querySelectorAll('button[data-tab]')) b.setAttribute('aria-selected', String(b.dataset.tab === tab));
    for (const p of s.ui.outline.querySelectorAll('.mdSidePane')) p.hidden = p.dataset.pane !== tab;
    if (tab === 'files') renderFiles(s);
  }
  function renderFiles(s) {
    const f = s.ui.files; if (!f) return;
    f.root.textContent = folder ? folder.root : ''; f.root.title = folder?.root || '';
    const rows = [];
    const walk = (nodes, depth) => {
      for (const n of nodes) {
        const b = el('button', 'mdFileItem'); b.style.setProperty('--depth', depth);
        if (n.type === 'dir') {
          const closed = collapsedDirs.has(n.path); b.append(el('span', 'mdFileGlyph', closed ? '▸' : '▾'), el('span', 'mdFileName', n.name));
          b.onclick = () => { closed ? collapsedDirs.delete(n.path) : collapsedDirs.add(n.path); for (const x of sessions) if (x.ui) renderFiles(x); };
          rows.push(b); if (!closed) walk(n.children, depth + 1);
        } else {
          b.classList.toggle('isCurrent', !!s.path && n.path.toLowerCase() === s.path.toLowerCase());
          b.append(el('span', 'mdFileGlyph', '¶'), el('span', 'mdFileName', n.name.replace(/\.[^.]+$/, ''))); b.title = n.path;
          b.onclick = () => guard(() => openPath(n.path));
          b.oncontextmenu = e => { e.preventDefault(); D.popupMenu(e.clientX, e.clientY, fileMenu(n)); };
          rows.push(b);
        }
      }
    };
    if (folder) walk(folder.children, 0);
    f.list.replaceChildren(...(rows.length ? rows : [el('p', 'mdFileEmpty', folder ? '此文件夹中没有 Markdown 文件。' : '还没有打开文件夹。点击上方“打开文件夹”，文件树只显示 Markdown 文件。')]));
  }
  const fileMenu = n => [
    { label: '打开', run: () => guard(() => openPath(n.path)) }, '-',
    { label: '重命名…', run: () => guard(() => fileOp({ path: n.path }, 'rename', undefined, null)) },
    { label: '创建副本', run: () => guard(() => fileOp({ path: n.path }, 'duplicate', undefined, null)) },
    { label: '移动到…', run: () => guard(() => fileOp({ path: n.path }, 'move', undefined, null)) }, '-',
    { label: '在资源管理器中显示', run: () => guard(() => fileOp({ path: n.path }, 'reveal')) },
    { label: '复制文件路径', run: () => guard(() => fileOp({ path: n.path }, 'copyPath')) }, '-',
    { label: '移到回收站…', run: () => guard(() => fileOp({ path: n.path }, 'trash')) },
  ];
  async function fileOp(target, op, arg, s) {
    if (op === 'rename' || op === 'duplicate' || op === 'move') { if (target.id && !s?.path && op !== 'duplicate') throw new Error('请先保存文档。'); }
    if (op === 'duplicate' && target.id && !s.path) throw new Error('请先保存文档，再创建副本。');
    if (op === 'rename') { const cur = s?.name || target.path.replace(/^.*[\\/]/, ''); const name = await D.promptText({ title: '重命名', label: '新的文件名：', value: cur }); if (!name || name === cur) return; arg = name; }
    const r = await api.mdFileOp(target, op, arg);
    if (r == null) return;
    if (op === 'copyPath') { await navigator.clipboard.writeText(r).catch(() => {}); status('已复制路径：' + r); return; }
    if (op === 'duplicate') { await addDocuments(r); status('已创建副本'); }
    if ((op === 'rename' || op === 'move') && r.path) {
      const open = [...sessions].find(x => x.id === r.id || (x.path && x.path.toLowerCase() === (target.path || '').toLowerCase()));
      if (open) { Object.assign(open, { name: r.name || r.path.replace(/^.*[\\/]/, ''), path: r.path }); open.editor.doc.setAttribute('aria-label', open.name); host.changed(open); }
      status('已' + (op === 'rename' ? '重命名' : '移动') + '：' + r.path);
    }
    if (op === 'trash' && r.trashed) status('已移到回收站');
    if (folder && ['rename', 'move', 'duplicate', 'trash'].includes(op)) { try { setFolder(await api.mdTree(folder.root)); } catch {} }
  }

  // ——— Images ———
  async function pickImage(s) {
    const files = await api.mdPickImageFiles(s.id); if (!files?.length) return;
    const paths = await api.mdImageImport(s.id, files, imageOptions());
    s.editor.focus(); for (const p of paths) s.editor.run('image', p, baseName(p));
  }
  const imageBar = el('div', 'mdImageBar'); imageBar.hidden = true; imageBar.setAttribute('role', 'toolbar'); imageBar.setAttribute('aria-label', '图片');
  const tableBar = el('div', 'mdTableBar'); tableBar.hidden = true; tableBar.setAttribute('role', 'toolbar'); tableBar.setAttribute('aria-label', '表格');
  document.body.append(imageBar, tableBar);
  imageBar.onmousedown = e => { if (e.target.tagName !== 'INPUT') e.preventDefault(); };
  tableBar.onmousedown = e => { if (e.target.tagName !== 'INPUT') e.preventDefault(); };
  const hideImageBar = () => { imageBar.hidden = true; };
  function showImageBar(s, img) {
    const info = s.editor.imageInfo(img); if (!info || s.editor.readonly) return hideImageBar();
    imageBar.replaceChildren();
    const btn = (label, fn, title) => { const b = el('button', '', label); if (title) b.title = title; b.onclick = () => { hideImageBar(); guard(async () => fn(info)); }; imageBar.append(b); };
    const width = el('input'); width.type = 'text'; width.value = info.width || ''; width.placeholder = '宽度'; width.title = '宽度，如 320 或 50%'; width.style.cssText = 'width:64px;height:26px;text-align:center;font-size:12px';
    width.onkeydown = e => { if (e.key === 'Enter') { e.preventDefault(); hideImageBar(); s.editor.setImageWidth(info, width.value.trim().replace(/px$/i, '')); } };
    imageBar.append(width);
    btn('25%', i => s.editor.setImageWidth(i, '25%')); btn('50%', i => s.editor.setImageWidth(i, '50%')); btn('100%', i => s.editor.setImageWidth(i, '100%')); btn('原始', i => s.editor.setImageWidth(i, ''), '恢复原始大小');
    btn(info.html ? '改用 Markdown 语法' : '改用 <img> 语法', i => s.editor.switchImageSyntax(i));
    if (s.path && !/^(https?:|data:)/i.test(info.src)) { btn('显示文件', i => api.mdImageOp(s.id, i.src, 'reveal')); btn('复制路径', async i => { const p = await api.mdImageOp(s.id, i.src, 'copyPath'); await navigator.clipboard.writeText(p).catch(() => {}); status('已复制：' + p); }); }
    btn('删除', i => s.editor.deleteImage(i), '从文档中删除此图片引用');
    imageBar.hidden = false;
    const r = img.getBoundingClientRect(), b = imageBar.getBoundingClientRect();
    imageBar.style.left = Math.max(8, Math.min(r.left, innerWidth - b.width - 8)) + 'px'; imageBar.style.top = Math.max(8, Math.min(r.bottom + 6, innerHeight - b.height - 8)) + 'px';
  }
  function imageMenu(s, img, x, y) {
    const info = s.editor.imageInfo(img); if (!info) return false;
    const local = s.path && !/^(https?:|data:)/i.test(info.src);
    D.popupMenu(x, y, [
      { label: '调整为 50% 宽度', run: () => s.editor.setImageWidth(info, '50%'), disabled: s.editor.readonly }, { label: '原始大小', run: () => s.editor.setImageWidth(info, ''), disabled: s.editor.readonly },
      { label: info.html ? '改用 Markdown 语法' : '改用 <img> 语法', run: () => s.editor.switchImageSyntax(info), disabled: s.editor.readonly }, '-',
      { label: '在资源管理器中显示', run: () => guard(() => api.mdImageOp(s.id, info.src, 'reveal')), disabled: !local },
      { label: '复制图片路径', run: () => guard(async () => { const p = await api.mdImageOp(s.id, info.src, 'copyPath'); await navigator.clipboard.writeText(p); status('已复制：' + p); }), disabled: !local }, '-',
      { label: '删除图片引用', run: () => s.editor.deleteImage(info), disabled: s.editor.readonly },
      { label: '将图片文件移到回收站…', run: () => guard(async () => { if (await api.mdImageOp(s.id, info.src, 'trash')) { s.editor.deleteImage(info); status('已移到回收站'); } }), disabled: !local || s.editor.readonly },
    ]);
    return true;
  }

  // ——— Table quick bar ———
  const TB = [['↑+', 'tableRowAbove', '在上方插入行'], ['↓+', 'tableRowBelow', '在下方插入行'], ['←+', 'tableColBefore', '在左侧插入列'], ['→+', 'tableColAfter', '在右侧插入列'], '-',
    ['行−', 'tableDeleteRow', '删除当前行'], ['列−', 'tableDeleteCol', '删除当前列'], '-', ['↑', 'tableRowUp', '上移该行'], ['↓', 'tableRowDown', '下移该行'], ['←', 'tableColLeft', '左移该列'], ['→', 'tableColRight', '右移该列'], '-',
    ['左', 'tableAlignLeft', '左对齐'], ['中', 'tableAlignCenter', '居中'], ['右', 'tableAlignRight', '右对齐'], '-', ['大小…', 'tableResize', '调整表格大小'], ['格式化', 'formatTable', '整理表格源码'], ['删除表', 'tableDelete', '删除整个表格']];
  function refreshTableBar(s) {
    const ed = s?.editor;
    if (!s || !ed || ed.sourceMode || ed.readonly || !ed.inTable?.() || s !== getVisible()) { tableBar.hidden = true; return; }
    const box = ed.tableBox(); if (!box) { tableBar.hidden = true; return; }
    if (!tableBar.childElementCount) {
      for (const it of TB) { if (it === '-') { tableBar.append(el('span', 'sep')); continue; } const [label, id, title] = it; const b = el('button', '', label); b.title = title; b.setAttribute('aria-label', title); b.dataset.cmd = id; b.onclick = () => runCommand(getVisible(), id); tableBar.append(b); }
    }
    const st = ed.tableState(); for (const b of tableBar.querySelectorAll('[data-cmd^="tableAlign"]')) b.setAttribute('aria-pressed', String(b.dataset.cmd === 'tableAlign' + ({ left: 'Left', center: 'Center', right: 'Right' })[st?.align || '']));
    tableBar.hidden = false;
    const view = ed.scroller.getBoundingClientRect(), b = tableBar.getBoundingClientRect();
    tableBar.style.left = Math.max(view.left + 6, Math.min(box.left, view.right - b.width - 6)) + 'px';
    tableBar.style.top = Math.max(view.top + 6, box.top - b.height - 6) + 'px';
  }
  function refreshBars(s) { refreshTableBar(s); }

  // ——— Export ———
  async function exportAs(s, fmt) {
    if (s.editor.active) s.editor.syncFromDom(true);
    const text = s.editor.text, info = FORMAT_INFO[fmt];
    status('正在导出 ' + (info?.name || fmt) + '…');
    if (isPandocFormat(fmt)) {
      const p = await api.mdPandocInfo(prefs.get('pandocPath'));
      if (!p.found) { await message('转换引擎不可用', '文档转换引擎缺失，请重新解压青页便携版。'); return; }
      const r = await api.mdPandocExport(s.id, fmt, text, prefs.get('pandocPath')); status(r ? '已导出到 ' + r.path : '已取消导出'); return;
    }
    const needCss = ['html', 'pdf', 'image'].includes(fmt);
    const built = await buildExport(fmt, { text, name: s.name, prefs: prefs.values, katexCss: needCss ? await api.mdKatexCss() : '', custom: prefs.get('theme') === 'custom' ? customCss : '', resolveAsset: src => api.markdownAsset(s.id, src) });
    let r;
    if (built.kind === 'pdf') r = await api.mdExportPdf(s.id, built.html, { pageSize: prefs.get('pdfPageSize'), margin: MARGINS[prefs.get('pdfMargin')] ?? 20, landscape: prefs.get('pdfLandscape'), pageNumbers: prefs.get('pdfHeaderFooter'), background: prefs.get('pdfBackground') });
    else if (built.kind === 'image') r = await api.mdExportImage(s.id, built.html, { width: prefs.get('pageWidth') + 80 });
    else r = await api.mdExportSave(s.id, built.ext, built.data, '导出为 ' + (info?.name || fmt));
    status(r ? '已导出到 ' + r.path : '已取消导出');
  }

  // ——— Menu bar & panel wiring ———
  function dynamic(kind) {
    if (kind === 'recent') return recentCache.map(r => ({ label: r.name, run: () => guard(() => openRecent(r.id)) }));
    return customThemes.map(t => ({ label: t.name, checked: prefs.get('theme') === 'custom' && prefs.get('customTheme') === t.id, run: () => H.setCustomTheme(t.id) }));
  }
  let recentCache = [];
  const refreshRecent = async () => { try { recentCache = (await api.recent()).filter(r => isMd(r.path)).slice(0, 12); } catch {} };
  function attach(s) {
    const u = s.ui;
    u.menubar = D.buildMenubar({ reg, comboOf, x: () => ctxOf(s), run: id => runCommand(s, id), dynamic, extras: u.topTools });
    u.menubar.addEventListener('pointerdown', () => { refreshRecent(); }, true);
    u.host.parentElement.insertBefore(u.menubar, u.host.parentElement.firstChild);
    u.stats.onclick = () => H.wordCount(s);
    u.host.addEventListener('click', e => { if (e.target.tagName === 'IMG' && !e.target.closest('.mdMermaid')) setTimeout(() => showImageBar(s, e.target), 0); else if (!imageBar.contains(e.target)) hideImageBar(); });
    u.host.addEventListener('scroll', () => { hideImageBar(); refreshTableBar(s); }, true);
    u.files.open.onclick = () => H.openFolder(s); u.files.refresh.onclick = () => guard(async () => { if (folder) setFolder(await api.mdTree(folder.root)); });
    for (const b of u.sideTabs.querySelectorAll('button[data-tab]')) b.onclick = () => H.showSidebar(s, b.dataset.tab);
    applyPanel(s);
  }
  function detach(s) { s.ui.menubar?.destroy?.(); s.ui.menubar?.remove(); if (getVisible() === s) { tableBar.hidden = true; hideImageBar(); } }
  function show(s) { tableBar.hidden = !s; if (!s) { hideImageBar(); return; } applyPanel(s); refreshTableBar(s); refreshRecent(); }
  function onSpell({ word, suggestions }) {
    const menu = document.getElementById('mdContextMenu'); if (!menu || menu.hidden) return;
    const s = getVisible(); const first = menu.firstChild;
    const items = [...suggestions.map(w => { const b = D.el('button', 'menuItem', w); b.style.fontWeight = '600'; b.onclick = () => { menu.hidden = true; s.editor.focus(); api.spellReplace(w); }; return b; }),
      (() => { const b = D.el('button', 'menuItem', `将“${word}”添加到词典`); b.onclick = () => { menu.hidden = true; api.spellLearn(word); }; return b; })(), (() => { const d = D.el('div', 'menuSep'); d.setAttribute('role', 'separator'); return d; })()];
    for (const b of items) { if (b.classList.contains('menuItem')) { b.setAttribute('role', 'menuitem'); b.tabIndex = -1; } menu.insertBefore(b, first); }
    if (!suggestions.length) { const n = D.el('div', 'menuLabel', '没有拼写建议'); menu.insertBefore(n, menu.firstChild); }
  }
  // Init
  (async () => {
    try { customThemes = await api.mdThemes(); } catch {}
    await loadCustomCss(); renderKey = JSON.stringify([prefs.get('smartPunctuation'), prefs.get('preserveBreaks')]);
    setRenderOptions({ smartPunctuation: prefs.get('smartPunctuation'), preserveBreaks: prefs.get('preserveBreaks') });
    applyAuto(); refreshRecent();
  })();
  document.addEventListener('pointerdown', e => { if (!tableBar.contains(e.target)) { /* keep: bar follows selection */ } if (!imageBar.contains(e.target) && e.target.tagName !== 'IMG') hideImageBar(); }, true);

  return {
    prefs, reg, H, syncSidebar, attach, setReadonly, detach, show, resolveShortcut, imageMenu, onSpell, runCommand, refreshBars, imageOptions, hideImageBar,
    editorPrefs: prefs.values,
    selectionChanged: s => { if (s === getVisible()) refreshTableBar(s); },
    beforeSave(s) { if (prefs.get('finalNewline') && s.editor.text && !s.editor.text.endsWith('\n')) { const n = s.editor.text.length; s.editor.apply([{ from: n, to: n, insert: '\n' }], s.editor.sel, { group: 'save', focus: false, activate: false }); } },
    imageOptionsFor: imageOptions,
  };
}
