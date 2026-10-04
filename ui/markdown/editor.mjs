// Qingye Markdown editor: a Typora-style block editor.
// The Markdown text is the single source of truth. Every top-level block is rendered as HTML;
// the block under the caret switches to its live-styled source (syntax revealed, content
// still formatted). All edits go through apply(), which records undo history and keeps
// block offsets in sync, so saving always writes exactly what the user typed.
import { analyze, renderBlockHtml, sanitize, escapeHtml, renderOptions } from './parser.mjs';
import { styleSource } from './source-style.mjs';
import * as C from './commands.mjs';
import { createVisualTables } from './visual-table.mjs';
import { renderDiagrams, fit as fitDiagram } from './diagrams.mjs';
import { installTypora, writeClipboard, CLIP_MARK } from './editor-typora.mjs';

const KIND_LABEL = { footnoteDef: '脚注', toc: '目录', paragraph: '段落', heading: '标题', blockquote: '引用', listItem: '列表项', fence: '代码块', codeBlock: '代码块', hr: '分隔线', html: 'HTML', table: '表格', math: '公式块', frontMatter: 'YAML 元数据', raw: '链接定义' };
const OPAQUE = new Set(['fence', 'codeBlock', 'math', 'table', 'html', 'frontMatter', 'hr']);
const MARKER_AT_START = /^(\s{0,3}#{1,6}[ \t]+|\s{0,3}(?:>\s?)+|\s{0,3}(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)/;
const MATH_SOURCE = /\$\$[\s\S]+?\$\$|\$(?![\s$])(?:\\\$|[^$\n])*?[^\s\\]\$(?!\d)/g;
const SKIP_RENDERED = '.katex, .mdCodeHead, .mdFrontLabel, .mdLivePreview, .mdMermaid';

function textBefore(root, node, offset) {
  const range = document.createRange();
  range.setStart(root, 0);
  try { range.setEnd(node, offset); } catch { return root.textContent; }
  const fragment = range.cloneContents();
  for (const el of fragment.querySelectorAll(SKIP_RENDERED)) el.remove();
  return fragment.textContent;
}
function lengthUntil(root, node, offset) {
  const range = document.createRange();
  range.setStart(root, 0); range.setEnd(node, offset);
  return range.toString().length;
}
function caretPoint(x, y) {
  if (document.caretPositionFromPoint) { const p = document.caretPositionFromPoint(x, y); return p && { node: p.offsetNode, offset: p.offset }; }
  const r = document.caretRangeFromPoint?.(x, y); return r && { node: r.startContainer, offset: r.startOffset };
}
function textNodes(root) { const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); const nodes = []; for (let n; (n = walker.nextNode());) nodes.push(n); return nodes; }
function rangeAt(root, start, end = start) {
  const range = document.createRange();
  let pos = 0, startSet = false;
  for (const node of textNodes(root)) {
    const len = node.data.length;
    if (!startSet && start <= pos + len) { range.setStart(node, start - pos); startSet = true; }
    if (startSet && end <= pos + len) { range.setEnd(node, end - pos); return range; }
    pos += len;
  }
  if (!startSet) range.setStart(root, root.childNodes.length);
  range.setEnd(root, root.childNodes.length);
  return range;
}
export function copyText(text) {
  const area = document.createElement('textarea');
  area.value = text; area.setAttribute('readonly', ''); area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.append(area); area.select();
  try { document.execCommand('copy'); } finally { area.remove(); }
}

