// Document tools for AI (0.9.1). One implementation serves the in-app assistant (function calling)
// and the local OpenAPI interface (ai-api-server.cjs → bridge). Definitions live in ui/ai/tools.json.
import { t, tf } from '../i18n/i18n.mjs';
import { documentReferences } from './references.mjs';
import { prepareMarkdownChange } from './diff.mjs';

const MAX_RESULT = 60000;
// Arguments come from models and external programs: coerce numbers, fall back when missing or invalid.
const num = (v, fallback) => { const n = Math.floor(Number(v)); return v == null || v === '' || !Number.isFinite(n) ? fallback : n; };
const clip = (text, max) => (text.length > max ? { text: text.slice(0, max), truncated: true } : { text, truncated: false });

/** Finds `quote` in the text items of one PDF page and returns the rectangle around it as
 *  fractions of the displayed page ([x0, y0, x1, y1], origin top-left), or null when absent.
 *  Whitespace is ignored when matching, because PDF text is split into arbitrary runs. */
export function quoteRect(items, viewport, quote) {
  const squash = text => text.replace(/\s+/g, '').toLowerCase(), needle = squash(String(quote));
  if (!needle) return null;
  let all = ''; const owners = [];
  items.forEach((item, index) => { const text = squash(item.str || ''); for (let i = 0; i < text.length; i++) owners.push([index, i, text.length]); all += text; });
  const at = all.indexOf(needle); if (at < 0) return null;
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  const used = new Map();
  for (let i = at; i < at + needle.length; i++) { const [index, offset, length] = owners[i], range = used.get(index) || [offset, offset, length]; range[0] = Math.min(range[0], offset); range[1] = Math.max(range[1], offset); used.set(index, range); }
  for (const [index, [first, last, length]] of used) {
    const item = items[index], [a, b, c, d, e, f] = item.transform, width = item.width || 0, height = item.height || Math.hypot(c, d) || 10;
    // The run's own axes: along the baseline and upwards. Part of a run is taken by character share.
    const along = Math.hypot(a, b) || 1, ux = a / along, uy = b / along, vx = -uy, vy = ux, from = width * first / length, to = width * (last + 1) / length;
    for (const [s, h] of [[from, -height * .22], [to, -height * .22], [from, height * .88], [to, height * .88]]) {
      const [px, py] = viewport.convertToViewportPoint(e + ux * s + vx * h, f + uy * s + vy * h);
      x0 = Math.min(x0, px); x1 = Math.max(x1, px); y0 = Math.min(y0, py); y1 = Math.max(y1, py);
    }
  }
  const clamp = v => Math.max(0, Math.min(1, v));
  const rect = [clamp(x0 / viewport.width), clamp(y0 / viewport.height), clamp(x1 / viewport.width), clamp(y1 / viewport.height)];
  return rect[2] - rect[0] < .002 || rect[3] - rect[1] < .002 ? null : rect.map(v => Math.round(v * 1e5) / 1e5);
}

