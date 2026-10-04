// HTML → Markdown for "smart paste" (pasting from web pages / Word / other editors).
// Runs in the renderer on a detached DOM; the input HTML is never inserted into the page.
const BLOCKS = new Set(['P', 'DIV', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'FIGURE', 'FIGCAPTION', 'DETAILS', 'SUMMARY', 'ADDRESS']);
const SEMANTIC = /<(h[1-6]|ul|ol|li|table|strong|b|em|i|a|img|pre|blockquote|code|del|s|strike|u|mark|sub|sup|hr|br)\b/i;
export const looksSemantic = html => SEMANTIC.test(html) && !/^\s*<meta[^>]*><span[^>]*style=/i.test(html.replace(/^<html>\s*<body>\s*(?:<!--StartFragment-->)?/i, ''));

const escapeText = text => text.replace(/([\\`*_[\]<>])/g, '\\$1').replace(/^(\s*)([#>+-]|\d+[.)])(\s)/gm, '$1\\$2$3').replace(/\|/g, '\\|');
const fence = code => { let n = 3; while (code.includes('`'.repeat(n))) n++; return '`'.repeat(n); };
const collapse = text => text.replace(/[ \t\r\n\f]+/g, ' ');

function inline(node, ctx) {
  let out = '';
  for (const child of node.childNodes) out += convert(child, ctx, true);
  return out;
}
function wrap(marker, content) {
  const lead = /^\s*/.exec(content)[0], trail = /\s*$/.exec(content)[0], core = content.trim();
  return core ? lead + marker + core + marker + trail : content;
}
function listItems(list, ctx, depth) {
  const ordered = list.tagName === 'OL';
  let n = Number(list.getAttribute('start')) || 1, out = '';
  for (const li of list.children) {
    if (li.tagName !== 'LI') continue;
    const check = li.querySelector(':scope > input[type=checkbox], :scope > p > input[type=checkbox]');
    const marker = (ordered ? `${n++}. ` : '- ') + (check ? (check.checked || check.hasAttribute('checked') ? '[x] ' : '[ ] ') : '');
    let body = '';
    const nested = [];
    for (const child of li.childNodes) {
      if (child.nodeType === 1 && (child.tagName === 'UL' || child.tagName === 'OL')) nested.push(child);
      else if (!(child.nodeType === 1 && child.tagName === 'INPUT')) body += child.nodeType === 1 && BLOCKS.has(child.tagName) ? inline(child, ctx) + '\n' : convert(child, ctx, true);
    }
    const pad = ' '.repeat(marker.length);
    const lines = body.trim().replace(/\n{2,}/g, '\n').split('\n');
    out += ' '.repeat(depth * 2) + marker + lines[0] + '\n' + lines.slice(1).map(l => ' '.repeat(depth * 2) + pad + l).join('\n') + (lines.length > 1 ? '\n' : '');
    for (const sub of nested) out += listItems(sub, ctx, depth + 1);
  }
  return out;
}
function table(node, ctx) {
  const rows = [...node.querySelectorAll('tr')].map(tr => [...tr.children].filter(c => /^(TD|TH)$/.test(c.tagName)).map(c => inline(c, ctx).trim().replace(/\n+/g, '<br>').replace(/\|/g, '\\|')));
  if (!rows.length) return '';
  const cols = Math.max(...rows.map(r => r.length));
  const pad = r => [...r, ...Array(cols - r.length).fill('')];
  const align = [...(node.querySelector('tr')?.children || [])].map(c => { const a = (c.getAttribute('align') || c.style?.textAlign || '').toLowerCase(); return a === 'center' ? ':---:' : a === 'right' ? '---:' : a === 'left' ? ':---' : '---'; });
  const head = pad(rows[0]);
  return '\n\n| ' + head.join(' | ') + ' |\n| ' + Array.from({ length: cols }, (_, i) => align[i] || '---').join(' | ') + ' |\n' + rows.slice(1).map(r => '| ' + pad(r).join(' | ') + ' |').join('\n') + '\n\n';
}
function convert(node, ctx, inInline = false) {
  if (node.nodeType === 3) return ctx.pre ? node.data : escapeText(collapse(node.data));
  if (node.nodeType !== 1) return '';
  const tag = node.tagName;
  if (/^(SCRIPT|STYLE|META|LINK|TITLE|HEAD|NOSCRIPT|TEMPLATE|SVG|IFRAME|OBJECT|EMBED|BUTTON|FORM|SELECT|TEXTAREA)$/.test(tag)) return '';
  if (node.hasAttribute?.('hidden') || /display\s*:\s*none/i.test(node.getAttribute('style') || '')) return '';
  const style = node.getAttribute('style') || '';
  let out;
  switch (tag) {
    case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': return `\n\n${'#'.repeat(Number(tag[1]))} ${inline(node, ctx).trim().replace(/\n+/g, ' ')}\n\n`;
    case 'P': return `\n\n${inline(node, ctx).trim()}\n\n`;
    case 'BR': return inInline ? '  \n' : '\n';
    case 'HR': return '\n\n---\n\n';
    case 'STRONG': case 'B': return /font-weight\s*:\s*(normal|400)/.test(style) ? inline(node, ctx) : wrap('**', inline(node, ctx));
    case 'EM': case 'I': case 'CITE': return wrap('*', inline(node, ctx));
    case 'DEL': case 'S': case 'STRIKE': return wrap('~~', inline(node, ctx));
    case 'MARK': return wrap('==', inline(node, ctx));
    case 'SUB': return wrap('~', inline(node, ctx));
    case 'SUP': return wrap('^', inline(node, ctx));
    case 'U': case 'INS': return `<u>${inline(node, ctx)}</u>`;
    case 'CODE': case 'KBD': case 'SAMP': case 'TT': {
      if (ctx.pre) return node.textContent;
      const code = node.textContent, ticks = '`'.repeat(Math.max(1, ...[...code.matchAll(/`+/g)].map(m => m[0].length + 1)));
      return code ? `${ticks}${code.startsWith('`') || code.endsWith('`') ? ' ' + code + ' ' : code}${ticks}` : '';
    }
    case 'PRE': {
      const codeEl = node.querySelector('code'), text = (codeEl || node).textContent.replace(/\n$/, '');
      const lang = ((codeEl || node).className.match(/(?:language|lang|highlight-source|brush:?)[-\s]?([\w+#-]+)/i) || [])[1] || '';
      return `\n\n${fence(text)}${lang}\n${text}\n${fence(text)}\n\n`;
    }
    case 'A': {
      const href = node.getAttribute('href') || '', text = inline(node, ctx);
      if (!href || /^javascript:/i.test(href)) return text;
      if (href.startsWith('#') && ctx.dropAnchors) return text;
      const label = text.trim() || href, title = node.getAttribute('title');
      return `[${label}](${/[\s()]/.test(href) ? `<${href}>` : href}${title ? ` "${title.replace(/"/g, '\\"')}"` : ''})`;
    }
    case 'IMG': {
      const src = node.getAttribute('src') || '', alt = (node.getAttribute('alt') || '').replace(/[\[\]]/g, '');
      if (!src) return '';
      return `![${alt}](${/[\s()]/.test(src) ? `<${src}>` : src})`;
    }
    case 'BLOCKQUOTE': { const body = inline(node, ctx).trim().split('\n').map(l => '> ' + l).join('\n'); return `\n\n${body}\n\n`; }
    case 'UL': case 'OL': return `\n\n${listItems(node, ctx, 0).replace(/\n+$/, '')}\n\n`;
    case 'LI': return `\n- ${inline(node, ctx).trim()}\n`;
    case 'TABLE': return table(node, ctx);
    case 'DL': return `\n\n${inline(node, ctx)}\n\n`;
    case 'DT': return `\n**${inline(node, ctx).trim()}**\n`;
    case 'DD': return `\n: ${inline(node, ctx).trim()}\n`;
    case 'INPUT': return '';
    default: break;
  }
  out = inline(node, ctx);
  // Word / Google Docs style spans carry bold / italic in CSS.
  if (tag === 'SPAN') {
    if (/font-weight\s*:\s*(bold|[6-9]00)/i.test(style)) out = wrap('**', out);
    if (/font-style\s*:\s*italic/i.test(style)) out = wrap('*', out);
    if (/text-decoration[^;]*line-through/i.test(style)) out = wrap('~~', out);
  }
  if (BLOCKS.has(tag) && !inInline) return `\n\n${out.trim()}\n\n`;
  if (BLOCKS.has(tag)) return `\n${out}\n`;
  return out;
}
export function htmlToMarkdown(html, { parser = globalThis.DOMParser } = {}) {
  if (!parser) return '';
  const doc = new parser().parseFromString(html.replace(/<!--(?:Start|End)Fragment-->/g, ''), 'text/html');
  const body = doc.body;
  const md = convert(body, { pre: false }, false);
  return md.replace(/[ \t]+\n/g, m => (m.startsWith('  ') && m.length === 3 ? m : '\n')).replace(/\u00a0/g, ' ').replace(/\n{3,}/g, '\n\n').replace(/^\s+|\s+$/g, '');
}
