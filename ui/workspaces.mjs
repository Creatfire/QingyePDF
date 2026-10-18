import { promptText } from './markdown/typora-dialogs.mjs';
// Document workspaces and pinned documents on the home page (0.20, main side: workspace-ipc.cjs).
// "保存为工作区" stores the open documents with the notes-mode pair and the active tab; opening a
// workspace restores them. Files that were moved are listed with a "重新定位" button, so the
// workspace keeps them. Pinned documents are a short list separate from the recent list.

export function createWorkspaces({ api, guard, status, sessions, activeId, activate, addDocuments, notes, $ }) {
  const panel = document.createElement('section');
  panel.className = 'workspacePanel'; panel.id = 'workspacePanel'; panel.setAttribute('aria-labelledby', 'workspaceTitle');
  panel.innerHTML = `<div class="workspaceHeading"><h2 id="workspaceTitle">继续工作</h2><button id="workspaceSave" type="button" data-icon="save">保存当前标签为工作区…</button></div>
    <div id="workspaceList" class="workspaceList" role="list" aria-label="工作区"></div>
    <div class="pinnedHeading"><h3>固定文档</h3><small>在标签上单击右键可以固定</small></div>
    <div id="pinnedList" class="pinnedList" role="list" aria-label="固定文档"></div>
    <p id="workspaceHint" class="workspaceHint">把论文、合同、会议材料等一组文档（包括笔记模式的左右搭配）保存为工作区，下次一键回到原样。</p>`;
  $('recentHeading')?.closest('.recentPanel')?.before(panel);
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const when = ms => { if (!ms) return ''; const d = new Date(ms); return `${d.getMonth() + 1} 月 ${d.getDate()} 日 ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

  async function refresh() {
    const [list, pinned] = await Promise.all([api.workspaceList(), api.pinnedList()]);
    const box = $('workspaceList'); box.replaceChildren();
    for (const w of list) {
      const card = el('div', 'workspaceCard'); card.setAttribute('role', 'listitem');
      const open = el('button', 'workspaceOpen'); open.type = 'button'; open.title = w.names.join('\n');
      open.append(el('strong', '', w.name), el('small', '', `${w.count} 个文档${w.notes ? ' · 笔记模式' : ''}${w.missing ? ` · ${w.missing} 个需重新定位` : ''} · ${when(w.updated)}`));
      open.onclick = () => guard(() => openWorkspace(w.id));
      const more = el('button', 'workspaceMore'); more.type = 'button'; more.dataset.icon = 'down'; more.title = '更多'; more.setAttribute('aria-label', `${w.name} 的更多操作`);
      more.onclick = () => menu(w, more);
      card.append(open, more); if (w.missing) card.classList.add('hasMissing'); box.append(card);
    }
    const pins = $('pinnedList'); pins.replaceChildren();
    for (const p of pinned) {
      const chip = el('div', 'pinnedChip' + (p.missing ? ' isMissing' : '')); chip.setAttribute('role', 'listitem');
      const open = el('button', '', p.name); open.type = 'button'; open.title = p.missing ? '文件已被移动或删除：' + p.path : p.path; open.dataset.icon = /\.md$|\.markdown$/i.test(p.path) ? 'markdown' : 'file';
      open.onclick = () => guard(async () => addDocuments(await api.openPinned(p.id)));
      const x = el('button', 'pinnedRemove'); x.type = 'button'; x.dataset.icon = 'x'; x.title = '取消固定'; x.setAttribute('aria-label', `取消固定 ${p.name}`);
      x.onclick = () => guard(async () => { await api.unpin(p.id); await refresh(); });
      chip.append(open, x); pins.append(chip);
    }
    panel.querySelector('.pinnedHeading').hidden = !pinned.length;
    $('workspaceHint').hidden = !!(list.length || pinned.length);
    $('workspaceSave').disabled = ![...sessions.values()].some(s => s.loaded && (s.path || s.converted));
    return { list, pinned };
  }
  function menu(w, anchor) {
    const pop = el('div', 'workspaceMenu'); pop.popover = 'auto';
    const item = (label, fn) => { const b = el('button', '', label); b.type = 'button'; b.onclick = () => { pop.hidePopover(); guard(fn); }; pop.append(b); };
    item('打开', () => openWorkspace(w.id));
    item('用当前标签更新', () => save(w.id, w.name));
    item('重命名…', async () => { const name = await promptText({ title: '重命名工作区', label: '工作区名称：', value: w.name }); if (name && name.trim()) { await api.workspaceRename(w.id, name.trim()); await refresh(); } });
    item('删除工作区（不删除文件）', async () => { if (confirm(`删除工作区“${w.name}”？其中的文件不会被删除。`)) { await api.workspaceRemove(w.id); await refresh(); } });
    document.body.append(pop); const r = anchor.getBoundingClientRect(); pop.style.left = Math.min(r.left, innerWidth - 220) + 'px'; pop.style.top = (r.bottom + 4) + 'px';
    pop.addEventListener('toggle', e => { if (e.newState === 'closed') pop.remove(); }); pop.showPopover();
  }
  async function save(id, name) {
    const ids = [...sessions.values()].filter(s => s.loaded).map(s => s.id);
    if (!id && name == null) { name = await promptText({ title: '保存为工作区', label: '工作区名称（会记住打开的文档、笔记模式的搭配和当前标签）：', value: defaultName(), okLabel: '保存' }); if (!name || !name.trim()) return null; }
    const pair = notes.ids?.(), result = await api.workspaceSave({ id, name: name?.trim(), ids, activeId: activeId(), split: pair ? { leftId: pair[0], rightId: pair[1], ratio: notes.ratio?.() } : null });
    status(`已保存工作区“${result.name}”：${result.count} 个文档` + (result.skipped ? `；${result.skipped} 个未保存的新文档没有放进去` : ''));
    await refresh(); return result;
  }
  const defaultName = () => { const first = [...sessions.values()].find(s => s.loaded && (s.path || s.converted)); return first ? first.name.replace(/\.[^.]+$/, '') + ' 等' : '我的工作区'; };
  async function openWorkspace(id) {
    const result = await api.workspaceOpen(id);
    await addDocuments(result.opened);
    const loaded = async docId => { for (let n = 0; n < 200 && docId && !sessions.get(docId)?.loaded; n++) await new Promise(r => setTimeout(r, 50)); return sessions.get(docId)?.loaded; };
    if (result.split?.leftId && result.split?.rightId && await loaded(result.split.leftId) && await loaded(result.split.rightId)) { notes.start(result.split.leftId, result.split.rightId); notes.setRatio?.(result.split.ratio); }
    if (result.activeId && sessions.has(result.activeId)) activate(result.activeId);
    if (result.missing.length) relocatePrompt(id, result.missing);
    else status(`已打开工作区“${result.name}”`);
    await refresh(); return result;
  }
  // Moved files: offer to locate each one; the workspace remembers the new place.
  function relocatePrompt(id, missing) {
    const bar = el('div', 'workspaceMissing'); bar.setAttribute('role', 'alert');
    bar.append(el('strong', '', `${missing.length} 个文件找不到了（可能已被移动或改名）：`));
    for (const m of missing) {
      const row = el('div', 'workspaceMissingRow'); row.append(el('span', '', m.name)); row.title = m.path;
      const b = el('button', '', '重新定位…'); b.type = 'button';
      b.onclick = () => guard(async () => { const r = await api.workspaceRelocate(id, m.index); if (r) { await addDocuments(r.opened); row.remove(); if (!bar.querySelector('.workspaceMissingRow')) bar.remove(); await refresh(); } });
      row.append(b); bar.append(row);
    }
    const close = el('button', 'workspaceMissingClose', '稍后'); close.type = 'button'; close.onclick = () => bar.remove(); bar.append(close);
    document.body.append(bar);
  }
  $('workspaceSave').onclick = () => guard(() => save());
  async function pin(id) { const added = await api.pinDocument(id); status(added ? '已固定到首页' : '这个文档已经固定在首页'); await refresh(); }
  return { refresh, save, open: openWorkspace, pin };
}
