// Markdown tabs inside Qingye: panel, outline sidebar, find & replace, external-change banner,
// status pill, context menu, local images, links, printing, saving and state.
import { menuItem, menuLabel, menuSep, menuKeys } from '../chrome.mjs';
import { slug } from './parser.mjs';
import { countWords } from './commands.mjs';
import { createTypora } from './typora-ui.mjs';
import { parseSourceFragment } from '../source-links.mjs';

const debounce = (fn, ms) => { let t; const d = (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; d.cancel = () => clearTimeout(t); return d; };

// Fence-aware heading scan (fast enough to run while typing).
export function scanHeadings(text) {
  const headings = [], lines = text.split('\n');
  let offset = 0, fence = null, math = false, front = lines[0]?.trimEnd() === '---';
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i], start = offset; offset += line.length + 1;
    if (front) { if (i > 0 && /^(---|\.\.\.)\s*$/.test(line)) front = false; continue; }
    const f = /^\s{0,3}(`{3,}|~{3,})/.exec(line);
    if (fence) { if (f && f[1][0] === fence[0] && f[1].length >= fence.length && !line.slice(f[0].length).trim()) fence = null; continue; }
    if (f) { fence = f[1]; continue; }
    if (/^\s{0,3}\$\$\s*$/.test(line)) { math = !math; continue; }
    if (math) continue;
    const atx = /^\s{0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/.exec(line);
    if (atx) { headings.push({ level: atx[1].length, text: clean(atx[2] || ''), offset: start }); continue; }
    const next = lines[i + 1];
    if (next !== undefined && line.trim() && !/^\s{0,3}([-*+>]|\d+[.)]|\|)/.test(line) && /^\s{0,3}(=+|-+)\s*$/.test(next) && (i === 0 || !lines[i - 1].trim())) headings.push({ level: next.trim()[0] === '=' ? 1 : 2, text: clean(line), offset: start });
  }
  return headings;
}
const clean = text => text.replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1').replace(/\[([^\]]+)\]\([^)]*\)/g, '$1').replace(/[*_~`]+/g, '').replace(/\\(.)/g, '$1').trim() || '（无标题）';

