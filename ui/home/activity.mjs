// 0.16.0 — a small reading diary kept in this browser profile only (localStorage): documents opened,
// minutes spent in a document tab and excerpts made, per day. Used by the home layouts' charts.
const KEY = 'qingye.activity.v1', KEEP_DAYS = 160;
const dayKey = (d = new Date()) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
function load() { try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v.days === 'object' ? v : { days: {} }; } catch { return { days: {} }; } }
function save(v) {
  const cut = dayKey(new Date(Date.now() - KEEP_DAYS * 864e5));
  for (const k of Object.keys(v.days)) if (k < cut) delete v.days[k];
  try { localStorage.setItem(KEY, JSON.stringify(v)); } catch {}
}
export function createActivity({ isReading }) {
  let lastInput = Date.now();
  const bump = (field, n = 1) => { const v = load(), k = dayKey(); const d = v.days[k] ||= { o: 0, m: 0, e: 0 }; d[field] = (d[field] || 0) + n; save(v); document.dispatchEvent(new CustomEvent('qingye:activity')); };
  for (const type of ['pointerdown', 'keydown', 'wheel']) addEventListener(type, () => { lastInput = Date.now(); }, { capture: true, passive: true });
  document.addEventListener('qingye:excerpt', () => bump('e'));
  // A minute counts when the window has focus, a document tab is shown and the reader acted recently
  // (inside a PDF frame the focus itself is the signal: its events do not reach this window).
  setInterval(() => { if (document.hasFocus() && isReading() && (Date.now() - lastInput < 180000 || document.activeElement?.tagName === 'IFRAME')) bump('m'); }, 60000);
  return {
    record: kind => bump(kind === 'open' ? 'o' : kind === 'excerpt' ? 'e' : 'm'),
    /** Days ending today, oldest first: [{ date, o, m, e }]. */
    days(count) { const v = load(), out = []; for (let i = count - 1; i >= 0; i--) { const d = new Date(Date.now() - i * 864e5), k = dayKey(d); out.push({ date: d, key: k, o: 0, m: 0, e: 0, ...(v.days[k] || {}) }); } return out; },
    today() { return { o: 0, m: 0, e: 0, ...(load().days[dayKey()] || {}) }; },
  };
}
