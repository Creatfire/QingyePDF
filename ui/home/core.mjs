// 0.16.0 — shared parts of the optional home layouts (Settings → 常规 → 首页样式): data, small DOM
// helpers, actions and the quick launcher (Ctrl+K on the home page). Layout modules only arrange it.
import { toolCatalog, toolKey } from '../tool-catalog.mjs';
import { current as uiLanguage } from '../i18n/i18n.mjs';

export const el = (tag, cls, text) => { const n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; };
export const icon = (name, cls = 'hIcon') => { const n = el('span', cls); n.dataset.icon = name; n.setAttribute('aria-hidden', 'true'); return n; };
export const reduceMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
export const isMdPath = p => /\.(md|markdown|mdown|mkdn?|mdwn)$/i.test(p || '');
export const folderOf = p => { const parts = String(p || '').split(/[\\/]/).filter(Boolean); return parts.length > 2 ? parts.slice(-3, -1).join('/') : parts.slice(-2, -1).join('/') || '/'; };
export const baseName = n => String(n || '').replace(/\.(pdf|md|markdown|mdown|mkdn?|mdwn)$/i, '');
export function fmtSize(bytes) { if (bytes == null) return '—'; if (bytes < 1024) return bytes + ' B'; if (bytes < 1048576) return Math.round(bytes / 1024) + ' KB'; return (bytes / 1048576).toFixed(1) + ' MB'; }
export function when(ms) {
  if (!ms) return '';
  const now = Date.now(), d = new Date(ms), day = 864e5, today = new Date(); today.setHours(0, 0, 0, 0); const start = today.getTime();
  const hm = `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  if (now - ms < 60000) return '刚刚';
  if (now - ms < 3600000 && ms >= start) return Math.floor((now - ms) / 60000) + ' 分钟前';
  if (ms >= start) return '今天 ' + hm;
  if (ms >= start - day) return '昨天 ' + hm;
  if (ms >= start - 6 * day) return Math.ceil((start - ms) / day) + ' 天前';
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}
export const greeting = () => { const h = new Date().getHours(); return h < 6 ? '夜深了，慢慢读' : h < 11 ? '早上好' : h < 14 ? '中午好' : h < 18 ? '下午好' : '晚上好'; };
export const dateLine = (opts = { weekday: 'short', month: 'long', day: 'numeric' }) => { try { return new Intl.DateTimeFormat(uiLanguage() || 'zh-CN', opts).format(new Date()); } catch { return new Date().toDateString(); } };
/** 问候 · 日期：分成两个文本节点，界面翻译能分别处理。 */
export const kicker = (cls, opts) => { const p = el('p', cls); p.append(el('span', null, greeting()), el('span', null, ' · '), el('span', null, dateLine(opts))); return p; };
export function hm(minutes) { return minutes >= 60 ? (minutes / 60).toFixed(1).replace(/\.0$/, '') + 'h' : minutes + 'm'; }

const PIN = 'qingye.home.pinned', TOOLS = 'qingye.home.tools';
const readJson = (k, d) => { try { return JSON.parse(localStorage.getItem(k) || '') ?? d; } catch { return d; } };
const writeJson = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} };
export const pins = { has: p => readJson(PIN, []).includes(p), toggle(p) { const l = readJson(PIN, []); writeJson(PIN, l.includes(p) ? l.filter(x => x !== p) : [p, ...l].slice(0, 50)); } };
export const toolHistory = { note(key) { const m = readJson(TOOLS, {}); m[key] = (m[key] || 0) + 1; writeJson(TOOLS, m); }, top(n) { const m = readJson(TOOLS, {}); return Object.entries(m).sort((a, b) => b[1] - a[1]).slice(0, n).map(([k]) => k); } };
export const allTools = () => toolCatalog.flatMap(c => c.tools.map(t => ({ ...t, category: c.id, categoryLabel: c.label, key: toolKey(t) })));

/** Everything a layout shows, gathered once per refresh. */
export function createHomeData({ api, sessions, activity }) {
  let excerpts = [], converterInfo = undefined, recent = [];
  return {
    async load() {
      recent = (await api.recent()).map(item => {
        const md = isMdPath(item.path), open = [...sessions.values()].some(s => s.path && s.path === item.path);
        return { ...item, md, open, folder: folderOf(item.path), progress: !md && item.pages ? Math.min(1, item.page / item.pages) : 0, pinned: pins.has(item.path) };
      });
      try { excerpts = await api.homeExcerpts(); } catch { excerpts = []; }
      return this.snapshot();
    },
    snapshot() {
      const days = activity.days(119), week = days.slice(-7);
      const folders = Object.entries(recent.reduce((m, r) => (m[r.folder] = (m[r.folder] || 0) + 1, m), {})).sort((a, b) => b[1] - a[1]).slice(0, 5).map(([name, count]) => ({ name, count }));
      return { recent, excerpts, days, week, today: activity.today(), folders,
        weekOpens: week.reduce((s, d) => s + d.o, 0), weekMinutes: week.reduce((s, d) => s + d.m, 0), weekExcerpts: week.reduce((s, d) => s + d.e, 0),
        continueItems: recent.filter(r => r.md || r.page > 0).slice(0, 3), converter: converterInfo };
    },
    /** Pandoc's writer list, read once and only when a layout asks for it (it starts the engine). */
    async converter() { if (converterInfo === undefined) { try { converterInfo = await api.converterInfo(); } catch { converterInfo = null; } } return converterInfo; },
  };
}

/** Actions shared by every layout. */
export function createHomeActions({ api, guard, addDocuments, sessions, openTool, openConverter, compare }) {
  const click = id => document.getElementById(id)?.click();
  async function goToPage(opened, page) {
    const id = opened?.[0]?.id; if (!id || !page) return;
    for (let i = 0; i < 100; i++) { const s = sessions.get(id); if (s?.loaded && s.app?.pdfViewer) { s.app.pdfViewer.currentPageNumber = Math.min(page, s.app.pagesCount || page); return; } await new Promise(r => setTimeout(r, 100)); }
  }
  return {
    open: () => click('welcomeOpen'), newMarkdown: () => click('newMarkdownButton'), convert: () => click('homeConvertButton'), sample: () => click('exampleButton'),
    openRecent: (item, page) => guard(async () => { const opened = await api.openRecent(item.id); await addDocuments(opened); if (page) await goToPage(opened, page); }),
    openExcerpt: excerpt => guard(async () => { if (!excerpt?.id) throw new Error('这条摘录来自未保存的 PDF，无法跳回原处。'); const r = await api.homeOpenExcerpt(excerpt.id); await addDocuments(r.opened); await goToPage(r.opened, r.page); }),
    tool: t => guard(async () => { toolHistory.note(t.key || toolKey(t)); if (t.converter) return openConverter(); if (t.compareView) return compare(); await openTool(t.action, { mode: t.mode, category: t.category }); }),
    togglePin: item => { pins.toggle(item.path); },
  };
}

/** Ctrl+K: one box for opening, recent files and every tool. */
export function createLauncher({ actions, getRecent }) {
  const dialog = el('dialog', 'homeLauncher'); dialog.setAttribute('aria-label', '快速启动');
  const input = el('input', 'launcherInput'); input.type = 'search'; input.placeholder = '打开文件、搜索最近、运行工具…'; input.setAttribute('aria-label', '快速启动');
  const list = el('div', 'launcherList'); list.setAttribute('role', 'listbox');
  dialog.append(input, list); document.body.append(dialog);
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });
  let items = [], index = 0;
  const base = () => [
    { kind: '操作', label: '打开文件…', icon: 'open', run: actions.open },
    { kind: '操作', label: '新建 Markdown', icon: 'newdoc', run: actions.newMarkdown },
    { kind: '操作', label: '文档转换中心', icon: 'markdown', run: actions.convert },
    ...getRecent().map(r => ({ kind: r.md ? 'MD' : 'PDF', label: r.name, hint: r.folder, icon: r.md ? 'markdown' : 'file', run: () => actions.openRecent(r) })),
    ...allTools().map(t => ({ kind: t.categoryLabel, label: t.label, icon: t.icon, run: () => actions.tool(t) })),
  ];
  function draw() {
    const q = input.value.trim().toLowerCase(), all = base();
    items = (q ? all.filter(i => (i.label + ' ' + (i.hint || '') + ' ' + i.kind).toLowerCase().includes(q)) : all).slice(0, 40); index = Math.min(index, Math.max(0, items.length - 1));
    list.replaceChildren(...items.map((it, i) => { const b = el('button', 'launcherItem'); b.type = 'button'; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(i === index)); b.append(icon(it.icon), el('span', 'launcherLabel', it.label), el('span', 'launcherKind', it.kind)); b.onclick = () => { dialog.close(); it.run(); }; return b; }));
    if (!items.length) list.append(el('p', 'launcherEmpty', '没有匹配的文件或工具'));
    list.children[index]?.scrollIntoView?.({ block: 'nearest' });
  }
  input.oninput = () => { index = 0; draw(); };
  input.onkeydown = e => {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); index = (index + (e.key === 'ArrowDown' ? 1 : -1) + items.length) % Math.max(1, items.length); draw(); }
    else if (e.key === 'Enter' && items[index]) { e.preventDefault(); dialog.close(); items[index].run(); }
  };
  return { open(text = '') { input.value = text; index = 0; draw(); if (!dialog.open) dialog.showModal(); input.focus(); } };
}

/** Drives a set of springs with one requestAnimationFrame loop that stops when everything rests. */
export function springLoop(step) {
  let raf = 0, last = 0;
  const frame = t => { const dt = Math.min(0.032, last ? (t - last) / 1000 : 0.016); last = t; if (step(dt)) raf = requestAnimationFrame(frame); else { raf = 0; last = 0; } };
  return { kick() { if (!raf && !reduceMotion()) raf = requestAnimationFrame(frame); }, stop() { cancelAnimationFrame(raf); raf = 0; last = 0; } };
}
