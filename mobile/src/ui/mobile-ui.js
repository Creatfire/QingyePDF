// Touch / small-screen behaviour layered over the shared desktop interface: the "more" menu
// that replaces the title bar tools on a phone, the Android back button, saving drafts when the
// app goes to the background, and a few desktop-only controls that are hidden.
import { isNative, Native } from '../shims/backend.js';
import { toast } from '../main/dialogs.js';

const phone = () => matchMedia('(max-width: 760px)').matches;
const $ = id => document.getElementById(id);
const visible = node => !!node && !node.hidden && getComputedStyle(node).display !== 'none';

function moreMenu() {
  const button = document.createElement('button');
  button.id = 'qmMore'; button.type = 'button'; button.className = 'iconOnly'; button.dataset.icon = 'more';
  button.title = '更多'; button.setAttribute('aria-label', '更多'); button.setAttribute('aria-haspopup', 'menu'); button.setAttribute('aria-expanded', 'false');
  const menu = document.createElement('div'); menu.id = 'qmMoreMenu'; menu.setAttribute('popover', 'auto'); menu.setAttribute('role', 'menu');
  $('titlebar').append(button); document.body.append(menu);
  const proxy = (label, icon, target) => ({ label, icon, disabled: () => !!$(target)?.disabled, run: () => $(target)?.click() });
  const items = [
    proxy('返回阅读位置', 'left', 'readingBack'), proxy('前进阅读位置', 'right', 'readingForward'), null,
    { label: '分享当前文档', icon: 'external', disabled: () => !window.qingye?.sessions?.size || document.body.dataset.mode === 'home', run: shareCurrent },
    { label: '全屏阅读', icon: 'fullscreen', disabled: () => document.body.dataset.mode === 'home', run: () => window.desktop.fullscreen() },
    // Notes mode and library search live in the title bar on a tablet and here on a phone.
    { label: () => window.qingye?.notes?.active() ? '笔记模式命令' : '笔记模式', icon: 'double', disabled: () => !window.qingye?.notes, run: () => window.qingye.notes.toggle(button, true) },
    { label: '全库搜索', icon: 'search', disabled: () => !window.qingye?.library, run: () => window.qingye.library.open() },
    proxy('文档转换中心', 'convert', 'convertButton'), null,
    { label: () => document.body.classList.contains('dark') ? '切换浅色界面' : '切换深色界面', icon: () => document.body.classList.contains('dark') ? 'sun' : 'moon', run: () => $('themeButton')?.click() },
    proxy('设置', 'settings', 'settingsButton'), proxy('使用帮助', 'help', 'helpButton'),
  ];
  const value = v => typeof v === 'function' ? v() : v;
  function render() {
    menu.textContent = '';
    for (const item of items) {
      if (!item) { menu.append(document.createElement('hr')); continue; }
      const entry = document.createElement('button'); entry.type = 'button'; entry.setAttribute('role', 'menuitem');
      entry.dataset.icon = value(item.icon); entry.textContent = value(item.label); entry.disabled = !!item.disabled?.();
      entry.onclick = () => { menu.hidePopover(); item.run(); };
      menu.append(entry);
    }
  }
  button.onclick = () => { if (menu.matches(':popover-open')) menu.hidePopover(); else { render(); menu.showPopover(); } };
  menu.addEventListener('toggle', event => button.setAttribute('aria-expanded', String(event.newState === 'open')));
}

// The shared app keeps its sessions in tab order; the first tab is the home button.
function currentSession() {
  const tabs = [...document.querySelectorAll('#tabs .tab')], index = tabs.findIndex(tab => tab.classList.contains('active')) - 1;
  return index >= 0 ? [...(window.qingye?.sessions?.values() || [])][index] : null;
}
async function shareCurrent() {
  const current = currentSession();
  if (!current?.path) { toast('请先保存文档，再分享。'); return; }
  if (current.dirty) toast('分享的是已保存到文件的版本。');
  if (!isNative) { toast('分享需要在安卓设备上运行。'); return; }
  try { await Native.shareFile({ path: current.path, mime: /\.pdf$/i.test(current.path) ? 'application/pdf' : 'text/markdown' }); }
  catch (error) { toast('无法分享：' + (error?.message || error)); }
}

