// 0.16.0 — optional home layouts. "classic" is the original home (index.html); the others render
// into #homeAlt. The choice is stored per profile and applies at once.
import { createHomeData, createHomeActions, createLauncher } from './core.mjs';
export const HOME_LAYOUTS = [
  { id: 'classic', label: '经典', note: '列表与分类色块' },
  { id: 'glass', label: '玻璃', note: '磨砂玻璃，光随指针移动' },
  { id: 'bento', label: '版画格', note: '错版方格，悬停抬起、按下压印' },
  { id: 'desk', label: '桌面', note: '文档像纸张摊在桌上，可拖动、会晃动' },
  { id: 'blocks', label: '色块', note: '大色块拼贴，按压收缩、滑过放大' },
];
const KEY = 'qingye.homeLayout';
const modules = { glass: () => import('./glass.mjs'), bento: () => import('./bento.mjs'), desk: () => import('./desk.mjs'), blocks: () => import('./blocks.mjs') };
export function createHomeLayouts({ api, guard, addDocuments, sessions, activity, openTool, openConverter, compare, isHomeVisible }) {
  const host = document.getElementById('homeAlt'), classic = document.querySelector('#home .homeContent'), home = document.getElementById('home');
  const data = createHomeData({ api, sessions, activity });
  const actions = createHomeActions({ api, guard, addDocuments, sessions, openTool, openConverter, compare });
  let snap = data.snapshot(), view = null, layout = 'classic', ticket = 0;
  const launcher = createLauncher({ actions, getRecent: () => snap.recent });
  const get = () => { try { const v = localStorage.getItem(KEY); return HOME_LAYOUTS.some(l => l.id === v) ? v : 'classic'; } catch { return 'classic'; } };
  async function draw() {
    const my = ++ticket;
    if (layout === 'classic') { view?.destroy?.(); view = null; host.replaceChildren(); host.hidden = true; classic.hidden = false; home.dataset.layout = 'classic'; return; }
    const mod = await modules[layout](); if (my !== ticket) return;
    view?.destroy?.(); host.replaceChildren(); classic.hidden = true; host.hidden = false; home.dataset.layout = layout;
    const root = document.createElement('div'); host.append(root);
    view = mod.render(root, { snap, actions, launcher, data, refresh });
  }
  // Classic is drawn too: draw() is what hides #homeAlt and shows the original home again.
  async function refresh() { try { snap = await data.load(); } catch (error) { console.warn('home data', error); } if (layout === 'classic' || isHomeVisible()) await draw(); }
  // Ctrl+K opens the launcher while the home page is shown (Markdown keeps Ctrl+K for links).
  addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'k' && isHomeVisible() && layout !== 'classic') { e.preventDefault(); if (view?.ctrlK) view.ctrlK(); else launcher.open(); } }, true);
  let pending = 0; document.addEventListener('qingye:activity', () => { clearTimeout(pending); pending = setTimeout(() => { if (isHomeVisible() && layout !== 'classic') { snap = { ...data.snapshot(), recent: snap.recent, excerpts: snap.excerpts }; draw(); } }, 400); });
  return {
    get, launcher,
    async set(id) { layout = HOME_LAYOUTS.some(l => l.id === id) ? id : 'classic'; try { localStorage.setItem(KEY, layout); } catch {} await refresh(); if (!isHomeVisible()) await draw(); },
    async init() { layout = get(); await refresh(); if (layout !== 'classic') await draw(); },
    refresh,
  };
}
