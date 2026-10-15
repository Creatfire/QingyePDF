// Text markup from a PDF selection (Xodo-style floating bar): highlight, underline, strikeout,
// squiggly and copy. Each selected line becomes one quad of a standard PDF annotation written by
// the backend ('markup' action), so other readers show and edit it; undo uses the edit history.
import { readSettings } from './settings.mjs';

export const MARKUP_KINDS = [
  ['highlight', '高亮', '#f5c518', 0.55],
  ['underline', '下划线', '#1d7a57', 1],
  ['strikeout', '删除线', '#d9482b', 1],
  ['squiggly', '波浪线', '#d9482b', 1],
];

// Client rects of a selection → { page: [[x0,y0,x1,y1] fractions of the displayed page] },
// one rect per text line (rects on the same line are merged).
export function selectionMarks(range, pages) {
  const byPage = new Map();
  for (const r of range.getClientRects()) {
    if (r.width < 0.5 || r.height < 0.5) continue;
    const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
    const page = pages.find(p => cx >= p.box.left && cx <= p.box.right && cy >= p.box.top && cy <= p.box.bottom);
    if (!page || r.height > page.box.height * 0.2) continue; // skip layout helpers such as endOfContent
    const list = byPage.get(page.number) || []; byPage.set(page.number, list);
    const line = list.find(l => Math.min(l.bottom, r.bottom) - Math.max(l.top, r.top) > Math.min(l.bottom - l.top, r.height) * 0.5);
    if (line) { line.left = Math.min(line.left, r.left); line.right = Math.max(line.right, r.right); line.top = Math.min(line.top, r.top); line.bottom = Math.max(line.bottom, r.bottom); }
    else list.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, box: page.box });
  }
  const clamp = v => Math.round(Math.max(0, Math.min(1, v)) * 1e5) / 1e5;
  return [...byPage].map(([page, lines]) => ({ page, rects: lines.sort((a, b) => a.top - b.top || a.left - b.left).map(l => [
    clamp((l.left - l.box.left) / l.box.width), clamp((l.top - l.box.top) / l.box.height), clamp((l.right - l.box.left) / l.box.width), clamp((l.bottom - l.box.top) / l.box.height),
  ]) })).filter(m => m.rects.length);
}