// One step back per press: close whatever is on top, then leave the document, then leave the app.
function back() {
  const dialogs = [...document.querySelectorAll('dialog[open]')];
  const top = dialogs.at(-1);
  if (top) { if (top.dispatchEvent(new Event('cancel', { cancelable: true }))) top.close(); return; }
  const popover = [...document.querySelectorAll(':popover-open')].at(-1);
  if (popover) { popover.hidePopover(); return; }
  for (const id of ['pageContextMenu', 'mdContextMenu']) if (visible($(id))) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); $(id).hidden = true; return; }
  const floating = [...document.querySelectorAll('.mdMenu, .mdPalette, .mdModal')].find(node => node.id !== 'mdContextMenu' && visible(node));
  if (floating) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); (document.activeElement || document.body).dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); return; }
  if (window.qingye?.notes?.picking?.()) { window.qingye.notes.stopPicking(); return; }
  if (document.body.classList.contains('qyImmersive')) { immersive(false); return; }
  if (document.body.classList.contains('isFullscreen')) { window.desktop.exitFullscreen(); return; }
  if (visible($('directEditor'))) { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true })); return; }
  if (document.body.classList.contains('aiOpen') && document.body.dataset.mode !== 'home') { $('aiButton')?.click(); return; }
  if (document.body.classList.contains('navigationOpen')) { $('closeNavigation')?.click(); return; }
  if (phone()) { const outline = [...document.querySelectorAll('.mdPanel')].find(panel => visible(panel))?.querySelector('.mdOutline'); if (outline && !outline.hidden) { [...document.querySelectorAll('.mdPanel')].find(panel => visible(panel))?.querySelector('.mdOutlineToggle')?.click(); return; } }
  if (window.qingye?.notes?.active()) { window.qingye.notes.end(); return; }
  if (document.body.dataset.mode && document.body.dataset.mode !== 'home') { $('homeButton')?.click(); return; }
  // Home screen: keep the open tabs and their drafts, just leave the app.
  window.qingye?.checkpoint?.();
  if (isNative) Native.moveToBackground().catch(() => {});
}

// ——— touch reading (0.12.0) ———
// A tap on the page hides or shows the bars above and below it; a double tap zooms; selecting
// text brings up a small bar with the actions a right click offers on a desktop.
let hintShown = false;
function immersive(on = !document.body.classList.contains('qyImmersive')) {
  document.body.classList.toggle('qyImmersive', !!on);
  if (on && !hintShown) { hintShown = true; try { if (!localStorage.getItem('qingye.mobile.tapHint')) { localStorage.setItem('qingye.mobile.tapHint', '1'); toast('轻点页面可以重新显示工具栏'); } } catch {} }
  // The page width did not change, but the viewer may have to settle its layout.
  window.dispatchEvent(new Event('resize'));
}
const INTERACTIVE = 'a, button, input, textarea, select, label, summary, [contenteditable="true"], [role="button"], .annotationEditorLayer > *, .annotationLayer section, .qyRegionBox, .directEditBox, .freeTextEditor, .inkEditor, .stampEditor, .highlightEditor';
/** May a tap on this PDF toggle the bars? Not while annotating, editing a page or picking a region. */
function tapAllowed(s) {
  if (window.qingye?.notes?.picking?.()) return false;
  if (visible($('directEditor')) || visible($('pageContextMenu'))) return false;
  const mode = s.app?.pdfViewer?.annotationEditorMode;
  return !(typeof mode === 'number' && mode > 0);
}
function zoomAt(s, event) {
  const viewer = s.app.pdfViewer, fitted = ['page-width', 'page-fit', 'auto'].includes(String(viewer.currentScaleValue));
  if (!fitted) { viewer.currentScaleValue = 'page-width'; return 'fit'; }
  if (typeof viewer.updateScale === 'function') viewer.updateScale({ scaleFactor: 2, origin: [event.clientX, event.clientY] });
  else viewer.currentScale = viewer.currentScale * 2;
  return 'zoom';
}
let selectionBar = null, selectionOwner = null;
function hideSelectionBar() { if (selectionBar) selectionBar.hidden = true; selectionOwner = null; }
function showSelectionBar(s) {
  if (!selectionBar) {
    selectionBar = document.createElement('div'); selectionBar.id = 'qmSelection'; selectionBar.setAttribute('role', 'toolbar'); selectionBar.setAttribute('aria-label', '所选文字'); selectionBar.hidden = true;
    document.body.append(selectionBar);
    // Keep the selection while a button of the bar is pressed.
    selectionBar.addEventListener('pointerdown', event => event.preventDefault());
  }
  const q = window.qingye, doc = s.frame.contentDocument, selection = () => s.frame.contentWindow.getSelection();
  const action = (label, icon, run) => { const b = document.createElement('button'); b.type = 'button'; b.dataset.icon = icon; b.textContent = label; b.onclick = async () => { try { await run(); } catch (error) { toast(error?.message || String(error)); } hideSelectionBar(); }; return b; };
  selectionBar.replaceChildren(
    action('复制', 'copy', () => { doc.execCommand('copy'); toast('已复制'); selection().removeAllRanges(); }),
    action('高亮', 'highlight', () => s.app.pdfViewer._layerProperties.annotationEditorUIManager?.highlightSelection('context_menu')),
    action('搜索', 'search', async () => { const text = selection().toString().trim(); await q.navigation.search(s, text); await q.navigation.show('search'); }),
    ...(q.notes?.notesFor(s) ? [action('摘录到笔记', 'quote', () => { q.notes.excerptSelection(s); selection().removeAllRanges(); })] : []));
  selectionBar.hidden = false; selectionOwner = s;
}
const boundFrames = new WeakSet();
function bindPdf(s) {
  const doc = s.frame.contentDocument, win = s.frame.contentWindow;
  let down = null, pendingTap = 0, lastTap = 0, selectionTimer = 0;
  const hasSelection = () => !!win.getSelection()?.toString().trim();
  doc.addEventListener('pointerdown', event => { down = event.isPrimary && event.button === 0 ? { x: event.clientX, y: event.clientY, time: event.timeStamp, selected: hasSelection(), target: event.target } : null; }, true);
  doc.addEventListener('pointerup', event => {
    const start = down; down = null;
    if (!start || event.timeStamp - start.time > 350 || Math.hypot(event.clientX - start.x, event.clientY - start.y) > 12) return;
    const target = start.target;
    if (!target.closest?.('.page, #viewerContainer') || target.closest(INTERACTIVE) || start.selected || !tapAllowed(s)) return;
    if (event.timeStamp - lastTap < 320) { clearTimeout(pendingTap); lastTap = 0; if (target.closest('.page')) zoomAt(s, event); return; }
    lastTap = event.timeStamp;
    // Wait for a possible second tap, and make sure the tap did not start a selection.
    clearTimeout(pendingTap); pendingTap = setTimeout(() => { if (!hasSelection() && tapAllowed(s)) immersive(); }, 300);
  }, true);
  doc.addEventListener('selectionchange', () => {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(() => {
      const selection = win.getSelection(), node = selection?.anchorNode, inText = !!(node?.nodeType === 1 ? node : node?.parentElement)?.closest?.('.textLayer');
      if (inText && selection.toString().trim() && !window.qingye?.notes?.picking?.()) showSelectionBar(s); else if (selectionOwner === s) hideSelectionBar();
    }, 250);
  });
}
function bindSessions() {
  for (const s of window.qingye?.sessions?.values() || []) if (s.loaded && s.frame?.contentDocument && s.app && !boundFrames.has(s.frame)) { boundFrames.add(s.frame); bindPdf(s); }
  if (selectionOwner && (!window.qingye.sessions.has(selectionOwner.id) || selectionOwner.panel.hidden)) hideSelectionBar();
}
function touchHelp() {
  $('messageTitle').textContent = '触屏操作';
  $('messageBody').textContent = '轻点页面：隐藏或显示上下的工具栏，让页面占满屏幕。\n双击页面：放大到两倍；再双击回到适合宽度。双指捏合可以任意缩放。\n长按文字：选中后，屏幕下方出现“复制 / 高亮 / 搜索 / 摘录到笔记”。\n长按页面空白处：打开页面菜单（批注、页面编辑、书签、引用信息）。\n长按标签：把这份文档放到笔记模式的另一侧。\n返回键：依次关闭菜单、退出笔记模式、回到首页。\n\n笔记模式：在“更多”里进入。竖屏时 PDF 在上、笔记在下，横屏和平板左右并排；拖动中间的分隔条调整大小。进入后，“更多”里的“笔记模式命令”可以框选区域（公式、图表）、同步批注、开关滚动联动。\n\n“更多”里还有全库搜索、分享、文档转换和设置。所有文档都在手机上处理，不会上传。';
  if (!$('messageDialog').open) $('messageDialog').showModal();
}

