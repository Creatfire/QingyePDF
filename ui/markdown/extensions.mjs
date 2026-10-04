// Typora-compatible Markdown extensions for markdown-it, written for Qingye:
//   ==highlight==   ~subscript~   ^superscript^   :emoji:   [^footnote]   [TOC]
//   GitHub-style alerts (> [!NOTE])   and a heading collector used by [TOC] and the outline.
// Block rendering in the editor is per top-level block, so cross-block data (footnote numbers,
// the heading list for [TOC]) travels in `env.doc`, produced once per document by analyze().
import { EMOJI } from './emoji.mjs';

const escape = value => String(value).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isSpace = code => code === 0x20 || code === 0x09 || code === 0x0a || code === 0x0d;

// A delimited inline span (marker … marker) whose content is parsed as inline Markdown.
function spanRule(md, name, marker, tag, { noSpace = false, rejectDouble = false } = {}) {
  const m = marker.length, first = marker.charCodeAt(0);
  md.inline.ruler.after('escape', name, (state, silent) => {
    const src = state.src, start = state.pos;
    if (src.charCodeAt(start) !== first || src.slice(start, start + m) !== marker) return false;
    if (rejectDouble && src.charCodeAt(start + 1) === first) return false;
    if (isSpace(src.charCodeAt(start + m)) || start + m >= state.posMax) return false;
    if (src.charCodeAt(start + m) === first && m === 1) return false;
    let end = start + m;
    for (;;) {
      end = src.indexOf(marker, end);
      if (end < 0 || end >= state.posMax) return false;
      let slashes = 0; for (let b = end - 1; src.charCodeAt(b) === 0x5c; b--) slashes++;
      if (slashes % 2 === 1) { end += m; continue; }
      if (noSpace && /\s/.test(src.slice(start + m, end))) return false;
      if (isSpace(src.charCodeAt(end - 1)) && !noSpace) { end += m; continue; }
      if (m === 1 && rejectDouble && src.charCodeAt(end + 1) === first) { end += 2; continue; }
      break;
    }
    if (end === start + m) return false;
    if (!silent) {
      const oldMax = state.posMax;
      state.pos = start + m; state.posMax = end;
      state.push(`${name}_open`, tag, 1).markup = marker;
      state.md.inline.tokenize(state);
      state.push(`${name}_close`, tag, -1).markup = marker;
      state.posMax = oldMax;
    }
    state.pos = end + m;
    return true;
  });
}

function emojiRule(md) {
  md.inline.ruler.after('escape', 'qy_emoji', (state, silent) => {
    const src = state.src, start = state.pos;
    if (src.charCodeAt(start) !== 0x3a) return false;
    const prev = src.charCodeAt(start - 1);
    if (start > 0 && /[\p{L}\p{N}]/u.test(String.fromCharCode(prev))) return false;
    const match = /^:([\w+-]+):/.exec(src.slice(start, start + 40));
    if (!match) return false;
    const glyph = EMOJI.get(match[1].toLowerCase());
    if (!glyph) return false;
    if (!silent) { const t = state.push('emoji', 'span', 0); t.content = glyph; t.markup = match[0]; }
    state.pos = start + match[0].length;
    return true;
  });
  md.renderer.rules.emoji = (tokens, i) => `<span class="mdEmoji" title="${escape(tokens[i].markup)}">${escape(tokens[i].content)}</span>`;
}

// ——— Footnotes ———
const FOOTNOTE_LABEL = /^\[\^([^\]\s]+)\]/;
function footnotes(md) {
  md.inline.ruler.before('link', 'qy_footnote_ref', (state, silent) => {
    const match = FOOTNOTE_LABEL.exec(state.src.slice(state.pos, state.posMax));
    if (!match) return false;
    if (state.src.charCodeAt(state.pos + match[0].length) === 0x3a && state.pos === 0) return false; // definition
    if (!silent) {
      const fn = (state.env.fn ||= { order: [], defs: {} });
      if (!fn.order.includes(match[1])) fn.order.push(match[1]);
      const t = state.push('footnote_ref', 'sup', 0); t.meta = { label: match[1] };
    }
    state.pos += match[0].length;
    return true;
  });
  md.block.ruler.before('reference', 'qy_footnote_def', (state, startLine, endLine, silent) => {
    const begin = state.bMarks[startLine] + state.tShift[startLine], max = state.eMarks[startLine];
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;
    const line = state.src.slice(begin, max), match = /^\[\^([^\]\s]+)\]:[ \t]?/.exec(line);
    if (!match) return false;
    if (silent) return true;
    let content = line.slice(match[0].length), next = startLine + 1;
    for (; next < endLine; next++) {
      const s = state.bMarks[next] + state.tShift[next], e = state.eMarks[next];
      if (s >= e) { // blank line: continue only when the following line is indented
        if (next + 1 < endLine && state.sCount[next + 1] >= 2 && state.tShift[next + 1] > 0 && state.bMarks[next + 1] + state.tShift[next + 1] < state.eMarks[next + 1]) { content += '\n'; continue; }
        break;
      }
      if (state.sCount[next] < 2) break;
      content += '\n' + state.src.slice(s, e);
    }
    const fn = (state.env.fn ||= { order: [], defs: {} });
    fn.defs[match[1]] = { line: startLine };
    const token = state.push('footnote_def', 'div', 0);
    token.block = true; token.meta = { label: match[1] }; token.map = [startLine, next]; token.content = content;
    token.children = [];
    state.md.inline.parse(content.trim(), state.md, state.env, token.children);
    state.line = next;
    return true;
  }, { alt: ['paragraph'] });
  const numberOf = (env, label) => { const order = env.fn?.order || []; const i = order.indexOf(label); return i >= 0 ? i + 1 : null; };
  md.renderer.rules.footnote_ref = (tokens, i, options, env) => {
    const label = tokens[i].meta.label, n = numberOf(env, label);
    return `<sup class="mdFootnoteRef"><a href="#fn-${escape(label)}" id="fnref-${escape(label)}" title="脚注 ${escape(label)}">${n ?? escape(label)}</a></sup>`;
  };
  md.renderer.rules.footnote_def = (tokens, i, options, env, self) => {
    const label = tokens[i].meta.label, n = numberOf(env, label);
    return `<div class="mdFootnoteDef" id="fn-${escape(label)}"><span class="mdFootnoteNum">${n ?? escape(label)}</span><span class="mdFootnoteBody">${self.renderInline(tokens[i].children, options, env)}</span> <a class="mdFootnoteBack" href="#fnref-${escape(label)}" title="返回正文">↩</a></div>\n`;
  };
}

