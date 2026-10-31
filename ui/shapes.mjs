// Shape annotations drawn in the viewer (Xodo-style): rectangle, ellipse, line, arrow and cloud.
// Dragging on a page previews the shape in an SVG overlay; on release the backend writes a standard
// Square / Circle / Line annotation ('draw' action), undoable through the edit history. The tool
// stays active for the next shape (continuous drawing) until Esc, P or the bar's 完成 button.
// 'note' (0.21) is the annotation menu's 评论: one click on a page asks for the text and writes a
// standard sticky note through the same action.
import { readSettings } from './settings.mjs';
import { readPresets, SHAPE_KIND } from './annot-presets.mjs';

export const SHAPES = [
  ['rect', '矩形', 'R'], ['ellipse', '椭圆', 'O'], ['line', '直线', 'L'], ['arrow', '箭头', 'A'], ['cloud', '云形框', ''],
];
const STYLE_KEY = 'qingye.shapeStyle';
const readStyle = () => { try { return { color: '#d9482b', width: 2, fill: '', ...JSON.parse(localStorage.getItem(STYLE_KEY) || '{}') }; } catch { return { color: '#d9482b', width: 2, fill: '' }; } };
const writeStyle = style => { try { localStorage.setItem(STYLE_KEY, JSON.stringify(style)); } catch {} };
const SVG = 'http://www.w3.org/2000/svg';

// Pointer positions → the request fields of the 'draw' action (fractions of the displayed page).
const NOTE_LABEL = '评论';
const labelOf = kind => kind === 'note' ? NOTE_LABEL : SHAPES.find(s => s[0] === kind)[1];

export function shapeRequest(kind, a, b) {
  const clamp = v => Math.round(Math.max(0, Math.min(1, v)) * 1e5) / 1e5;
  if (kind === 'line' || kind === 'arrow') return { points: [[clamp(a.x), clamp(a.y)], [clamp(b.x), clamp(b.y)]] };
  return { rect: [clamp(Math.min(a.x, b.x)), clamp(Math.min(a.y, b.y)), clamp(Math.max(a.x, b.x)), clamp(Math.max(a.y, b.y))] };
}

