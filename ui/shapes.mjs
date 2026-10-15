// Shape annotations drawn in the viewer (Xodo-style): rectangle, ellipse, line, arrow and cloud.
// Dragging on a page previews the shape in an SVG overlay; on release the backend writes a standard
// Square / Circle / Line annotation ('draw' action), undoable through the edit history. The tool
// stays active for the next shape (continuous drawing) until Esc, P or the bar's 完成 button.
import { readSettings } from './settings.mjs';

export const SHAPES = [
  ['rect', '矩形', 'R'], ['ellipse', '椭圆', 'O'], ['line', '直线', 'L'], ['arrow', '箭头', 'A'], ['cloud', '云形框', ''],
];
const STYLE_KEY = 'qingye.shapeStyle';
const readStyle = () => { try { return { color: '#d9482b', width: 2, fill: '', ...JSON.parse(localStorage.getItem(STYLE_KEY) || '{}') }; } catch { return { color: '#d9482b', width: 2, fill: '' }; } };
const writeStyle = style => { try { localStorage.setItem(STYLE_KEY, JSON.stringify(style)); } catch {} };
const SVG = 'http://www.w3.org/2000/svg';

// Pointer positions → the request fields of the 'draw' action (fractions of the displayed page).
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
    + '<button type="button" data-done>完成</button>';
  document.body.append(bar);
  let tool = null, drag = null;

  function syncBar() {
    if (!tool) { bar.hidden = true; return; }
    const style = readStyle(), [, label] = SHAPES.find(s => s[0] === tool.kind);
    bar.querySelector('.shapeName').textContent = label + ' · 在页面上拖动绘制，Esc 结束';
    bar.querySelector('[data-style="color"]').value = style.color;
    bar.querySelector('[data-style="width"]').value = String(style.width);
    bar.querySelector('[data-style="fillOn"]').checked = !!style.fill;
    bar.querySelector('[data-style="fill"]').value = style.fill || '#ffee58';
    bar.querySelector('.shapeFill').hidden = tool.kind === 'line' || tool.kind === 'arrow';
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
    if (!s?.loaded || !SHAPES.some(x => x[0] === kind)) return false;
    if (!document.getElementById('directEditor')?.hidden) { status('请先应用或取消当前页面编辑，再绘制图形。'); return false; }
    stop();
    s.app.eventBus.dispatch('switchannotationeditormode', { source: null, mode: 0 });
    s.frame.contentDocument.getSelection()?.removeAllRanges();
    tool = { kind, session: s };
    s.frame.contentDocument.body.classList.add('qyShapeDrawing');
    syncBar(); status(`${SHAPES.find(x => x[0] === kind)[1]}：在页面上拖动绘制，可连续画多个；Esc 结束。`);
    return true;
  }
  function stop() {
    cancelDrag();
    if (tool) tool.session.frame.contentDocument?.body.classList.remove('qyShapeDrawing');
    tool = null; syncBar();
  }
  function cancelDrag() { drag?.overlay.remove(); drag = null; }

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
    const style = readStyle(), label = SHAPES.find(x => x[0] === kind)[1];
    const result = await applyEdit(s, { action: 'draw', shape: kind, page, color: style.color, width: style.width, fill: style.fill || null, author: readSettings().annotAuthor || '', ...request }, `${label} · 第 ${page} 页`);
    if (!result?.canceled) status(`已添加${label}（第 ${page} 页），可撤销；继续拖动可画下一个，Esc 结束。`);
    if (tool?.session === s) s.frame.contentDocument.body.classList.add('qyShapeDrawing'), syncBar();
  }

  function bind(s) {
    const doc = s.frame.contentDocument;
    if (!doc.getElementById('qyShapeStyle')) {
      const style = doc.createElement('style'); style.id = 'qyShapeStyle';
      style.textContent = '.qyShapeDrawing .page, .qyShapeDrawing .page * { cursor: crosshair !important; user-select: none !important; }';
      doc.head.append(style);
    }
    doc.addEventListener('pointerdown', e => {
      if (tool?.session !== s || e.button !== 0) return;
      const pageEl = e.target.closest?.('.page[data-page-number]');
      if (!pageEl || s.editBusy) return;
      e.preventDefault(); e.stopPropagation();
      const box = (pageEl.querySelector('.canvasWrapper') || pageEl).getBoundingClientRect();
      const overlay = doc.createElementNS(SVG, 'svg');
      overlay.setAttribute('class', 'qyShapePreview'); overlay.setAttribute('viewBox', '0 0 1000 1000'); overlay.setAttribute('preserveAspectRatio', 'none');
      Object.assign(overlay.style, { position: 'absolute', left: (box.left - pageEl.getBoundingClientRect().left) + 'px', top: (box.top - pageEl.getBoundingClientRect().top) + 'px', width: box.width + 'px', height: box.height + 'px', pointerEvents: 'none', zIndex: 30, overflow: 'visible' });
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
    doc.addEventListener('keydown', e => { if (tool?.session === s && (e.key === 'Escape' || (e.key.toLowerCase() === 'p' && !e.ctrlKey && !e.metaKey))) { e.preventDefault(); e.stopImmediatePropagation(); stop(); status('已结束图形绘制。'); } }, true);
    doc.getElementById('viewerContainer')?.addEventListener('scroll', () => { if (tool?.session === s) syncBar(); }, { passive: true });
  }
  return { bind, start, stop, active: () => tool?.kind || null };
}