// ——— [TOC] ———
function toc(md) {
  md.block.ruler.before('paragraph', 'qy_toc', (state, startLine, endLine, silent) => {
    if (state.sCount[startLine] - state.blkIndent >= 4) return false;
    const line = state.src.slice(state.bMarks[startLine] + state.tShift[startLine], state.eMarks[startLine]).trim();
    if (!/^\[(toc|TOC)\]$/.test(line)) return false;
    const after = startLine + 1;
    if (after < endLine && state.bMarks[after] + state.tShift[after] < state.eMarks[after] && state.sCount[after] >= state.blkIndent && false) return false;
    if (silent) return true;
    const token = state.push('toc', 'nav', 0); token.block = true; token.map = [startLine, startLine + 1];
    state.line = startLine + 1;
    return true;
  }, { alt: ['paragraph'] });
  md.renderer.rules.toc = (tokens, i, options, env) => {
    const list = env.doc?.headings || env.headingList || [];
    if (!list.length) return '<nav class="mdToc isEmpty"><span class="mdTocTitle">目录</span><p class="mdTocEmpty">（没有标题）</p></nav>\n';
    const min = Math.min(...list.map(h => h.level));
    return `<nav class="mdToc"><span class="mdTocTitle">目录</span><ul>${list.map(h => `<li class="mdTocItem" style="margin-left:${(h.level - min) * 1.2}em"><a href="#${escape(h.id)}">${escape(h.text)}</a></li>`).join('')}</ul></nav>\n`;
  };
}

// ——— GitHub-style alerts ———
export const ALERT_TYPES = { note: '注意', tip: '提示', important: '重要', warning: '警告', caution: '小心' };
function alerts(md) {
  md.core.ruler.after('inline', 'qy_alerts', state => {
    const t = state.tokens;
    for (let i = 0; i + 2 < t.length; i++) {
      if (t[i].type !== 'blockquote_open' || t[i + 1].type !== 'paragraph_open' || t[i + 2].type !== 'inline') continue;
      const inline = t[i + 2], match = /^\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\][ \t]*(?:\n|$)/i.exec(inline.content);
      if (!match) continue;
      const kind = match[1].toLowerCase();
      t[i].attrJoin('class', `mdAlert mdAlert-${kind}`);
      inline.content = inline.content.slice(match[0].length);
      const kids = inline.children || [];
      if (kids[0]?.type === 'text') { kids.shift(); if (kids[0]?.type === 'softbreak') kids.shift(); }
      if (!inline.content.trim()) { t[i + 1].hidden = true; t[i + 3].hidden = true; inline.children = []; }
    }
  });
}

// ——— Heading list (for [TOC]); ids are assigned in parser.mjs ———
export function collectHeadings(md, slug) {
  md.core.ruler.push('qy_heading_list', state => {
    const list = state.env.headingList = [];
    const used = new Map();
    for (let i = 0; i < state.tokens.length; i++) {
      const tk = state.tokens[i];
      if (tk.type !== 'heading_open') continue;
      const text = (state.tokens[i + 1].children || []).filter(c => ['text', 'code_inline', 'math_inline', 'emoji'].includes(c.type)).map(c => c.content).join('').trim();
      list.push({ level: Number(tk.tag.slice(1)), text: text || '（无标题）', id: slug(text), offset: tk.map?.[0] });
      used.set(slug(text), (used.get(slug(text)) || 0) + 1);
    }
  });
}

export function useExtensions(md, slug) {
  spanRule(md, 'qy_mark', '==', 'mark');
  spanRule(md, 'qy_sub', '~', 'sub', { noSpace: true, rejectDouble: true });
  spanRule(md, 'qy_sup', '^', 'sup', { noSpace: true, rejectDouble: true });
  emojiRule(md); footnotes(md); toc(md); alerts(md); collectHeadings(md, slug);
  // Renderer rules for the generic open/close tokens
  for (const name of ['qy_mark', 'qy_sub', 'qy_sup']) {
    md.renderer.rules[`${name}_open`] = (tokens, i) => `<${tokens[i].tag}>`;
    md.renderer.rules[`${name}_close`] = (tokens, i) => `</${tokens[i].tag}>`;
  }
}