export function createShapes({ current, applyEdit, guard, status }) {
  const bar = document.createElement('div');
  bar.className = 'shapeBar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', '图形批注'); bar.hidden = true;
  bar.innerHTML = '<span class="shapeName"></span>'
    + '<label title="线条颜色"><input type="color" data-style="color"></label>'
    + '<label title="线宽"><select data-style="width"><option value="1">细</option><option value="2">标准</option><option value="4">粗</option><option value="8">很粗</option></select></label>'
    + '<label class="shapeFill" title="填充"><input type="checkbox" data-style="fillOn"> 填充 <input type="color" data-style="fill"></label>'
    + '<span class="shapePresets" role="group" aria-label="样式预设"></span>'
    + '<button type="button" data-done>完成</button>';
  document.body.append(bar);
  let tool = null, drag = null;

  // 0.22: the annotation strip under the toolbar mirrors the active shape, so it hears every change.
  function syncBar() {
    document.dispatchEvent(new CustomEvent('qy-shape-change'));
    if (!tool) { bar.hidden = true; return; }
    const style = readStyle(), label = labelOf(tool.kind), note = tool.kind === 'note';
    bar.querySelector('.shapeName').textContent = label + (note ? ' · 点击页面上要评论的位置，Esc 取消' : ' · 在页面上拖动绘制，Esc 结束');
    for (const el of bar.querySelectorAll('label, .shapePresets')) el.hidden = note;
    bar.querySelector('[data-style="color"]').value = style.color;
    bar.querySelector('[data-style="width"]').value = String(style.width);
    bar.querySelector('[data-style="fillOn"]').checked = !!style.fill;
    bar.querySelector('[data-style="fill"]').value = style.fill || '#ffee58';
    bar.querySelector('.shapeFill').hidden = note || tool.kind === 'line' || tool.kind === 'arrow';
    // Saved presets for this kind of shape (annot-presets.mjs) as one-click swatches.
    const swatches = bar.querySelector('.shapePresets'); swatches.replaceChildren();
    for (const p of note ? [] : readPresets(SHAPE_KIND[tool.kind])) {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'shapePreset'; b.title = `预设：${p.color}，线宽 ${p.width}${p.fill ? '，填充' : ''}`;
      b.style.setProperty('--preset', p.color); b.style.setProperty('--preset-fill', p.fill || 'transparent'); b.style.borderWidth = Math.min(4, p.width) + 'px';
      b.onclick = () => { writeStyle({ color: p.color, width: p.width, fill: tool.kind === 'line' || tool.kind === 'arrow' ? '' : p.fill }); syncBar(); };
      swatches.append(b);
    }
    bar.hidden = false;
    const frame = tool.session.frame.getBoundingClientRect();
    bar.style.left = Math.round(frame.left + frame.width / 2 - bar.offsetWidth / 2) + 'px';
    bar.style.top = Math.round(frame.top + 10) + 'px';
  }
  bar.addEventListener('change', () => {
    const style = { color: bar.querySelector('[data-style="color"]').value, width: Number(bar.querySelector('[data-style="width"]').value) || 2, fill: bar.querySelector('[data-style="fillOn"]').checked ? bar.querySelector('[data-style="fill"]').value : '' };
    writeStyle(style);
  });
  bar.querySelector('[data-done]').onclick = () => stop();

  function start(kind, s = current()) {
    if (!s?.loaded || (kind !== 'note' && !SHAPES.some(x => x[0] === kind))) return false;
    if (!document.getElementById('directEditor')?.hidden) { status('请先应用或取消当前页面编辑，再绘制图形。'); return false; }
    stop();
    s.app.eventBus.dispatch('switchannotationeditormode', { source: null, mode: 0 });
    s.frame.contentDocument.getSelection()?.removeAllRanges();
    tool = { kind, session: s };
    s.frame.contentDocument.body.classList.add('qyShapeDrawing');
    syncBar(); status(kind === 'note' ? '评论：点击页面上要评论的位置；Esc 取消。' : `${labelOf(kind)}：在页面上拖动绘制，可连续画多个；Esc 结束。`);
    return true;
  }
  function stop() {
    cancelDrag(); closeNote();
    if (tool) tool.session.frame.contentDocument?.body.classList.remove('qyShapeDrawing');
    tool = null; syncBar();
  }
  function cancelDrag() { drag?.overlay.remove(); drag = null; }
  let noteBox = null;
  function closeNote() { noteBox?.remove(); noteBox = null; }
  // The comment text box opens where the page was clicked; 添加 writes the note, then the tool ends.
  function askNote(s, pageEl, box, at) {
    closeNote();
    const doc = s.frame.contentDocument, form = doc.createElement('form');
    form.className = 'qyNoteInput';
    Object.assign(form.style, { position: 'absolute', zIndex: 60, left: Math.min(box.width - 240, Math.max(0, at.x * box.width)) + (box.left - pageEl.getBoundingClientRect().left) + 'px', top: at.y * box.height + (box.top - pageEl.getBoundingClientRect().top) + 'px', width: '240px', padding: '8px', background: '#fff', color: '#1b1b1b', border: '1px solid #c9c9c9', borderRadius: '8px', boxShadow: '0 6px 20px rgba(0,0,0,.18)', font: '13px system-ui, sans-serif' });
    form.innerHTML = '<textarea rows="3" style="width:100%;box-sizing:border-box;resize:vertical;font:inherit"></textarea><div style="display:flex;justify-content:flex-end;gap:6px;margin-top:6px"><button type="button" data-cancel>取消</button><button type="submit">添加评论</button></div>';
    const input = form.querySelector('textarea');
    input.placeholder = '输入评论内容'; input.setAttribute('aria-label', '评论内容');
    form.addEventListener('pointerdown', e => e.stopPropagation(), true);
    form.querySelector('[data-cancel]').onclick = () => { stop(); status('已取消评论。'); };
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); stop(); status('已取消评论。'); }
      if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) { e.preventDefault(); form.requestSubmit(); }
    });
    form.onsubmit = e => {
      e.preventDefault(); const text = input.value.trim();
      if (!text) { input.focus(); return; }
      const page = Number(pageEl.dataset.pageNumber); stop();
      guard(async () => {
        const result = await applyEdit(s, { action: 'draw', shape: 'note', page, points: [[at.x, at.y]], text, color: '#f5c518', author: readSettings().annotAuthor || '' }, `${NOTE_LABEL} · 第 ${page} 页`);
        if (!result?.canceled) status(`已添加评论（第 ${page} 页），可撤销。`);
      });
    };
    pageEl.append(form); noteBox = form; input.focus();
  }

  const pagePoint = (box, e) => ({ x: (e.clientX - box.left) / box.width, y: (e.clientY - box.top) / box.height });
  function preview() {
    const { overlay, kind, a, b } = drag, w = 1000, h = 1000;
    overlay.replaceChildren();
    const style = readStyle(), stroke = Math.max(1, style.width);
    let el;
    if (kind === 'line' || kind === 'arrow') {
      el = document.createElementNS(SVG, 'line');
      Object.entries({ x1: a.x * w, y1: a.y * h, x2: b.x * w, y2: b.y * h }).forEach(([k, v]) => el.setAttribute(k, v));
      if (kind === 'arrow') el.setAttribute('marker-end', 'url(#qyArrow)');
    } else {
      const x = Math.min(a.x, b.x) * w, y = Math.min(a.y, b.y) * h, rw = Math.abs(b.x - a.x) * w, rh = Math.abs(b.y - a.y) * h;
      el = document.createElementNS(SVG, kind === 'ellipse' ? 'ellipse' : 'rect');
      if (kind === 'ellipse') Object.entries({ cx: x + rw / 2, cy: y + rh / 2, rx: rw / 2, ry: rh / 2 }).forEach(([k, v]) => el.setAttribute(k, v));
      else Object.entries({ x, y, width: rw, height: rh }).forEach(([k, v]) => el.setAttribute(k, v));
      if (kind === 'cloud') el.setAttribute('stroke-dasharray', '6 4');
      el.setAttribute('fill', style.fill || 'none'); el.setAttribute('fill-opacity', '0.35');
    }
    el.setAttribute('stroke', style.color); el.setAttribute('stroke-width', String(stroke)); el.setAttribute('vector-effect', 'non-scaling-stroke');
    const defs = document.createElementNS(SVG, 'defs');
    defs.innerHTML = `<marker id="qyArrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10" fill="none" stroke="${style.color}" stroke-width="1.5"/></marker>`;
    overlay.append(defs, el);
  }

  async function finish(s, kind, page, a, b) {
    const request = shapeRequest(kind, a, b);
    const tiny = request.rect ? (request.rect[2] - request.rect[0] < 0.004 || request.rect[3] - request.rect[1] < 0.004) : Math.hypot(b.x - a.x, b.y - a.y) < 0.004;
    if (tiny) return;
    const style = readStyle(), label = labelOf(kind);
    const result = await applyEdit(s, { action: 'draw', shape: kind, page, color: style.color, width: style.width, fill: style.fill || null, author: readSettings().annotAuthor || '', ...request }, `${label} · 第 ${page} 页`);
    if (!result?.canceled) status(`已添加${label}（第 ${page} 页），可撤销；继续拖动可画下一个，Esc 结束。`);
    if (tool?.session === s) { s.frame.contentDocument.body.classList.add('qyShapeDrawing'); syncBar(); }
  }

  function bind(s) {
    const doc = s.frame.contentDocument;
    // PDF.js's comment button only opens its comment sidebar; every 评论 entry (menus, key C) clicks
    // it, so it places a new comment instead. The list stays under 批注列表与导出.
    doc.getElementById('editorCommentButton')?.addEventListener('click', e => { e.preventDefault(); e.stopImmediatePropagation(); start('note', s); }, true);
    doc.addEventListener('pointerdown', e => {
      if (tool?.session !== s || e.button !== 0) return;
      const pageEl = e.target.closest?.('.page[data-page-number]');
      if (!pageEl || s.editBusy) return;
      e.preventDefault(); e.stopPropagation();
      const box = (pageEl.querySelector('.canvasWrapper') || pageEl).getBoundingClientRect();
      if (tool.kind === 'note') { askNote(s, pageEl, box, pagePoint(box, e)); return; }
      const overlay = doc.createElementNS(SVG, 'svg');
      overlay.setAttribute('class', 'qyShapePreview'); overlay.setAttribute('viewBox', '0 0 1000 1000'); overlay.setAttribute('preserveAspectRatio', 'none');
      Object.assign(overlay.style, { position: 'absolute', left: (box.left - pageEl.getBoundingClientRect().left - pageEl.clientLeft) + 'px', top: (box.top - pageEl.getBoundingClientRect().top - pageEl.clientTop) + 'px', width: box.width + 'px', height: box.height + 'px', pointerEvents: 'none', zIndex: 30, overflow: 'visible' });
      pageEl.append(overlay);
      const a = pagePoint(box, e);
      drag = { overlay, box, kind: tool.kind, page: Number(pageEl.dataset.pageNumber), a, b: a };
      pageEl.setPointerCapture?.(e.pointerId);
    }, true);
    doc.addEventListener('pointermove', e => { if (drag && tool?.session === s) { drag.b = pagePoint(drag.box, e); preview(); } }, true);
    doc.addEventListener('pointerup', e => {
      if (!drag || tool?.session !== s) return;
      const { kind, page, a, box } = drag, b = pagePoint(box, e);
      cancelDrag();
      guard(() => finish(s, kind, page, a, b));
    }, true);
    doc.addEventListener('keydown', e => { if (tool?.session === s && !noteBox && (e.key === 'Escape' || (e.key.toLowerCase() === 'p' && !e.ctrlKey && !e.metaKey))) { e.preventDefault(); e.stopImmediatePropagation(); stop(); status('已结束图形绘制。'); } }, true);
    doc.getElementById('viewerContainer')?.addEventListener('scroll', () => { if (tool?.session === s) syncBar(); }, { passive: true });
  }
  return { bind, start, stop, active: () => tool?.kind || null };
}
