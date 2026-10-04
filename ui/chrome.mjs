// Application chrome: title bar state, anchored popovers, the annotation tool menu,
// the floating page navigator, and shared keyboard handling for menus.
export const ANNOTATION_TOOLS = [
  // [label, PDF.js toolbar button id, icon, editor mode]
  ['高亮', 'editorHighlightButton', 'highlight', 9],
  ['自由绘制', 'editorInkButton', 'ink', 15],
  ['文本框', 'editorFreeTextButton', 'text', 3],
  ['插入图片', 'editorStampButton', 'image', 13],
  ['手写签名', 'editorSignatureButton', 'signature', 101],
  ['评论', 'editorCommentButton', 'comment', 102],
];
const MODE_NAMES = Object.fromEntries(ANNOTATION_TOOLS.map(([label, , , mode]) => [mode, label]));

export function menuItem(label, { icon, shortcut, onSelect, role = 'menuitem', checked, className = '', title } = {}) {
  const b = document.createElement('button');
  b.className = ('menuItem ' + className).trim(); b.setAttribute('role', role); b.tabIndex = -1;
  if (icon) b.dataset.icon = icon;
  b.append(document.createTextNode(label));
  if (shortcut) { const k = document.createElement('span'); k.className = 'shortcut'; k.textContent = shortcut; b.append(k); }
  if (checked !== undefined) b.setAttribute('aria-checked', String(!!checked));
  if (title) b.title = title;
  if (onSelect) b.onclick = onSelect;
  return b;
}
export function menuLabel(text) { const d = document.createElement('div'); d.className = 'menuLabel'; d.setAttribute('role', 'presentation'); d.textContent = text; return d; }
export function menuSep() { const d = document.createElement('div'); d.className = 'menuSep'; d.setAttribute('role', 'separator'); return d; }

// Roving focus for any role=menu container: arrows, Home/End, type-ahead is unnecessary here.
export function menuKeys(container, close) {
  container.addEventListener('keydown', event => {
    const items = [...container.querySelectorAll('[role^="menuitem"]:not(:disabled)')].filter(el => el.offsetParent);
    const index = items.indexOf(document.activeElement);
    let next;
    if (event.key === 'ArrowDown') next = items[(index + 1) % items.length];
    else if (event.key === 'ArrowUp') next = items[(index - 1 + items.length) % items.length];
    else if (event.key === 'Home') next = items[0];
    else if (event.key === 'End') next = items.at(-1);
    else if (event.key === 'Escape' || event.key === 'Tab') { event.preventDefault(); event.stopPropagation(); close(); return; }
    if (next) { event.preventDefault(); next.focus(); }
  });
}

