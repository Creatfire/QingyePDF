// Text differences drawn in the side-by-side compare view (0.19, Xodo "Compare PDF"): page n of the
// left document is compared with page n + offset of the right one. CJK text is compared per
// character and other text per word; removed text is marked red on the left, added text green on the
// right, and the bar steps through the changes. Marks are kept in PDF coordinates and redrawn whenever
// PDF.js renders a page, so zooming and scrolling keep them in place.

const CJK = /[　-ヿ㐀-鿿豈-﫿＀-￯]/;

// Tokens of one page with their boxes in PDF user space.
export function pageTokens(items) {
  const tokens = [];
  for (const item of items) {
    const text = item.str || ''; if (!text.trim()) continue;
    const [a, b, , , e, f] = item.transform, height = item.height || Math.hypot(a, b) || 10, width = item.width || 0, len = text.length;
    const box = (i, j) => [e + width * i / len, f - height * 0.22, e + width * j / len, f + height * 0.9];
    let i = 0;
    while (i < len) {
      const ch = text[i];
      if (/\s/.test(ch)) { i++; continue; }
      if (CJK.test(ch)) { tokens.push({ text: ch, rect: box(i, i + 1) }); i++; continue; }
      let j = i; while (j < len && !/\s/.test(text[j]) && !CJK.test(text[j])) j++;
      tokens.push({ text: text.slice(i, j), rect: box(i, j) }); i = j;
    }
  }
  return tokens;
}

// Longest-common-subsequence diff of two token lists → ops: ['=', i, j] | ['-', i] | ['+', j].
export function diffTokens(a, b, limit = 6e6) {
  const n = a.length, m = b.length;
  if (!n) return b.map((_, j) => ['+', j]);
  if (!m) return a.map((_, i) => ['-', i]);
  if (n * m > limit) return null;
  // Trim the common head and tail first; most pages differ in a few places.
  let head = 0; while (head < n && head < m && a[head].text === b[head].text) head++;
  let tail = 0; while (tail < n - head && tail < m - head && a[n - 1 - tail].text === b[m - 1 - tail].text) tail++;
  const A = a.slice(head, n - tail), B = b.slice(head, m - tail), N = A.length, M = B.length;
  const table = new Uint32Array((N + 1) * (M + 1));
  for (let i = N - 1; i >= 0; i--) for (let j = M - 1; j >= 0; j--) table[i * (M + 1) + j] = A[i].text === B[j].text ? table[(i + 1) * (M + 1) + j + 1] + 1 : Math.max(table[(i + 1) * (M + 1) + j], table[i * (M + 1) + j + 1]);
  const ops = [];
  for (let k = 0; k < head; k++) ops.push(['=', k, k]);
  let i = 0, j = 0;
  while (i < N && j < M) {
    if (A[i].text === B[j].text) { ops.push(['=', head + i, head + j]); i++; j++; }
    else if (table[(i + 1) * (M + 1) + j] >= table[i * (M + 1) + j + 1]) { ops.push(['-', head + i]); i++; }
    else { ops.push(['+', head + j]); j++; }
  }
  while (i < N) ops.push(['-', head + i++]);
  while (j < M) ops.push(['+', head + j++]);
  for (let k = 0; k < tail; k++) ops.push(['=', n - tail + k, m - tail + k]);
  return ops;
}

// Consecutive changes form one hunk; each hunk knows its boxes on both sides.
export function hunksOf(ops, left, right, leftPage, rightPage) {
  const hunks = []; let open = null;
  for (const op of ops) {
    if (op[0] === '=') { open = null; continue; }
    if (!open) { open = { left: { page: leftPage, rects: [], text: '' }, right: { page: rightPage, rects: [], text: '' } }; hunks.push(open); }
    if (op[0] === '-') { open.left.rects.push(left[op[1]].rect); open.left.text += left[op[1]].text; }
    else { open.right.rects.push(right[op[1]].rect); open.right.text += right[op[1]].text; }
  }
  return hunks;
}

