// Markdown parsing and rendering for Qingye's Markdown editor.
// markdown-it (CommonMark + GFM tables / strikethrough / autolinks) with Qingye's own plugins for
// task lists, TeX math and YAML front matter. The document is split into top-level blocks
// (list items individually) so each block can be rendered or edited on its own.
import { MarkdownIt, katex, hljs, DOMPurify } from '../../vendor/markdown/qingye-markdown-vendor.mjs';
import { LEGACY_LANGS } from './diagrams-legacy.mjs';
import { useExtensions } from './extensions.mjs';
export { DOMPurify };

const escapeHtml = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export { escapeHtml };

export function renderMath(tex, display) {
  try { return katex.renderToString(tex, { displayMode: display, throwOnError: false, strict: 'ignore', trust: false, output: 'htmlAndMathml', maxExpand: 1000, maxSize: 50 }); }
  catch (error) { return `<span class="mdMathError" title="${escapeHtml(error.message)}">${escapeHtml(tex)}</span>`; }
}

// ——— Plugins ———
function mathPlugin(md) {
  md.inline.ruler.after('escape', 'math_inline', (state, silent) => {
    const src = state.src, start = state.pos;
    if (src.charCodeAt(start) !== 0x24) return false;
    if (src.charCodeAt(start + 1) === 0x24) {
      const end = src.indexOf('$$', start + 2);
      if (end < 0 || end === start + 2) return false;
      if (!silent) { const t = state.push('math_inline', 'math', 0); t.content = src.slice(start + 2, end); t.markup = '$$'; }
      state.pos = end + 2; return true;
    }
    const next = src.charCodeAt(start + 1);
    if (Number.isNaN(next) || next === 0x20 || next === 0x09 || next === 0x0a) return false;
    let pos = start + 1;
    for (;;) {
      pos = src.indexOf('$', pos);
      if (pos < 0) return false;
      let slashes = 0; for (let b = pos - 1; src.charCodeAt(b) === 0x5c; b--) slashes++;
      const prev = src.charCodeAt(pos - 1), after = src.charCodeAt(pos + 1);
      if (slashes % 2 === 1 || prev === 0x20 || prev === 0x09 || prev === 0x0a || (after >= 0x30 && after <= 0x39)) { pos++; continue; }
      break;
    }
    if (!silent) { const t = state.push('math_inline', 'math', 0); t.content = src.slice(start + 1, pos); t.markup = '$'; }
    state.pos = pos + 1; return true;
  });
  md.block.ruler.before('fence', 'math_block', (state, startLine, endLine, silent) => {
    const begin = state.bMarks[startLine] + state.tShift[startLine], max = state.eMarks[startLine];
    if (state.sCount[startLine] - state.blkIndent >= 4 || state.src.slice(begin, begin + 2) !== '$$') return false;
    const first = state.src.slice(begin + 2, max);
    let next = startLine, content = '', closed = false;
    if (first.trim().length > 2 && first.trim().endsWith('$$')) { content = first.trim().slice(0, -2); closed = true; }
    else {
      if (first.trim()) content = first + '\n';
      for (next = startLine + 1; next < endLine; next++) {
        const p = state.bMarks[next] + state.tShift[next], m = state.eMarks[next];
        if (p < m && state.sCount[next] < state.blkIndent) break;
        const line = state.src.slice(p, m);
        if (line.trimEnd().endsWith('$$')) { content += line.trimEnd().slice(0, -2); closed = true; break; }
        content += state.getLines(next, next + 1, state.blkIndent, true);
      }
    }
    if (silent) return true;
    state.line = closed ? next + 1 : next;
    const token = state.push('math_block', 'math', 0);
    token.block = true; token.content = content.trim(); token.markup = '$$'; token.map = [startLine, state.line];
    return true;
  }, { alt: ['paragraph', 'reference', 'blockquote', 'list'] });
  md.renderer.rules.math_inline = (tokens, i) => `<span class="mdMath" data-display="${tokens[i].markup === '$$'}">${renderMath(tokens[i].content, tokens[i].markup === '$$')}</span>`;
  md.renderer.rules.math_block = (tokens, i) => `<div class="mdMathBlock">${renderMath(tokens[i].content, true)}</div>\n`;
}