export function createChrome({ api, current, guard, navigation, status }) {
  const $ = id => document.getElementById(id);
  document.body.classList.add('platform-' + (api.platform || 'win32'));

  // Full screen hides the title bar; the command bar stays available.
  const fullscreen = value => document.body.classList.toggle('isFullscreen', !!value);
  api.windowState?.().then(state => fullscreen(state?.fullscreen)).catch(() => {});

  // Greeting on the home page follows the local time of day.
  const hour = new Date().getHours();
  $('greeting').textContent = hour < 6 ? '夜深了，慢慢读' : hour < 11 ? '早上好' : hour < 14 ? '中午好' : hour < 18 ? '下午好' : '晚上好';

  // Anchor popovers to the control that opened them.
  function anchor(popover, invoker, align) {
    popover.addEventListener('beforetoggle', event => {
      if (event.newState !== 'open') return;
      const r = $(invoker).getBoundingClientRect();
      popover.style.top = Math.round(r.bottom + 6) + 'px';
      if (align === 'right') { popover.style.right = Math.max(12, Math.round(innerWidth - r.right)) + 'px'; popover.style.left = 'auto'; }
      else { popover.style.left = Math.max(8, Math.min(Math.round(r.left), innerWidth - 260)) + 'px'; popover.style.right = 'auto'; }
    });
    popover.addEventListener('toggle', event => $(invoker).setAttribute('aria-expanded', String(event.newState === 'open')));
  }
  anchor($('viewPanel'), 'viewButton', 'right');
  anchor($('annotateMenu'), 'annotateButton', 'left');

  // ——— Annotation tools (PDF.js editors, driven from Qingye's own controls) ———
  const annotateMenu = $('annotateMenu');
  const readerButton = (s, id) => s?.frame.contentDocument?.getElementById(id);
  const available = (s, id) => { const b = readerButton(s, id); return !!b && !b.disabled && !b.closest('.hidden,[hidden]'); };
  function editorMode(s) { return s?.loaded ? s.app.pdfViewer.annotationEditorMode : 0; }
  function useTool(s, id) {
    if (!s?.loaded) return;
    if (!$('directEditor').hidden) { status('请先应用或取消当前页面编辑，再使用批注工具。'); return; }
    readerButton(s, id)?.click();
  }
  function exitAnnotation(s = current()) { if (s?.loaded) s.app.eventBus.dispatch('switchannotationeditormode', { source: annotateMenu, mode: 0 }); }
  function buildAnnotateMenu() {
    const s = current(), mode = editorMode(s);
    annotateMenu.replaceChildren(menuLabel('批注工具'));
    for (const [label, id, icon, toolMode] of ANNOTATION_TOOLS) {
      const item = menuItem(label, { icon, role: 'menuitemradio', checked: mode === toolMode, onSelect: () => { annotateMenu.hidePopover(); useTool(current(), id); } });
      item.disabled = !available(s, id);
      annotateMenu.append(item);
    }
    annotateMenu.append(menuSep(),
      menuItem('批注列表与导出', { icon: 'outline', onSelect: () => { annotateMenu.hidePopover(); guard(() => navigation.show('comments')); } }),
      menuItem('退出批注模式', { icon: 'x', shortcut: 'Esc', onSelect: () => { annotateMenu.hidePopover(); exitAnnotation(); } }));
    annotateMenu.lastChild.disabled = mode <= 0;
  }
  annotateMenu.addEventListener('beforetoggle', event => { if (event.newState === 'open') buildAnnotateMenu(); });
  annotateMenu.addEventListener('toggle', event => { if (event.newState === 'open') annotateMenu.querySelector('[role^="menuitem"]:not(:disabled)')?.focus(); });
  menuKeys(annotateMenu, () => { annotateMenu.hidePopover(); $('annotateButton').focus(); });

  function syncAnnotate() {
    const s = current(), button = $('annotateButton');
    button.disabled = !s?.loaded || !!s.saving || !!s.view?.reflow;
    const mode = editorMode(s), name = MODE_NAMES[mode];
    button.classList.toggle('modeActive', !!name); button.querySelector('.label').textContent = name || '批注';
    if (name) { button.dataset.mode = '· ' + name; button.setAttribute('aria-label', `批注工具（当前：${name}）`); }
    else { delete button.dataset.mode; button.setAttribute('aria-label', '批注工具'); }
    if (button.disabled && annotateMenu.matches(':popover-open')) annotateMenu.hidePopover();
  }

  // ——— Floating page navigator (bottom-left of each document) ———
  const ZOOMS = [['auto', '自动缩放'], ['page-fit', '适合页面'], ['page-width', '适合宽度'], ['page-actual', '实际大小'], ['0.5', '50%'], ['0.75', '75%'], ['1', '100%'], ['1.25', '125%'], ['1.5', '150%'], ['2', '200%'], ['3', '300%'], ['4', '400%']];
  function attachPager(s) {
    const el = document.createElement('div'); el.className = 'pager'; el.setAttribute('role', 'toolbar'); el.setAttribute('aria-label', '页面导航');
    const make = (icon, label, action) => { const b = document.createElement('button'); b.dataset.icon = icon; b.title = label; b.setAttribute('aria-label', label); b.onclick = () => guard(action); return b; };
    const viewer = () => s.app.pdfViewer;
    const prev = make('left', '上一页', () => { if (s.loaded) viewer().previousPage(); });
    const next = make('right', '下一页', () => { if (s.loaded) viewer().nextPage(); });
    const page = document.createElement('span'); page.className = 'pagerPage';
    const input = document.createElement('input'); input.className = 'pageInput'; input.inputMode = 'numeric'; input.setAttribute('aria-label', '当前页码，输入后按回车跳转'); input.autocomplete = 'off';
    const total = document.createElement('span'); total.setAttribute('aria-live', 'off');
    page.append(input, total);
    const jump = () => { if (!s.loaded) return; const n = Math.round(Number(input.value)); if (Number.isFinite(n) && n >= 1) viewer().currentPageNumber = Math.min(s.app.pagesCount, n); update(); };
    input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); jump(); s.frame.focus(); } else if (event.key === 'Escape') { event.preventDefault(); update(true); s.frame.focus(); } };
    input.onchange = jump; input.onfocus = () => input.select();
    const sep = document.createElement('span'); sep.className = 'pagerSep'; sep.setAttribute('aria-hidden', 'true');
    const zoomOut = make('minus', '缩小 · Ctrl+-', () => s.app.eventBus.dispatch('zoomout', { source: el }));
    const zoomIn = make('plus', '放大 · Ctrl+=', () => s.app.eventBus.dispatch('zoomin', { source: el }));
    const zoom = document.createElement('select'); zoom.className = 'zoomSelect'; zoom.setAttribute('aria-label', '缩放比例');
    const custom = new Option('', 'custom'); custom.hidden = true; zoom.append(custom);
    for (const [value, label] of ZOOMS) zoom.append(new Option(label, value));
    zoom.onchange = () => { if (s.loaded && zoom.value !== 'custom') { viewer().currentScaleValue = zoom.value; update(); } };
    el.append(prev, page, next, sep, zoomOut, zoom, zoomIn);
    function update(force = false) {
      if (!s.loaded || !s.app.pdfDocument) return;
      const v = viewer(), n = v.currentPageNumber, count = s.app.pagesCount;
      if (force || document.activeElement !== input) input.value = n;
      input.style.width = Math.max(46, String(count).length * 9 + 22) + 'px';
      total.textContent = '/ ' + count; prev.disabled = n <= 1; next.disabled = n >= count;
      const value = String(v.currentScaleValue), known = ZOOMS.find(([key]) => key === value && isNaN(Number(key)));
      if (known) zoom.value = value;
      else { custom.textContent = Math.round(v.currentScale * 100) + '%'; zoom.value = 'custom'; }
      zoomOut.disabled = v.currentScale <= 0.1; zoomIn.disabled = v.currentScale >= 10;
    }
    for (const event of ['pagechanging', 'scalechanging', 'pagesinit', 'pagesloaded', 'documentinit', 'rotationchanging']) s.app.eventBus.on(event, () => update());
    s.app.eventBus.on('annotationeditormodechanged', () => { if (s === current()) syncAnnotate(); });
    s.panel.append(el); s.pager = { element: el, update, focus: () => { input.focus(); input.select(); } }; update();
    return s.pager;
  }

  return { sync: syncAnnotate, attachPager, exitAnnotation, fullscreen, useTool, available, readerButton };
}