export function createCompareDiff({ sessions, status }) {
  let state = null; // { ids, hunks, index, marks: [Map(page → [{rect, hunk}]), Map] }

  async function compute(leftId, rightId, offset = 0, onProgress = () => {}) {
    const L = sessions.get(leftId), R = sessions.get(rightId), pages = Math.min(L.app.pagesCount, 300);
    const hunks = [], marks = [new Map(), new Map()];
    for (let p = 1; p <= pages; p++) {
      const q = p + offset;
      onProgress(p, pages);
      const left = pageTokens((await (await L.app.pdfDocument.getPage(p)).getTextContent()).items);
      const right = q >= 1 && q <= R.app.pagesCount ? pageTokens((await (await R.app.pdfDocument.getPage(q)).getTextContent()).items) : [];
      const ops = diffTokens(left, right) || [...left.map((_, i) => ['-', i]), ...right.map((_, j) => ['+', j])];
      for (const h of hunksOf(ops, left, right, p, q)) {
        h.index = hunks.length; hunks.push(h);
        if (h.left.rects.length) (marks[0].get(p) || marks[0].set(p, []).get(p)).push(...h.left.rects.map(rect => ({ rect, hunk: h.index })));
        if (h.right.rects.length && q >= 1) (marks[1].get(q) || marks[1].set(q, []).get(q)).push(...h.right.rects.map(rect => ({ rect, hunk: h.index })));
      }
    }
    // Pages only the right document has count as added.
    for (let q = pages + offset + 1; q <= Math.min(R.app.pagesCount, 300); q++) {
      const right = pageTokens((await (await R.app.pdfDocument.getPage(q)).getTextContent()).items);
      if (!right.length) continue;
      const h = { index: hunks.length, left: { page: null, rects: [], text: '' }, right: { page: q, rects: right.map(t => t.rect), text: right.map(t => t.text).join('') } };
      hunks.push(h); marks[1].set(q, right.map(t => ({ rect: t.rect, hunk: h.index })));
    }
    clear();
    state = { ids: [leftId, rightId], hunks, index: -1, marks };
    for (const s of [L, R]) paintAll(s);
    return { hunks: hunks.length, truncated: L.app.pagesCount > 300 };
  }

  function side(s) { return state ? state.ids.indexOf(s.id) : -1; }
  function paintPage(s, pageNumber) {
    const k = side(s); if (k < 0) return;
    const view = s.app.pdfViewer.getPageView(pageNumber - 1); if (!view?.div) return;
    view.div.querySelectorAll('.qyDiffMark').forEach(e => e.remove());
    const list = state.marks[k].get(pageNumber); if (!list) return;
    const wrap = view.div.querySelector('.canvasWrapper') || view.div, vp = view.viewport, offX = wrap.offsetLeft, offY = wrap.offsetTop;
    const sx = wrap.clientWidth / vp.width || 1, sy = wrap.clientHeight / vp.height || 1;
    for (const { rect, hunk } of list) {
      const [x0, y0] = vp.convertToViewportPoint(rect[0], rect[1]), [x1, y1] = vp.convertToViewportPoint(rect[2], rect[3]);
      const d = view.div.ownerDocument.createElement('div');
      d.className = 'qyDiffMark ' + (k ? 'isAdded' : 'isRemoved') + (hunk === state.index ? ' isCurrent' : '');
      Object.assign(d.style, { left: offX + Math.min(x0, x1) * sx + 'px', top: offY + Math.min(y0, y1) * sy + 'px', width: Math.abs(x1 - x0) * sx + 'px', height: Math.abs(y1 - y0) * sy + 'px' });
      view.div.append(d);
    }
  }
  function paintAll(s) { if (!state || side(s) < 0) return; for (const page of state.marks[side(s)].keys()) paintPage(s, page); }
  function clear() {
    if (!state) return;
    for (const id of state.ids) { const s = sessions.get(id); s?.frame?.contentDocument?.querySelectorAll('.qyDiffMark').forEach(e => e.remove()); }
    state = null;
  }
  // Steps to the next / previous change and scrolls both documents to it.
  function step(dir) {
    if (!state?.hunks.length) return null;
    state.index = (state.index + dir + state.hunks.length) % state.hunks.length;
    const h = state.hunks[state.index];
    for (const [k, part] of [[0, h.left], [1, h.right]]) {
      const s = sessions.get(state.ids[k]); if (!s?.loaded || !part.page) continue;
      const rect = part.rects[0];
      s.app.pdfViewer.scrollPageIntoView({ pageNumber: part.page, destArray: rect ? [null, { name: 'XYZ' }, Math.max(0, rect[0] - 40), rect[3] + 60, null] : undefined });
      paintAll(s);
    }
    return { index: state.index + 1, total: state.hunks.length, removed: h.left.text, added: h.right.text };
  }
  function bind(s) {
    s.app.eventBus.on('pagerendered', e => { if (state && side(s) >= 0) paintPage(s, e.pageNumber); });
    s.app.eventBus.on('textlayerrendered', e => { if (state && side(s) >= 0) paintPage(s, e.pageNumber); });
  }
  return { compute, step, clear, bind, active: () => !!state, summary: () => state && { total: state.hunks.length, index: state.index + 1 } };
}
