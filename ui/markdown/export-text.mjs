// Plain-text, LaTeX and RTF exporters working on the prepared export DOM.
import { texOf, frontMatter, toPng } from './export-dom.mjs';

const isEl = n => n.nodeType === 1;
const BLOCK_TAGS = new Set(['P', 'DIV', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'UL', 'OL', 'LI', 'PRE', 'BLOCKQUOTE', 'TABLE', 'HR', 'NAV', 'SECTION']);

// ——— Plain text ———
export function toPlainText(root) {
  const out = [];
  const walk = (node, ctx) => {
    for (const child of node.childNodes) {
      if (child.nodeType === 3) { out.push(ctx.pre ? child.data : child.data.replace(/\s+/g, ' ')); continue; }
      if (!isEl(child)) continue;
      const tag = child.tagName;
      if (child.classList.contains('katex-mathml')) continue;
      if (child.classList.contains('katex-html')) continue;
      if (child.classList.contains('katex') || child.classList.contains('katex-display')) { out.push(texOf(child)); continue; }
      if (child.classList.contains('mdFootnoteBack')) continue;
      if (child.classList.contains('mdFrontMatter') || child.classList.contains('mdMermaid')) { if (child.classList.contains('mdMermaid')) out.push('\n' + (child.querySelector('.mdMermaidSource code')?.textContent || '') + '\n'); continue; }
      if (tag === 'BR') { out.push('\n'); continue; }
      if (tag === 'IMG') { out.push(child.getAttribute('alt') ? `[${child.getAttribute('alt')}]` : ''); continue; }
      if (tag === 'HR') { out.push('\n' + '-'.repeat(40) + '\n'); continue; }
      if (tag === 'LI') { const parent = child.parentElement, ordered = parent?.tagName === 'OL', index = [...parent.children].indexOf(child) + (Number(parent.getAttribute('start')) || 1); const box = child.querySelector(':scope > input[type=checkbox], :scope > p > input[type=checkbox]'); out.push('\n' + '  '.repeat(ctx.depth || 0) + (ordered ? `${index}. ` : '• ') + (box ? (box.checked || box.hasAttribute('checked') ? '[x] ' : '[ ] ') : '')); walk(child, { ...ctx, depth: (ctx.depth || 0) + 1 }); continue; }
      if (tag === 'INPUT') continue;
      if (tag === 'TR') { out.push('\n' + [...child.children].map(c => c.textContent.trim()).join('\t')); continue; }
      if (tag === 'TABLE') { out.push('\n'); walk(child, ctx); out.push('\n'); continue; }
      const block = BLOCK_TAGS.has(tag);
      if (block) out.push('\n');
      walk(child, tag === 'PRE' ? { ...ctx, pre: true } : ctx);
      if (block) out.push(/^H[1-6]$/.test(tag) || tag === 'P' || tag === 'PRE' || tag === 'BLOCKQUOTE' ? '\n\n' : '\n');
    }
  };
  walk(root, {});
  return out.join('').replace(/[ \t]+\n/g, '\n').replace(/\n{3,}/g, '\n\n').trim() + '\n';
}

