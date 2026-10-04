// Typora-style editing features layered onto MarkdownEditor (installed once with installTypora):
// extra commands, view modes (focus / typewriter / read-only), copy & paste flavours, smart paste,
// auto-pairing, emoji completion, image tools and semantic selection.
import * as C from './commands.mjs';
import { md, sanitize, renderBlockHtml, escapeHtml } from './parser.mjs';
import { htmlToMarkdown, looksSemantic } from './html2md.mjs';
import { searchEmoji } from './emoji.mjs';

const PAIRS = { '(': ')', '[': ']', '{': '}', '"': '"', "'": "'", '`': '`', '（': '）', '【': '】', '「': '」', '『': '』', '《': '》', '“': '”', '‘': '’', '〈': '〉' };
const WRAP_ONLY = { '*': '*', '_': '_', '~': '~', '$': '$', '=': '=', '<': '>', '^': '^' };
const CLOSERS = new Set(Object.values(PAIRS));

// Writes text (and optionally HTML) to the clipboard through a synthetic copy event.
export function writeClipboard({ text = '', html = '' }) {
  const area = document.createElement('textarea');
  area.value = text || ' '; area.setAttribute('readonly', ''); area.style.cssText = 'position:fixed;left:-9999px;top:0;opacity:0';
  document.body.append(area); area.select();
  const handler = e => { e.preventDefault(); e.clipboardData.setData('text/plain', text); if (html) e.clipboardData.setData('text/html', html); };
  document.addEventListener('copy', handler, { once: true, capture: true });
  try { document.execCommand('copy'); } finally { document.removeEventListener('copy', handler, true); area.remove(); }
}
const stripTheme = root => {
  for (const el of root.querySelectorAll('*')) { el.removeAttribute('class'); el.removeAttribute('style'); el.removeAttribute('id'); el.removeAttribute('title'); el.removeAttribute('aria-label'); }
  for (const el of root.querySelectorAll('.mdCopy, .mdZoom, button')) el.remove();
  return root;
};
export const CLIP_MARK = '<meta name="qingye-md" content="1">';

