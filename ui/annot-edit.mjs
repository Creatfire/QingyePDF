// Editing annotations already in the PDF (0.19, Xodo-style): click an annotation to select it, drag
// to move, drag a handle to resize (boxes) or move an end (lines), and change colour, fill, width,
// opacity and the note from the bar. Changes are written by the backend ('annot-update' action) and
// are undoable; text markup keeps its position because it follows the text.
import { readSettings } from './settings.mjs';
import { writePreset } from './annot-presets.mjs';

const SKIP = new Set(['Link', 'Widget', 'Popup']);
export const MOVABLE = new Set(['Square', 'Circle', 'FreeText', 'Stamp', 'Text', 'Caret', 'FileAttachment', 'Sound']);
const FILLABLE = new Set(['Square', 'Circle', 'Polygon', 'FreeText']);
const BORDERED = new Set(['Square', 'Circle', 'Line', 'Polygon', 'PolyLine', 'Ink', 'FreeText']);
const LABEL = { Square: '矩形', Circle: '椭圆', Line: '直线', Polygon: '多边形', PolyLine: '折线', Ink: '自由绘制', FreeText: '文本框', Stamp: '印章 / 图片', Text: '便签', Highlight: '高亮', Underline: '下划线', StrikeOut: '删除线', Squiggly: '波浪线', Caret: '插入符', FileAttachment: '附件', Sound: '声音' };
const hex = rgb => rgb && rgb.length >= 3 ? '#' + [...rgb].slice(0, 3).map(v => Math.round(v).toString(16).padStart(2, '0')).join('') : '';
const xrefOf = id => { const m = /^(\d+)R$/.exec(id || ''); return m ? Number(m[1]) : 0; };

// Distance from p to segment ab (viewport pixels), for picking thin lines.
function segmentDistance(p, a, b) {
  const dx = b.x - a.x, dy = b.y - a.y, len = dx * dx + dy * dy;
  const t = len ? Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len)) : 0;
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy));
}
// Annotation under a viewport point: smallest box containing it, or a line within 6 px.
export function pickAnnotation(items, point) {
  let best = null, bestArea = Infinity;
  for (const item of items) {
    if (item.line) { if (segmentDistance(point, item.line[0], item.line[1]) <= 6 && 1 < bestArea) { best = item; bestArea = 1; } continue; }
    const [x0, y0, x1, y1] = item.box;
    if (point.x >= x0 - 3 && point.x <= x1 + 3 && point.y >= y0 - 3 && point.y <= y1 + 3) {
      const area = (x1 - x0) * (y1 - y0);
      if (area < bestArea) { best = item; bestArea = area; }
    }
  }
  return best;
}