// ——— LaTeX ———
const TEX_ESC = { '\\': '\\textbackslash{}', '{': '\\{', '}': '\\}', '$': '\\$', '&': '\\&', '#': '\\#', '^': '\\textasciicircum{}', '_': '\\_', '%': '\\%', '~': '\\textasciitilde{}' };
const texEscape = s => s.replace(/[\\{}$&#^_%~]/g, c => TEX_ESC[c]);
const CJK = /[\u3400-\u9fff\uf900-\ufaff\u3040-\u30ff\uac00-\ud7af]/;
export function toLatex(root, { title = '', text = '' } = {}) {
  const fm = frontMatter(text);
  const defs = new Map([...root.querySelectorAll('.mdFootnoteDef')].map(d => [d.id.replace(/^fn-/, ''), d.querySelector('.mdFootnoteBody')]));
  const hasMath = !!root.querySelector('.katex'), hasCjk = CJK.test(root.textContent), hasStrike = !!root.querySelector('del, s'), hasMark = !!root.querySelector('mark');
  const inline = node => {
    let s = '';
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { s += texEscape(c.data.replace(/\s+/g, ' ')); continue; }
      if (!isEl(c)) continue;
      if (c.classList.contains('katex-display')) continue;
      if (c.classList.contains('katex') || c.classList.contains('mdMath')) { const el = c.classList.contains('mdMath') ? c.querySelector('.katex, .katex-display') || c : c; s += `$${texOf(el).trim()}$`; continue; }
      if (c.classList.contains('mdFootnoteRef')) { const label = c.querySelector('a')?.getAttribute('href')?.replace(/^#fn-/, ''); const body = defs.get(label); s += body ? `\\footnote{${inline(body).trim()}}` : ''; continue; }
      const inner = () => inline(c);
      switch (c.tagName) {
        case 'STRONG': case 'B': s += `\\textbf{${inner()}}`; break;
        case 'EM': case 'I': s += `\\textit{${inner()}}`; break;
        case 'DEL': case 'S': s += `\\sout{${inner()}}`; break;
        case 'U': case 'INS': s += `\\underline{${inner()}}`; break;
        case 'MARK': s += `\\hl{${inner()}}`; break;
        case 'SUP': s += `\\textsuperscript{${inner()}}`; break;
        case 'SUB': s += `\\textsubscript{${inner()}}`; break;
        case 'CODE': s += `\\texttt{${texEscape(c.textContent)}}`; break;
        case 'BR': s += '\\\\\n'; break;
        case 'A': { const href = c.getAttribute('href') || ''; s += href.startsWith('#') ? inner() : `\\href{${href.replace(/([%#\\])/g, '\\$1')}}{${inner()}}`; break; }
        case 'IMG': s += `\\includegraphics[max width=\\linewidth]{${(c.dataset.originalSrc || c.getAttribute('src') || '').replace(/^data:.*/, 'image')}}`; break;
        case 'INPUT': s += c.checked || c.hasAttribute('checked') ? '$\\boxtimes$ ' : '$\\square$ '; break;
        default: s += inner();
      }
    }
    return s;
  };
  const blocks = (node, depth = 0) => {
    let out = '';
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { if (c.data.trim()) out += texEscape(c.data.replace(/\s+/g, ' ')); continue; }
      if (!isEl(c)) continue;
      if (c.classList.contains('mdFrontMatter') || c.classList.contains('mdFootnoteDef')) continue;
      if (c.classList.contains('mdToc')) { out += '\\tableofcontents\n\n'; continue; }
      if (c.classList.contains('mdMathBlock')) { out += `\\[\n${texOf(c).trim()}\n\\]\n\n`; continue; }
      if (c.classList.contains('mdMermaid')) { out += `\\begin{verbatim}\n${c.querySelector('.mdMermaidSource code')?.textContent || ''}\\end{verbatim}\n\n`; continue; }
      switch (c.tagName) {
        case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': out += `\\${['section', 'subsection', 'subsubsection', 'paragraph', 'subparagraph', 'subparagraph'][Number(c.tagName[1]) - 1]}{${inline(c).trim()}}\n\n`; break;
        case 'P': { const t = inline(c).trim(); if (t) out += t + '\n\n'; break; }
        case 'UL': case 'OL': { const env = c.tagName === 'UL' ? 'itemize' : 'enumerate'; out += `\\begin{${env}}\n`; if (env === 'enumerate' && Number(c.getAttribute('start')) > 1) out += `  \\setcounter{enumi}{${Number(c.getAttribute('start')) - 1}}\n`; for (const li of c.children) { if (li.tagName !== 'LI') continue; const nested = [...li.children].filter(x => x.tagName === 'UL' || x.tagName === 'OL'); const clone = li.cloneNode(true); for (const n of clone.querySelectorAll(':scope > ul, :scope > ol')) n.remove(); out += `  \\item ${inline(clone).trim()}\n`; for (const n of nested) out += blocks({ childNodes: [n] }, depth + 1).replace(/^/gm, '  '); } out += `\\end{${env}}\n\n`; break; }
        case 'BLOCKQUOTE': { const alert = [...c.classList].find(x => x.startsWith('mdAlert-')); out += `\\begin{quote}\n${alert ? `\\textbf{${{ note: '注意', tip: '提示', important: '重要', warning: '警告', caution: '小心' }[alert.slice(8)]}}\\\\\n` : ''}${blocks(c, depth)}\\end{quote}\n\n`; break; }
        case 'PRE': out += `\\begin{verbatim}\n${c.textContent.replace(/\n$/, '')}\n\\end{verbatim}\n\n`; break;
        case 'HR': out += '\\noindent\\rule{\\linewidth}{0.4pt}\n\n'; break;
        case 'TABLE': {
          const rows = [...c.querySelectorAll('tr')]; if (!rows.length) break;
          const cols = Math.max(...rows.map(r => r.children.length));
          const aligns = [...rows[0].children].map(x => { const a = x.style?.textAlign || x.getAttribute('align') || ''; return a === 'center' ? 'c' : a === 'right' ? 'r' : 'l'; });
          out += `\\begin{center}\n\\begin{tabular}{|${Array.from({ length: cols }, (_, i) => aligns[i] || 'l').join('|')}|}\n\\hline\n`;
          rows.forEach((r, i) => { out += [...r.children].map(x => inline(x).trim()).join(' & ') + ' \\\\ \\hline\n'; });
          out += '\\end{tabular}\n\\end{center}\n\n'; break;
        }
        case 'DIV': case 'SECTION': case 'NAV': case 'ARTICLE': out += blocks(c, depth); break;
        default: { const t = inline(c).trim(); if (t) out += t + '\n\n'; }
      }
    }
    return out;
  };
  const body = blocks(root);
  const heading = fm.title || title;
  const pre = ['\\documentclass[11pt]{article}', hasCjk ? '\\usepackage[UTF8]{ctex}' : '\\usepackage[utf8]{inputenc}', '\\usepackage[T1]{fontenc}', '\\usepackage[margin=2.5cm]{geometry}', '\\usepackage{amsmath,amssymb}', '\\usepackage[export]{adjustbox}', '\\usepackage{hyperref}', '\\usepackage{enumitem}',
    hasStrike ? '\\usepackage[normalem]{ulem}' : '', hasMark ? '\\usepackage{xcolor,soul}' : '', '\\usepackage{textcomp}'].filter(Boolean).join('\n');
  return `${pre}\n${heading ? `\\title{${texEscape(heading)}}\n${fm.author ? `\\author{${texEscape(fm.author)}}\n` : ''}${fm.date ? `\\date{${texEscape(fm.date)}}\n` : ''}` : ''}\n\\begin{document}\n${heading ? '\\maketitle\n' : ''}\n${body.trim()}\n\n\\end{document}\n`;
}

// ——— RTF ———
const rtfEscape = s => { let out = ''; for (const ch of s) { const c = ch.codePointAt(0); if (ch === '\\' || ch === '{' || ch === '}') out += '\\' + ch; else if (ch === '\n') out += '\\line '; else if (c > 126) { if (c > 0xffff) { const v = c - 0x10000; out += `\\u${((0xd800 + (v >> 10)) << 16) >> 16}?\\u${((0xdc00 + (v & 0x3ff)) << 16) >> 16}?`; } else out += `\\u${(c << 16) >> 16}?`; } else if (c >= 32 || c === 9) out += ch === '\t' ? '\\tab ' : ch; } return out; };
const hex = bytes => { let s = ''; for (const b of bytes) s += b.toString(16).padStart(2, '0'); return s; };
export async function toRtf(root, { title = '' } = {}) {
  const sizes = [44, 36, 30, 26, 24, 22];
  const pieces = [];
  const runs = async (node, fmt = '') => {
    let s = '';
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { s += fmt ? `{${fmt} ${rtfEscape(c.data.replace(/\s+/g, ' '))}}` : rtfEscape(c.data.replace(/\s+/g, ' ')); continue; }
      if (!isEl(c)) continue;
      if (c.classList.contains('katex-display') || c.classList.contains('katex') || c.classList.contains('mdMath')) { const el = c.classList.contains('mdMath') ? c : c; s += `{\\i ${rtfEscape(texOf(el).trim())}}`; continue; }
      if (c.classList.contains('mdFootnoteRef')) { s += `{\\super ${rtfEscape(c.textContent)}}`; continue; }
      switch (c.tagName) {
        case 'STRONG': case 'B': s += await runs(c, fmt + '\\b'); break;
        case 'EM': case 'I': s += await runs(c, fmt + '\\i'); break;
        case 'DEL': case 'S': s += await runs(c, fmt + '\\strike'); break;
        case 'U': case 'INS': s += await runs(c, fmt + '\\ul'); break;
        case 'MARK': s += await runs(c, fmt + '\\highlight3'); break;
        case 'SUP': s += await runs(c, fmt + '\\super'); break;
        case 'SUB': s += await runs(c, fmt + '\\sub'); break;
        case 'CODE': s += `{\\f1\\fs20 ${rtfEscape(c.textContent)}}`; break;
        case 'BR': s += '\\line '; break;
        case 'A': { const href = (c.getAttribute('href') || '').replace(/[\\{}"]/g, ''); s += /^https?:|^mailto:/i.test(href) ? `{\\field{\\*\\fldinst HYPERLINK "${href}"}{\\fldrslt {\\cf1\\ul ${await runs(c)}}}}` : await runs(c, fmt); break; }
        case 'IMG': { const asset = c._asset; if (asset) { const png = await toPng(asset.bytes, asset.type, { maxWidth: 1600 }); if (png) { const w = Math.min(png.width, 600), h = Math.round(png.height * (w / png.width)); s += `{\\pict\\pngblip\\picw${png.width}\\pich${png.height}\\picwgoal${w * 15}\\pichgoal${h * 15} ${hex(png.bytes)}}`; break; } } s += rtfEscape(c.getAttribute('alt') || ''); break; }
        case 'INPUT': s += c.checked || c.hasAttribute('checked') ? '\\u9745? ' : '\\u9744? '; break;
        default: s += await runs(c, fmt);
      }
    }
    return s;
  };
  const para = (content, props = '') => pieces.push(`{\\pard\\sa160\\sl300\\slmult1${props} ${content}\\par}\n`);
  const blocks = async (node, indent = 0) => {
    for (const c of node.children) {
      if (c.classList.contains('mdFrontMatter') || c.classList.contains('mdFootnoteDef')) continue;
      if (c.classList.contains('mdMathBlock')) { para(`{\\i ${rtfEscape(texOf(c).trim())}}`, '\\qc'); continue; }
      if (c.classList.contains('mdMermaid')) { const svg = c.querySelector('svg'); if (svg) { const { svgToPng } = await import('./export-dom.mjs'); try { const png = await svgToPng(svg.outerHTML); const w = Math.min(png.width / 2, 600), h = Math.round(png.height / 2 * (w / (png.width / 2))); para(`{\\pict\\pngblip\\picw${png.width}\\pich${png.height}\\picwgoal${w * 15}\\pichgoal${h * 15} ${hex(png.bytes)}}`, '\\qc'); } catch { para(`{\\f1\\fs20 ${rtfEscape(c.querySelector('.mdMermaidSource code')?.textContent || '')}}`); } } continue; }
      switch (c.tagName) {
        case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': para(`{\\b\\fs${sizes[Number(c.tagName[1]) - 1]} ${await runs(c)}}`, '\\keepn\\sb240'); break;
        case 'P': para(await runs(c), indent ? `\\li${indent}` : ''); break;
        case 'UL': case 'OL': {
          let n = Number(c.getAttribute('start')) || 1;
          for (const li of c.children) {
            if (li.tagName !== 'LI') continue;
            const clone = li.cloneNode(true), nested = [...clone.querySelectorAll(':scope > ul, :scope > ol')];
            nested.forEach(x => x.remove());
            const box = clone.querySelector('input'); box?.remove();
            const mark = c.tagName === 'UL' ? '\\u8226?\\tab ' : `${n++}.\\tab `;
            para(`${mark}${box ? (box.hasAttribute('checked') || box.checked ? '\\u9745? ' : '\\u9744? ') : ''}${await runs(clone)}`, `\\li${indent + 360}\\fi-360\\tx${indent + 360}`);
            for (const nn of nested) await blocks({ children: [nn] }, indent + 360);
          }
          break;
        }
        case 'BLOCKQUOTE': await blocks(c, indent + 480); break;
        case 'PRE': for (const line of c.textContent.replace(/\n$/, '').split('\n')) para(`{\\f1\\fs20 ${rtfEscape(line) || ' '}}`, `\\li${indent + 240}\\sa0\\cbpat2`); break;
        case 'HR': para('', '\\brdrb\\brdrs\\brdrw10\\brsp20'); break;
        case 'TABLE': {
          const rows = [...c.querySelectorAll('tr')], cols = Math.max(1, ...rows.map(r => r.children.length)), width = 9000, cell = Math.floor(width / cols);
          for (const r of rows) { let row = `\\trowd\\trgaph108\\trleft0` + Array.from({ length: cols }, (_, i) => `\\clbrdrt\\brdrs\\brdrw10\\clbrdrl\\brdrs\\brdrw10\\clbrdrb\\brdrs\\brdrw10\\clbrdrr\\brdrs\\brdrw10${r.children[i]?.tagName === 'TH' ? '\\clcbpat2' : ''}\\cellx${cell * (i + 1)}`).join(''); for (let i = 0; i < cols; i++) row += `\\pard\\intbl ${r.children[i] ? await runs(r.children[i], r.children[i].tagName === 'TH' ? '\\b' : '') : ''}\\cell`; pieces.push(`{${row}\\row}\n`); }
          para(''); break;
        }
        case 'DIV': case 'NAV': case 'SECTION': await blocks(c, indent); break;
        default: para(await runs(c));
      }
    }
  };
  await blocks(root);
  return `{\\rtf1\\ansi\\ansicpg936\\deff0\\uc1{\\fonttbl{\\f0\\fnil\\fcharset134 Microsoft YaHei;}{\\f1\\fmodern\\fcharset0 Consolas;}}{\\colortbl;\\red9\\green105\\blue218;\\red240\\green242\\blue240;\\red255\\green229\\blue138;}\\viewkind4\\f0\\fs22\n${title ? `{\\info{\\title ${rtfEscape(title)}}}\n` : ''}${pieces.join('')}}`;
}