// Occurrences of images in a block source, skipping code spans / fences.
function imageMatches(src) {
  const skip = [];
  for (const re of [/^[ \t]*(`{3,}|~{3,})[^\n]*\n[\s\S]*?(?:\n[ \t]*\1[ \t]*(?:\n|$)|$)/gm, /(`+)[^`\n]+?\1/g]) for (let m; (m = re.exec(src));) skip.push([m.index, m.index + m[0].length]);
  const found = [];
  const re = /!\[((?:\\.|[^\]])*)\]\((<[^>]*>|[^)\s]*)(?:\s+(?:"([^"]*)"|'([^']*)'))?\)|<img\b[^>]*>/gi;
  for (let m; (m = re.exec(src));) {
    if (skip.some(([a, b]) => m.index >= a && m.index < b)) continue;
    if (m[0][0] === '<') {
      const attr = name => (new RegExp(`\\b${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i').exec(m[0]) || [])[2] ?? (new RegExp(`\\b${name}\\s*=\\s*'([^']*)'`, 'i').exec(m[0]) || [])[1] ?? '';
      found.push({ from: m.index, to: m.index + m[0].length, src: attr('src'), alt: attr('alt'), title: attr('title'), width: attr('width'), html: true });
    } else found.push({ from: m.index, to: m.index + m[0].length, src: m[2].replace(/^<|>$/g, ''), alt: m[1], title: m[3] ?? m[4] ?? '', width: '', html: false });
  }
  return found;
}
export { imageMatches };
const pathOf = src => (/[\s()]/.test(src) ? `<${src}>` : src);
export function imageMarkdown(info) { return `![${info.alt}](${pathOf(info.src)}${info.title ? ` "${info.title.replace(/"/g, '&quot;')}"` : ''})`; }
export function imageHtml(info, width) {
  const a = v => String(v).replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');
  return `<img src="${a(info.src)}"${info.alt ? ` alt="${a(info.alt)}"` : ''}${info.title ? ` title="${a(info.title)}"` : ''}${width ? ` width="${a(width)}"` : ''} />`;
}

export function installTypora(Editor) {
  Object.assign(Editor.prototype, {
    // ——— Options shared with the host ———
    initTypora() {
      this.prefs = this.options.prefs || {};
      this.readonly = false; this.typewriter = false; this.focusMode = false; this.plainNext = false;
      this.root.addEventListener('keydown', e => this.typoraKeyDown(e), true);
      this.root.addEventListener('input', () => { clearTimeout(this.emojiTimer); this.emojiTimer = setTimeout(() => this.updateEmojiPopup(), 0); }, true);
      this.scroller.addEventListener('scroll', () => this.closeEmojiPopup(), { passive: true });
      document.addEventListener('selectionchange', this.typewriterTick = () => { if (this.typewriter) this.scheduleTypewriter(); });
    },
    setFocusMode(on) { this.focusMode = !!on; this.root.classList.toggle('isFocusMode', !!on); },
    setTypewriterMode(on) { this.typewriter = !!on; this.root.classList.toggle('isTypewriter', !!on); if (on) this.scheduleTypewriter(true); },
    setReadonly(on) {
      this.readonly = !!on; this.root.classList.toggle('isReadonly', !!on);
      this.sourceView.readOnly = !!on;
      if (on) { this.deactivate(); this.closeEmojiPopup(); }
    },
    setSpellcheck(on) { this.prefs.spellcheck = !!on; if (this.active) this.active.el.spellcheck = !!on; this.sourceView.spellcheck = !!on; },
    scheduleTypewriter(force) {
      if (this.sourceMode || !this.active) return;
      cancelAnimationFrame(this.twFrame);
      this.twFrame = requestAnimationFrame(() => {
        const sel = getSelection();
        if (!sel.rangeCount || !this.active?.el.contains(sel.anchorNode)) return;
        let rect = sel.getRangeAt(0).getClientRects()[0];
        if (!rect) { rect = this.active.el.getBoundingClientRect(); }
        const view = this.scroller.getBoundingClientRect(), target = view.top + view.height * 0.42, delta = rect.top - target;
        if (force || Math.abs(delta) > 6) this.scroller.scrollTop += delta;
      });
    },

    blockKind() { const b = this.currentBlock(); if (!b) return ''; if (this.active) { try { return this.context().kind; } catch { return b.kind; } } return b.kind; },
    tableState() { const s = this.currentSelection(); return C.tableInfo(this.text, s.from); },
    tableBox() { const b = this.active?.block; if (!b) return null; const t = C.findTable(this.text, this.currentSelection().from); if (!t) return null; return (this.active.el.closest('.mdBlock') || b.el).getBoundingClientRect(); },
    selectAllText() { if (this.sourceMode) { this.sourceView.select(); return; } this.selectDocument(); },
    refreshAll() { this.refKey = ''; this.deactivate(); this.reconcile(); },
    // ——— Selection helpers ———
    selectedSource() {
      let range = this.sourceMode ? this.currentSelection() : (this.active ? this.currentSelection() : this.selectionToSource() || this.sel);
      if (!range) range = { from: 0, to: 0 };
      return { ...range, text: this.text.slice(range.from, range.to) };
    },
    currentBlock() { return this.active?.block || this.blocks[this.blockIndexAt(this.currentSelection().from)] || null; },
    select(range) { if (range) this.activateAt(range.from, range.to); },
    selectBlock() { const b = this.currentBlock(); if (b) this.activateAt(b.from, b.to); },
    jump(where) {
      const len = this.text.length, sel = this.currentSelection();
      if (where === 'top') { this.activateAt(0); this.scroller.scrollTop = 0; if (this.sourceMode) this.sourceView.scrollTop = 0; }
      else if (where === 'bottom') { this.activateAt(this.sourceMode || !this.blocks.length ? len : Math.min(len, this.blocks.at(-1).to)); this.scroller.scrollTop = this.scroller.scrollHeight; if (this.sourceMode) this.sourceView.scrollTop = this.sourceView.scrollHeight; }
      else if (where === 'selection') { if (this.sourceMode) this.scrollSourceTo(sel.from); else { this.activateAt(sel.from, sel.to); this.active?.el.scrollIntoView({ block: 'center' }); } }
      else if (where === 'lineStart') this.activateAt(C.lineStartAt(this.text, sel.from));
      else if (where === 'lineEnd') this.activateAt(C.lineEndAt(this.text, sel.to));
    },

    // ——— Extra commands (returns undefined when unknown, true when handled, else a result) ———
    extraCommand(command, args, sel, block, text) {
      const table = op => C.tableEdit(text, sel.from, op, args[0]);
      switch (command) {
        case 'underline': return C.toggleWrap(text, sel, '<u>', '</u>');
        case 'highlight': return C.toggleInline(text, sel, '==');
        case 'sub': return C.toggleScript(text, sel, '~');
        case 'sup': return C.toggleScript(text, sel, '^');
        case 'comment': return C.toggleWrap(text, sel, '<!-- ', ' -->');
        case 'clearFormat': return C.clearFormat(text, sel);
        case 'footnote': return C.insertFootnote(text, sel);
        case 'linkRef': return C.insertLinkReference(text, sel);
        case 'toc': return C.insertToc(text, sel);
        case 'frontMatter': return C.insertFrontMatter(text);
        case 'alert': return C.insertAlert(text, sel, args[0] || 'NOTE');
        case 'headingUp': return C.shiftHeading(text, sel, 1);
        case 'headingDown': return C.shiftHeading(text, sel, -1);
        case 'taskToggle': return C.setTaskStatus(text, sel, 'toggle');
        case 'taskComplete': return C.setTaskStatus(text, sel, 'complete');
        case 'taskIncomplete': return C.setTaskStatus(text, sel, 'incomplete');
        case 'indent': return C.indentSelection(text, sel, false);
        case 'outdent': return C.indentSelection(text, sel, true);
        case 'insertText': { const t = String(args[0] ?? ''); return { changes: [{ from: sel.from, to: sel.to, insert: t }], selection: { from: sel.from + t.length, to: sel.from + t.length } }; }
        case 'insertHtml': return C.insertHtmlSnippet(text, sel, args[0]);
        case 'tableRowAbove': return table('rowAbove');
        case 'tableRowBelow': return table('rowBelow');
        case 'tableColBefore': return table('colBefore');
        case 'tableColAfter': return table('colAfter');
        case 'tableDeleteCol': return table('deleteCol');
        case 'tableRowUp': return table('rowUp');
        case 'tableRowDown': return table('rowDown');
        case 'tableColLeft': return table('colLeft');
        case 'tableColRight': return table('colRight');
        case 'tableAlign': return table('align');
        case 'tableResize': return table('resize');
        case 'tableDelete': return table('delete');
        case 'paragraphBefore': return block ? C.insertParagraphBefore(block) : null;
        case 'deleteBlock': return block ? C.deleteBlockRange(text, block) : null;
        case 'selectWord': this.select(C.wordRange(text, sel.from)); return true;
        case 'selectLine': this.select(C.lineRange(text, sel.from)); return true;
        case 'selectStyled': this.select(C.styledScopeRange(text, sel.from)); return true;
        case 'selectBlock': this.selectBlock(); return true;
        case 'deleteWord': return C.deleteRange(text, sel.from !== sel.to ? sel : C.wordRange(text, sel.from));
        case 'deleteLine': return C.deleteRange(text, sel.from !== sel.to ? sel : C.lineRange(text, sel.from));
        case 'deleteStyled': return C.deleteRange(text, sel.from !== sel.to ? sel : C.styledScopeRange(text, sel.from));
        case 'jumpTop': this.jump('top'); return true;
        case 'jumpBottom': this.jump('bottom'); return true;
        case 'jumpSelection': this.jump('selection'); return true;
        case 'jumpLineStart': this.jump('lineStart'); return true;
        case 'jumpLineEnd': this.jump('lineEnd'); return true;
        case 'codeIndent': return block ? C.autoIndentCode(text, block, sel, false) : null;
        case 'codeIndentAll': return block ? C.autoIndentCode(text, block, sel, true) : null;
        case 'copyMarkdown': case 'copyHtml': case 'copyPlain': case 'copyNoTheme': case 'copyRich': this.copyAs(command.slice(4).toLowerCase()); return true;
        case 'copyTable': { const t = C.tableMarkdown(text, sel.from); if (t) { writeClipboard({ text: t }); this.options.onStatus?.('已复制表格 Markdown'); } return true; }
        case 'copyCode': { const b = block && C.fenceBody(text, block); const code = b ? text.slice(b.from, b.to) : block ? text.slice(block.from, block.to) : ''; writeClipboard({ text: code }); this.options.onStatus?.('已复制代码'); return true; }
        case 'copyMath': case 'copyTex': { const t = this.mathAt(sel.from, block); if (t) { writeClipboard({ text: command === 'copyMath' ? t.tex : t.tex }); this.options.onStatus?.('已复制 TeX 代码'); } return true; }
        case 'copyMathML': { const t = this.mathAt(sel.from, block); if (t) { writeClipboard({ text: t.mathml }); this.options.onStatus?.('已复制 MathML'); } return true; }
        case 'pasteAsPlain': this.plainNext = true; this.options.onPasteCommand?.(); return true;
        case 'paste': this.options.onPasteCommand?.(); return true;
        default: return undefined;
      }
    },

    // Math under the caret: TeX source and MathML (through KaTeX's own MathML output).
    mathAt(pos, block) {
      const src = block ? this.text.slice(block.from, block.to) : '';
      let tex = '';
      if (block?.kind === 'math') tex = src.replace(/^\s*\$\$\s*\n?/, '').replace(/\n?\s*\$\$\s*$/, '');
      else { const at = pos - (block?.from ?? 0); const re = /\$\$([^$]+?)\$\$|\$(?![\s$])((?:\\\$|[^$\n])*?[^\s\\])\$(?!\d)/g; for (let m; (m = re.exec(src));) if (at >= m.index && at <= m.index + m[0].length) { tex = m[1] ?? m[2]; break; } }
      if (!tex) return null;
      const holder = document.createElement('div'); holder.innerHTML = md.render(`$$\n${tex}\n$$`, {});
      const mathml = holder.querySelector('math')?.outerHTML || '';
      return { tex: tex.trim(), mathml };
    },

    // ——— Copy flavours ———
    copyAs(kind) {
      const { text, from, to } = this.selectedSource();
      let source = text;
      if (!source) { const b = this.currentBlock(); source = b ? this.text.slice(b.from, b.to) : ''; }
      if (!source) return;
      const html = () => { const div = document.createElement('div'); div.append(sanitize(renderBlockHtml(source, {}, this.references, this.info))); for (const el of div.querySelectorAll('.mdCopy,.mdZoom')) el.remove(); return div; };
      if (kind === 'markdown') writeClipboard({ text: source });
      else if (kind === 'html') { const div = html(); stripTheme(div); writeClipboard({ text: div.innerHTML.trim() }); }
      else if (kind === 'plain') writeClipboard({ text: html().textContent.trim() });
      else if (kind === 'notheme' || kind === 'rich') { const div = stripTheme(html()); writeClipboard({ text: source, html: CLIP_MARK + div.innerHTML }); }
      this.options.onStatus?.({ markdown: '已复制为 Markdown', html: '已复制为 HTML 代码', plain: '已复制为纯文本', notheme: '已复制内容（无主题样式）', rich: '已复制富文本' }[kind]);
    },

    // ——— Paste ———
    smartPasteText(data) {
      const html = data.getData('text/html'), plain = data.getData('text/plain').replace(/\r\n?/g, '\n');
      const plainOnly = this.plainNext; this.plainNext = false;
      if (plainOnly) return { text: plain, converted: false };
      if (html && !html.includes('qingye-md') && this.prefs.smartPaste !== false && looksSemantic(html)) {
        const converted = htmlToMarkdown(html);
        if (converted && converted.trim()) return { text: converted, converted: true };
      }
      return { text: plain, converted: false };
    },
    // Pasting a URL over selected text links it; a lone image URL becomes an image.
    smartUrl(text, sel) {
      const url = text.trim();
      if (!/^(https?:\/\/|mailto:)\S+$/i.test(url)) return null;
      if (sel.from !== sel.to && !this.text.slice(sel.from, sel.to).includes('\n')) { const label = this.text.slice(sel.from, sel.to); const insert = `[${label}](${url})`; return { from: sel.from, to: sel.to, insert }; }
      if (/\.(png|jpe?g|gif|webp|svg|bmp|avif)(\?\S*)?$/i.test(url)) { const insert = `![](${url})`; return { from: sel.from, to: sel.to, insert }; }
      return null;
    },

    // ——— Auto pairing ———
    typoraKeyDown(e) {
      if (this.readonly && !(e.ctrlKey || e.metaKey) && e.key.length === 1) { e.preventDefault(); e.stopPropagation(); return; }
      if (this.emojiPopup && this.emojiKey(e)) return;
      if (e.isComposing || e.keyCode === 229 || this.sourceMode || !this.active || e.target !== this.active.el) return;
      const mod = e.ctrlKey || e.metaKey;
      if (mod && e.shiftKey && e.key.toLowerCase() === 'v') { this.plainNext = true; return; }
      if (mod || e.altKey || this.prefs.autoPair === false) return;
      const key = e.key;
      const caret = this.getCaret();
      if (!caret) return;
      const b = this.active.block, src = this.text.slice(b.from, b.to), start = caret.start, end = caret.end, collapsed = start === end;
      const before = src[start - 1] || '', after = src[end] || '';
      const edit = (from, to, insert, selFrom, selTo = selFrom) => {
        e.preventDefault(); e.stopPropagation();
        this.applyRaw({ from: b.from + from, to: b.from + to, insert }, { group: 'type', selBefore: this.currentSelection() });
        this.sel = { from: b.from + selFrom, to: b.from + selTo };
        const last = this.undoStack.at(-1); if (last) last.selAfter = { ...this.sel };
        this.paint(false); this.setCaret(selFrom, selTo); this.schedulePreview();
      };
      if (key === 'Backspace' && collapsed && before && PAIRS[before] === after && start > 0) return edit(start - 1, start + 1, '', start - 1);
      if (key.length !== 1) return;
      const inCode = ['fence', 'codeBlock', 'math', 'frontMatter'].includes(b.kind);
      if (collapsed && CLOSERS.has(key) && after === key && (PAIRS[before] !== undefined || key !== '"' && key !== "'" && key !== '`' || true)) {
        if (after === key && (before !== key || !PAIRS[key] || PAIRS[key] !== key || src[start - 2] !== key)) { e.preventDefault(); this.paint(false); this.setCaret(start + 1); this.sel = { from: b.from + start + 1, to: b.from + start + 1 }; return; }
      }
      const pair = PAIRS[key] ?? (!collapsed ? WRAP_ONLY[key] : undefined);
      if (!pair) return;
      if (!collapsed) { const selected = src.slice(start, end); if (selected.includes('\n') && !PAIRS[key]) return; return edit(start, end, key + selected + pair, start + 1, start + 1 + selected.length); }
      if (inCode && (key === '`' || key === "'" || key === '"') && b.kind === 'math') return;
      // Do not pair apostrophes inside words, or when the next character is a word character.
      if ((key === "'" || key === '"' || key === '`') && (/[\p{L}\p{N}]/u.test(before) || /[\p{L}\p{N}]/u.test(after))) return;
      if (after && /[\p{L}\p{N}]/u.test(after) && PAIRS[key] !== undefined) return;
      if (key === '`' && src.slice(0, start).match(/`/g)?.length % 2 === 1) return;
      return edit(start, end, key + pair, start + 1);
    },

    // ——— Emoji completion (":smi" → suggestions) ———
    updateEmojiPopup() {
      if (this.prefs.emoji === false || this.sourceMode || !this.active) return this.closeEmojiPopup();
      const caret = this.getCaret();
      if (!caret || caret.start !== caret.end) return this.closeEmojiPopup();
      const src = this.text.slice(this.active.block.from, this.active.block.from + caret.start);
      const m = /(?:^|[\s(（])(:[\w+-]{2,20})$/.exec(src);
      if (!m) return this.closeEmojiPopup();
      const list = searchEmoji(m[1].slice(1), 8);
      if (!list.length) return this.closeEmojiPopup();
      const range = getSelection().rangeCount ? getSelection().getRangeAt(0) : null;
      const rect = range?.getClientRects()[0] || this.active.el.getBoundingClientRect();
      let pop = this.emojiPopup;
      if (!pop) { pop = this.emojiPopup = document.createElement('div'); pop.className = 'mdEmojiPopup'; pop.setAttribute('role', 'listbox'); pop.setAttribute('aria-label', '表情建议'); pop.addEventListener('mousedown', e => e.preventDefault()); document.body.append(pop); }
      pop.replaceChildren(...list.map(([name, glyph], i) => { const item = document.createElement('button'); item.type = 'button'; item.tabIndex = -1; item.className = 'mdEmojiItem'; item.setAttribute('role', 'option'); item.setAttribute('aria-selected', String(i === 0)); item.dataset.name = name; item.innerHTML = `<span>${escapeHtml(glyph)}</span><code>:${escapeHtml(name)}:</code>`; item.onclick = () => this.acceptEmoji(name); return item; }));
      this.emojiState = { index: 0, trigger: m[1], list };
      pop.style.left = Math.max(8, Math.min(rect.left, innerWidth - 240)) + 'px'; pop.style.top = Math.min(rect.bottom + 6, innerHeight - 260) + 'px';
    },
    closeEmojiPopup() { this.emojiPopup?.remove(); this.emojiPopup = null; this.emojiState = null; },
    emojiKey(e) {
      const s = this.emojiState; if (!s) return false;
      const move = d => { s.index = (s.index + d + s.list.length) % s.list.length; [...this.emojiPopup.children].forEach((c, i) => c.setAttribute('aria-selected', String(i === s.index))); };
      if (e.key === 'ArrowDown') { e.preventDefault(); e.stopPropagation(); move(1); return true; }
      if (e.key === 'ArrowUp') { e.preventDefault(); e.stopPropagation(); move(-1); return true; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); e.stopPropagation(); this.acceptEmoji(s.list[s.index][0]); return true; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); this.closeEmojiPopup(); return true; }
      return false;
    },
    acceptEmoji(name) {
      const s = this.emojiState, a = this.active; if (!s || !a) return;
      const sel = this.currentSelection(), from = sel.from - s.trigger.length, insert = `:${name}: `;
      this.closeEmojiPopup();
      this.applyRaw({ from, to: sel.from, insert }, { group: 'type', selBefore: sel });
      this.sel = { from: from + insert.length, to: from + insert.length };
      this.paint(false); this.setCaret(this.sel.from - a.block.from); this.schedulePreview();
    },

    // ——— Images ———
    imageInfo(img) {
      const blockEl = img.closest('.mdBlock'), b = blockEl?.blockRef;
      if (!b) return null;
      const rendered = blockEl.querySelector(':scope > .mdRendered') || blockEl;
      const index = [...(img.closest('.mdLivePreview') ? blockEl.querySelectorAll('.mdLivePreview img') : rendered.querySelectorAll('img'))].indexOf(img);
      const src = this.text.slice(b.from, b.to), found = imageMatches(src)[index];
      return found ? { ...found, from: b.from + found.from, to: b.from + found.to } : null;
    },
    imageAt(pos) { const b = this.blocks[this.blockIndexAt(pos)]; if (!b) return null; const at = pos - b.from; const m = imageMatches(this.text.slice(b.from, b.to)).find(x => at >= x.from && at <= x.to); return m ? { ...m, from: b.from + m.from, to: b.from + m.to } : null; },
    setImage(info, replacement) { this.apply([{ from: info.from, to: info.to, insert: replacement }], { from: info.from + replacement.length, to: info.from + replacement.length }, { group: 'image', focus: false, activate: false }); },
    setImageWidth(info, width) {
      const next = width ? imageHtml(info, width) : (info.html && (info.width || info.alt || info.title) ? imageMarkdown(info) : imageMarkdown(info));
      this.setImage(info, next);
    },
    switchImageSyntax(info) { this.setImage(info, info.html ? imageMarkdown(info) : imageHtml(info, info.width)); },
    deleteImage(info) { this.apply([{ from: info.from, to: info.to, insert: '' }], { from: info.from, to: info.from }, { group: 'image', focus: false, activate: false }); },
  });
}
