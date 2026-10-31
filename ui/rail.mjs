// The application rail (0.22): the narrow column on the left with the app-level destinations
// (首页, 文档库, 工作区, 转换, 任务) and, at the bottom, appearance, settings and help. These used to
// be spread over the title bar, the home page and the status bar. The buttons keep their 0.21 ids
// (homeButton, libraryButton, convertButton, themeButton, settingsButton, helpButton), so the
// handlers other modules attach to them are unchanged; this module adds what is new.
export function createRail({ $, guard, activate, hasLibrary }) {
  const rail = $('appRail');
  if (!hasLibrary) $('libraryButton').hidden = true;

  // 首页 is marked current while the home page is shown.
  const syncHome = () => {
    const home = document.body.dataset.mode === 'home';
    if (home) $('homeButton').setAttribute('aria-current', 'page'); else $('homeButton').removeAttribute('aria-current');
  };
  new MutationObserver(syncHome).observe(document.body, { attributes: true, attributeFilter: ['data-mode'] });
  syncHome();

  // 工作区: the saved workspaces live on the home page.
  $('workspaceButton').onclick = () => guard(async () => {
    await activate(null);
    const panel = $('workspaceTitle')?.closest('section, div');
    panel?.scrollIntoView({ block: 'start', behavior: 'smooth' });
    ($('workspaceList')?.querySelector('button') || $('workspaceSave'))?.focus({ preventScroll: true });
  });

  // 任务: the task center's own pill (status bar) still exists; the rail opens the same panel and
  // shows how many tasks are running.
  const pill = () => $('taskPill');
  $('railTasks').onclick = () => { const p = pill(); if (p) p.click(); };
  const badge = $('railTaskBadge');
  const syncTasks = () => {
    const p = pill(), match = p && !p.hidden ? /(\d+)\s*个进行中/.exec(p.textContent || '') : null;
    badge.hidden = !match; badge.textContent = match ? match[1] : '';
    $('railTasks').setAttribute('aria-label', match ? `任务中心，${match[1]} 个进行中` : '任务中心');
  };
  if (pill()) new MutationObserver(syncTasks).observe(pill(), { attributes: true, childList: true, characterData: true, subtree: true });
  syncTasks();

  // Arrow keys move between rail buttons (one tab stop per button is kept for simplicity).
  rail.addEventListener('keydown', event => {
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp') return;
    const items = [...rail.querySelectorAll('.railItem')].filter(b => !b.hidden);
    const at = items.indexOf(document.activeElement); if (at < 0) return;
    event.preventDefault(); items[(at + (event.key === 'ArrowDown' ? 1 : -1) + items.length) % items.length].focus();
  });
  return { sync: () => { syncHome(); syncTasks(); } };
}
