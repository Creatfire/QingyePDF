// Style presets per annotation type (0.19, Xodo keeps four per tool): colour, width, fill and opacity.
// Saved from the annotation edit bar ("存为预设") and offered as swatches by the shape tool.
const KEY = 'qingye.annotPresets';
const DEFAULTS = {
  Square: [{ color: '#d9482b', width: 2, fill: '', opacity: 1 }, { color: '#1d7a57', width: 2, fill: '', opacity: 1 }, { color: '#1565c0', width: 4, fill: '', opacity: 1 }, { color: '#f9a825', width: 1, fill: '#fff59d', opacity: 0.6 }],
  Circle: [{ color: '#d9482b', width: 2, fill: '', opacity: 1 }, { color: '#1565c0', width: 2, fill: '', opacity: 1 }],
  Line: [{ color: '#d9482b', width: 2, fill: '', opacity: 1 }, { color: '#212121', width: 1, fill: '', opacity: 1 }, { color: '#1565c0', width: 4, fill: '', opacity: 1 }],
};
const read = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
const valid = p => p && /^#[\da-f]{6}$/i.test(p.color) && (!p.fill || /^#[\da-f]{6}$/i.test(p.fill));
export function readPresets(kind) { const saved = read()[kind]; return (Array.isArray(saved) && saved.length ? saved.filter(valid) : DEFAULTS[kind] || []).slice(0, 4); }
// Newest first; the same style is not stored twice; at most four per type.
export function writePreset(kind, style) {
  if (!valid(style)) return readPresets(kind);
  const clean = { color: style.color.toLowerCase(), width: Math.max(0.5, Math.min(12, Number(style.width) || 2)), fill: style.fill ? style.fill.toLowerCase() : '', opacity: Math.max(0.1, Math.min(1, Number(style.opacity) || 1)) };
  const same = p => p.color === clean.color && p.width === clean.width && (p.fill || '') === clean.fill && p.opacity === clean.opacity;
  const list = [clean, ...readPresets(kind).filter(p => !same(p))].slice(0, 4), all = read();
  all[kind] = list;
  try { localStorage.setItem(KEY, JSON.stringify(all)); } catch {}
  return list;
}
// Shape tool kinds → stored annotation types.
export const SHAPE_KIND = { rect: 'Square', cloud: 'Square', ellipse: 'Circle', line: 'Line', arrow: 'Line' };