function taskPlugin(md) {
  md.core.ruler.after('inline', 'task_lists', state => {
    const tokens = state.tokens; let index = state.env.taskIndex || 0;
    for (let i = 2; i < tokens.length; i++) {
      const inline = tokens[i];
      if (inline.type !== 'inline' || tokens[i - 1].type !== 'paragraph_open' || tokens[i - 2].type !== 'list_item_open') continue;
      const match = /^\[([ xX])\](?=\s|$)/.exec(inline.content);
      if (!match) continue;
      const checked = match[1] !== ' ';
      tokens[i - 2].attrJoin('class', 'task-list-item');
      for (let j = i - 3; j >= 0; j--) if (/_list_open$/.test(tokens[j].type) && tokens[j].level === tokens[i - 2].level - 1) { tokens[j].attrJoin('class', 'contains-task-list'); break; }
      const first = inline.children[0];
      if (first?.type === 'text') first.content = first.content.slice(3).replace(/^\s/, '');
      const box = new state.Token('html_inline', '', 0);
      box.content = `<input type="checkbox" class="mdTask" data-task="${index++}"${checked ? ' checked' : ''} aria-label="${checked ? '已完成' : '未完成'}的任务">`;
      inline.children.unshift(box);
    }
    state.env.taskIndex = index;
  });
}

function frontMatterPlugin(md) {
  md.block.ruler.before('hr', 'front_matter', (state, startLine, endLine, silent) => {
    if (startLine !== 0 || state.blkIndent !== 0) return false;
    const line = n => state.src.slice(state.bMarks[n] + state.tShift[n], state.eMarks[n]);
    if (line(0).trimEnd() !== '---') return false;
    let next = 1;
    while (next < endLine && !/^(---|\.\.\.)\s*$/.test(line(next))) next++;
    if (next >= endLine) return false;
    if (silent) return true;
    const token = state.push('front_matter', '', 0);
    token.block = true; token.content = state.getLines(1, next, 0, true); token.map = [0, next + 1];
    state.line = next + 1; return true;
  }, { alt: [] });
  md.renderer.rules.front_matter = (tokens, i) => `<div class="mdFrontMatter"><span class="mdFrontLabel">YAML 元数据</span><pre>${escapeHtml(tokens[i].content)}</pre></div>\n`;
}

export function slug(text) {
  return String(text).trim().toLowerCase().replace(/[\s]+/g, '-').replace(/[^\p{L}\p{N}\-_]/gu, '').replace(/-+/g, '-') || 'section';
}
function headingPlugin(md) {
  md.core.ruler.push('heading_ids', state => {
    const tokens = state.tokens;
    for (let i = 0; i < tokens.length; i++) if (tokens[i].type === 'heading_open') {
      const text = (tokens[i + 1].children || []).filter(c => ['text', 'code_inline', 'math_inline'].includes(c.type)).map(c => c.content).join('');
      tokens[i].attrSet('id', slug(text));
    }
  });
}

