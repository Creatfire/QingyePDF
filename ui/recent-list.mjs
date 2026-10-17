// Home page: the recent list — filter by document type, filter by name, remove an entry
// (removing only forgets the entry; the file itself is untouched).
export function createRecentList({ api, guard, addDocuments, $ }) {
  let items = [], filter = 'all', limit = 12;
  const isMdPath = p => /\.(md|markdown|mdown|mkdn?|mdwn)$/i.test(p || '');
  // Recent entries carry their kind (pdf / markdown / office) and extension from the main process.
  const kindOf = i => i.kind || (isMdPath(i.path) ? 'markdown' : 'pdf');
  function badge(i) {
    const kind = kindOf(i), ext = (i.ext || '').toLowerCase();
    if (kind === 'markdown') return ['MD', 'md'];
    if (kind !== 'office') return ['PDF', ''];
    if (/^(xls|xlsx|xlsm|xlsb|ods|csv|et)$/.test(ext)) return [ext === 'csv' ? 'CSV' : 'XLS', 'excel'];
    if (/^(ppt|pptx|pptm|pps|ppsx|odp|dps)$/.test(ext)) return ['PPT', 'powerpoint'];
    return [/^(odt|ott)$/.test(ext) ? 'ODT' : ext === 'rtf' ? 'RTF' : 'DOC', 'word'];
  }
  function when(ms) {
    if (!ms) return '';
    const d = new Date(ms), now = new Date(), day = 86400000, start = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    const hm = d.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false });
    if (ms >= start) return '今天 ' + hm;
    if (ms >= start - day) return '昨天 ' + hm;
    if (ms >= start - 6 * day) return Math.ceil((start - ms) / day) + ' 天前';
    return d.getFullYear() === now.getFullYear() ? `${d.getMonth() + 1} 月 ${d.getDate()} 日` : `${d.getFullYear()}-${d.getMonth() + 1}-${d.getDate()}`;
  }
  function render() {
    const term = $('recentSearch').value.trim().toLowerCase(), list = $('recent');
    const shown = items.filter(i => (filter === 'all' || kindOf(i) === filter) && (!term || i.name.toLowerCase().includes(term) || i.path.toLowerCase().includes(term)));
    list.replaceChildren();
    if (!shown.length) {
      const empty = document.createElement('div'); empty.className = 'emptyRecent';
      const title = document.createElement('strong'), hint = document.createElement('span');
      title.textContent = items.length ? '没有符合条件的文件' : '还没有打开过文件';
      hint.textContent = items.length ? '换个关键词或类型试试。' : '打开 PDF、Markdown 或 Word / Excel / PPT 文件（也可以直接拖进窗口），或者先看看右侧的示例。';
      empty.append(title, hint); list.append(empty); return;
    }
    for (const item of shown.slice(0, limit)) {
      const [text, badgeKind] = badge(item);
      const row = document.createElement('div'); row.className = 'recentRow'; row.setAttribute('role', 'listitem');
      const open = document.createElement('button'); open.className = 'recentOpen'; open.title = item.path; open.setAttribute('aria-label', `打开 ${item.name}`);
      open.style.cssText = 'position:absolute;inset:0;border-radius:10px;padding:0;background:none';
      open.onclick = () => guard(async () => addDocuments(await api.openRecent(item.id)));
      const icon = document.createElement('span'); icon.className = 'recentIcon' + (badgeKind ? ' ' + badgeKind : ''); icon.textContent = text; icon.setAttribute('aria-hidden', 'true');
      const body = document.createElement('span'); body.className = 'recentText';
      const name = document.createElement('span'); name.className = 'recentName'; name.textContent = item.name;
      const file = document.createElement('span'); file.className = 'recentPath'; file.textContent = item.path.replace(/[\\/][^\\/]*$/, '') || item.path;
      body.append(name, file);
      const meta = document.createElement('span'); meta.className = 'recentMeta';
      if (item.page > 1) { const b = document.createElement('b'); b.textContent = `读到第 ${item.page} 页`; meta.append(b); }
      if (kindOf(item) === 'office') { const b = document.createElement('b'); b.className = 'recentAsPdf'; b.textContent = '以 PDF 打开'; meta.append(b); }
      meta.append(document.createTextNode(when(item.opened)));
      const remove = document.createElement('button'); remove.className = 'recentRemove'; remove.dataset.icon = 'x'; remove.title = '从最近列表中移除（不删除文件）'; remove.setAttribute('aria-label', `从最近列表中移除 ${item.name}`);
      remove.onclick = event => { event.stopPropagation(); guard(async () => { if (await api.recentRemove?.(item.id)) { items = items.filter(x => x !== item); render(); } }); };
      for (const el of [icon, body, meta]) el.style.pointerEvents = 'none';
      row.append(open, icon, body, meta, remove); list.append(row);
    }
    if (shown.length > limit) {
      const more = document.createElement('button'); more.className = 'recentMore'; more.textContent = `显示全部 ${shown.length} 个`;
      more.onclick = () => { limit = Infinity; render(); }; list.append(more);
    }
  }
  async function refresh() { items = await api.recent(); render(); }
  for (const button of document.querySelectorAll('.recentFilter button')) button.onclick = () => { filter = button.dataset.filter; for (const other of document.querySelectorAll('.recentFilter button')) other.setAttribute('aria-pressed', String(other === button)); render(); };
  $('recentSearch').oninput = () => render();
  return { refresh, render };
}