export function createDocTools({ sessions, current, activate, markdown, addDocuments, api, confirm, views,navigate, applyEdit, notes }) {
  const isMd = s => s?.kind === 'markdown';
  let ask = confirm || (async () => false);
  const pageCache = new WeakMap();
  const referenceOutline = new WeakMap();
  function docs() { return [...sessions.values()].filter(s => s.loaded); }
  function resolve(id, restoredPath = null) {
    let s = id ? sessions.get(id) : current();
    // Only the start of a regenerated turn may resolve a saved target by its already-open path.
    // In-flight tools call resolve(id) without a fallback, so closing the source still rejects them.
    if (!s?.loaded && restoredPath) s = docs().find(doc => doc.path === restoredPath);
    if (!s?.loaded) throw Object.assign(new Error(id ? '找不到该文档或文档尚未加载：' + id : '当前没有打开的文档。'), { status: 404 });
    return s;
  }
  // Notes mode: which side of the split a document is on ('left' / 'right'), if any.
  const paneOf = s => { const index = notes?.ids?.()?.indexOf(s.id) ?? -1; return index < 0 ? null : index ? 'right' : 'left'; };
  const info = s => ({ id: s.id, name: s.name, kind: isMd(s) ? 'markdown' : 'pdf', path: s.path || null, ...(paneOf(s) ? { pane: paneOf(s) } : {}), ...(isMd(s) ? { characters: s.editor.text.length, view: s.editor.sourceMode ? 'source' : s.readonly ? 'read' : 'edit' } : { pages: s.app.pagesCount, current_page: s.app.pdfViewer.currentPageNumber }), unsaved_changes: !!s.dirty });
  async function pageText(s, n) {
    let cache = pageCache.get(s.app.pdfDocument); if (!cache) pageCache.set(s.app.pdfDocument, cache = new Map());
    if (!cache.has(n)) {
      const content = await (await s.app.pdfDocument.getPage(n)).getTextContent();
      let out = ''; for (const item of content.items) { out += item.str || ''; if (item.hasEOL) out += '\n'; else if (item.str && !/\s$/.test(item.str)) out += ''; }
      cache.set(n, out.replace(/[ \t]+\n/g, '\n').trim());
    }
    return cache.get(n);
  }
  function mdLineOf(text, pos) { return text.slice(0, pos).split('\n').length; }
  async function focusDocument(s) {
    activate(s.id);
    if (!isMd(s) && s.view?.reflow && views) await views.change('reflow', false, s);
    // Activating a tab and opening the AI dock resizes PDF.js on the next frame. Navigate after that.
    if (typeof requestAnimationFrame === 'function') await new Promise(resolve => {
      // Hidden/minimized Electron windows may stop painting; external AI navigation must still finish.
      const timer = setTimeout(resolve, 100);
      requestAnimationFrame(() => requestAnimationFrame(() => { clearTimeout(timer); resolve(); }));
    });
  }

  const tools = {
    async list_documents() {
      const all = docs();
      const side = notes?.ids?.() || null;
      return { active_document_id: current()?.loaded ? current().id : null, ...(side ? { notes_mode: { left_document_id: side[0], right_document_id: side[1] } } : {}), documents: all.map(info) };
    },
    async read_document(a) {
      const s = resolve(a.document_id), max = Math.max(200, Math.min(MAX_RESULT, num(a.max_chars, 12000)));
      if (isMd(s)) {
        const text = s.editor.text, from = Math.max(0, Math.min(text.length, num(a.start_char, 0))), to = Math.max(from, Math.min(text.length, num(a.end_char, text.length)));
        const c = clip(text.slice(from, to), max);
        return { document: info(s), start_char: from, start_line: mdLineOf(text, from), end_char: from + c.text.length, text: c.text, truncated: c.truncated || from + c.text.length < text.length };
      }
      const total = s.app.pagesCount, start = Math.max(1, Math.min(total, num(a.start_page, 1))), end = Math.max(start, Math.min(total, num(a.end_page, Math.min(total, start + 9)), start + 49));
      const pages = []; let used = 0, truncated = false;
      for (let n = start; n <= end; n++) {
        const text = await pageText(s, n);
        if (used + text.length > max) { pages.push({ page: n, text: text.slice(0, Math.max(0, max - used)) }); truncated = true; break; }
        pages.push({ page: n, text }); used += text.length;
      }
      const empty = pages.every(p => !p.text.trim());
      return { document: info(s), pages, truncated: truncated || end < total, ...(empty ? { note: 'These pages have no text layer (scanned). Ask the user to run text recognition (OCR) first.' } : {}) };
    },
    async get_selection(a) {
      const s = resolve(a.document_id);
      if (isMd(s)) {
        const sel = s.editor.currentSelection(), text = s.editor.text.slice(sel.from, sel.to);
        return { document: info(s), selection: clip(text, MAX_RESULT).text, cursor_line: mdLineOf(s.editor.text, sel.from), start_char: sel.from };
      }
      const text = s.frame.contentWindow.getSelection()?.toString() || '';
      return { document: info(s), selection: clip(text, MAX_RESULT).text, page: s.app.pdfViewer.currentPageNumber };
    },
    async get_outline(a) {
      const s = resolve(a.document_id);
      if (isMd(s)) return { document: info(s), headings: (s.headings || []).map(h => ({ level: h.level, title: h.text, line: mdLineOf(s.editor.text, h.offset) })) };
      const doc = s.app.pdfDocument, outline = (await doc.getOutline()) || [], items = [];
      const walk = async (nodes, level) => {
        for (const node of nodes) {
          if (items.length >= 500) return;
          let page = null;
          try { const dest = typeof node.dest === 'string' ? await doc.getDestination(node.dest) : node.dest; if (dest?.[0]) page = (await doc.getPageIndex(dest[0])) + 1; } catch {}
          items.push({ level, title: node.title, page });
          if (node.items?.length) await walk(node.items, level + 1);
        }
      };
      await walk(outline, 1);
      return { document: info(s), outline: items, ...(items.length ? {} : { note: 'The PDF has no built-in outline.' }) };
    },
    async search_document(a) {
      const s = resolve(a.document_id), q = String(a.query || '').trim().toLowerCase(), limit = Math.max(1, Math.min(100, num(a.max_results, 20)));
      if (!q) throw Object.assign(new Error('query 不能为空。'), { status: 400 });
      const hits = [];
      const scan = (text, where) => { const low = text.toLowerCase(); let i = low.indexOf(q); while (i >= 0 && hits.length < limit) { hits.push({ ...where(i), context: text.slice(Math.max(0, i - 60), i + q.length + 60).replace(/\s+/g, ' ') }); i = low.indexOf(q, i + q.length); } };
      if (isMd(s)) scan(s.editor.text, i => ({ line: mdLineOf(s.editor.text, i), offset: i }));
      else for (let n = 1; n <= s.app.pagesCount && hits.length < limit; n++) scan(await pageText(s, n), () => ({ page: n }));
      return { document: info(s), query: a.query, matches: hits, complete: hits.length < limit };
    },
    async go_to(a) {
      const s = resolve(a.document_id); await focusDocument(s);
      if (isMd(s)) {
        const heading = String(a.heading ?? ''), h = (s.headings || []).find(x => x.text === heading) || (heading ? (s.headings || []).find(x => x.text.includes(heading)) : null);
        if (!h) throw Object.assign(new Error('找不到标题：' + (a.heading || '')), { status: 404 });
        s.editor.scrollToOffset(h.offset); return { ok: true, heading: h.text };
      }
      const page = Math.max(1, Math.min(s.app.pagesCount, num(a.page, 1))); s.app.pdfViewer.currentPageNumber = page; return { ok: true, page };
    },
    async insert_markdown(a, meta) {
      const s = resolve(a.document_id);
      if (!isMd(s)) throw Object.assign(new Error('只能写入 Markdown 文档；PDF 请使用批注或页面编辑。'), { status: 400 });
      const text = String(a.text ?? ''), position = ['cursor', 'end', 'replace_selection'].includes(a.position) ? a.position : 'cursor';
      if (!text) throw Object.assign(new Error('text 不能为空。'), { status: 400 });
      const ed = s.editor, original = ed.text, change = prepareMarkdownChange(original, ed.currentSelection(), text, position);
      if (meta.confirm && !await ask({ title: '允许 AI 修改文档？', doc: s.name, action: ({ cursor: '在光标处插入', end: '追加到文末', replace_selection: '替换选中内容' })[position], preview: text, before: original.slice(change.from,change.to), after: change.insert, source: meta.source })) throw Object.assign(new Error('用户拒绝了这次修改。'), { declined: true });
      if (sessions.get(s.id) !== s || !s.loaded || ed.text !== original) throw new Error('原文已变化或关闭，请重新发起修改。');
      if (s.readonly || s.editor.sourceMode) markdown.setViewMode(s, 'live');
      const { from, to, insert } = change;
      ed.apply([{ from, to, insert }], { from: from + insert.length, to: from + insert.length }, { group: 'ai', activate: false });
      activate(s.id);
      return { ok: true, inserted_characters: insert.length, replaced_characters: to - from, undo: 'Ctrl+Z', saved: false };
    },
    // Highlights (or underlines / strikes out) a quoted passage of a PDF page and can attach a comment.
    // It is applied as one undoable document edit, exactly like the page tools; nothing is saved.
    async annotate_pdf(a, meta) {
      const s = resolve(a.document_id);
      if (isMd(s)) throw Object.assign(new Error('只能批注 PDF 文档；Markdown 请使用 insert_markdown。'), { status: 400 });
      if (typeof applyEdit !== 'function') throw Object.assign(new Error('当前环境不支持 AI 批注 PDF。'), { status: 400 });
      const page = num(a.page, 0), quote = String(a.quote ?? '').trim(), comment = String(a.comment ?? '').slice(0, 2000);
      const kind = ['highlight', 'underline', 'strikeout'].includes(a.kind) ? a.kind : 'highlight';
      if (page < 1 || page > s.app.pagesCount) throw Object.assign(new Error('页码超出范围。'), { status: 400 });
      if (quote.length < 2) throw Object.assign(new Error('quote 需要是该页上的一段原文。'), { status: 400 });
      const pdfPage = await s.app.pdfDocument.getPage(page), content = await pdfPage.getTextContent();
      const rect = quoteRect(content.items, pdfPage.getViewport({ scale: 1 }), quote);
      if (!rect) throw Object.assign(new Error('在第 ' + page + ' 页找不到这段原文，请先用 read_document 核对文字。'), { status: 404 });
      const label = ({ highlight: '高亮', underline: '下划线', strikeout: '删除线' })[kind];
      if (meta.confirm && !await ask({ title: '允许 AI 批注 PDF？', doc: s.name, action: tf('第 {page} 页 · {label}', { page, label: t(label) }), preview: quote + (comment ? '\n\n' + t('评论：') + comment : ''), source: meta.source })) throw Object.assign(new Error('用户拒绝了这次批注。'), { declined: true });
      if (sessions.get(s.id) !== s || !s.loaded) throw new Error('文档已关闭，请重新发起批注。');
      const color = /^#[0-9a-fA-F]{6}$/.test(a.color || '') ? a.color : kind === 'highlight' ? '#f5c518' : '#d9482b';
      const result = await applyEdit(s, { action: 'annotation', pages: String(page), rect, annotation: kind, color, text: comment }, tf('AI 批注 · 第 {page} 页', { page }));
      if (result?.canceled) throw new Error('批注没有应用。');
      pageCache.delete(s.app.pdfDocument);
      return { ok: true, document: info(s), page, kind, quote, undo: 'Ctrl+Z', saved: false };
    },
    async create_markdown(a, meta) {
      let content = String(a.content ?? ''); const title = String(a.title || '').trim();
      if (title && !/^\s*#\s/.test(content)) content = `# ${title}\n\n${content}`;
      if (meta.confirm && meta.source === 'api' && !await ask({ title: '允许外部程序新建文档？', doc: title || t('无标题'), action: '新建 Markdown 标签', preview: content, source: meta.source })) throw Object.assign(new Error('用户拒绝了这次操作。'), { declined: true });
      const created = await api.newMarkdown(); await addDocuments(created);
      const s = sessions.get(created[0].id); s?.editor?.replaceAll(content);
      return { ok: true, document: s ? info(s) : null, saved: false };
    },
  };

  // meta: { source: 'panel' | 'api', allowEdits, confirmEdits }
  async function run(name, args = {}, meta = {}) {
    const fn = tools[name]; if (!fn) throw Object.assign(new Error('未知工具：' + name), { status: 404 });
    args = args && typeof args === 'object' ? args : {};
    if (!args.document_id && Object.hasOwn(meta, 'defaultDocumentId') && !['list_documents', 'create_markdown'].includes(name)) {
      if (!meta.defaultDocumentId) throw Object.assign(new Error('本轮没有可用的目标文档，请打开文档后重新提问。'), { status: 404 });
      args = { ...args, document_id: meta.defaultDocumentId };
    }
    const mutating = name === 'insert_markdown' || name === 'create_markdown' || name === 'annotate_pdf';
    const confirmNeeded = mutating && (meta.source === 'api' ? !meta.allowEdits : meta.confirmEdits !== false);
    const perform=()=>fn(args,{...meta,confirm:confirmNeeded});
    const result = await (name==='go_to'&&navigate?navigate(perform):perform());
    const references = documentReferences(name, result);
    return references.length ? { ...result, references } : result;
  }
  async function followReference(ref) {return navigate?navigate(()=>followReferenceInner(ref)):followReferenceInner(ref);}
  async function followReferenceInner(ref) {
    let s = sessions.get(ref.documentId);
    if ((!s?.loaded || (ref.path && s.path !== ref.path)) && ref.path) s = docs().find(doc => doc.path === ref.path);
    if (!s?.loaded || (isMd(s) ? 'markdown' : 'pdf') !== ref.kind) throw new Error('引用文档已关闭，请重新打开原文。');
    await focusDocument(s);
    let target;
    if (isMd(s)) {
      const lines = s.editor.text.split('\n');
      if (!Number.isInteger(ref.line) || ref.line < 1 || ref.line > lines.length) throw new Error('引用位置已变化，请重新读取文档。');
      let offset = lines.slice(0, ref.line - 1).reduce((n, line) => n + line.length + 1, 0);
      if (Number.isInteger(ref.offset)) offset = ref.offset;
      if (ref.quote && !s.editor.text.slice(offset).toLowerCase().startsWith(ref.quote.toLowerCase()) && !lines[ref.line - 1].toLowerCase().includes(ref.quote.toLowerCase())) throw new Error('引用位置已变化，请重新读取文档。');
      s.editor.scrollToOffset(offset); target = s.editor.elementAt?.(offset) || s.editor.sourceView;
    } else {
      if (!Number.isInteger(ref.page) || ref.page < 1 || ref.page > s.app.pagesCount) throw new Error('引用位置已变化，请重新读取文档。');
      const normalized = text => text.replace(/\s+/g, '').toLowerCase();
      if (ref.quote && ref.sourceTool !== 'get_outline' && !normalized(await pageText(s, ref.page)).includes(normalized(ref.quote))) throw new Error('引用位置已变化，请重新读取文档。');
      s.app.pdfViewer.currentPageNumber = ref.page;
      s.app.pdfViewer.scrollPageIntoView?.({ pageNumber: ref.page }); target = s.app.pdfViewer.getPageView?.(ref.page - 1)?.div;
    }
    if (target?.style) {
      if (!referenceOutline.has(target)) referenceOutline.set(target, target.style.outline);
      const stamp = String(performance.now()); target.dataset.aiReference = stamp; target.style.outline = '2px solid #249d75';
      setTimeout(() => { if (target.dataset.aiReference === stamp) { target.style.outline = referenceOutline.get(target); referenceOutline.delete(target); delete target.dataset.aiReference; } }, 2200);
    }
    return { name: s.name, page: ref.page, line: ref.line };
  }
  // Short human description of a tool call for the chat transcript.
  function describe(name, a = {}) {
    const doc = a.document_id && sessions.get(a.document_id)?.name;
    const where = doc ? `「${doc}」` : '';
    switch (name) {
      case 'list_documents': return t('查看打开的文档');
      case 'read_document': return a.start_page ? tf('读取{where}第 {from}–{to} 页', { where, from: a.start_page, to: a.end_page || a.start_page }) : tf('读取文档{where}', { where });
      case 'get_selection': return t('读取选中内容');
      case 'get_outline': return t('读取目录');
      case 'search_document': return tf('搜索“{query}”', { query: a.query || '' });
      case 'go_to': return a.page ? tf('跳转到第 {page} 页', { page: a.page }) : tf('跳转到“{heading}”', { heading: a.heading || '' });
      case 'insert_markdown': return t('写入 Markdown');
      case 'annotate_pdf': return tf('批注{where}第 {page} 页', { where, page: a.page || '' });
      case 'create_markdown': return t('新建 Markdown 文档');
      default: return name;
    }
  }
  return { run, describe, info, resolve, pageText, isMd, followReference, setConfirm: fn => { ask = fn; } };
}