// ——— Configured instance ———
export const md = new MarkdownIt({
  html: true, linkify: true, typographer: false, breaks: false,
  highlight: (code, info) => {
    const name = (info || '').trim().split(/\s+/)[0].toLowerCase();
    if (name && hljs.getLanguage(name)) { try { return hljs.highlight(code, { language: name, ignoreIllegals: true }).value; } catch {} }
    return escapeHtml(code);
  },
});
md.use(mathPlugin).use(taskPlugin).use(frontMatterPlugin).use(headingPlugin);
useExtensions(md, slug);
md.validateLink = url => !/^(javascript|vbscript|file:.*\.(exe|bat|cmd|com|scr|ps1|vbs|js|msi))/i.test(url.trim());
md.renderer.rules.fence = (tokens, i, options) => {
  const token = tokens[i], lang = (token.info || '').trim().split(/\s+/)[0];
  // Diagrams: the source travels as text and is drawn by diagrams.mjs after sanitizing.
  const legacy = LEGACY_LANGS[lang.toLowerCase()];
  if (lang.toLowerCase() === 'mermaid' || legacy) return `<div class="mdMermaid"${legacy ? ` data-kind="${legacy}"` : ''}><div class="mdCodeHead"><span class="mdCodeLang">${escapeHtml(legacy ? lang.toLowerCase() : 'mermaid')}</span></div><pre class="mdMermaidSource"><code>${escapeHtml(token.content)}</code></pre><div class="mdMermaidView"></div></div>\n`;
  const code = options.highlight(token.content, lang);
  const known = lang && hljs.getLanguage(lang.toLowerCase());
  return `<div class="mdCodeBlock"><div class="mdCodeHead"><span class="mdCodeLang">${escapeHtml(lang || '纯文本')}</span></div><pre><code class="hljs${known ? ' language-' + escapeHtml(lang.toLowerCase()) : ''}">${code}</code></pre></div>\n`;
};
const defaultLinkOpen = md.renderer.rules.link_open || ((tokens, i, options, env, self) => self.renderToken(tokens, i, options));
md.renderer.rules.link_open = (tokens, i, options, env, self) => {
  const href = tokens[i].attrGet('href') || '';
  // Keep local document links through sanitization without permitting file URLs on images/scripts.
  if(/^file:\/\//i.test(href)&&/\.(?:pdf|md|markdown)(?:[?#]|$)/i.test(href))tokens[i].attrSet('href','#qingye-document-'+encodeURIComponent(href));
  tokens[i].attrSet('title', (tokens[i].attrGet('title') ? tokens[i].attrGet('title') + '\n' : '') + href + '\nCtrl + 单击打开');
  return defaultLinkOpen(tokens, i, options, env, self);
};

// ——— Block analysis ———
const kindOf = type => ({ paragraph_open: 'paragraph', heading_open: 'heading', blockquote_open: 'blockquote', fence: 'fence', code_block: 'codeBlock', hr: 'hr', html_block: 'html', table_open: 'table', math_block: 'math', front_matter: 'frontMatter', footnote_def: 'footnoteDef', toc: 'toc' }[type]);

export function lineStarts(text) {
  const starts = [0];
  for (let i = text.indexOf('\n'); i >= 0; i = text.indexOf('\n', i + 1)) starts.push(i + 1);
  return starts;
}

// Returns top-level blocks as character ranges plus document-wide data (headings, references).
export function analyze(text) {
  const env = {}, tokens = md.parse(text, env), starts = lineStarts(text);
  const lineEnd = line => (line + 1 < starts.length ? starts[line + 1] - 1 : text.length);
  const blocks = [], headings = [];
  const push = (startLine, endLine, props) => {
    let last = Math.min(endLine, starts.length) - 1;
    while (last > startLine && !text.slice(starts[last], lineEnd(last)).trim()) last--;
    blocks.push({ from: starts[startLine], to: lineEnd(last), ...props });
  };
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    if (t.level !== 0 || t.nesting === -1 || !t.map) continue;
    if (t.type === 'bullet_list_open' || t.type === 'ordered_list_open') {
      const ordered = t.type === 'ordered_list_open', close = ordered ? 'ordered_list_close' : 'bullet_list_close';
      let number = ordered ? Number(t.attrGet('start') || 1) : 0, loose = false;
      const items = [];
      for (i++; i < tokens.length && !(tokens[i].type === close && tokens[i].level === 0); i++) {
        if (tokens[i].type === 'list_item_open' && tokens[i].level === 1) items.push(tokens[i]);
        if (tokens[i].type === 'paragraph_open' && tokens[i].level === 2 && !tokens[i].hidden) loose = true;
      }
      for (const item of items) push(item.map[0], item.map[1], { kind: 'listItem', ordered, number: ordered ? number++ : 0, loose, task: false });
      continue;
    }
    const kind = kindOf(t.type);
    if (!kind) continue;
    const props = { kind };
    if (kind === 'heading') {
      props.level = Number(t.tag.slice(1));
      const inline = tokens[i + 1];
      const title = (inline.children || []).filter(c => ['text', 'code_inline', 'math_inline'].includes(c.type)).map(c => c.content).join('').trim();
      headings.push({ level: props.level, text: title || '（无标题）', offset: starts[t.map[0]], id: t.attrGet('id') });
    }
    push(t.map[0], t.map[1], props);
  }
  // Lines that produce no tokens (link reference definitions, stray lines) remain editable.
  const covered = new Uint8Array(starts.length);
  for (const b of blocks) for (let l = lineIndex(starts, b.from); l <= lineIndex(starts, b.to); l++) covered[l] = 1;
  for (let l = 0; l < starts.length; l++) {
    if (covered[l] || !text.slice(starts[l], lineEnd(l)).trim()) continue;
    let end = l; while (end + 1 < starts.length && !covered[end + 1] && text.slice(starts[end + 1], lineEnd(end + 1)).trim()) end++;
    blocks.push({ from: starts[l], to: lineEnd(end), kind: 'raw' }); l = end;
  }
  blocks.sort((a, b) => a.from - b.from);
  for (const b of blocks) if (b.kind === 'listItem') b.task = /^\s*(?:[-*+]|\d+[.)])\s+\[[ xX]\](?=\s|$)/.test(text.slice(b.from, b.to));
  // Cross-block document data: footnote numbering and the heading list used by [TOC].
  const fn = { order: env.fn?.order || [], defs: Object.fromEntries(Object.entries(env.fn?.defs || {}).map(([k, v]) => [k, { offset: starts[v.line] }])) };
  const info = { fn, headings: (env.headingList || []).map(h => ({ ...h, offset: starts[h.offset] ?? 0 })) };
  return { blocks, headings, references: env.references || {}, info };
}
export function lineIndex(starts, offset) {
  let lo = 0, hi = starts.length - 1;
  while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (starts[mid] <= offset) lo = mid; else hi = mid - 1; }
  return lo;
}