export function createMarkup({ current, applyEdit, guard, status }) {
  const bar = document.createElement('div');
  bar.className = 'markupBar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', '文字批注'); bar.hidden = true;
  for (const [kind, label, color] of MARKUP_KINDS) {
    const b = document.createElement('button'); b.type = 'button'; b.dataset.kind = kind; b.title = label; b.setAttribute('aria-label', label);
    b.innerHTML = `<span class="markupSwatch markup-${kind}" style="--markup:${color}">文</span>`;
    bar.append(b);
  }
  const copy = document.createElement('button'); copy.type = 'button'; copy.dataset.kind = 'copy'; copy.dataset.icon = 'copy'; copy.textContent = '复制'; bar.append(copy);
  document.body.append(bar);
  let pending = null; // { session, marks, text }

  function hide() { bar.hidden = true; pending = null; }
  function inspect(s, { show = true } = {}) {
    const doc = s.frame.contentDocument, sel = doc.getSelection();
    if ((show && !readSettings().markupBar) || !sel?.rangeCount || sel.isCollapsed || s.editBusy || s.saving || s.app.pdfViewer.annotationEditorMode > 0) return hide();
    const range = sel.getRangeAt(0);
    if (!range.commonAncestorContainer.parentElement?.closest('.pdfViewer') || !doc.querySelector('.textLayer')) return hide();
    const text = sel.toString().trim();
    if (!text) return hide();
    const pages = [...doc.querySelectorAll('.page[data-page-number]')].map(p => ({ number: Number(p.dataset.pageNumber), box: (p.querySelector('.textLayer') || p).getBoundingClientRect() }));
    const marks = selectionMarks(range, pages);
    if (!marks.length) return hide();
    pending = { session: s, marks, text };
    if (!show) return;
    const rects = [...range.getClientRects()].filter(r => r.width > 0.5), last = rects.at(-1), frame = s.frame.getBoundingClientRect();
    bar.hidden = false;
    const w = bar.offsetWidth, h = bar.offsetHeight;
    const left = Math.max(8, Math.min(innerWidth - w - 8, frame.left + last.right - w / 2));
    const below = frame.top + last.bottom + 8, above = frame.top + rects[0].top - h - 8;
    bar.style.left = left + 'px'; bar.style.top = (below + h < innerHeight - 8 ? below : Math.max(8, above)) + 'px';
  }
  bar.addEventListener('mousedown', e => e.preventDefault());
  bar.addEventListener('click', e => {
    const kind = e.target.closest('button')?.dataset.kind, job = pending;
    if (!kind || !job) return;
    if (kind === 'copy') { navigator.clipboard.writeText(job.text).then(() => status('已复制所选文字。'), () => status('无法写入剪贴板。')); hide(); return; }
    hide();
    guard(() => apply(job.session, kind, job.marks, job.text));
  });

  async function apply(s, kind, marks, text) {
    const [, label, color, opacity] = MARKUP_KINDS.find(k => k[0] === kind);
    const settings = readSettings();
    s.frame.contentDocument.getSelection()?.removeAllRanges();
    const pages = marks.map(m => m.page);
    const where = pages.length > 1 ? `第 ${pages[0]}–${pages.at(-1)} 页` : `第 ${pages[0]} 页`;
    const result = await applyEdit(s, { action: 'markup', annotation: kind, marks, color, opacity, author: settings.annotAuthor || '', text: settings.markupCopyText ? text.slice(0, 10000) : '' }, `${label} · ${where}`);
    if (!result?.canceled) status(`已添加${label}（${where}），可撤销。`);
    return result;
  }

  function bind(s) {
    const doc = s.frame.contentDocument;
    doc.addEventListener('pointerup', e => { if (e.button === 0) setTimeout(() => current() === s && inspect(s), 0); });
    doc.addEventListener('keyup', e => { if (e.shiftKey || e.key === 'Shift') inspect(s); });
    doc.addEventListener('pointerdown', () => hide());
    doc.getElementById('viewerContainer')?.addEventListener('scroll', () => { if (!bar.hidden) hide(); }, { passive: true });
    // Single-letter tools (Xodo): H U S G mark the selection; H I T C pick a PDF.js tool; P leaves.
    // Captured before PDF.js so its own letter shortcuts do not fire for these keys.
    doc.addEventListener('keydown', e => {
      if (!readSettings().annotKeys || e.ctrlKey || e.metaKey || e.altKey || e.repeat || current() !== s) return;
      if (e.target.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""], [contenteditable="plaintext-only"]')) return;
      if (!document.getElementById('directEditor')?.hidden) return;
      const key = e.key.toLowerCase(), stop = () => { e.preventDefault(); e.stopImmediatePropagation(); };
      const kind = { h: 'highlight', u: 'underline', s: 'strikeout', g: 'squiggly' }[key];
      if (kind && applyToSelection(kind, s)) return stop();
      const tool = { h: 'editorHighlightButton', i: 'editorInkButton', t: 'editorFreeTextButton', c: 'editorCommentButton' }[key];
      if (tool) { const b = doc.getElementById(tool); if (b && !b.disabled) { b.click(); stop(); } return; }
      if (key === 'p' && s.app.pdfViewer.annotationEditorMode > 0) { s.app.eventBus.dispatch('switchannotationeditormode', { source: null, mode: 0 }); stop(); }
    }, true);
  }
  // Applies a markup to the current selection without the bar (keyboard shortcuts).
  function applyToSelection(kind, s = current()) {
    if (!s?.loaded) return false;
    inspect(s, { show: false }); const job = pending; hide();
    if (!job) return false;
    guard(() => apply(s, kind, job.marks, job.text));
    return true;
  }
  return { bind, hide, applyToSelection };
}