export function createAnnotEdit({ current, applyEdit, guard, status, shapes }) {
  const bar = document.createElement('div');
  bar.className = 'shapeBar annotEditBar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', '编辑批注'); bar.hidden = true;
  bar.innerHTML = '<span class="shapeName"></span>'
    + '<label title="颜色"><input type="color" data-edit="color"></label>'
    + '<label data-for-border title="线宽"><select data-edit="width"><option value="1">细</option><option value="2">标准</option><option value="4">粗</option><option value="8">很粗</option></select></label>'
    + '<label data-for-fill class="shapeFill" title="填充"><input type="checkbox" data-edit="fillOn"> 填充 <input type="color" data-edit="fill"></label>'
    + '<label title="透明度">透明度 <input type="range" min="10" max="100" step="5" data-edit="opacity"></label>'
    + '<button type="button" data-edit="note">备注…</button>'
    + '<button type="button" data-edit="preset" title="把当前样式存为这类批注的预设">存为预设</button>'
    + '<button type="button" data-edit="delete" data-icon="trash" title="删除这条批注">删除</button>'
    + '<button type="button" data-done>完成</button>';
  document.body.append(bar);
  let sel = null; // { session, page, item, overlay }

  async function pageItems(s, pageNumber) {
    const view = s.app.pdfViewer.getPageView(pageNumber - 1), vp = view.viewport;
    const annots = await (await s.app.pdfDocument.getPage(pageNumber)).getAnnotations();
    return annots.filter(a => !SKIP.has(a.subtype) && xrefOf(a.id) && a.rect).map(a => {
      const [x0, y0] = vp.convertToViewportPoint(a.rect[0], a.rect[1]), [x1, y1] = vp.convertToViewportPoint(a.rect[2], a.rect[3]);
      const item = { annotation: a, kind: a.subtype, xref: xrefOf(a.id), box: [Math.min(x0, x1), Math.min(y0, y1), Math.max(x0, x1), Math.max(y0, y1)], vp };
      if (a.subtype === 'Line' && a.lineCoordinates) { const [ax, ay] = vp.convertToViewportPoint(a.lineCoordinates[0], a.lineCoordinates[1]), [bx, by] = vp.convertToViewportPoint(a.lineCoordinates[2], a.lineCoordinates[3]); item.line = [{ x: ax, y: ay }, { x: bx, y: by }]; }
      return item;
    });
  }

  function clear() { sel?.overlay.remove(); sel = null; bar.hidden = true; }
  function frac(v, size) { return Math.round(Math.max(0, Math.min(1, v / size)) * 1e5) / 1e5; }

  function placeOverlay() {
    const { overlay, item, box } = sel, pageDiv = sel.pageDiv, wrap = (pageDiv.querySelector('.canvasWrapper') || pageDiv), w = wrap.getBoundingClientRect(), p = pageDiv.getBoundingClientRect();
    const sx = w.width / item.vp.width, sy = w.height / item.vp.height;
    // Absolute positions start inside the page's border; bounding rects include it.
    Object.assign(overlay.style, { left: (w.left - p.left - pageDiv.clientLeft + box[0] * sx) + 'px', top: (w.top - p.top - pageDiv.clientTop + box[1] * sy) + 'px', width: Math.max(4, (box[2] - box[0]) * sx) + 'px', height: Math.max(4, (box[3] - box[1]) * sy) + 'px' });
    if (sel.line) for (const [k, end] of sel.line.entries()) { const h = overlay.querySelector(`[data-end="${k}"]`); Object.assign(h.style, { left: ((end.x - box[0]) * sx) + 'px', top: ((end.y - box[1]) * sy) + 'px' }); }
  }

  function syncBar() {
    if (!sel) { bar.hidden = true; return; }
    const a = sel.item.annotation, kind = sel.item.kind;
    bar.querySelector('.shapeName').textContent = (LABEL[kind] || kind) + (MOVABLE.has(kind) || kind === 'Line' ? ' · 可拖动' : '');
    bar.querySelector('[data-edit="color"]').value = hex(a.color) || '#d9482b';
    bar.querySelector('[data-for-border]').hidden = !BORDERED.has(kind);
    bar.querySelector('[data-edit="width"]').value = String([1, 2, 4, 8].reduce((b, v) => Math.abs(v - (a.borderStyle?.width || 2)) < Math.abs(b - (a.borderStyle?.width || 2)) ? v : b, 2));
    bar.querySelector('[data-for-fill]').hidden = !FILLABLE.has(kind);
    bar.querySelector('[data-edit="fillOn"]').checked = !!a.interiorColor;
    bar.querySelector('[data-edit="fill"]').value = hex(a.interiorColor) || '#ffee58';
    bar.querySelector('[data-edit="opacity"]').value = String(Math.round((a.opacity ?? 1) * 100));
    bar.hidden = false;
    const frame = sel.session.frame.getBoundingClientRect();
    bar.style.left = Math.round(frame.left + frame.width / 2 - bar.offsetWidth / 2) + 'px';
    bar.style.top = Math.round(frame.top + 10) + 'px';
  }

  function select(s, pageNumber, item) {
    clear();
    const doc = s.frame.contentDocument, pageDiv = doc.querySelector(`.page[data-page-number="${pageNumber}"]`);
    const overlay = doc.createElement('div'); overlay.className = 'qyAnnotSel' + (MOVABLE.has(item.kind) ? ' isMovable' : '') + (item.line ? ' isLine' : '');
    if (MOVABLE.has(item.kind)) for (const h of ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w']) { const d = doc.createElement('i'); d.className = 'qyHandle'; d.dataset.handle = h; overlay.append(d); }
    if (item.line) for (const k of [0, 1]) { const d = doc.createElement('i'); d.className = 'qyHandle qyEnd'; d.dataset.end = String(k); overlay.append(d); }
    pageDiv.append(overlay);
    sel = { session: s, page: pageNumber, item, overlay, pageDiv, box: [...item.box], line: item.line ? item.line.map(p => ({ ...p })) : null };
    placeOverlay(); syncBar();
    overlay.addEventListener('pointerdown', e => startDrag(e), true);
    status(`已选中${LABEL[item.kind] || '批注'}：拖动可移动${MOVABLE.has(item.kind) ? '，拖动角点可缩放' : item.line ? '，拖动端点可改方向' : ''}；Delete 删除，Esc 取消选择。`);
  }

  // ——— drag to move / resize ———
  function startDrag(e) {
    if (!sel || e.button !== 0) return;
    const handle = e.target.dataset?.handle, end = e.target.dataset?.end;
    if (!MOVABLE.has(sel.item.kind) && !sel.line) return;
    e.preventDefault(); e.stopPropagation();
    const wrap = sel.pageDiv.querySelector('.canvasWrapper') || sel.pageDiv, w = wrap.getBoundingClientRect();
    const k = sel.item.vp.width / w.width, start = { x: e.clientX, y: e.clientY }, box0 = [...sel.box], line0 = sel.line?.map(p => ({ ...p }));
    const move = ev => {
      const dx = (ev.clientX - start.x) * k, dy = (ev.clientY - start.y) * k;
      if (end != null) { sel.line[end] = { x: line0[end].x + dx, y: line0[end].y + dy }; sel.box = [Math.min(sel.line[0].x, sel.line[1].x), Math.min(sel.line[0].y, sel.line[1].y), Math.max(sel.line[0].x, sel.line[1].x), Math.max(sel.line[0].y, sel.line[1].y)]; }
      else if (handle) {
        const b = [...box0];
        if (handle.includes('w')) b[0] = Math.min(box0[2] - 4, box0[0] + dx); if (handle.includes('e')) b[2] = Math.max(box0[0] + 4, box0[2] + dx);
        if (handle.includes('n')) b[1] = Math.min(box0[3] - 4, box0[1] + dy); if (handle.includes('s')) b[3] = Math.max(box0[1] + 4, box0[3] + dy);
        sel.box = b;
      } else { sel.box = [box0[0] + dx, box0[1] + dy, box0[2] + dx, box0[3] + dy]; if (line0) sel.line = line0.map(p => ({ x: p.x + dx, y: p.y + dy })); }
      placeOverlay();
    };
    const up = ev => {
      sel.pageDiv.ownerDocument.removeEventListener('pointermove', move, true); sel.pageDiv.ownerDocument.removeEventListener('pointerup', up, true);
      if (Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 2) return;
      const vp = sel.item.vp, req = sel.line ? { points: sel.line.map(p => [frac(p.x, vp.width), frac(p.y, vp.height)]) } : { rect: [frac(sel.box[0], vp.width), frac(sel.box[1], vp.height), frac(sel.box[2], vp.width), frac(sel.box[3], vp.height)] };
      guard(() => update(req, sel.line ? '移动直线' : handle ? '调整大小' : '移动批注'));
    };
    sel.pageDiv.ownerDocument.addEventListener('pointermove', move, true); sel.pageDiv.ownerDocument.addEventListener('pointerup', up, true);
  }

  // Writes a change and re-selects the same annotation in the reloaded document (object numbers can
  // change when the file is rewritten, so it is found again by type and position).
  async function update(request, label) {
    if (!sel) return;
    const { session: s, page, item } = sel, kind = item.kind, target = request.rect || null;
    const result = await applyEdit(s, { action: 'annot-update', page, xref: item.xref, ...request }, `${label} · ${LABEL[kind] || '批注'} · 第 ${page} 页`);
    clear();
    if (result?.canceled) return;
    const items = (await pageItems(s, page)).filter(i => i.kind === kind);
    const vp = items[0]?.vp, want = target && vp ? [target[0] * vp.width, target[1] * vp.height] : item.box;
    const again = items.sort((a, b) => Math.hypot(a.box[0] - want[0], a.box[1] - want[1]) - Math.hypot(b.box[0] - want[0], b.box[1] - want[1]))[0];
    if (again) select(s, page, again);
    status(`${label}完成 · 可撤销`);
  }

  bar.addEventListener('change', e => {
    if (!sel) return;
    const name = e.target.dataset.edit, req = {};
    if (name === 'color') req.color = e.target.value;
    else if (name === 'width') req.width = Number(e.target.value);
    else if (name === 'fillOn' || name === 'fill') req.fill = bar.querySelector('[data-edit="fillOn"]').checked ? bar.querySelector('[data-edit="fill"]').value : null;
    else if (name === 'opacity') req.opacity = Number(e.target.value) / 100;
    else return;
    guard(() => update(req, '修改样式'));
  });
  bar.addEventListener('click', e => {
    const name = e.target.closest('button')?.dataset.edit;
    if (e.target.closest('[data-done]')) return clear();
    if (!sel || !name) return;
    if (name === 'delete') { const { session: s, page, item } = sel; clear(); guard(async () => { const r = await applyEdit(s, { action: 'annot-delete', items: [{ page, xref: item.xref }] }, `删除${LABEL[item.kind] || '批注'} · 第 ${page} 页`); if (!r?.canceled) status('已删除批注 · 可撤销'); }); }
    if (name === 'note') { const text = prompt('批注备注', sel.item.annotation.contentsObj?.str || ''); if (text != null) guard(() => update({ text }, '修改备注')); }
    if (name === 'preset') { const a = sel.item.annotation; writePreset(sel.item.kind, { color: bar.querySelector('[data-edit="color"]').value, width: Number(bar.querySelector('[data-edit="width"]').value), fill: FILLABLE.has(sel.item.kind) && bar.querySelector('[data-edit="fillOn"]').checked ? bar.querySelector('[data-edit="fill"]').value : '', opacity: (a.opacity ?? 1) }); status('已把当前样式存为预设，可在图形工具栏中选用。'); }
  });

  function bind(s) {
    const doc = s.frame.contentDocument;
    let down = null;
    doc.addEventListener('pointerdown', e => { down = e.button === 0 ? { x: e.clientX, y: e.clientY, target: e.target } : null; }, true);
    doc.addEventListener('pointerup', e => {
      const start = down; down = null;
      if (!start || readSettings().annotEdit === false || current() !== s || shapes?.active() || s.editBusy) return;
      if (Math.hypot(e.clientX - start.x, e.clientY - start.y) > 4 || s.app.pdfViewer.annotationEditorMode > 0) return;
      if (e.target.closest?.('.qyAnnotSel, .annotationEditorLayer [contenteditable], input, textarea, a') || !doc.getSelection().isCollapsed) return;
      const pageDiv = e.target.closest?.('.page[data-page-number]');
      if (!pageDiv) return clear();
      const pageNumber = Number(pageDiv.dataset.pageNumber), wrap = pageDiv.querySelector('.canvasWrapper') || pageDiv, w = wrap.getBoundingClientRect();
      guard(async () => {
        const items = await pageItems(s, pageNumber); if (!items.length) return clear();
        const k = items[0].vp.width / w.width, hit = pickAnnotation(items, { x: (e.clientX - w.left) * k, y: (e.clientY - w.top) * k });
        if (hit) select(s, pageNumber, hit); else clear();
      });
    }, true);
    doc.addEventListener('keydown', e => {
      if (!sel || sel.session !== s || e.target.closest?.('input, textarea, [contenteditable="true"]')) return;
      if (e.key === 'Escape') { e.preventDefault(); e.stopImmediatePropagation(); clear(); }
      if (e.key === 'Delete') { e.preventDefault(); e.stopImmediatePropagation(); bar.querySelector('[data-edit="delete"]').click(); }
    }, true);
    doc.getElementById('viewerContainer')?.addEventListener('scroll', () => { if (sel?.session === s) syncBar(); }, { passive: true });
    s.app.eventBus?.on('scalechanging', () => { if (sel?.session === s) clear(); });
  }
  return { bind, clear, select, selected: () => sel && { kind: sel.item.kind, xref: sel.item.xref, page: sel.page } };
}
