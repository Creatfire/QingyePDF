// Command palette (0.21, Ctrl+Shift+P): one search box over every toolbar command, menu entry
// and tool, so nothing has to be found by browsing menus. The host supplies the command list on
// every open, so enabled states are current: [{ id, label, group, shortcut, keys, enabled, run }].
import { rankItems } from './tool-registry.mjs';
import { shortcutText } from './i18n/i18n.mjs';

export function createCommandPalette({ guard, commands, searches = () => [] }) {
  const dialog = document.createElement('dialog'); dialog.id = 'commandPalette'; dialog.setAttribute('closedby', 'any'); dialog.setAttribute('aria-label', '命令面板');
  dialog.innerHTML = '<label class="commandSearch" data-icon="search"><input id="commandInput" type="search" autocomplete="off" spellcheck="false" placeholder="搜索命令、工具或文字，例如“打印”“水印”，或输入要在文档里找的内容" aria-label="搜索命令" role="combobox" aria-expanded="true" aria-controls="commandList" aria-autocomplete="list"></label>'
    + '<div id="commandList" class="commandList" role="listbox" aria-label="命令"></div>'
    + '<footer class="commandFoot"><span>↑↓ 选择</span><span>Enter 执行</span><span>Esc 关闭</span></footer>';
  document.body.append(dialog);
  for (const k of document.querySelectorAll('#commandButton kbd')) k.textContent = shortcutText(k.textContent);
  const input = dialog.querySelector('#commandInput'), list = dialog.querySelector('#commandList');
  let items = [], shown = [], index = 0;
  const enabled = item => item.enabled ? !!item.enabled() : true;
  function render() {
    // 0.22 unified search: with a query, "find in this document" and "search every document" follow
    // the matching commands (and are the only rows, and so the Enter target, when no command matches).
    const query = input.value.trim();
    shown = [...rankItems(items, input.value, item => [item.label, item.keys, item.group]).slice(0, 60), ...(query ? searches(query) : [])];
    index = Math.max(0, Math.min(index, shown.length - 1));
    list.replaceChildren();
    if (!shown.length) { const p = document.createElement('p'); p.className = 'commandEmpty'; p.textContent = '没有找到匹配的命令。'; list.append(p); input.removeAttribute('aria-activedescendant'); return; }
    shown.forEach((item, n) => {
      const row = document.createElement('div'); row.className = 'commandRow'; row.id = 'command-' + n; row.setAttribute('role', 'option');
      row.setAttribute('aria-selected', String(n === index)); if (!enabled(item)) row.setAttribute('aria-disabled', 'true');
      if (item.icon) row.dataset.icon = item.icon;
      const name = document.createElement('span'); name.className = 'commandName'; name.textContent = item.label;
      const group = document.createElement('span'); group.className = 'commandGroup'; group.textContent = item.group;
      row.append(name, group);
      if (item.shortcut) { const k = document.createElement('kbd'); k.textContent = shortcutText(item.shortcut); row.append(k); }
      row.onpointermove = () => { if (index !== n) { index = n; mark(); } };
      row.onclick = () => runAt(n);
      list.append(row);
    });
    mark();
  }
  function mark() {
    for (const row of list.children) row.setAttribute?.('aria-selected', String(row.id === 'command-' + index));
    const row = list.querySelector('#command-' + index); if (!row) return;
    input.setAttribute('aria-activedescendant', row.id); row.scrollIntoView({ block: 'nearest' });
  }
  function runAt(n) {
    const item = shown[n]; if (!item || !enabled(item)) return;
    dialog.close(); guard(() => item.run());
  }
  input.addEventListener('input', () => { index = 0; render(); });
  input.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') { event.preventDefault(); if (shown.length) { index = (index + (event.key === 'ArrowDown' ? 1 : -1) + shown.length) % shown.length; mark(); } }
    else if (event.key === 'Enter') { event.preventDefault(); runAt(index); }
    // A search box clears itself on the first Esc; the footer promises Esc closes the palette.
    else if (event.key === 'Escape') { event.preventDefault(); dialog.close(); }
  });
  function open(query = '') {
    items = commands(); input.value = query; index = 0; render();
    if (!dialog.open) dialog.showModal();
    input.focus(); input.select();
  }
  return { open, close: () => dialog.close(), isOpen: () => dialog.open };
}