const purifyConfig = { ADD_TAGS: ['semantics', 'annotation'], ADD_ATTR: ['target', 'data-kind', 'data-task', 'data-display', 'aria-label', 'id', 'encoding'], FORBID_TAGS: ['style', 'form', 'button', 'textarea', 'select', 'iframe', 'object', 'embed', 'link', 'meta', 'base'], FORBID_ATTR: ['srcset', 'formaction', 'autofocus'], ALLOW_DATA_ATTR: false };
// The code block "copy" button is added after sanitizing (buttons are never accepted from Markdown).
export function sanitize(html) {
  const clean = DOMPurify.sanitize(html, { ...purifyConfig, RETURN_DOM_FRAGMENT: true });
  for(const anchor of clean.querySelectorAll('a[href^="#qingye-document-"]')){
    try{const href=decodeURIComponent(anchor.getAttribute('href').slice('#qingye-document-'.length));if(/^file:\/\//i.test(href)&&/\.(?:pdf|md|markdown)(?:[?#]|$)/i.test(href)&&!/[\x00-\x1f]/.test(href))anchor.setAttribute('href',href);}catch{}
  }
  for (const head of clean.querySelectorAll('.mdMermaid > .mdCodeHead')) if (!head.querySelector('.mdZoom')) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'mdZoom'; b.tabIndex = -1; b.dataset.icon = 'fullscreen'; b.textContent = '原始大小'; b.hidden = true; head.append(b);
  }
  for (const head of clean.querySelectorAll('.mdCodeHead')) if (!head.querySelector('.mdCopy')) {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'mdCopy'; b.tabIndex = -1; b.dataset.icon = 'copy'; b.textContent = '复制'; head.append(b);
  }
  return clean;
}
export function renderBlockHtml(source, block, references, info) {
  return md.render(source, { references: { ...references }, taskIndex: 0, ...(info ? { doc: info, fn: { order: [...info.fn.order], defs: { ...info.fn.defs } } } : {}) });
}
// Rendering options that users can change (Typora's "smart punctuation", "preserve single line break").
export const renderOptions = { smartPunctuation: false, preserveBreaks: false, epoch: 0 };
export function setRenderOptions(next = {}) {
  const smart = !!next.smartPunctuation, breaks = !!next.preserveBreaks;
  if (smart === renderOptions.smartPunctuation && breaks === renderOptions.preserveBreaks) return false;
  Object.assign(renderOptions, { smartPunctuation: smart, preserveBreaks: breaks, epoch: renderOptions.epoch + 1 });
  md.set({ typographer: smart, breaks, quotes: '“”‘’' });
  return true;
}
export function renderDocumentHtml(text) { return md.render(text, { taskIndex: 0 }); }
export { hljs };