export function createMarkdownHost({ api, guard, status, message, onChange, addDocuments, workspace,navigate=action=>action(),onPdfLink }) {
  let editorModule = null;
  const load = async () => (editorModule ||= await import('./editor.mjs'));
  const sessions = new Set();
  let visible = null;

  // ——— Context menu ———
  const menu = document.createElement('div');
  menu.id = 'mdContextMenu'; menu.className = 'mdMenu'; menu.hidden = true; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'Markdown 编辑');
  document.body.append(menu);
  const hideMenu = () => { menu.hidden = true; };
  menuKeys(menu, () => { hideMenu(); visible?.editor.focus(); });
  document.addEventListener('pointerdown', e => { if (!menu.contains(e.target)) hideMenu(); }, true);
  window.addEventListener('blur', hideMenu);

  function openMenu(s, x, y) {
    const editor = s.editor, range = getSelection().rangeCount ? getSelection().getRangeAt(0).cloneRange() : null;
    const restore = () => { if (range && !editor.active) { const sel = getSelection(); sel.removeAllRanges(); sel.addRange(range); editor.doc.focus({ preventScroll: true }); } else editor.focus(); };
    const act = (fn, { keepMenu } = {}) => () => { if (!keepMenu) hideMenu(); restore(); return guard(async () => fn()); };
    const item = (label, icon, fn, opts = {}) => { const b = menuItem(label, { icon, shortcut: opts.shortcut, role: opts.role, checked: opts.checked }); b.onclick = act(fn); b.disabled = !!opts.disabled; return b; };
    const grid = (...items) => { const g = document.createElement('div'); g.className = 'menuGrid cols3'; g.append(...items); return g; };
    const run = (cmd, ...args) => () => editor.run(cmd, ...args);
    const quick = document.createElement('div'); quick.className = 'menuQuick';
    quick.append(item('撤销', 'undo', () => editor.undo(), { disabled: !editor.canUndo }), item('重做', 'redo', () => editor.redo(), { disabled: !editor.canRedo }),
      item('剪切', 'cut', () => api.editCommand('cut')), item('复制', 'copy', () => api.editCommand('copy')), item('粘贴', 'paste', () => api.editCommand('paste')));
    menu.replaceChildren(quick);
    const source = editor.sourceMode;
    if (!source && !s.readonly) {
      menu.append(menuLabel('格式'), grid(item('加粗', 'bold', run('bold'), { shortcut: 'Ctrl+B' }), item('斜体', 'italic', run('italic'), { shortcut: 'Ctrl+I' }), item('删除线', 'strike', run('strike')),
        item('行内代码', 'code', run('code')), item('链接', 'link', run('link'), { shortcut: 'Ctrl+K' }), item('行内公式', 'sigma', run('inlineMath'))));
      menu.append(menuLabel('段落'), grid(item('标题 1', 'h1', run('heading', 1), { shortcut: 'Ctrl+1' }), item('标题 2', 'h2', run('heading', 2)), item('标题 3', 'h3', run('heading', 3)),
        item('正文', 'pilcrow', run('heading', 0), { shortcut: 'Ctrl+0' }), item('引用', 'quote', run('quote')), item('无序列表', 'bullets', run('bullet')),
        item('有序列表', 'numbers', run('ordered')), item('任务列表', 'checkbox', run('task'))));
      menu.append(menuLabel('插入'), grid(item('表格', 'table', run('table'), { shortcut: 'Ctrl+T' }), item('代码块', 'braces', run('codeBlock')), item('公式块', 'sigma', run('mathBlock')),
        item('图片…', 'image', () => typora.H.pickImage(s)), item('分隔线', 'minus', run('rule'))));
      if (editor.inTable()) menu.append(menuLabel('表格'), grid(item('格式化', 'table', run('formatTable')), item('添加行', 'plus', run('tableRow')), item('添加列', 'plus', run('tableColumn')), item('删除行', 'trash', run('tableDeleteRow'))));
    }
    menu.append(menuSep(), item('查找与替换…', 'search', () => openFind(s, true), { shortcut: 'Ctrl+H' }),
      s.readonly ? item('开始编辑', 'pen', () => setViewMode(s, 'live'), { shortcut: 'E' }) : item('阅读模式', 'view', () => setViewMode(s, 'read')),
      item('源代码模式', 'code', () => setSource(s, !editor.sourceMode), { shortcut: 'Ctrl+/', role: 'menuitemcheckbox', checked: editor.sourceMode }),
      item('命令面板…', 'more', () => typora.H.palette(s), { shortcut: 'Ctrl+Shift+P' }));
    menu.hidden = false;
    const size = menu.getBoundingClientRect();
    menu.style.left = Math.max(8, Math.min(x, innerWidth - size.width - 8)) + 'px';
    menu.style.top = Math.max(8, Math.min(y, innerHeight - size.height - 8)) + 'px';
    menu.querySelector('.menuItem:not(:disabled)')?.focus();
  }

  // ——— Panel ———
  function buildPanel(s) {
    const panel = document.createElement('div');
    panel.className = 'viewerPanel mdPanel';
    panel.innerHTML = `
      <aside class="mdOutline" aria-label="侧边栏">
        <div class="mdSideTabs" role="tablist">
          <button role="tab" data-tab="outline" aria-selected="true">大纲</button>
          <button role="tab" data-tab="files" aria-selected="false">文件</button>
        </div>
        <div class="mdSidePane" data-pane="outline">
          <input class="mdOutlineFilter" type="search" placeholder="筛选标题" aria-label="筛选标题">
          <nav class="mdOutlineList" aria-label="标题"></nav>
          <p class="mdOutlineEmpty">没有标题。以 # 开头的行会出现在这里。</p>
        </div>
        <div class="mdSidePane" data-pane="files" hidden>
          <div class="mdFileTools"><button class="mdFilesOpen">打开文件夹…</button><button class="mdFilesRefresh" aria-label="刷新文件树" title="刷新">刷新</button></div>
          <div class="mdFileRoot"></div>
          <div class="mdFileList" role="tree" aria-label="文件"></div>
        </div>
      </aside>
      <div class="mdMain">
        <div class="mdFindBar" role="search" hidden>
          <div class="mdFindRow">
            <button class="mdFindToggleReplace" data-icon="right" title="显示替换" aria-label="显示替换" aria-expanded="false"></button>
            <input class="mdFindInput" type="text" placeholder="查找" aria-label="查找">
            <span class="mdFindCount" aria-live="polite"></span>
            <button class="mdFindOpt" data-opt="caseSensitive" title="区分大小写" aria-label="区分大小写" aria-pressed="false">Aa</button>
            <button class="mdFindOpt" data-opt="wholeWord" title="全词匹配" aria-label="全词匹配" aria-pressed="false">ab</button>
            <button class="mdFindOpt" data-opt="regex" title="正则表达式" aria-label="正则表达式" aria-pressed="false">.*</button>
            <button class="mdFindPrev" data-icon="up" title="上一个 · Shift+Enter" aria-label="上一个"></button>
            <button class="mdFindNext" data-icon="down" title="下一个 · Enter" aria-label="下一个"></button>
            <button class="mdFindClose" data-icon="x" title="关闭 · Esc" aria-label="关闭查找"></button>
          </div>
          <div class="mdFindRow mdReplaceRow" hidden>
            <span class="mdFindSpacer"></span>
            <input class="mdReplaceInput" type="text" placeholder="替换为" aria-label="替换为">
            <button class="mdReplaceOne">替换</button>
            <button class="mdReplaceAll">全部替换</button>
          </div>
        </div>
        <div class="mdBanner" role="alert" hidden><span class="mdBannerText"></span><span class="spacer"></span></div>
        <div class="mdProgress" aria-hidden="true"><i></i></div>
        <div class="mdEditorHost"></div>
        <footer class="mdStatusBar">
          <span class="mdStatusMsg" role="status"></span>
          <span class="spacer"></span>
          <button class="mdStats" title="字数统计"></button>
          <span class="mdStatusInfo"></span>
        </footer>
      </div>`;
    // Controls that live in the Markdown top bar (built by the Typora layer around the menus).
    const tool = (icon, title, cls) => { const b = document.createElement('button'); b.className = 'mdMenuIcon ' + cls; b.dataset.icon = icon; b.title = title; b.setAttribute('aria-label', title.replace(/ · .*/, '')); b.onmousedown = e => e.preventDefault(); return b; };
    const modes = document.createElement('div'); modes.className = 'segmented mdModes'; modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', '视图模式');
    for (const [mode, label, title] of [['read', '阅读', '阅读模式：只看排版好的文档，不会误改内容'], ['live', '编辑', '所见即所得编辑'], ['source', '源码', '源代码 · Ctrl+/']]) {
      const b = document.createElement('button'); b.dataset.mode = mode; b.textContent = label; b.title = title; b.setAttribute('aria-pressed', String(mode === 'live')); b.onmousedown = e => e.preventDefault(); modes.append(b);
    }
    const save = tool('save', '保存 · Ctrl+S', 'mdSaveButton'); save.append(Object.assign(document.createElement('span'), { className: 'label', textContent: '保存' }));
    const aiToggle = tool('sparkle', 'AI 协作 · Ctrl+Shift+A', 'aiToggle'); aiToggle.setAttribute('aria-pressed', String(document.body.classList.contains('aiOpen'))); aiToggle.onclick = () => window.dispatchEvent(new Event('qingye:ai-toggle'));
    const topTools = [tool('search', '查找与替换 · Ctrl+F', 'mdFindButton'), tool('outline', '侧边栏 · Ctrl+Shift+L', 'mdOutlineToggle'), modes, tool('more', '命令面板 · Ctrl+Shift+P', 'mdPaletteButton'), aiToggle, save];
    const $ = sel => panel.querySelector(sel);
    s.ui = { panel, outline: $('.mdOutline'), list: $('.mdOutlineList'), filter: $('.mdOutlineFilter'), count: { textContent: '' }, empty: $('.mdOutlineEmpty'), sideTabs: $('.mdSideTabs'),
      files: { root: $('.mdFileRoot'), list: $('.mdFileList[role=tree]'), open: $('.mdFilesOpen'), refresh: $('.mdFilesRefresh') }, recent: { list: $('.mdRecentList') },
      find: $('.mdFindBar'), findInput: $('.mdFindInput'), replaceInput: $('.mdReplaceInput'), findCount: $('.mdFindCount'), replaceRow: $('.mdReplaceRow'),
      banner: $('.mdBanner'), bannerText: $('.mdBannerText'), host: $('.mdEditorHost'), stats: $('.mdStats'), info: $('.mdStatusInfo'), msg: $('.mdStatusMsg'), progress: $('.mdProgress > i'),
      topTools, outlineToggle: topTools[1], modes, saveButton: save, findButton: topTools[0], paletteButton: topTools[3] };
    s.ui.outlineToggle.onclick = () => toggleOutline(s);
    s.ui.outlineToggle.setAttribute('aria-pressed', 'true');
    s.ui.findButton.onclick = () => s.ui.find.hidden ? openFind(s, false) : closeFind(s);
    s.ui.paletteButton.onclick = () => typora.H.palette(s);
    save.onclick = () => guard(() => window.qingye?.saveSession(s, false));
    for (const b of modes.querySelectorAll('button')) b.onclick = () => setViewMode(s, b.dataset.mode);
    s.ui.filter.oninput = () => renderOutline(s);
    s.ui.list.addEventListener('keydown', e => {
      const items = [...s.ui.list.querySelectorAll('button')], i = items.indexOf(document.activeElement);
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); items[Math.max(0, Math.min(items.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))]?.focus(); }
    });
    bindFind(s);
    return panel;
  }

  // ——— Outline ———
  function renderOutline(s) {
    const term = s.ui.filter.value.trim().toLowerCase(), tree = typora.prefs.get('outlineMode') !== 'flat' && !term;
    s.folded ||= new Set();
    const hs = s.headings, min = Math.min(...hs.map(h => h.level), 6), rows = [];
    const hasKids = i => hs[i + 1] && hs[i + 1].level > hs[i].level;
    let hideBelow = null;
    hs.forEach((h, i) => {
      if (hideBelow != null) { if (h.level > hideBelow) return; hideBelow = null; }
      if (term && !h.text.toLowerCase().includes(term)) return;
      const b = document.createElement('button');
      b.className = 'mdOutlineItem'; b.style.setProperty('--depth', h.level - min); b.dataset.level = h.level; b.dataset.offset = h.offset;
      if (tree && hasKids(i)) {
        const fold = document.createElement('span'); fold.className = 'mdFold'; fold.textContent = '▾'; fold.setAttribute('aria-hidden', 'true');
        const folded = s.folded.has(h.offset); b.classList.toggle('isFolded', folded); b.setAttribute('aria-expanded', String(!folded));
        fold.onclick = e => { e.stopPropagation(); folded ? s.folded.delete(h.offset) : s.folded.add(h.offset); renderOutline(s); };
        b.append(fold); if (folded) hideBelow = h.level;
      }
      b.append(document.createTextNode(h.text)); b.title = h.text;
      b.onclick = () => guard(()=>navigate(()=>{ s.editor.scrollToOffset(h.offset); markCurrentHeading(s, h.offset); }));
      rows.push(b);
    });
    s.ui.list.replaceChildren(...rows);
    s.ui.empty.hidden = hs.length > 0;
    markCurrentHeading(s);
  }
  function markCurrentHeading(s, forced) {
    if (s.ui.outline.hidden || !s.headings.length || !typora.prefs.get('highlightHeading')) return;
    let current = forced;
    if (current == null) {
      if (s.editor.sourceMode) { const pos = s.editor.sel.from; current = [...s.headings].reverse().find(h => h.offset <= pos)?.offset; }
      else {
        const top = s.editor.scroller.getBoundingClientRect().top + 90;
        for (const h of s.headings) { const el = s.editor.elementAt(h.offset); if (!el) continue; if (el.getBoundingClientRect().top <= top) current = h.offset; else break; }
        current ??= s.headings[0].offset;
      }
    }
    for (const b of s.ui.list.children) { const on = Number(b.dataset.offset) === current; b.classList.toggle('isCurrent', on); if (on) b.setAttribute('aria-current', 'location'); else b.removeAttribute('aria-current'); }
  }
  function toggleOutline(s, force) {
    const show = force ?? s.ui.outline.hidden;
    s.ui.outline.hidden = !show;
    s.ui.outlineToggle.setAttribute('aria-pressed', String(show));
    s.ui.outlineToggle.setAttribute('aria-label', show ? '隐藏大纲' : '显示大纲');
    if (show) { renderOutline(s); typora.syncSidebar(s); }
    onChange(s, { chrome: true });
  }

  // ——— Find & replace ———
  const findOptions = s => ({ query: s.ui.findInput.value, ...Object.fromEntries([...s.ui.find.querySelectorAll('.mdFindOpt')].map(b => [b.dataset.opt, b.getAttribute('aria-pressed') === 'true'])) });
  function showCount(s, result) {
    const el = s.ui.findCount;
    el.classList.toggle('isError', !!result.error || (!!s.ui.findInput.value && !result.total));
    el.textContent = result.error ? '无效' : !s.ui.findInput.value ? '' : result.total ? `${result.index + 1} / ${result.total}` : '无结果';
    el.title = result.error || '';
  }
  function bindFind(s) {
    const u = s.ui, update = debounce(() => showCount(s, s.editor.setSearch(findOptions(s))), 120);
    u.findInput.addEventListener('input', update);
    for (const b of u.find.querySelectorAll('.mdFindOpt')) b.onclick = () => { b.setAttribute('aria-pressed', String(b.getAttribute('aria-pressed') !== 'true')); showCount(s, s.editor.setSearch(findOptions(s))); u.findInput.focus(); };
    const step = dir => { s.editor.setSearch(findOptions(s)); showCount(s, s.editor.findStep(dir)); };
    u.find.querySelector('.mdFindNext').onclick = () => step(1);
    u.find.querySelector('.mdFindPrev').onclick = () => step(-1);
    u.find.querySelector('.mdFindClose').onclick = () => closeFind(s);
    u.find.querySelector('.mdFindToggleReplace').onclick = () => setReplaceVisible(s, u.replaceRow.hidden);
    u.find.querySelector('.mdReplaceOne').onclick = () => guard(() => { s.editor.setSearch(findOptions(s)); showCount(s, s.editor.replaceCurrent(u.replaceInput.value)); });
    u.find.querySelector('.mdReplaceAll').onclick = () => guard(() => { s.editor.setSearch(findOptions(s)); const n = s.editor.replaceEvery(u.replaceInput.value); status(n ? `已替换 ${n} 处 · 可撤销` : '没有可替换的内容'); showCount(s, s.editor.setSearch(findOptions(s))); });
    u.find.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); closeFind(s); }
      else if (e.key === 'Enter' && e.target === u.findInput) { e.preventDefault(); step(e.shiftKey ? -1 : 1); }
      else if (e.key === 'Enter' && e.target === u.replaceInput) { e.preventDefault(); u.find.querySelector(e.ctrlKey || e.metaKey ? '.mdReplaceAll' : '.mdReplaceOne').click(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'h') { e.preventDefault(); setReplaceVisible(s, true); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') { e.preventDefault(); u.findInput.select(); }
    });
  }
  function setReplaceVisible(s, on) {
    s.ui.replaceRow.hidden = !on;
    const t = s.ui.find.querySelector('.mdFindToggleReplace');
    t.dataset.icon = on ? 'down' : 'right'; t.setAttribute('aria-expanded', String(on)); t.setAttribute('aria-label', on ? '隐藏替换' : '显示替换');
    (on ? s.ui.replaceInput : s.ui.findInput).focus();
  }
  function openFind(s, replace = false) {
    const u = s.ui, sel = s.editor.currentSelection(), picked = s.editor.text.slice(sel.from, sel.to);
    u.find.hidden = false;
    if (picked && !picked.includes('\n') && picked.length < 200) u.findInput.value = picked;
    setReplaceVisible(s, replace || !u.replaceRow.hidden);
    if (!replace) { u.findInput.focus(); }
    u.findInput.select();
    showCount(s, s.editor.setSearch(findOptions(s)));
    syncChrome(s);
  }
  function closeFind(s) { s.ui.find.hidden = true; s.editor.clearSearch(); s.editor.focus(); syncChrome(s); }

  // ——— Status pill & stats ———
  function updateStats(s) {
    const { words } = countWords(s.editor.text);
    const minutes = Math.max(1, Math.round(words / 400));
    if (s.readonly && !s.editor.sourceMode) s.ui.stats.textContent = `${words.toLocaleString('zh-CN')} 字 · 约 ${minutes} 分钟读完`;
    else {
      const pos = s.editor.sel.from, before = s.editor.text.slice(0, pos);
      const line = before.split('\n').length, column = pos - before.lastIndexOf('\n');
      s.ui.stats.textContent = `${words.toLocaleString('zh-CN')} 字 · 行 ${line}, 列 ${column}`;
    }
    s.ui.stats.title = `${words} 字 · 共 ${s.editor.text.split('\n').length} 行 · 点击查看字数统计`;
    s.ui.info.textContent = `${s.encodingLabel} · ${s.eol === '\r\n' ? 'CRLF' : 'LF'}`;
  }
  function updateProgress(s) {
    const el = s.editor.sourceMode ? s.editor.sourceView : s.editor.scroller, max = el.scrollHeight - el.clientHeight;
    s.ui.progress.style.transform = `scaleX(${max > 0 ? Math.min(1, el.scrollTop / max) : 0})`;
  }
  function setSource(s, on) {
    if (on && s.readonly) typora.setReadonly(s, false);
    s.editor.setSourceMode(on);
  }
  const modeOf = s => s.editor.sourceMode ? 'source' : s.readonly ? 'read' : 'live';
  // Three mutually exclusive views: read (rendered, read-only), live (WYSIWYG) and source.
  function setViewMode(s, mode) {
    s.editor.visualTables?.finish();
    if (modeOf(s) === mode) return;
    if (mode === 'source') { setSource(s, true); return; }
    if (s.editor.sourceMode) s.editor.setSourceMode(false);
    typora.setReadonly(s, mode === 'read');
  }
  function syncMode(s) {
    const mode = modeOf(s);
    if (s.lastMode && s.lastMode !== mode && s === visible) status({ read: '阅读模式 · 双击正文或按 E 开始编辑', live: '编辑模式 · 单击段落即可编辑', source: '源码模式 · Ctrl+/ 返回编辑' }[mode]);
    s.lastMode = mode;
    for (const b of s.ui.modes.querySelectorAll('button')) b.setAttribute('aria-pressed', String(b.dataset.mode === mode));
    s.ui.panel.classList.toggle('isSource', mode === 'source');
    s.ui.panel.classList.toggle('isReading', mode === 'read');
    markCurrentHeading(s); updateStats(s); updateProgress(s);
    onChange(s, { chrome: true });
  }

  // ——— Banner (external changes) ———
  function banner(s, text, actions) {
    const u = s.ui;
    u.bannerText.textContent = text;
    for (const b of u.banner.querySelectorAll('button')) b.remove();
    for (const [label, fn, primary] of actions) { const b = document.createElement('button'); b.textContent = label; if (primary) b.className = 'primary'; b.onclick = () => guard(async () => { u.banner.hidden = true; await fn(); }); u.banner.append(b); }
    u.banner.hidden = false;
  }
  async function reloadFromDisk(s) {
    const { text, notice } = await api.reloadMarkdown(s.id);
    s.editor.replaceAll(text);
    s.savedText = text; s.orphaned = false; s.recovered = false;
    s.ui.banner.hidden = true;
    s.imageCache.clear();
    onChange(s);
    status('已载入磁盘上的最新版本' + (s.editor.canUndo ? ' · Ctrl+Z 可恢复之前的内容' : '') + (notice ? ' · ' + notice : ''));
  }
  async function external(s, state) {
    if (state === 'deleted') {
      s.orphaned = true; onChange(s);
      banner(s, '磁盘上的文件已被移动或删除。保存时会重新创建该文件，也可以另存为新文件。', [['另存为…', () => window.qingye?.saveSession(s, true), true], ['知道了', () => {}]]);
      return;
    }
    if (!isDirty(s)) { await reloadFromDisk(s); return; }
    banner(s, '此文件已被其他程序修改，而青页中有未保存的修改。', [['载入磁盘版本（可撤销）', () => reloadFromDisk(s), true], ['保留我的版本', () => status('已保留当前内容；保存时会再次确认是否覆盖。')]]);
  }

  // ——— Images & links ———
  function resolveImage(s, src) {
    if (!s.imageCache.has(src)) s.imageCache.set(src, api.markdownAsset(s.id, src).then(r => r ? URL.createObjectURL(new Blob([r.bytes], { type: r.type })) : null).catch(() => null));
    return s.imageCache.get(src);
  }
  async function openLink(s,href){return navigate(()=>openLinkInner(s,href));}
  async function openLinkInner(s, href) {
    if(href.startsWith('#qingye-source-')){const point=JSON.parse(decodeURIComponent(href.slice('#qingye-source-'.length)));if(onPdfLink)return onPdfLink(point);return;}
    if (!href) return;
    const result = await api.markdownOpenLink(s.id, href);
    if (result?.opened?.length) await addDocuments(result.opened);
    const anchor = result?.anchor;
    if (anchor != null && anchor !== '') {
      const source=parseSourceFragment(anchor);if(source&&result.opened?.length&&onPdfLink){await onPdfLink({...source,id:result.opened[0].id});return;}
      const target = result.opened?.length ? [...sessions].find(x => x.id === result.opened[0].id) : s;
      const heading = target?.headings?.find(h => slug(h.text) === slug(anchor) || h.text === anchor);
      if (heading) target.editor.scrollToOffset(heading.offset); else status('未找到标题：' + anchor);
    } else if (result?.revealed) status('已在资源管理器中显示链接的文件');
  }

  // ——— Printing ———
  async function print(s) {
    const { renderDocumentHtml, sanitize } = await import('./parser.mjs');
    const frame = document.createElement('iframe');
    frame.className = 'mdPrintFrame'; frame.setAttribute('aria-hidden', 'true');
    frame.srcdoc = `<!doctype html><html lang="zh-CN"><head><meta charset="utf-8"><title>${s.name.replace(/[<&]/g, '')}</title><link rel="stylesheet" href="../vendor/markdown/katex/katex.min.css"><link rel="stylesheet" href="markdown.css"></head><body class="mdPrint"><article class="mdDoc"></article></body></html>`;
    document.body.append(frame);
    await new Promise(resolve => { frame.onload = resolve; });
    const doc = frame.contentDocument, article = doc.querySelector('article');
    article.append(doc.importNode(sanitize(renderDocumentHtml(s.editor.text)), true));
    await Promise.all([...article.querySelectorAll('img')].map(async img => { const src = img.getAttribute('src') || ''; if (/^(https?:)/i.test(src)) { img.remove(); return; } if (!/^(data:|blob:)/i.test(src)) { const url = await resolveImage(s, src); if (url) img.src = url; else img.remove(); } await img.decode?.().catch(() => {}); }));
    for (const el of article.querySelectorAll('.mdCopy, input.mdTask')) el.type === 'checkbox' ? el.setAttribute('disabled', '') : el.remove();
    if (article.querySelector('.mdMermaid')) {
      const { renderDiagrams } = await import('./diagrams.mjs');
      const staging = document.createElement('div'); staging.className = 'mdPrintStaging';
      staging.append(...article.childNodes); document.body.append(staging);
      await renderDiagrams(staging, { dark: false, fit: false });
      article.append(...[...staging.childNodes].map(n => doc.importNode(n, true))); staging.remove();
    }
    await doc.fonts?.ready;
    frame.contentWindow.addEventListener('afterprint', () => setTimeout(() => frame.remove(), 200));
    frame.contentWindow.print();
    setTimeout(() => frame.isConnected && frame.remove(), 60000);
  }

  // ——— Typora-style layer ———
  const typora = createTypora({ api, guard, status, message, sessions, getVisible: () => visible, addDocuments,
    app: { newMarkdown: () => window.qingye?.newMarkdown?.() ?? api.newMarkdown().then(addDocuments), open: () => window.qingye?.open?.(), save: (s, saveAs) => window.qingye.saveSession(s, saveAs), example: () => api.markdownExample().then(addDocuments) },
    host: { openFind, setSource, setViewMode, syncMode, print, reload: reloadFromDisk, toggleOutline, renderOutline, isDirty: s => isDirty(s), changed: s => onChange(s, { chrome: true }) } });

  // ——— Public API ———
  const isDirty = s => !!s.recovered || !!s.orphaned || !!s.forceDirty || (s.editor ? s.editor.text !== s.savedText || s.editor.visualTables?.pendingDirty : false);
  async function create(info) {
    const { MarkdownEditor } = await load();
    const s = { ...info, kind: 'markdown', loaded: false, dirty: !!info.recovered||!!info.unsaved, forceDirty:!!info.unsaved,saving: false, savedText: info.recovered ? null : info.text, imageCache: new Map(), headings: [], encodingLabel: 'UTF-8' };
    s.panel = buildPanel(s);
    workspace.append(s.panel);
    const state = info.state || {};
    const refreshOutline = debounce(() => { s.headings = scanHeadings(s.editor.text); if (!s.ui.outline.hidden) renderOutline(s); }, 250);
    const refreshStats = debounce(() => updateStats(s), 200);
    s.editor = new MarkdownEditor(s.ui.host, {
      text: info.text, label: s.name,
      resolveImage: src => resolveImage(s, src), prefs: typora.editorPrefs, resolveShortcut: e => typora.resolveShortcut(e), onPasteCommand: () => api.editCommand('paste'),
      onChange: () => { refreshOutline(); refreshStats(); onChange(s); },
      onSelection: () => { if (visible === s) { refreshStats(); scheduleMark(); typora.selectionChanged(s); } },
      onStructure: () => {},
      onMode: () => syncMode(s),
      onFind: replace => openFind(s, replace),
      onFindStep: dir => { if (s.ui.find.hidden) openFind(s); else showCount(s, s.editor.findStep(dir)); },
      onOpenLink: href => guard(() => openLink(s, href)),
      onInsertImage: () => typora.H.pickImage(s),
      onStatus: status,
      onPasteImage: async file => guard(async () => api.mdImageSave(s.id, new Uint8Array(await file.arrayBuffer()), (file.type.split('/')[1] || 'png').replace('svg+xml', 'svg'), typora.imageOptions())),
      onDropImages: async files => guard(async () => api.mdImageImportFiles(s.id, files, typora.imageOptions())),
    });
    const scheduleMark = debounce(() => markCurrentHeading(s), 80);
    let progressFrame = 0;
    const onScroll = () => { scheduleMark(); cancelAnimationFrame(progressFrame); progressFrame = requestAnimationFrame(() => updateProgress(s)); };
    s.editor.scroller.addEventListener('scroll', onScroll, { passive: true });
    s.editor.sourceView.addEventListener('scroll', onScroll, { passive: true });
    // Reading mode: double-click (or E) switches to editing at that spot.
    s.editor.doc.addEventListener('dblclick', e => {
      if (!s.readonly || s.editor.sourceMode || e.target.closest('a, .mdMermaid, img')) return;
      const pos = s.editor.pointToOffset(e.clientX, e.clientY, e.target);
      setViewMode(s, 'live'); if (pos != null) s.editor.activateAt(pos);
    });
    s.editor.root.addEventListener('keydown', e => {
      if (s.readonly && !s.editor.sourceMode && (e.key === 'e' || e.key === 'E') && !e.ctrlKey && !e.metaKey && !e.altKey) { e.preventDefault(); setViewMode(s, 'live'); s.editor.focus(); }
    }, true);
    s.editor.root.addEventListener('contextmenu', e => {
      if (e.target.closest('input, .mdFindBar')) return;
      if (!typora.prefs.get('spellcheck')) e.preventDefault();
      if (e.target.tagName === 'IMG' && !e.target.closest('.mdMermaid') && typora.imageMenu(s, e.target, e.clientX, e.clientY)) { e.preventDefault(); return; }
      const block = e.target.closest?.('.mdBlock');
      const sel = getSelection();
      if (block && !block.classList.contains('isActive') && (!sel.rangeCount || sel.isCollapsed)) { const pos = s.editor.pointToOffset(e.clientX, e.clientY, e.target); if (pos != null) s.editor.activateAt(pos); }
      let { clientX: x, clientY: y } = e;
      if (e.button !== 2 && !x && !y) { const r = sel.rangeCount ? sel.getRangeAt(0).getBoundingClientRect() : s.editor.root.getBoundingClientRect(); x = r.left; y = r.bottom; }
      openMenu(s, x, y);
    });
    s.headings = scanHeadings(info.text);
    if (state.outline === false) toggleOutline(s, false); else renderOutline(s);
    if (state.source) s.editor.setSourceMode(true);
    requestAnimationFrame(() => { s.editor.scrollTop = state.scrollTop || 0; if (state.caret) s.editor.sel = { from: Math.min(state.caret, info.text.length), to: Math.min(state.caret, info.text.length) }; });
    if (info.notice) banner(s, info.notice, [['知道了', () => {}]]);
    typora.attach(s);
    s.eol = info.eol || '\n'; s.readonly = false;
    if (!state.source && (state.reading ?? (typora.prefs.get('openInReadMode') && !!s.path && !!info.text.trim()))) typora.setReadonly(s, true);
    s.loaded = true;
    sessions.add(s);
    syncMode(s);
    return s;
  }
  function show(s, { focus = true } = {}) {
    if(visible&&visible!==s)visible.editor.visualTables?.finish();
    if (visible && visible !== s) visible.editor.releaseHighlights();
    visible = s;
    typora.show(s);
    if (!s) return;
    s.editor.highlightSearch();
    requestAnimationFrame(() => { markCurrentHeading(s); updateProgress(s); if (focus) s.editor.focus(); });
    updateStats(s); syncChrome(s);
  }
  async function save(s, saveAs) {
    s.editor.visualTables?.finish();
    if (s.saving) return false;
    if (s.editor.active) s.editor.syncFromDom(true);
    typora.beforeSave(s);
    const text = s.editor.text;
    s.saving = true; onChange(s, { chrome: true });
    try {
      const result = await api.saveMarkdown(s.id, text, saveAs);
      if (!result) return false;
      Object.assign(s, { name: result.name, path: result.path, ...(result.eol ? { eol: result.eol } : {}) });
      s.forceDirty = false; s.savedText = text; s.recovered = false; s.orphaned = false; s.ui.banner.hidden = true; s.encodingLabel = 'UTF-8';
      s.editor.doc.setAttribute('aria-label', s.name);
      return true;
    } finally { s.saving = false; onChange(s, { chrome: true }); }
  }
  function destroy(s) {
    sessions.delete(s);
    if (visible === s) visible = null;
    for (const url of s.imageCache.values()) Promise.resolve(url).then(u => u && URL.revokeObjectURL(u));
    typora.detach(s);
    s.editor.destroy();
    s.panel.remove();
  }
  const state = s => ({ kind: 'markdown', scrollTop: Math.round(s.editor.scrollTop), caret: s.editor.sel.from, source: s.editor.sourceMode, reading: !!s.readonly, outline: !s.ui.outline.hidden });
  // Save button in the Markdown top bar mirrors the document state.
  function syncChrome(s) {
    const b = s.ui?.saveButton; if (!b) return;
    const dirty = isDirty(s);
    b.classList.toggle('isDirty', dirty); b.disabled = !!s.saving;
    b.querySelector('.label').textContent = s.saving ? '保存中…' : dirty ? '保存' : '已保存';
    b.title = dirty ? '保存 · Ctrl+S' : '所有修改都已保存';
    s.ui.findButton.setAttribute('aria-pressed', String(!s.ui.find.hidden));
  }
  let messageTimer = 0;
  function statusMessage(text) {
    const s = visible; if (!s) return;
    s.ui.msg.textContent = text; s.ui.msg.classList.add('isFresh');
    clearTimeout(messageTimer); messageTimer = setTimeout(() => s.ui.msg.classList.remove('isFresh'), 2500);
  }
  return {
    create, show, save, destroy, isDirty, state, external, print, openFind, toggleOutline, syncChrome, statusMessage, setViewMode,
    outlineOpen: s => !s.ui.outline.hidden,
    findOpen: s => !s.ui.find.hidden,
    setSource, sessions,
    undo: s => s.editor.undo(), redo: s => s.editor.redo(),
    canUndo: s => s.editor.canUndo, canRedo: s => s.editor.canRedo,
    text: s => {s.editor.visualTables?.finish();return s.editor.text;},
    closeMenu: hideMenu, reload: reloadFromDisk, renderOutline, typora, syncStage: null,
    command: (s, id) => typora.runCommand(s, id),
    onSpell: data => typora.onSpell(data),
  };
}