// Marks which source characters appear as rendered text, for mapping clicks to source offsets.
function visibleMask(src, kind) {
  const mask = new Uint8Array(src.length).fill(1);
  const hide = (a, b) => { for (let k = Math.max(0, a); k < Math.min(src.length, b); k++) mask[k] = 0; };
  const each = (re, fn) => { re.lastIndex = 0; for (let m; (m = re.exec(src));) { if (!m[0].length) { re.lastIndex++; continue; } fn(m); } };
  if (kind === 'fence' || kind === 'frontMatter' || kind === 'math') {
    const first = src.indexOf('\n'); hide(0, first < 0 ? src.length : first + 1);
    const last = src.lastIndexOf('\n'); if (last > 0 && /^\s*(`{3,}|~{3,}|\$\$|---|\.\.\.)\s*$/.test(src.slice(last + 1))) hide(last, src.length);
    if (kind === 'math') hide(0, src.length);
    return mask;
  }
  if (kind === 'codeBlock') return mask;
  each(/^[ \t]*(?:>[ \t]?)*[ \t]*(?:#{1,6}[ \t]+|(?:[-*+]|\d{1,9}[.)])[ \t]+(?:\[[ xX]\][ \t]+)?)?/gm, m => hide(m.index, m.index + m[0].length));
  if (kind === 'heading') each(/[ \t]+#+[ \t]*$/gm, m => hide(m.index, m.index + m[0].length));
  if (kind === 'table') { each(/(?<!\\)\|/g, m => hide(m.index, m.index + 1)); each(/^[ \t|:-]+$/gm, m => hide(m.index, m.index + m[0].length)); }
  if (kind === 'hr') hide(0, src.length);
  each(/!\[[^\]]*\]\([^)]*\)/g, m => hide(m.index, m.index + m[0].length));
  each(/\[([^\]]+)\]\(([^)]*)\)/g, m => { hide(m.index, m.index + 1); hide(m.index + 1 + m[1].length, m.index + m[0].length); });
  each(/\[([^\]]+)\]\[[^\]]*\]/g, m => { hide(m.index, m.index + 1); hide(m.index + 1 + m[1].length, m.index + m[0].length); });
  each(/<((?:https?:\/\/|mailto:)[^>\s]+)>/g, m => { hide(m.index, m.index + 1); hide(m.index + m[0].length - 1, m.index + m[0].length); });
  each(/<\/?[A-Za-z][^<>]*>|<!--[\s\S]*?-->/g, m => hide(m.index, m.index + m[0].length));
  each(/`+/g, m => hide(m.index, m.index + m[0].length));
  each(/==(?=[^\s=])|(?<=[^\s=])==|(?<=\S)[*~^]+|[*~^]+(?=\S)|(?<![\p{L}\p{N}])_+|_+(?![\p{L}\p{N}])/gu, m => hide(m.index, m.index + m[0].length));
  each(/\[\^(?=[^\]\s]+\])|(?<=\[\^[^\]\s]{1,40})\]/g, m => hide(m.index, m.index + m[0].length));
  each(/\\(?=[\\`*_{}[\]()#+\-.!|$<>~])/g, m => hide(m.index, m.index + 1));
  each(MATH_SOURCE, m => hide(m.index, m.index + m[0].length));
  each(/ {2,}$/gm, m => hide(m.index, m.index + m[0].length));
  return mask;
}
function alignRendered(src, kind, rendered) {
  const mask = visibleMask(src, kind);
  let i = 0;
  for (const ch of rendered) {
    if (/\s/.test(ch)) { while (i < src.length && (!mask[i] || /\s/.test(src[i])) && /\s/.test(src[i] || 'x')) i++; continue; }
    let j = i, limit = Math.min(src.length, i + 200);
    while (j < limit && !(mask[j] && src[j] === ch)) j++;
    if (j < limit) i = j + 1;
  }
  // Prefer the inside of emphasis / code markers so typing continues the formatting.
  let j = i;
  while (j < src.length && !mask[j] && /[*_~`]/.test(src[j])) j++;
  if (j > i && j < src.length && mask[j] && !/\s/.test(src[j])) i = j;
  return Math.min(i, src.length);
}

function metaNote(b) {
  const src = b.source || '';
  const note = (label, text, cls) => { const p = document.createElement('p'); p.className = 'mdMetaNote ' + cls; const l = document.createElement('span'); l.className = 'mdMetaLabel'; l.textContent = label; const t = document.createElement('span'); t.className = 'mdMetaText'; t.textContent = text; p.append(l, t); return p; };
  if (b.kind === 'html' && /^\s*(?:<!--[\s\S]*?-->\s*)+$/.test(src)) return note('注释', src.replace(/<!--|-->/g, ' ').replace(/\s+/g, ' ').trim() || '（空）', 'isComment');
  if (b.kind === 'raw') {
    const lines = src.split('\n').filter(l => l.trim());
    const defs = lines.map(l => /^\s{0,3}\[([^\]]+)\]:\s*<?(\S+?)>?(?:\s+["'(].*["')])?\s*$/.exec(l));
    if (defs.length && defs.every(Boolean)) return note('链接引用', defs.map(m => `[${m[1]}] → ${m[2]}`).join('   '), 'isRefDef');
  }
  return null;
}

export class MarkdownEditor {
  constructor(root, options = {}) {
    this.root = root; this.options = options;
    this.text = options.text || '';
    this.undoStack = []; this.redoStack = []; this.version = 0;
    this.blocks = []; this.active = null; this.stale = true;
    this.sel = { from: 0, to: 0 };
    this.sourceMode = false;
    this.search = { matches: [], index: -1, options: null };
    root.classList.add('mdEditor');
    this.scroller = document.createElement('div'); this.scroller.className = 'mdScroll';
    this.doc = document.createElement('div'); this.doc.className = 'mdDoc'; this.doc.tabIndex = 0;
    this.doc.setAttribute('role', 'document'); this.doc.setAttribute('aria-label', options.label || 'Markdown 文档');
    this.tail = document.createElement('div'); this.tail.className = 'mdTail'; this.tail.setAttribute('aria-hidden', 'true');
    this.scroller.append(this.doc, this.tail);
    this.sourceView = document.createElement('textarea'); this.sourceView.className = 'mdSourceView'; this.sourceView.hidden = true;
    this.sourceView.spellcheck = false; this.sourceView.setAttribute('aria-label', 'Markdown 源代码');
    root.append(this.scroller, this.sourceView);
    this.visualTables=createVisualTables(this);
    this.bind();
    this.initTypora();
    this.reconcile();
  }

  // ——— Structure & rendering ———
  reconcile() {
    const { blocks, references, info } = analyze(this.text);
    const refKey = JSON.stringify(references) + '|' + renderOptions.epoch, refsChanged = refKey !== this.refKey;
    const infoKey = JSON.stringify([info.fn.order, info.headings.map(h => [h.level, h.text])]);
    this.refKey = refKey; this.references = references; this.info = info;
    const pool = new Map();
    for (const b of this.blocks) if (b.el && !b.temp) { const list = pool.get(b.key) || []; list.push(b.el); pool.set(b.key, list); }
    for (const b of blocks) {
      b.source = this.text.slice(b.from, b.to);
      b.key = `${b.kind}|${b.number || ''}|${b.loose ? 'L' : ''}|${b.source}|${/\[\^|^\s*\[toc\]/i.test(b.source) ? infoKey : ''}`;
      const reuse = !refsChanged && pool.get(b.key)?.shift();
      b.el = reuse || this.renderBlock(b);
      b.el.blockRef = b;
    }
    this.blocks = blocks; this.stale = false;
    this.doc.replaceChildren(...blocks.map(b => b.el));
    this.doc.classList.toggle('isEmpty', !blocks.length);
    this.options.onStructure?.();
    if (this.search.options) this.highlightSearch();
  }
  renderBlock(b) {
    const el = document.createElement('div');
    el.className = `mdBlock kind-${b.kind}${b.loose ? ' isLoose' : ''}`;
    const rendered = document.createElement('div'); rendered.className = 'mdRendered';
    // Things that render to nothing in the final document (HTML comments, link reference
    // definitions) show as a quiet one-line note while editing and are hidden in reading mode.
    const meta = metaNote(b);
    if (meta) { el.classList.add('isMeta'); rendered.append(meta); }
    else if (b.kind === 'raw') { const p = document.createElement('p'); p.className = 'mdRawSource'; p.textContent = b.source; rendered.append(p); }
    else {
      rendered.append(sanitize(renderBlockHtml(b.source, b, this.references, this.info)));
      if (b.ordered) for (const ol of rendered.querySelectorAll(':scope > ol')) ol.start = b.number;
      if (!rendered.textContent.trim() && !rendered.querySelector('img, hr, input, .katex')) { const p = document.createElement('p'); p.className = 'mdRawSource'; p.textContent = b.source; rendered.replaceChildren(p); }
    }
    this.loadImages(rendered);
    if (rendered.querySelector('.mdMermaid')) requestAnimationFrame(() => renderDiagrams(rendered));
    el.append(rendered);
    if(b.kind==='table')this.visualTables.decorate(b,rendered);
    return el;
  }
  loadImages(root) {
    for (const img of root.querySelectorAll('img')) {
      const src = img.getAttribute('src') || '';
      if (/^(data:|blob:)/i.test(src)) continue;
      img.dataset.source = src; img.removeAttribute('src');
      img.alt ||= src; img.title ||= src;
      if (/^https?:/i.test(src)) { img.classList.add('mdImageRemote'); img.title = '离线模式不加载网络图片：' + src; continue; }
      img.classList.add('mdImageLoading');
      Promise.resolve(this.options.resolveImage?.(src)).then(url => {
        img.classList.remove('mdImageLoading');
        if (url) img.src = url; else { img.classList.add('mdImageMissing'); img.title = '找不到图片：' + src; }
      }).catch(() => { img.classList.remove('mdImageLoading'); img.classList.add('mdImageMissing'); });
    }
  }
  blockIndexAt(pos) {
    let lo = 0, hi = this.blocks.length - 1;
    while (lo <= hi) {
      const mid = (lo + hi) >> 1, b = this.blocks[mid];
      if (pos < b.from) hi = mid - 1; else if (pos > b.to) lo = mid + 1; else return mid;
    }
    return -1;
  }
  elementAt(pos) { const i = this.blockIndexAt(pos); return i >= 0 ? this.blocks[i].el : null; }

  // ——— Editing a block ———
  activateAt(from, to = from, { focus = true, scroll = true } = {}) {
    this.breakUndo = true;
    from = Math.max(0, Math.min(from, this.text.length)); to = Math.max(from, Math.min(to, this.text.length));
    if (this.readonly && !this.sourceMode) { this.sel = { from, to }; return; }
    if (this.sourceMode) { this.sel = { from, to }; this.sourceView.setSelectionRange(from, to); if (focus) this.sourceView.focus(); return; }
    const current = this.active?.block;
    if (!(current && from >= current.from && to <= current.to)) {
      this.deactivate();
      if (this.stale) this.reconcile();
      const index = this.blockIndexAt(from);
      if (index < 0) this.openTemp(from);
      else this.openEditor(this.blocks[index]);
    }
    const b = this.active.block;
    this.sel = { from, to };
    this.setCaret(from - b.from, Math.min(to, b.to) - b.from, focus);
    if (scroll) this.revealActive();
    this.highlightSearch();
  }
  openEditor(b) {
    const el = document.createElement('pre');
    el.className = 'mdSource'; el.contentEditable = 'plaintext-only'; el.spellcheck = !!this.prefs?.spellcheck;
    el.setAttribute('role', 'textbox'); el.setAttribute('aria-multiline', 'true');
    el.setAttribute('aria-label', '正在编辑' + (KIND_LABEL[b.kind] || '段落') + '，Esc 结束编辑');
    el.dataset.kind = b.kind;
    b.el.querySelector(':scope > .mdRendered').hidden = true;
    b.el.classList.add('isActive');
    b.el.append(el);
    this.active = { block: b, el, preview: null, composing: false, padded: false };
    this.paint(false);
    this.updatePreview();
  }
  openTemp(pos) {
    const before = this.text.slice(0, pos), after = this.text.slice(pos);
    const lead = !before || before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
    const trail = !after ? '' : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
    const b = { from: pos, to: pos, kind: 'paragraph', temp: true, lead, trail, source: '' };
    b.el = document.createElement('div'); b.el.className = 'mdBlock kind-paragraph isTemp';
    const rendered = document.createElement('div'); rendered.className = 'mdRendered'; b.el.append(rendered);
    const next = this.blocks.find(x => x.from >= pos);
    this.doc.insertBefore(b.el, next ? next.el : null);
    this.doc.classList.remove('isEmpty');
    this.openEditor(b);
  }
  deactivate() {
    const a = this.active;
    if (!a) return;
    this.breakUndo = true;
    if (a.composing) this.syncFromDom(true);
    this.active = null;
    a.el.remove(); a.preview?.remove(); clearTimeout(a.previewTimer);
    a.block.el.classList.remove('isActive');
    const rendered = a.block.el.querySelector(':scope > .mdRendered'); if (rendered) rendered.hidden = false;
    if (a.block.temp) { a.block.el.remove(); this.doc.classList.toggle('isEmpty', !this.blocks.length); }
    if (this.stale) this.reconcile();
  }
  paint(keepCaret = true) {
    const a = this.active;
    if (!a) return;
    const b = a.block, src = this.text.slice(b.from, b.to);
    const caret = keepCaret ? this.getCaret() : null;
    a.padded = src.endsWith('\n');
    a.el.innerHTML = styleSource(src, b.kind) + (a.padded ? '\n' : '');
    a.el.classList.toggle('isEmpty', !src);
    if (caret) this.setCaret(caret.start, caret.end, document.activeElement === a.el);
  }
  readDom() {
    const a = this.active;
    let t = a.el.textContent.replace(/\r\n?/g, '\n').replace(/ /g, ' ');
    if (a.padded && t.endsWith('\n')) t = t.slice(0, -1);
    return t;
  }
  getCaret() {
    const a = this.active, sel = getSelection();
    if (!a || !sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    if (!a.el.contains(r.startContainer) || !a.el.contains(r.endContainer)) return null;
    const max = this.active.block.to - this.active.block.from;
    return { start: Math.min(max, lengthUntil(a.el, r.startContainer, r.startOffset)), end: Math.min(max, lengthUntil(a.el, r.endContainer, r.endOffset)) };
  }
  setCaret(start, end = start, focus = true) {
    const a = this.active;
    if (!a) return;
    if (focus && document.activeElement !== a.el) a.el.focus({ preventScroll: true });
    if (!focus && document.activeElement !== a.el) return;
    const sel = getSelection();
    sel.removeAllRanges(); sel.addRange(rangeAt(a.el, start, end));
  }
  revealActive() {
    const el = this.active?.el;
    if (!el) return;
    const box = el.getBoundingClientRect(), view = this.scroller.getBoundingClientRect();
    if (box.top < view.top + 8 || box.top > view.bottom - 40) el.scrollIntoView({ block: box.height > view.height * 0.7 ? 'start' : 'center' });
  }
  currentSelection() {
    if (this.sourceMode) return { from: this.sourceView.selectionStart, to: this.sourceView.selectionEnd };
    const caret = this.active && this.getCaret();
    if (caret) { const b = this.active.block; return { from: b.from + caret.start, to: b.from + caret.end }; }
    return { ...this.sel };
  }
  syncFromDom(force = false) {
    const a = this.active;
    if (!a || (a.composing && !force)) return;
    const b = a.block, old = this.text.slice(b.from, b.to), now = this.readDom();
    if (now === old) return;
    const caret = this.getCaret();
    const selBefore = { ...this.sel };
    if (b.temp) {
      const insert = b.lead + now + b.trail;
      this.applyRaw({ from: b.from, to: b.from, insert }, { group: 'type', selBefore, skipBlock: b });
      b.from += b.lead.length; b.to = b.from + now.length; b.temp = false; b.el.classList.remove('isTemp');
      const index = this.blocks.findIndex(x => x.from > b.from);
      this.blocks.splice(index < 0 ? this.blocks.length : index, 0, b);
      this.stale = true;
    } else {
      let p = 0; const max = Math.min(old.length, now.length);
      while (p < max && old[p] === now[p]) p++;
      let s = 0;
      while (s < max - p && old[old.length - 1 - s] === now[now.length - 1 - s]) s++;
      this.applyRaw({ from: b.from + p, to: b.from + old.length - s, insert: now.slice(p, now.length - s) }, { group: 'type', selBefore });
    }
    if (caret) this.sel = { from: b.from + caret.start, to: b.from + caret.end };
    const last = this.undoStack.at(-1); if (last) last.selAfter = { ...this.sel };
    if (!a.composing) this.paint();
    this.schedulePreview();
  }

  // ——— Changes & history ———
  applyRaw(change, { group = 'edit', selBefore = this.sel, record = true, skipBlock = null } = {}) {
    if (this.readonly && !this.allowReadonly) return;
    const removed = this.text.slice(change.from, change.to);
    if (!removed && !change.insert) return;
    this.text = this.text.slice(0, change.from) + change.insert + this.text.slice(change.to);
    const delta = change.insert.length - removed.length;
    const active = this.active?.block;
    for (const b of this.blocks) {
      if (b === skipBlock) continue;
      if (b === active && change.from >= b.from && change.to <= b.to) { b.to += delta; continue; }
      if (b.from >= change.to && !(b.from === change.to && b === active)) { b.from += delta; b.to += delta; }
      else if (b.to >= change.from) this.stale = true;
    }
    if (active?.temp && active !== skipBlock && active.from >= change.to) { active.from += delta; active.to += delta; }
    this.stale = true; this.version++;
    if (record) {
      const now = Date.now(), last = this.undoStack.at(-1);
      const entry = { from: change.from, removed, inserted: change.insert };
      const prev = last?.changes.at(-1);
      const contiguous = prev && (change.from === prev.from + prev.inserted.length || (change.to === prev.from + prev.inserted.length && !change.insert) || (change.to === prev.from && !change.insert));
      const wordBoundary = prev && /\s$/.test(prev.inserted) && change.insert && !/^\s/.test(change.insert);
      if (group === 'type' && last?.group === 'type' && contiguous && !wordBoundary && now - last.time < 1500 && last.changes.length < 80 && !this.breakUndo) { last.changes.push(entry); last.time = now; }
      else this.undoStack.push({ changes: [entry], selBefore: { ...selBefore }, selAfter: null, group, time: now });
      if (this.undoStack.length > 500) this.undoStack.shift();
      this.redoStack = []; this.breakUndo = false;
    }
    this.options.onChange?.();
  }
  // Applies a command result (several changes) as one undo step and refreshes the view.
  apply(changes, selection, { group = 'edit', activate = true, focus = true } = {}) {
    if (this.readonly && !this.allowReadonly) return;
    if (!changes?.length) { if (selection && activate) this.refresh(selection, focus); return; }
    if (this.active && !this.sourceMode) this.syncFromDom(true);
    const selBefore = this.currentSelection();
    const sorted = [...changes].sort((a, b) => b.from - a.from);
    this.breakUndo = true;
    const entries = [];
    for (const c of sorted) { entries.push({ from: c.from, removed: this.text.slice(c.from, c.to), inserted: c.insert }); this.applyRaw(c, { record: false }); }
    this.undoStack.push({ changes: entries, selBefore, selAfter: selection ? { ...selection } : null, group, time: Date.now() });
    this.redoStack = []; this.breakUndo = true;
    this.refresh(selection, focus, activate);
  }
  refresh(selection, focus = true, activate = true) {
    if (this.sourceMode) {
      this.sourceView.value = this.text;
      if (selection) { this.sel = { ...selection }; this.sourceView.setSelectionRange(selection.from, selection.to); if (focus) this.sourceView.focus(); }
      return;
    }
    const top = this.scroller.scrollTop;
    this.deactivate();
    if (this.stale) this.reconcile();
    this.scroller.scrollTop = top;
    if (selection) { this.sel = { from: selection.from, to: selection.to }; if (activate) this.activateAt(selection.from, selection.to, { focus }); }
  }
  undo() { this.history(this.undoStack, this.redoStack, true); }
  redo() { this.history(this.redoStack, this.undoStack, false); }
  history(from, to, undo) {
    if (this.active?.composing) return;
    if (this.active) this.syncFromDom(true);
    const entry = from.pop();
    if (!entry) return;
    const changes = undo ? [...entry.changes].reverse() : entry.changes;
    for (const c of changes) this.applyRaw(undo ? { from: c.from, to: c.from + c.inserted.length, insert: c.removed } : { from: c.from, to: c.from + c.removed.length, insert: c.inserted }, { record: false });
    to.push(entry); this.breakUndo = true;
    const sel = undo ? entry.selBefore : entry.selAfter || entry.selBefore;
    this.refresh(sel, true);
    this.options.onChange?.();
  }
  get canUndo() { return this.undoStack.length > 0; }
  get canRedo() { return this.redoStack.length > 0; }

  // Replaces the whole document (external reload); undoable so local edits are never lost.
  replaceAll(text, { record = true } = {}) {
    if (text === this.text) return;
    if (this.readonly) { this.allowReadonly = true; try { this.replaceAllInner(text, record); } finally { this.allowReadonly = false; } return; }
    this.replaceAllInner(text, record);
  }
  replaceAllInner(text, record) {
    const selection = this.currentSelection();
    if (record) this.apply([{ from: 0, to: this.text.length, insert: text }], { from: Math.min(selection.from, text.length), to: Math.min(selection.from, text.length) }, { activate: !!this.active, focus: false });
    else { this.deactivate(); this.text = text; this.stale = true; this.refresh(null); this.options.onChange?.(); }
  }

  // ——— Commands ———
  run(command, ...args) {
    const sel = this.currentSelection();
    const block = this.active?.block || this.blocks[this.blockIndexAt(sel.from)];
    const text = this.text;
    let result = null;
    switch (command) {
      case 'bold': result = C.toggleInline(text, sel, '**'); break;
      case 'italic': result = C.toggleInline(text, sel, '*'); break;
      case 'strike': result = C.toggleInline(text, sel, '~~'); break;
      case 'code': result = C.toggleInline(text, sel, '`'); break;
      case 'inlineMath': result = C.toggleInline(text, sel, '$'); break;
      case 'heading': result = C.setHeading(text, sel, args[0]); break;
      case 'quote': case 'bullet': case 'ordered': case 'task': result = C.toggleLinePrefix(text, sel, command); break;
      case 'table': result = C.insertTable(text, sel); break;
      case 'codeBlock': result = C.insertCodeBlock(text, sel); break;
      case 'mathBlock': result = C.insertMathBlock(text, sel); break;
      case 'rule': result = C.insertRule(text, sel); break;
      case 'link': result = C.insertLink(text, sel); break;
      case 'image': result = C.insertImage(text, sel, args[0], args[1]); break;
      case 'formatTable': result = C.formatTable(text, sel.from); break;
      case 'tableRow': result = C.tableNavigate(text, sel.from, 'row'); break;
      case 'tableColumn': result = C.tableAddColumn(text, sel.from); break;
      case 'tableDeleteRow': result = C.tableDeleteRow(text, sel.from); break;
      case 'paragraphAfter': result = block ? C.exitAfter(text, block) : null; break;
      default: {
        const extra = this.extraCommand(command, args, sel, block, text);
        if (extra === undefined) return false;
        if (extra === true) return true;
        result = extra; break;
      }
    }
    if (!result) return false;
    if (result.paragraphAfter != null) { this.openParagraphAfter(result.paragraphAfter); return true; }
    this.apply(result.changes, result.selection, { group: command });
    return true;
  }
  inTable() { const s = this.currentSelection(); return !!C.findTable(this.text, s.from); }

  // The kind of the (sub-)block under the caret, derived from the current text: a paragraph
  // the user just turned into "- item" or "```" behaves like a list or code block at once.
  context() {
    const b = this.active.block, src = this.text.slice(b.from, b.to), caret = this.currentSelection().from - b.from;
    const { blocks } = analyze(src);
    const inner = blocks.find(x => caret >= x.from && caret <= x.to) || blocks.at(-1);
    return inner ? { ...b, ...inner, from: b.from + inner.from, to: b.from + inner.to, temp: b.temp } : b;
  }
  handleEnter(shift, mod) {
    const a = this.active;
    if (!a) return;
    this.syncFromDom(true);
    const sel = this.currentSelection(), b = a.block.temp ? a.block : this.context();
    if (b.temp) return;
    const result = mod ? C.exitAfter(this.text, b) : C.enter(this.text, b, sel, { shift });
    if (!result) return;
    if (result.paragraphAfter != null) { this.openParagraphAfter(result.paragraphAfter); return; }
    const [c] = result.changes;
    // Enter at the end of a paragraph or heading opens a fresh paragraph without touching the text yet.
    if (!mod && !shift && result.blankAt && result.changes.length === 1 && c.from === b.to && /^\n+$/.test(c.insert) && ['paragraph', 'heading'].includes(b.kind)) {
      this.breakUndo = true; this.deactivate(); this.openTemp(b.to); this.sel = { from: b.to, to: b.to }; this.setCaret(0); this.revealActive(); return;
    }
    if (!result.refresh && result.changes.length === 1 && c.from >= a.block.from && c.to <= a.block.to) {
      this.breakUndo = true;
      this.applyRaw(c, { group: 'enter', selBefore: sel });
      this.sel = { ...result.selection };
      const last = this.undoStack.at(-1); if (last) last.selAfter = { ...this.sel };
      this.paint(false); this.setCaret(this.sel.from - a.block.from, this.sel.to - a.block.from); this.schedulePreview();
      this.breakUndo = true;
      return;
    }
    this.apply(result.changes, result.selection, { group: 'enter' });
  }
  openParagraphAfter(pos) {
    this.breakUndo = true;
    this.deactivate();
    if (this.stale) this.reconcile();
    this.openTemp(pos);
    this.sel = { from: pos, to: pos };
    this.setCaret(0); this.revealActive();
  }
  backspaceAtStart() {
    const b = this.active.block, index = this.blocks.indexOf(b);
    const prev = b.temp ? [...this.blocks].reverse().find(x => x.to <= b.from) : this.blocks[index - 1];
    if (b.temp) { this.deactivate(); if (prev) this.activateAt(prev.to); return; }
    const marker = MARKER_AT_START.exec(this.text.slice(b.from, b.to));
    if (marker && ['heading', 'blockquote', 'listItem'].includes(b.kind)) { this.apply([{ from: b.from, to: b.from + marker[0].length, insert: '' }], { from: b.from, to: b.from }, { group: 'unmark' }); return; }
    if (!prev) return;
    if (OPAQUE.has(prev.kind) || OPAQUE.has(b.kind)) { this.activateAt(prev.to); return; }
    this.apply([{ from: prev.to, to: b.from, insert: '' }], { from: prev.to, to: prev.to }, { group: 'join' });
  }
  deleteAtEnd() {
    const b = this.active.block, next = this.blocks.find(x => x.from > b.to);
    if (!next || b.temp) return;
    if (OPAQUE.has(next.kind) || OPAQUE.has(b.kind)) { this.activateAt(next.from); return; }
    const marker = MARKER_AT_START.exec(this.text.slice(next.from, next.to));
    this.apply([{ from: b.to, to: next.from + (marker ? marker[0].length : 0), insert: '' }], { from: b.to, to: b.to }, { group: 'join' });
  }
  handleTab(shift) {
    if (this.active.block.temp) return false;
    const b = this.context(), sel = this.currentSelection(), host = this.active.block;
    let result = null;
    if (b.kind === 'table') result = C.tableNavigate(this.text, sel.from, shift ? -1 : 1);
    else if (b.kind === 'listItem' || (b.kind === 'blockquote' && /^\s*(?:>\s?)*\s*(?:[-*+]|\d+[.)])\s/m.test(b.source || ''))) result = C.indentLines(this.text, sel, shift, () => C.listUnit(this.text, sel.from));
    else if (['fence', 'codeBlock', 'math', 'frontMatter', 'html'].includes(b.kind)) {
      if (!shift && sel.from === sel.to) { this.breakUndo = true; this.applyRaw({ from: sel.from, to: sel.to, insert: '    ' }, { group: 'indent', selBefore: sel }); this.sel = { from: sel.from + 4, to: sel.from + 4 }; this.paint(false); this.setCaret(this.sel.from - host.from); return true; }
      result = C.indentLines(this.text, sel, shift, () => 4);
    }
    else return false;
    if (result) this.apply(result.changes, result.selection, { group: 'indent' });
    return true;
  }
  atEdgeLine(up) {
    const a = this.active, caret = this.getCaret();
    if (!caret || caret.start !== caret.end) return false;
    const src = this.text.slice(a.block.from, a.block.to);
    const logical = up ? !src.slice(0, caret.start).includes('\n') : !src.slice(caret.end).includes('\n');
    if (!logical) return false;
    const range = getSelection().getRangeAt(0).cloneRange();
    let rect = range.getClientRects()[0];
    if (!rect) return true;
    const box = a.el.getBoundingClientRect(), style = getComputedStyle(a.el);
    const line = parseFloat(style.lineHeight) || 24;
    return up ? rect.top - box.top - parseFloat(style.paddingTop) < line * 0.8 : box.bottom - parseFloat(style.paddingBottom) - rect.bottom < line * 0.8;
  }
  move(direction) {
    const b = this.active.block;
    const prev = [...this.blocks].reverse().find(x => x.to < b.from || (b.temp && x.to <= b.from));
    const next = this.blocks.find(x => x.from > b.to);
    if (direction < 0) { if (prev) this.activateAt(prev.to); return; }
    if (next) { this.activateAt(next.from); return; }
    if (!b.temp && (OPAQUE.has(b.kind) || b.kind === 'listItem' || b.kind === 'blockquote' || this.text.slice(b.from, b.to).trim())) this.activateAt(this.text.length);
  }

  // ——— Events ———
  bind() {
    const root = this.root;
    root.addEventListener('keydown', e => this.onKeyDown(e));
    root.addEventListener('beforeinput', e => {
      if (e.inputType === 'historyUndo' || e.inputType === 'historyRedo') { e.preventDefault(); e.inputType === 'historyUndo' ? this.undo() : this.redo(); return; }
      if (this.sourceMode || e.target !== this.active?.el) return;
      if (/^format/.test(e.inputType)) e.preventDefault();
      if ((e.inputType === 'insertParagraph' || e.inputType === 'insertLineBreak') && !e.isComposing) { e.preventDefault(); this.handleEnter(e.inputType === 'insertLineBreak', false); }
    });
    root.addEventListener('input', e => {
      if (e.target === this.sourceView) return this.syncSourceView();
      if (e.target === this.active?.el && !e.isComposing && !this.active.composing) this.syncFromDom();
    });
    root.addEventListener('compositionstart', e => { if (e.target === this.active?.el) this.active.composing = true; });
    root.addEventListener('compositionend', e => { if (e.target === this.active?.el) { this.active.composing = false; this.syncFromDom(); } });
    this.onSelectionChange = () => {
      if (this.sourceMode) { if (document.activeElement === this.sourceView) this.sel = { from: this.sourceView.selectionStart, to: this.sourceView.selectionEnd }; }
      else { const c = this.active && this.getCaret(); if (c) { const b = this.active.block; this.sel = { from: b.from + c.start, to: b.from + c.end }; } }
      this.options.onSelection?.();
    };
    document.addEventListener('selectionchange', this.onSelectionChange);
    this.doc.addEventListener('mousedown', e => { if (e.button === 0 && e.target.closest('.mdTask, .mdCopy, .mdZoom')) e.preventDefault(); });
    this.doc.addEventListener('click', e => this.onClick(e));
    this.doc.addEventListener('dblclick', e => { const special = e.target.closest('.mdMath, .mdMathBlock, img'); if (special) { const pos = this.pointToOffset(e.clientX, e.clientY, e.target); if (pos != null) this.activateAt(pos); } });
    // Clicking below the last block continues writing: in the last paragraph, or a new one.
    this.tail.addEventListener('mousedown', e => {
      e.preventDefault();
      const last = this.blocks.at(-1);
      if (this.active?.block.temp && this.active.block.from >= (last?.to ?? 0)) return this.setCaret(0);
      if (last && last.to === this.text.length && last.kind !== 'paragraph') { this.deactivate(); if (this.stale) this.reconcile(); this.openTemp(this.text.length); this.sel = { from: this.text.length, to: this.text.length }; this.setCaret(0); return; }
      this.activateAt(this.text.length);
    });
    root.addEventListener('copy', e => this.onCopy(e, false));
    root.addEventListener('cut', e => this.onCopy(e, true));
    root.addEventListener('paste', e => this.onPaste(e));
    root.addEventListener('dragover', e => { if ([...(e.dataTransfer?.items || [])].some(i => i.kind === 'file' && i.type.startsWith('image/'))) { e.preventDefault(); e.stopPropagation(); } });
    root.addEventListener('drop', e => this.onDrop(e));
    this.sourceView.addEventListener('keydown', e => { if (e.key === 'Tab' && !e.ctrlKey && !e.altKey) { e.preventDefault(); const s = this.sourceView.selectionStart; this.sourceView.setRangeText('    ', s, this.sourceView.selectionEnd, 'end'); this.syncSourceView(); } });
  }
  shortcut(e) {
    const custom = this.options.resolveShortcut?.(e);
    if (custom) return custom;
    const mod = e.ctrlKey || e.metaKey, key = e.key.toLowerCase(), code = e.code;
    if (mod && e.altKey) return null;
    if (mod && !e.shiftKey) {
      if (key === 'z') return () => this.undo();
      if (key === 'y') return () => this.redo();
      if (key === '/') return () => this.setSourceMode(!this.sourceMode);
      if (key === 'f') return () => this.options.onFind?.(false);
      if (key === 'h') return () => this.options.onFind?.(true);
      if (this.sourceMode) return null;
      if (key === 'b') return () => this.run('bold');
      if (key === 'i') return () => this.run('italic');
      if (key === 'k') return () => this.run('link');
      if (key === 't') return () => this.run('table');
      if (/^digit[0-6]$/.test(code.toLowerCase())) return () => this.run('heading', Number(code.slice(-1)));
      if (key === 'enter') return () => (this.active ? this.handleEnter(false, true) : null);
    }
    if (mod && e.shiftKey) {
      if (key === 'z') return () => this.redo();
      if (this.sourceMode) return null;
      if (code === 'Backquote') return () => this.run('code');
      if (key === 'k') return () => this.run('codeBlock');
      if (key === 'm') return () => this.run('mathBlock');
      if (key === 'e') return () => this.run('inlineMath');
      if (key === 'i') return () => this.options.onInsertImage?.();
      if (key === 'q') return () => this.run('quote');
      if (key === 'x') return () => this.run('task');
      if (code === 'BracketLeft') return () => this.run('ordered');
      if (code === 'BracketRight') return () => this.run('bullet');
      if (key === '-' || code === 'Minus') return () => this.run('rule');
    }
    if (!mod && e.altKey && e.shiftKey && code === 'Digit5') return () => this.run('strike');
    if (e.key === 'F3') return () => this.options.onFindStep?.(e.shiftKey ? -1 : 1);
    return null;
  }
  onKeyDown(e) {
    if(e.target.closest('.mdTableCellInput'))return;
    if (e.isComposing || e.keyCode === 229) return;
    const action = this.shortcut(e);
    if (action) { e.preventDefault(); e.stopPropagation(); action(); return; }
    if (this.sourceMode) return;
    const a = this.active, mod = e.ctrlKey || e.metaKey;
    if (a && e.target === a.el) {
      const caret = this.getCaret(), len = a.block.to - a.block.from;
      const collapsed = caret && caret.start === caret.end;
      switch (e.key) {
        case 'Enter': e.preventDefault(); this.handleEnter(e.shiftKey, mod); return;
        case 'Backspace': if (collapsed && caret.start === 0 && !mod) { e.preventDefault(); this.backspaceAtStart(); } return;
        case 'Delete': if (collapsed && caret.start === len && !mod) { e.preventDefault(); this.deleteAtEnd(); } return;
        case 'ArrowUp': case 'ArrowDown': if (!e.shiftKey && !mod && this.atEdgeLine(e.key === 'ArrowUp')) { e.preventDefault(); this.move(e.key === 'ArrowUp' ? -1 : 1); } return;
        case 'ArrowLeft': if (!e.shiftKey && !mod && collapsed && caret.start === 0) { e.preventDefault(); this.move(-1); } return;
        case 'ArrowRight': if (!e.shiftKey && !mod && collapsed && caret.start === len) { e.preventDefault(); this.move(1); } return;
        case 'Tab': if (!mod && this.handleTab(e.shiftKey)) e.preventDefault(); return;
        case 'Escape': e.preventDefault(); this.deactivate(); this.doc.focus({ preventScroll: true }); return;
        case 'a': if (mod && caret && caret.start === 0 && caret.end === len) { e.preventDefault(); this.selectDocument(); } return;
      }
      return;
    }
    if (e.target === this.doc) this.onDocKey(e);
  }
  selectDocument() {
    this.deactivate();
    this.doc.focus({ preventScroll: true });
    getSelection().selectAllChildren(this.doc);
  }
  onDocKey(e) {
    const mod = e.ctrlKey || e.metaKey, sel = getSelection();
    if (this.readonly && !(mod && e.key.toLowerCase() === 'a')) return;
    const range = sel.rangeCount && !sel.isCollapsed && this.doc.contains(sel.anchorNode) ? this.selectionToSource() : null;
    if (mod && e.key.toLowerCase() === 'a') { e.preventDefault(); this.selectDocument(); return; }
    if (range) {
      if (e.key === 'Backspace' || e.key === 'Delete') { e.preventDefault(); this.apply([{ from: range.from, to: range.to, insert: '' }], { from: range.from, to: range.from }, { group: 'delete' }); }
      else if (e.key.length === 1 && !mod) { e.preventDefault(); this.apply([{ from: range.from, to: range.to, insert: e.key }], { from: range.from + 1, to: range.from + 1 }, { group: 'type' }); }
      else if (e.key === 'Enter') { e.preventDefault(); this.activateAt(range.from, range.to); }
      return;
    }
    if (['Enter', 'ArrowDown', 'ArrowUp', 'ArrowLeft', 'ArrowRight', 'F2'].includes(e.key)) { e.preventDefault(); this.activateAt(Math.min(this.sel.from, this.text.length)); }
    else if (e.key.length === 1 && !mod && !e.altKey) { e.preventDefault(); this.activateAt(this.sel.from); this.apply([{ from: this.sel.from, to: this.sel.to, insert: e.key }], { from: this.sel.from + 1, to: this.sel.from + 1 }, { group: 'type' }); }
  }
  onClick(e) {
    if(this.visualTables.click(e))return;
    const t = e.target;
    const task = t.closest('.mdTask');
    if (task) { e.preventDefault(); if (this.readonly) return; const b = t.closest('.mdBlock')?.blockRef; const r = b && C.toggleTask(this.text, b, Number(task.dataset.task)); if (r) this.apply(r.changes, r.selection, { group: 'task', activate: false }); return; }
    const zoom = t.closest('.mdZoom');
    if (zoom) { e.preventDefault(); const box = zoom.closest('.mdMermaid'); box.dataset.zoom = box.dataset.zoom === 'actual' ? '' : 'actual'; fitDiagram(box.querySelector('.mdMermaidView')); return; }
    const copy = t.closest('.mdCopy');
    if (copy) { e.preventDefault(); copyText(copy.closest('.mdCodeBlock, .mdMermaid')?.querySelector('code')?.textContent || ''); this.options.onStatus?.('已复制代码'); return; }
    const link = t.closest('a');
    if (link) { e.preventDefault(); if (e.ctrlKey || e.metaKey || this.readonly) { this.options.onOpenLink?.(link.getAttribute('href') || ''); return; } }
    if (this.active && this.active.el.contains(t)) {
      if (e.ctrlKey || e.metaKey) { const url = this.linkAtCaret(); if (url) this.options.onOpenLink?.(url); }
      return;
    }
    const sel = getSelection();
    if (sel.rangeCount && !sel.isCollapsed && this.doc.contains(sel.anchorNode) && !(this.active?.el.contains(sel.anchorNode))) return;
    const pos = this.pointToOffset(e.clientX, e.clientY, t);
    if (pos != null) this.activateAt(pos);
  }
  linkAtCaret() {
    const { from } = this.currentSelection();
    const line0 = C.lineStartAt(this.text, from), line = this.text.slice(line0, C.lineEndAt(this.text, from));
    for (const re of [/\[[^\]]*\]\((<[^>]*>|[^)\s]*)[^)]*\)/g, /<((?:https?:\/\/|mailto:)[^>\s]+)>/g, /https?:\/\/[^\s<>()]+/g]) {
      for (let m; (m = re.exec(line));) if (from - line0 >= m.index && from - line0 <= m.index + m[0].length) return (m[1] || m[0]).replace(/^<|>$/g, '');
    }
    return null;
  }
  pointToOffset(x, y, target) {
    const blockEl = target.closest?.('.mdBlock');
    if (!blockEl || !this.doc.contains(blockEl)) {
      for (const b of this.blocks) { const r = b.el.getBoundingClientRect(); if (y < r.top) return b.from; if (y <= r.bottom) return b.to; }
      return this.blocks.length ? this.blocks.at(-1).to : 0;
    }
    const b = blockEl.blockRef;
    if (!b || b === this.active?.block || b.temp) return null;
    const rendered = blockEl.querySelector(':scope > .mdRendered');
    const src = this.text.slice(b.from, b.to);
    if (target.closest('.mdMermaid')) { const nl = src.indexOf('\n'); return b.from + (nl < 0 ? src.length : nl + 1); }
    const special = target.closest('.mdMath, .mdMathBlock');
    if (special) {
      const index = [...rendered.querySelectorAll('.mdMath, .mdMathBlock')].indexOf(special);
      if (b.kind === 'math') return b.from + Math.min(src.length, 3);
      let n = 0; MATH_SOURCE.lastIndex = 0;
      for (let m; (m = MATH_SOURCE.exec(src));) if (n++ === index) return b.from + m.index + (m[0].startsWith('$$') ? 2 : 1);
      return b.from;
    }
    if (target.tagName === 'IMG') {
      const index = [...rendered.querySelectorAll('img')].indexOf(target);
      let n = 0; const re = /!\[/g;
      for (let m; (m = re.exec(src));) if (n++ === index) return b.from + m.index + 2;
      return b.from;
    }
    if (target.closest('hr')) return b.to;
    const point = caretPoint(x, y);
    if (!point || !rendered.contains(point.node)) return b.to;
    return b.from + alignRendered(src, b.kind, textBefore(rendered, point.node, point.offset));
  }
  mapPoint(node, offset) {
    if (node === this.doc) { const child = this.doc.childNodes[offset]; return child?.blockRef ? child.blockRef.from : this.text.length; }
    const element = node.nodeType === 1 ? node : node.parentElement;
    const blockEl = element?.closest('.mdBlock'), b = blockEl?.blockRef;
    if (!b) return null;
    if (this.active?.block === b && this.active.el.contains(node)) return b.from + lengthUntil(this.active.el, node, offset);
    const rendered = blockEl.querySelector(':scope > .mdRendered');
    if (!rendered.contains(node)) return offset === 0 ? b.from : b.to;
    return b.from + alignRendered(this.text.slice(b.from, b.to), b.kind, textBefore(rendered, node, offset));
  }
  selectionToSource() {
    const sel = getSelection();
    if (!sel.rangeCount) return null;
    const r = sel.getRangeAt(0);
    const a = this.mapPoint(r.startContainer, r.startOffset), b = this.mapPoint(r.endContainer, r.endOffset);
    if (a == null || b == null) return null;
    // A selection ending exactly at a block end includes it completely.
    return { from: Math.min(a, b), to: Math.max(a, b) };
  }
  onCopy(e, cut) {
    if(e.target.closest('.mdTableCellInput'))return;
    if (this.sourceMode) return;
    const sel = getSelection();
    if (!sel.rangeCount || sel.isCollapsed || !this.doc.contains(sel.anchorNode)) return;
    if (this.active && this.active.el.contains(sel.anchorNode) && this.active.el.contains(sel.focusNode)) return;
    const range = this.selectionToSource();
    if (!range) return;
    e.preventDefault();
    const holder = document.createElement('div'); holder.append(sel.getRangeAt(0).cloneContents());
    for (const el of holder.querySelectorAll('.mdSource, .mdLivePreview, .mdCodeHead')) el.remove();
    e.clipboardData.setData('text/plain', this.prefs.copyMarkdown === false ? holder.textContent : this.text.slice(range.from, range.to));
    e.clipboardData.setData('text/html', CLIP_MARK + holder.innerHTML);
    if (cut) this.apply([{ from: range.from, to: range.to, insert: '' }], { from: range.from, to: range.from }, { group: 'cut' });
  }
  async onPaste(e) {
    if(e.target.closest('.mdTableCellInput'))return;
    if(this.visualTables.paste(e))return;
    if (this.sourceMode || e.target === this.sourceView) return;
    const data = e.clipboardData;
    if (!data) return;
    if (this.readonly) { e.preventDefault(); return; }
    const images = [...data.files].filter(f => f.type.startsWith('image/'));
    const { text: rawText, converted } = this.smartPasteText(data);
    const text = rawText;
    if (!images.length && !text) return;
    e.preventDefault();
    const sel = this.currentSelection();
    const urlEdit = !converted && this.smartUrl(text, sel);
    if (urlEdit) { this.apply([{ from: urlEdit.from, to: urlEdit.to, insert: urlEdit.insert }], { from: urlEdit.from + urlEdit.insert.length, to: urlEdit.from + urlEdit.insert.length }, { group: 'paste' }); return; }
    if (images.length && !text) {
      const inserts = [];
      for (const file of images) { const path = await this.options.onPasteImage?.(file); if (path) inserts.push(`![${file.name && !/^image\.\w+$/.test(file.name) ? file.name.replace(/\.\w+$/, '') : ''}](${path})`); }
      if (inserts.length) this.apply([{ from: sel.from, to: sel.to, insert: inserts.join('\n') }], { from: sel.from + inserts.join('\n').length, to: sel.from + inserts.join('\n').length }, { group: 'paste' });
      return;
    }
    let insert = converted ? text : text.replace(/\r\n?/g, '\n');
    if (converted && (insert.trim().includes('\n') || /^(#{1,6} |[-*+] |\d+[.)] |> |```|\|)/.test(insert))) {
      // Block-level content pasted mid-line starts its own block.
      const t = this.text, ls = t.lastIndexOf('\n', sel.from - 1) + 1, le = t.indexOf('\n', sel.to), rest = t.slice(sel.to, le < 0 ? t.length : le);
      insert = insert.replace(/\n+$/, '');
      if (t.slice(ls, sel.from).trim()) insert = '\n\n' + insert;
      if (rest.trim()) insert += '\n\n';
    }
    if (converted) this.options.onStatus?.('已按格式粘贴（Ctrl+Shift+V 粘贴为纯文本）');
    const a = this.active;
    if (a && !insert.includes('\n') && sel.from >= a.block.from && sel.to <= a.block.to && !a.block.temp) {
      this.breakUndo = true;
      this.applyRaw({ from: sel.from, to: sel.to, insert }, { group: 'paste', selBefore: sel });
      this.sel = { from: sel.from + insert.length, to: sel.from + insert.length };
      this.paint(false); this.setCaret(this.sel.from - a.block.from); this.schedulePreview(); this.breakUndo = true;
      return;
    }
    const end = sel.from + insert.length;
    this.apply([{ from: sel.from, to: sel.to, insert }], { from: end, to: end }, { group: 'paste' });
  }
  async onDrop(e) {
    if (this.readonly) { e.preventDefault(); return; }
    const files = [...(e.dataTransfer?.files || [])];
    const images = files.filter(f => /^image\//.test(f.type) || /\.(png|jpe?g|gif|webp|svg|bmp|avif)$/i.test(f.name));
    if (!images.length || images.length !== files.length) return;
    e.preventDefault(); e.stopPropagation();
    const pos = this.sourceMode ? this.sourceView.selectionStart : this.pointToOffset(e.clientX, e.clientY, e.target) ?? this.sel.from;
    const paths = await this.options.onDropImages?.(images);
    if (!paths?.length) return;
    const insert = paths.map(p => `![](${p})`).join('\n');
    this.apply([{ from: pos, to: pos, insert }], { from: pos + insert.length, to: pos + insert.length }, { group: 'drop' });
  }

  // ——— Live preview under the edited block (math, images, tables, HTML) ———
  schedulePreview() { const a = this.active; if (!a) return; clearTimeout(a.previewTimer); a.previewTimer = setTimeout(() => this.updatePreview(), 140); }
  updatePreview() {
    const a = this.active;
    if (!a) return;
    const src = this.text.slice(a.block.from, a.block.to);
    const wanted = ['math', 'table', 'html'].includes(a.block.kind) || /^\s*(`{3,}|~{3,})\s*(?:mermaid|sequence|flow(?:chart)?)\b/im.test(src) || /!\[[^\]]*\]\([^)]*\)|\$[^$\s]/.test(src);
    if (!wanted || !src.trim()) { a.preview?.remove(); a.preview = null; return; }
    if (!a.preview) { a.preview = document.createElement('div'); a.preview.className = 'mdLivePreview'; a.preview.setAttribute('aria-hidden', 'true'); a.block.el.append(a.preview); }
    const content = sanitize(renderBlockHtml(src, a.block, this.references, this.info));
    const holder = document.createElement('div'); holder.append(content);
    for (const img of holder.querySelectorAll('img')) { const old = [...(a.preview.querySelectorAll('img') || [])].find(x => x.dataset.source === img.getAttribute('src') && x.src); if (old) { img.dataset.source = old.dataset.source; img.src = old.src; } }
    this.loadImages(holder);
    // Keep the previous diagram on screen until the new one is drawn (no flicker while typing).
    const previous = a.preview.querySelector('.mdMermaid .mdMermaidView svg');
    if (previous) for (const view of holder.querySelectorAll('.mdMermaidView')) view.append(previous.cloneNode(true));
    a.preview.replaceChildren(...holder.childNodes);
    if (a.preview.querySelector('.mdMermaid')) renderDiagrams(a.preview);
  }

  // ——— Source mode ———
  setSourceMode(on) {
    if (on === this.sourceMode) return;
    const sel = this.currentSelection();
    if (on) {
      this.deactivate();
      this.sourceMode = true; this.scroller.hidden = true; this.sourceView.hidden = false;
      this.sourceView.value = this.text;
      this.sourceView.focus({ preventScroll: true }); this.sourceView.setSelectionRange(sel.from, sel.to);
      this.scrollSourceTo(sel.from);
    } else {
      this.sourceMode = false; this.sourceView.hidden = true; this.scroller.hidden = false;
      this.reconcile();
      this.activateAt(sel.from, sel.to);
    }
    this.sel = sel;
    this.options.onMode?.(this.sourceMode);
    this.highlightSearch();
  }
  syncSourceView() {
    const old = this.text, now = this.sourceView.value.replace(/\r\n?/g, '\n');
    if (old === now) return;
    let p = 0; const max = Math.min(old.length, now.length);
    while (p < max && old[p] === now[p]) p++;
    let s = 0; while (s < max - p && old[old.length - 1 - s] === now[now.length - 1 - s]) s++;
    this.applyRaw({ from: p, to: old.length - s, insert: now.slice(p, now.length - s) }, { group: 'type', selBefore: this.sel });
    this.sel = { from: this.sourceView.selectionStart, to: this.sourceView.selectionEnd };
    const last = this.undoStack.at(-1); if (last) last.selAfter = { ...this.sel };
  }
  scrollSourceTo(pos) {
    const view = this.sourceView, line = this.text.slice(0, pos).split('\n').length - 1;
    const height = parseFloat(getComputedStyle(view).lineHeight) || 22;
    view.scrollTop = Math.max(0, line * height - view.clientHeight / 3);
  }
  scrollToOffset(pos, { activate = false } = {}) {
    if (this.sourceMode) { this.sourceView.setSelectionRange(pos, pos); this.scrollSourceTo(pos); this.sel = { from: pos, to: pos }; return; }
    if (activate) { this.activateAt(pos); this.active?.el.scrollIntoView({ block: 'start' }); return; }
    const el = this.elementAt(pos) || this.blocks.find(b => b.from >= pos)?.el;
    el?.scrollIntoView({ block: 'start', behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
    this.sel = { from: pos, to: pos };
  }
  get scrollTop() { return this.sourceMode ? this.sourceView.scrollTop : this.scroller.scrollTop; }
  set scrollTop(value) { if (this.sourceMode) this.sourceView.scrollTop = value; else this.scroller.scrollTop = value; }
  focus() {
    if (this.sourceMode) this.sourceView.focus({ preventScroll: true });
    else if (this.active) this.setCaret(this.sel.from - this.active.block.from, this.sel.to - this.active.block.from);
    else this.doc.focus({ preventScroll: true });
  }

  // ——— Search ———
  setSearch(options) {
    this.search.options = options && options.query ? options : null;
    const found = this.search.options ? C.findMatches(this.text, options) : [];
    if (found.error) { this.search.matches = []; this.search.index = -1; this.highlightSearch(); return { total: 0, index: -1, error: found.error }; }
    this.search.matches = found;
    const from = this.currentSelection().from;
    this.search.index = found.length ? Math.max(0, found.findIndex(m => m.from >= from)) : -1;
    this.highlightSearch();
    return { total: found.length, index: this.search.index };
  }
  findStep(direction) {
    const s = this.search;
    if (!s.options) return { total: 0, index: -1 };
    s.matches = C.findMatches(this.text, s.options);
    if (s.matches.error || !s.matches.length) { s.index = -1; this.highlightSearch(); return { total: 0, index: -1 }; }
    const pos = this.currentSelection();
    if (s.index < 0 || s.index >= s.matches.length) s.index = 0;
    else {
      const current = s.matches[s.index];
      const onCurrent = current && current.from === pos.from && current.to === pos.to;
      s.index = onCurrent ? (s.index + direction + s.matches.length) % s.matches.length
        : direction > 0 ? Math.max(0, s.matches.findIndex(m => m.from >= pos.to)) : Math.max(0, s.matches.findLastIndex(m => m.to <= pos.from));
    }
    this.showMatch();
    return { total: s.matches.length, index: s.index };
  }
  showMatch() {
    const m = this.search.matches[this.search.index];
    if (!m) return;
    if (this.sourceMode) { this.sourceView.setSelectionRange(m.from, m.to); this.scrollSourceTo(m.from); this.sel = { from: m.from, to: m.to }; return; }
    this.activateAt(m.from, m.to, { focus: false });
    this.sel = { from: m.from, to: m.to };
    this.revealActive();
    this.highlightSearch();
  }
  replaceCurrent(replacement) {
    const s = this.search, m = s.matches[s.index];
    if (!m) return this.findStep(1);
    const insert = C.expandReplacement(m, replacement, s.options.regex);
    this.apply([{ from: m.from, to: m.to, insert }], { from: m.from + insert.length, to: m.from + insert.length }, { group: 'replace', focus: false });
    s.matches = C.findMatches(this.text, s.options);
    s.index = s.matches.findIndex(x => x.from >= m.from + insert.length);
    if (s.index < 0 && s.matches.length) s.index = 0;
    if (s.index >= 0) this.showMatch(); else this.highlightSearch();
    return { total: s.matches.length, index: s.index };
  }
  replaceEvery(replacement) {
    const s = this.search;
    const matches = C.findMatches(this.text, s.options || {});
    if (!matches.length || matches.error) return 0;
    this.apply(matches.map(m => ({ from: m.from, to: m.to, insert: C.expandReplacement(m, replacement, s.options.regex) })), null, { group: 'replaceAll', focus: false });
    s.matches = []; s.index = -1; this.highlightSearch();
    return matches.length;
  }
  clearSearch() { this.search = { matches: [], index: -1, options: null }; this.highlightSearch(); }
  highlightSearch() {
    if (!globalThis.CSS?.highlights) return;
    const all = [], current = [];
    const s = this.search;
    if (s.options && !this.sourceMode && this.root.isConnected && !this.root.closest('[hidden]')) {
      let pattern;
      try { pattern = new RegExp(s.options.regex ? s.options.query : s.options.query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'gu' + (s.options.caseSensitive ? '' : 'i')); } catch { pattern = null; }
      if (pattern) for (const b of this.blocks) {
        if (this.active?.block === b) continue;
        const rendered = b.el.querySelector(':scope > .mdRendered');
        if (!rendered || rendered.hidden) continue;
        const nodes = textNodes(rendered).filter(n => !n.parentElement.closest(SKIP_RENDERED));
        for (const node of nodes) { pattern.lastIndex = 0; for (let m; (m = pattern.exec(node.data)) && all.length < 3000;) { if (!m[0].length) { pattern.lastIndex++; continue; } const r = document.createRange(); r.setStart(node, m.index); r.setEnd(node, m.index + m[0].length); all.push(r); } }
      }
      const a = this.active;
      if (a) for (const [i, m] of s.matches.entries()) {
        if (m.from < a.block.from || m.to > a.block.to) continue;
        const r = rangeAt(a.el, m.from - a.block.from, m.to - a.block.from);
        (i === s.index ? current : all).push(r);
      }
    }
    CSS.highlights.set('md-search', new Highlight(...all));
    CSS.highlights.set('md-search-current', new Highlight(...current));
  }
  releaseHighlights() { if (globalThis.CSS?.highlights) { CSS.highlights.delete('md-search'); CSS.highlights.delete('md-search-current'); } }

  destroy() { document.removeEventListener('selectionchange', this.onSelectionChange); document.removeEventListener('selectionchange', this.typewriterTick); this.closeEmojiPopup(); this.releaseHighlights(); this.root.replaceChildren(); }
}
installTypora(MarkdownEditor);
