// Live styling for the block being edited: Markdown syntax stays visible but dimmed, while
// the content is already formatted (heading sizes, bold, links, code, math…), Typora-style.
import { hljs, escapeHtml } from './parser.mjs';

const span = (cls, html) => `<span class="${cls}">${html}</span>`;
const mark = text => span('sx-mark', escapeHtml(text));

const INLINE = new RegExp([
  /(?<code>(`+)(?!`)[\s\S]*?[^`]\2(?!`))/.source,
  /(?<math>\$\$[^$]+?\$\$|\$(?![\s$])(?:\\\$|[^$\n])*?[^\s\\]\$(?!\d))/.source,
  /(?<fnref>\[\^[^\]\s]+\])/.source,
  /(?<image>!\[(?:\\.|[^\]])*\]\((?:<[^>]*>|[^)\s]*)(?:\s+"[^"]*")?\))/.source,
  /(?<link>\[(?:\\.|[^\]])+\]\((?:<[^>]*>|[^)\s]*)(?:\s+"[^"]*")?\))/.source,
  /(?<reflink>\[(?:\\.|[^\]])+\]\[[^\]]*\])/.source,
  /(?<autolink><(?:https?:\/\/|mailto:)[^>\s]+>)/.source,
  /(?<url>\bhttps?:\/\/[^\s<>()]+[^\s<>().,;:!?'"’”])/.source,
  /(?<strong>(?<sd>\*\*|__)(?=\S)(?:[\s\S]*?\S)\k<sd>)/.source,
  /(?<strike>~~(?=\S)[\s\S]*?\S~~)/.source,
  /(?<hl>==(?=[^\s=])[\s\S]*?[^\s=]==)/.source,
  /(?<sub>(?<![~\\])~(?=[^\s~])[^\s~]+~(?!~))/.source,
  /(?<sup>(?<![\^\\\[])\^(?=[^\s^])[^\s^]+\^)/.source,
  /(?<emoji>(?<![A-Za-z0-9\u4e00-\u9fff]):[\w+-]+:)/.source,
  /(?<em>(?<![\w*])\*(?=[^\s*])(?:[^*]|\*\*[^*]+\*\*)*?[^\s*]\*(?!\*)|(?<![\w_])_(?=\S)[^_]*?\S_(?![\w_]))/.source,
  /(?<escape>\\[\\`*_{}[\]()#+\-.!|$<>~])/.source,
  /(?<html><\/?[A-Za-z][\w-]*(?:\s[^<>]*)?\/?>|<!--[\s\S]*?-->)/.source,
].join('|'), 'g');

export function styleInline(text) {
  // A fresh RegExp per call: this function recurses into link text and emphasis.
  const re = new RegExp(INLINE.source, 'g');
  let out = '', last = 0;
  for (let m; (m = re.exec(text));) {
    if (m[0].length === 0) { re.lastIndex++; continue; }
    out += escapeHtml(text.slice(last, m.index));
    const g = m.groups, s = m[0];
    if (g.code) { const ticks = m[2].length; out += span('sx-code', mark(s.slice(0, ticks)) + escapeHtml(s.slice(ticks, -ticks)) + mark(s.slice(-ticks))); }
    else if (g.math) { const d = s.startsWith('$$') ? 2 : 1; out += span('sx-math', mark(s.slice(0, d)) + escapeHtml(s.slice(d, -d)) + mark(s.slice(-d))); }
    else if (g.image || g.link) {
      const image = !!g.image, open = image ? 2 : 1, close = s.lastIndexOf('](');
      out += span(image ? 'sx-image' : 'sx-link', mark(s.slice(0, open)) + span('sx-linktext', image ? escapeHtml(s.slice(open, close)) : styleInline(s.slice(open, close))) + mark('](') + span('sx-url', escapeHtml(s.slice(close + 2, -1))) + mark(')'));
    }
    else if (g.reflink) { const mid = s.indexOf(']['); out += span('sx-link', mark('[') + span('sx-linktext', styleInline(s.slice(1, mid))) + mark(s.slice(mid))); }
    else if (g.autolink) out += span('sx-link', mark('<') + span('sx-url', escapeHtml(s.slice(1, -1))) + mark('>'));
    else if (g.url) out += span('sx-url', escapeHtml(s));
    else if (g.strong) out += span('sx-strong', mark(s.slice(0, 2)) + styleInline(s.slice(2, -2)) + mark(s.slice(-2)));
    else if (g.fnref) out += span('sx-fnref', escapeHtml(s));
    else if (g.hl) out += span('sx-hl', mark('==') + styleInline(s.slice(2, -2)) + mark('=='));
    else if (g.sub) out += span('sx-sub', mark('~') + escapeHtml(s.slice(1, -1)) + mark('~'));
    else if (g.sup) out += span('sx-sup', mark('^') + escapeHtml(s.slice(1, -1)) + mark('^'));
    else if (g.emoji) out += span('sx-emoji', escapeHtml(s));
    else if (g.strike) out += span('sx-strike', mark('~~') + styleInline(s.slice(2, -2)) + mark('~~'));
    else if (g.em) out += span('sx-em', mark(s[0]) + styleInline(s.slice(1, -1)) + mark(s.slice(-1)));
    else if (g.escape) out += mark('\\') + escapeHtml(s.slice(1));
    else if (g.html) out += span('sx-html', escapeHtml(s));
    last = m.index + s.length;
  }
  return out + escapeHtml(text.slice(last));
}

function styleLine(line) {
  let m, prefix = '', rest = line;
  if ((m = /^(\s*(?:>\s?)+)/.exec(rest))) { prefix += span('sx-quote', escapeHtml(m[1])); rest = rest.slice(m[1].length); }
  if ((m = /^(#{1,6})(\s+|$)/.exec(rest))) {
    const level = m[1].length, body = rest.slice(m[0].length), close = /(\s+#+\s*)$/.exec(body);
    const text = close ? body.slice(0, close.index) : body;
    return prefix + span(`sx-heading sx-h${level}`, mark(m[0]) + styleInline(text) + (close ? mark(close[1]) : ''));
  }
  if ((m = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)(\[[ xX]\](?=\s|$))?/.exec(rest)) && (m[3] || rest.length === m[0].length)) {
    prefix += escapeHtml(m[1]) + span('sx-listmark', escapeHtml(m[2] + m[3])) + (m[4] ? span(/x/i.test(m[4]) ? 'sx-task sx-done' : 'sx-task', escapeHtml(m[4])) : '');
    rest = rest.slice(m[0].length);
  }
  if (/^\s*([-*_])(\s*\1){2,}\s*$/.test(rest) && !prefix) return span('sx-hr', escapeHtml(rest));
  if ((m = /^(\s*\[[^\]]+\]:)(\s*\S+)(.*)$/.exec(rest))) return prefix + span('sx-def', mark(m[1]) + span('sx-url', escapeHtml(m[2])) + escapeHtml(m[3]));
  const hardBreak = /( {2,}|\\)$/.exec(rest);
  if (hardBreak) return prefix + styleInline(rest.slice(0, hardBreak.index)) + span('sx-br', escapeHtml(hardBreak[1]));
  return prefix + styleInline(rest);
}

function styleCode(code, info) {
  const lang = (info || '').trim().split(/\s+/)[0].toLowerCase();
  if (lang && hljs.getLanguage(lang)) { try { return hljs.highlight(code, { language: lang, ignoreIllegals: true }).value; } catch {} }
  return escapeHtml(code);
}

// Styles a whole block's source. Structural lines (fences, table pipes, $$) are dimmed.
export function styleSource(src, kind) {
  const lines = src.split('\n');
  if (kind === 'fence' || kind === 'codeBlock') {
    if (kind === 'codeBlock') return span('sx-codeblock', escapeHtml(src));
    const open = lines[0], closing = lines.length > 1 && /^\s*(`{3,}|~{3,})\s*$/.test(lines.at(-1));
    const body = lines.slice(1, closing ? -1 : undefined).join('\n'), info = open.replace(/^\s*(`{3,}|~{3,})/, '');
    return span('sx-fence', escapeHtml(open.slice(0, open.length - info.length))) + span('sx-lang', escapeHtml(info)) + (lines.length > 1 ? '\n' : '')
      + span('sx-codeblock', styleCode(body, info)) + (closing ? '\n' + span('sx-fence', escapeHtml(lines.at(-1))) : '');
  }
  if (kind === 'math') return lines.map(l => /^\s*\$\$\s*$/.test(l) ? span('sx-fence', escapeHtml(l)) : span('sx-mathblock', escapeHtml(l))).join('\n');
  if (kind === 'frontMatter') return lines.map((l, i) => i === 0 || i === lines.length - 1 ? span('sx-fence', escapeHtml(l)) : span('sx-yaml', escapeHtml(l))).join('\n');
  if (kind === 'html') return span('sx-html', escapeHtml(src));
  if (kind === 'table') return lines.map(l => /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/.test(l) ? span('sx-tabledelim', escapeHtml(l)) : span('sx-tablerow', l.split(/((?<!\\)\|)/).map(part => part === '|' ? span('sx-pipe', '|') : styleInline(part)).join(''))).join('\n');
  // Paragraphs, headings, lists, quotes: fenced code may appear nested inside list items/quotes.
  let out = [], fence = null;
  for (const line of lines) {
    const f = /^(\s*(?:>\s?)*\s*(?:(?:[-*+]|\d+[.)])\s+)?)(`{3,}|~{3,})(.*)$/.exec(line);
    if (fence) { out.push(f && f[2][0] === fence[0] && f[2].length >= fence.length && !f[3].trim() ? span('sx-fence', escapeHtml(line)) : span('sx-codeblock', escapeHtml(line))); if (f && f[2][0] === fence[0] && !f[3].trim()) fence = null; continue; }
    if (f && !/`/.test(f[3])) { fence = f[2]; out.push(escapeHtml(f[1]) + span('sx-fence', escapeHtml(f[2])) + span('sx-lang', escapeHtml(f[3]))); continue; }
    out.push(styleLine(line));
  }
  return out.join('\n');
}
