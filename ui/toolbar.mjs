// The PDF toolbar (0.21): split save and redo buttons with their menus, print, the select / hand
// switch, the 编辑 and 工具 menus, tools pinned to the bar, and the "更多" menu that takes the
// buttons a narrow window has no room for. It is built around the existing buttons, so their ids
// and the handlers other modules attach to them stay as they were.
import { anchorPopover, menuItem, menuLabel, menuSep, menuKeys } from './chrome.mjs';
import { tool, needsPdf } from './tool-registry.mjs';

// The page-content edits of the 编辑 menu: [label, page-edit kind (direct.mjs), icon]. The command
// palette lists the same entries.
export const EDIT_KINDS = [['添加文字', 'watermark', 'text'], ['文字印章', 'stamp', 'stamp'], ['图片印章', 'image', 'image'], ['图形', 'shape', 'shape'], ['替换区域内原文', 'text', 'replace'], ['全页水印', 'watermark-all', 'watermark']];

export function createToolbar({ $, guard, status, current, sessions, tools, pageManager, direct, history, print }) {
  const bar = $('pdfToolbar');
  for (const [menu, invoker, align] of [['saveMenu', 'saveMenuButton', 'left'], ['redoMenu', 'redoMenuButton', 'left'], ['editMenu', 'directButton', 'left'], ['toolsMenu', 'toolsButton', 'right'], ['moreMenu', 'moreButton', 'right']]) {
    const popover = $(menu);
    anchorPopover(popover, invoker, align);
    menuKeys(popover, () => { popover.hidePopover(); ($(invoker).offsetParent ? $(invoker) : $('moreButton')).focus(); });
    popover.addEventListener('toggle', event => { if (event.newState === 'open') popover.querySelector('[role^="menuitem"]:not(:disabled)')?.focus(); });
    // Static items (另存为, 文档属性, 编辑历史) keep their own handlers; the menu just closes after them.
    popover.addEventListener('click', event => { if (event.target.closest('.menuItem')) popover.hidePopover(); });
  }
  for (const item of document.querySelectorAll('#saveMenu .menuItem, #redoMenu .menuItem')) item.tabIndex = -1;
  const entry = (menu, label, icon, run, { shortcut, disabled, title } = {}) => {
    const item = menuItem(label, { icon, shortcut, title, onSelect: () => { $(menu).hidePopover(); guard(run); } });
    item.disabled = !!disabled; return item;
  };
  const ready = s => !!s?.loaded && !s.saving && !s.editBusy;

  // ——— 保存 ▾ / 打印 ———
  $('propertiesButton').onclick = () => current()?.app?.eventBus.dispatch('documentproperties', { source: bar });
  $('printButton').onclick = () => guard(print);

  // ——— 重做 ▾: the last few document edits, then the full history dialog ———
  $('redoMenu').addEventListener('beforetoggle', event => {
    if (event.newState !== 'open') return;
    const rows = current()?.history?.rows || [], box = $('redoRecent');
    box.replaceChildren();
    if (!rows.length) return;
    box.append(menuLabel('最近的修改'));
    for (const row of rows.slice(-5).reverse()) box.append(entry('redoMenu', (row.applied ? '' : '已撤销 · ') + row.label, row.applied ? 'check' : 'undo', () => history.show(), { title: row.time }));
    box.append(menuSep());
  });

  // ——— 选择 / 抓手 ———
  function syncPointer() {
    const s = current(), hand = !!s?.loaded && s.app.pdfCursorTools?.activeTool === 1;
    $('handToolButton').disabled = !s?.loaded || !!s.view?.reflow;
    $('handToolButton').setAttribute('aria-pressed', String(hand));
    $('selectTextButton').setAttribute('aria-pressed', String(!!s?.loaded && !hand));
  }
  $('handToolButton').onclick = () => guard(() => {
    const s = current(); if (!s?.loaded) return;
    if (direct.active) { status('请先应用或取消当前页面编辑，再切换到抓手。'); return; }
    s.app.eventBus.dispatch('switchannotationeditormode', { source: bar, mode: 0 });
    s.app.pdfCursorTools?.switchTool(1); s.textSelection = false; syncPointer();
  });
  function bind(s) { s.app.eventBus.on('cursortoolchanged', () => { if (s === current()) syncPointer(); }); }

  // ——— 编辑 ▾: everything that changes the page content ———
  $('editMenu').addEventListener('beforetoggle', event => {
    if (event.newState !== 'open') return;
    const s = current(), ok = ready(s) && !s.view?.reflow && !tools.isBusy(), menu = $('editMenu');
    menu.replaceChildren(menuLabel('修改页面内容，保存后写入 PDF'));
    for (const [label, kind, icon] of EDIT_KINDS) menu.append(entry('editMenu', label, icon, () => direct.open(kind), { disabled: !ok }));
    if (direct.active) menu.append(entry('editMenu', '取消当前页面编辑', 'x', () => $('directClose').click()));
    menu.append(menuSep(),
      entry('editMenu', '永久涂黑…', 'shield', () => tools.launch('redact'), { disabled: !ok }),
      entry('editMenu', '页面管理…', 'pages', () => pageManager.open(s), { disabled: !ok }),
      entry('editMenu', '编辑目录…', 'outline', () => tools.launch('outline'), { disabled: !ok }),
      menuSep(),
      entry('editMenu', '全部工具…', 'tools', () => tools.open(), { shortcut: 'Ctrl+Shift+T', disabled: tools.isBusy() }));
  });

  // ——— 工具 ▾: pinned (or the default common) tools, recent ones, then the tool center ———
  const launchable = t => !tools.isBusy() && (!needsPdf(t) || !!current()?.loaded);
  $('toolsMenu').addEventListener('beforetoggle', event => {
    if (event.newState !== 'open') return;
    const menu = $('toolsMenu'), common = tools.common();
    menu.replaceChildren(menuLabel(tools.pins().length ? '已固定' : '常用'));
    for (const t of common.map(tool).filter(Boolean)) menu.append(entry('toolsMenu', t.label, t.icon, () => tools.launch(t.id), { disabled: !launchable(t) }));
    const recent = tools.recent().filter(id => !common.includes(id)).slice(0, 3).map(tool).filter(Boolean);
    if (recent.length) { menu.append(menuLabel('最近使用')); for (const t of recent) menu.append(entry('toolsMenu', t.label, t.icon, () => tools.launch(t.id), { disabled: !launchable(t) })); }
    menu.append(menuSep(), entry('toolsMenu', '全部工具…', 'tools', () => tools.open(), { shortcut: 'Ctrl+Shift+T', disabled: tools.isBusy() }));
  });

  // ——— Tools pinned to the toolbar ———
  function renderPins(pins = tools.pins()) {
    const box = $('pinnedTools');
    box.replaceChildren(...pins.map(tool).filter(Boolean).map(t => {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.icon = t.icon; b.dataset.overflow = '2'; b.dataset.toolId = t.id;
      b.title = t.label; b.setAttribute('aria-label', t.label);
      const label = document.createElement('span'); label.className = 'label'; label.textContent = t.label; b.append(label);
      b.onclick = () => guard(() => tools.launch(t.id)); return b;
    }));
    box.hidden = !box.children.length;
    sync();
  }

  // ——— 视图 ▾ additions ———
  $('compareView').onclick = () => { $('viewPanel').hidePopover(); guard(() => tools.compareSideBySide()); };
  $('newWindowView').onclick = () => { $('viewPanel').hidePopover(); guard(() => tools.newWindow()); };

  // ——— "更多": buttons that do not fit move here, lowest priority (highest data-overflow) first ———
  const overflowable = () => [...bar.querySelectorAll('[data-overflow]')].filter(el => el.dataset.overflow !== 'keep');
  let fitting = 0;
  function fit() {
    cancelAnimationFrame(fitting);
    fitting = requestAnimationFrame(() => {
      // The Android app scrolls its toolbar sideways instead (mobile.css).
      if (document.documentElement.classList.contains('qyMobile') || !bar.offsetParent) return;
      const items = overflowable();
      for (const el of items) el.classList.remove('overflowed');
      $('moreButton').hidden = true;
      if (bar.scrollWidth <= bar.clientWidth + 1) return;
      $('moreButton').hidden = false;
      for (const el of items.sort((a, b) => Number(b.dataset.overflow) - Number(a.dataset.overflow))) {
        if (bar.scrollWidth <= bar.clientWidth + 1) break;
        el.classList.add('overflowed');
      }
    });
  }
  new ResizeObserver(fit).observe(bar);
  $('moreMenu').addEventListener('beforetoggle', event => {
    if (event.newState !== 'open') return;
    const menu = $('moreMenu'); menu.replaceChildren(menuLabel('放不下的按钮'));
    for (const el of overflowable().filter(el => el.classList.contains('overflowed'))) {
      for (const b of el.matches('button') ? [el] : [...el.querySelectorAll('button')]) {
        const label = b.querySelector('.label')?.textContent || b.getAttribute('aria-label') || b.title, target = b.getAttribute('popovertarget');
        const pressed = b.getAttribute('aria-pressed');
        const item = menuItem(label, { icon: b.dataset.icon, role: pressed ? 'menuitemcheckbox' : 'menuitem', checked: pressed ? pressed === 'true' : undefined,
          onSelect: () => { menu.hidePopover(); if (target) requestAnimationFrame(() => $(target).showPopover()); else b.click(); } });
        if (target) { const arrow = document.createElement('span'); arrow.className = 'shortcut'; arrow.textContent = '▸'; item.append(arrow); }
        item.disabled = b.disabled; menu.append(item);
      }
    }
  });

  function sync() {
    const s = current(), loaded = !!s?.loaded;
    $('printButton').disabled = !loaded || !!s.saving;
    $('saveMenuButton').disabled = $('saveButton').disabled && $('saveAsButton').disabled;
    $('propertiesButton').disabled = !loaded;
    syncPointer();
    for (const b of $('pinnedTools').children) { const t = tool(b.dataset.toolId); b.disabled = !t || !launchable(t); }
    $('compareView').disabled = !loaded || ![...sessions.values()].some(x => x !== s && x.loaded);
    $('newWindowView').disabled = !loaded;
    fit();
  }
  renderPins();
  return { sync, bind, fit, renderPins };
}