export function installMobileUi() {
  document.documentElement.classList.add('qyMobile');
  const start = () => {
    moreMenu();
    window.addEventListener('qingye:back', back);
    // Android may stop a background app at any time: write the recovery drafts first.
    window.addEventListener('qingye:pause', () => { try { window.qingye?.checkpoint?.(); } catch {} });
    document.addEventListener('visibilitychange', () => { if (document.hidden) { try { window.qingye?.checkpoint?.(); } catch {} } });
    setInterval(bindSessions, 700);
    // Leaving a document always brings the bars back.
    new MutationObserver(() => { if (document.body.dataset.mode === 'home') immersive(false); }).observe(document.body, { attributes: true, attributeFilter: ['data-mode'] });
    // Markdown in reading mode: a tap on the text (not on a link) toggles the bars as well.
    document.addEventListener('click', event => {
      const text = event.target.closest?.('.mdPanel.isReading .mdDoc'); if (!text || event.target.closest('a, button, input, summary, label, .mdCodeBlock, img, .mdTask') || getSelection()?.toString().trim()) return;
      immersive();
    });
    // PDF help on a touch screen describes gestures, not keys.
    document.addEventListener('click', event => { if (event.target.closest?.('#helpButton') && document.body.dataset.mode !== 'md') { event.stopImmediatePropagation(); event.preventDefault(); touchHelp(); } }, true);
    // The side drawer of a Markdown document closes when a heading or file is chosen on a phone.
    document.addEventListener('click', event => { if (phone() && event.target.closest?.('.mdOutlineItem, .mdFileItem')) event.target.closest('.mdPanel')?.querySelector('.mdOutlineToggle')?.click(); });
  };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start); else start();
}
export const mobileInternals = { back, immersive, bindSessions };
