// 0.15.0 — the toolbar's tools menu: every tool of tool-catalog.mjs, grouped by category, one click
// away from any PDF tab. The same classification appears in the toolbox dialog and on the home page.
import { toolCatalog, toolKey } from './tool-catalog.mjs';
export function createToolsMenu({ anchor, guard, openTool, openConverter, compare }) {
  const menu = document.createElement('section'); menu.id = 'toolsMenu'; menu.className = 'menuPopover toolsMenu'; menu.setAttribute('popover', 'auto'); menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', '全部工具');
  const grid = document.createElement('div'); grid.className = 'toolsMenuGrid';
  for (const c of toolCatalog) {
    const group = document.createElement('div'); group.className = 'toolsMenuGroup';
    const head = document.createElement('div'); head.className = 'menuLabel'; head.dataset.icon = c.icon; head.textContent = c.label; group.append(head);
    for (const t of c.tools) {
      const item = document.createElement('button'); item.type = 'button'; item.className = 'menuItem'; item.setAttribute('role', 'menuitem'); item.dataset.icon = t.icon; item.dataset.toolKey = toolKey(t); item.textContent = t.label;
      item.onclick = () => { menu.hidePopover(); guard(() => t.converter ? openConverter() : t.compareView ? compare() : openTool(t.action, { mode: t.mode, category: c.id })); };
      group.append(item);
    }
    grid.append(group);
  }
  menu.append(grid); document.body.append(menu);
  anchor.onclick = () => {
    if (menu.matches(':popover-open')) { menu.hidePopover(); return; }
    const box = anchor.getBoundingClientRect();
    menu.style.top = Math.round(box.bottom + 6) + 'px'; menu.style.right = Math.max(8, Math.round(innerWidth - box.right)) + 'px'; menu.style.left = 'auto';
    menu.showPopover(); anchor.setAttribute('aria-expanded', 'true');
  };
  menu.addEventListener('toggle', event => anchor.setAttribute('aria-expanded', String(event.newState === 'open')));
  return menu;
}
