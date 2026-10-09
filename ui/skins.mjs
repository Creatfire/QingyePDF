// 0.17.0 — interface skins. A skin re-tints the whole app shell (title bar, tabs, toolbars, side panels,
// dialogs) through the design tokens; it is independent of the home layout. "classic" sets no attribute.
export const SKINS = [
  { id: 'classic', label: '经典', note: '深绿框架，琥珀选中，错版阴影' },
  { id: 'glass', label: '玻璃', note: '磨砂半透明，圆角，柔光边' },
  { id: 'bento', label: '版画格', note: '厚错版阴影，直角，等宽标签' },
  { id: 'desk', label: '桌面', note: '纸张与文件夹标签，衬线标题' },
  { id: 'blocks', label: '色块', note: '零圆角，实心大色块，深色缝隙' },
  { id: 'dots', label: '墨绿网点', note: '墨绿网点底，斜切标签' },
];
const KEY = 'qingye.skin';
const valid = id => SKINS.some(s => s.id === id);

export function readSkin() { try { const v = localStorage.getItem(KEY); return valid(v) ? v : 'classic'; } catch { return 'classic'; } }
export function applySkin(id) {
  const root = document.documentElement;
  if (id && id !== 'classic' && valid(id)) root.dataset.skin = id; else delete root.dataset.skin;
}
export function createSkins() {
  return {
    get: readSkin,
    set(id) { const v = valid(id) ? id : 'classic'; try { localStorage.setItem(KEY, v); } catch {} applySkin(v); document.dispatchEvent(new CustomEvent('qingye:skin', { detail: v })); },
    init() { applySkin(readSkin()); },
  };
}
