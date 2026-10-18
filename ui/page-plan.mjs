// Page manager plan (0.20): the final list of pages, edited in the thumbnail grid and applied in one
// step by the backend action 'pages-plan'. Entries: { key, src, page, rotate } (src 0 = this
// document, 1… = inserted PDFs) or { key, blank: true, like }. Pure functions, no DOM.
let counter = 0;
const key = () => 'p' + (++counter).toString(36);

export function initialPlan(pageCount) {
  return Array.from({ length: pageCount }, (_, page) => ({ key: key(), src: 0, page, rotate: 0 }));
}
const indexOf = (plan, keys) => plan.map((e, i) => (keys.has(e.key) ? i : -1)).filter(i => i >= 0);

/** Moves the selected entries (in their current order) so they start before plan[to] (to = length: end). */
export function move(plan, keys, to) {
  const picked = plan.filter(e => keys.has(e.key)); if (!picked.length) return plan;
  const before = plan.slice(0, to).filter(e => !keys.has(e.key)).length;
  const rest = plan.filter(e => !keys.has(e.key));
  return [...rest.slice(0, before), ...picked, ...rest.slice(before)];
}
export function rotate(plan, keys, degrees) {
  return plan.map(e => (keys.has(e.key) && !e.blank ? { ...e, rotate: (((e.rotate + degrees) % 360) + 360) % 360 } : e));
}
/** Copies of the selected entries, each placed right after the last selected entry. Returns { plan, added }. */
export function duplicate(plan, keys) {
  const at = Math.max(-1, ...indexOf(plan, keys)); if (at < 0) return { plan, added: [] };
  const copies = plan.filter(e => keys.has(e.key)).map(e => ({ ...e, key: key() }));
  return { plan: [...plan.slice(0, at + 1), ...copies, ...plan.slice(at + 1)], added: copies.map(e => e.key) };
}
export function remove(plan, keys) {
  const next = plan.filter(e => !keys.has(e.key));
  if (!next.length) throw new Error('至少保留一页。');
  return next;
}
export function insertBlank(plan, at, like = 0) {
  const entry = { key: key(), blank: true, like };
  return { plan: [...plan.slice(0, at), entry, ...plan.slice(at)], added: [entry.key] };
}
export function insertPages(plan, at, src, pageCount) {
  const entries = Array.from({ length: pageCount }, (_, page) => ({ key: key(), src, page, rotate: 0 }));
  return { plan: [...plan.slice(0, at), ...entries, ...plan.slice(at)], added: entries.map(e => e.key) };
}
/** True when the plan is exactly the document as it is (nothing to apply). */
export const unchanged = (plan, pageCount) => plan.length === pageCount && plan.every((e, i) => !e.blank && e.src === 0 && e.page === i && !e.rotate);
/** What the backend needs: no keys. */
export const serialize = plan => plan.map(e => (e.blank ? { blank: true, like: e.like } : { src: e.src, page: e.page, ...(e.rotate ? { rotate: e.rotate } : {}) }));

/** "1–3, 5, 空白页, b.pdf 1–2" — runs of consecutive pages from the same source. */
export function summary(plan, names = []) {
  const parts = []; let run = null;
  const label = r => r.blank ? '空白页' : (r.src ? (names[r.src - 1] || '插入的 PDF') + ' ' : '') + (r.from === r.to ? r.from + 1 : `${r.from + 1}–${r.to + 1}`) + (r.rotate ? `（旋转 ${r.rotate}°）` : '');
  for (const e of plan) {
    if (run && !e.blank && !run.blank && e.src === run.src && e.page === run.to + 1 && (e.rotate || 0) === run.rotate) { run.to = e.page; continue; }
    if (run) parts.push(label(run));
    run = e.blank ? { blank: true } : { src: e.src, from: e.page, to: e.page, rotate: e.rotate || 0 };
  }
  if (run) parts.push(label(run));
  return parts.join(', ');
}

// ——— split groups (0-based page indexes of the current document) ———
export function groupsEvery(pageCount, n) {
  n = Math.floor(Number(n)); if (!(n >= 1)) throw new Error('每份页数至少为 1。');
  const groups = []; for (let p = 0; p < pageCount; p += n) groups.push(Array.from({ length: Math.min(n, pageCount - p) }, (_, i) => p + i));
  return groups;
}
/** "1-3; 4-10; 11" (also , or newline between groups; 1-3,5 inside a group is not allowed to keep it simple). */
export function groupsFromRanges(spec, pageCount) {
  const parts = String(spec || '').split(/[;；\n]+/).map(s => s.trim()).filter(Boolean);
  if (!parts.length) throw new Error('请填写拆分范围，例如 1-3; 4-10。');
  return parts.map(part => {
    const m = /^(\d+)\s*(?:[-–~]\s*(\d+))?$/.exec(part); if (!m) throw new Error(`无法识别的范围：${part}`);
    const from = Number(m[1]), to = Number(m[2] || m[1]);
    if (from < 1 || to < from || to > pageCount) throw new Error(`范围超出文档页数：${part}`);
    return Array.from({ length: to - from + 1 }, (_, i) => from - 1 + i);
  });
}
/** One file per top-level bookmark; pages before the first bookmark form their own part. */
export function groupsFromBookmarks(toc, pageCount) {
  const starts = [...new Set(toc.filter(([level]) => level === 1).map(([, , page]) => page - 1).filter(p => p >= 0 && p < pageCount))].sort((a, b) => a - b);
  if (!starts.length) throw new Error('这份文档没有一级书签，无法按书签拆分。');
  if (starts[0] !== 0) starts.unshift(0);
  const titles = new Map(toc.filter(([level]) => level === 1).map(([, title, page]) => [page - 1, title]));
  return starts.map((start, i) => ({ name: titles.get(start) || '前置页', pages: Array.from({ length: (starts[i + 1] ?? pageCount) - start }, (_, k) => start + k) }));
}
