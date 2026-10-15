// Prepares editor Markdown for the Pandoc engine. Pure text → text (no DOM), so it runs in the
// renderer before an export and in Node tests. Pandoc reads the result with PANDOC_FROM.
//  · Diagram fences (mermaid / Typora sequence & flow) become image references; the caller renders
//    each diagram to PNG and ships it with the job under the returned file name.
//  · A `[toc]` line becomes a Word table-of-contents field (docx) or turns on --toc elsewhere.
//  · GitHub alerts become the same Div Pandoc builds for `alerts`, titled with the editor's
//    Chinese label (Pandoc's own titles are English).
//  · HTML <img> tags (Typora's resize syntax) become Pandoc images with a width attribute, because
//    Pandoc drops raw HTML from Word / EPUB output.
import { ALERT_TYPES } from './extensions.mjs';
import { numberBlock } from './math-numbers.mjs';

const DIAGRAM_LANGS = new Set(['mermaid', 'sequence', 'flow', 'flowchart']);
const FENCE = /^( {0,3})(`{3,}|~{3,})\s*([^`\s]*)/;
const TOC = /^ {0,3}\[toc\]\s*$/i;
const ALERT = /^ {0,3}> ?\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]\s*$/i;

export const DOCX_TOC_FIELD = '<w:sdt><w:sdtPr><w:docPartObj><w:docPartGallery w:val="Table of Contents"/><w:docPartUnique/></w:docPartObj></w:sdtPr><w:sdtContent>'
  + '<w:p><w:r><w:fldChar w:fldCharType="begin" w:dirty="true"/></w:r><w:r><w:instrText xml:space="preserve"> TOC \\o "1-3" \\h \\z \\u </w:instrText></w:r>'
  + '<w:r><w:fldChar w:fldCharType="separate"/></w:r><w:r><w:t>目录：在 Word 中右键选择“更新域”生成</w:t></w:r><w:r><w:fldChar w:fldCharType="end"/></w:r></w:p></w:sdtContent></w:sdt>';

const attr = (tag, name) => { const m = new RegExp(`\\s${name}\\s*=\\s*("([^"]*)"|'([^']*)'|([^\\s>]+))`, 'i').exec(tag); return m ? (m[2] ?? m[3] ?? m[4]) : null; };
const escapeAlt = s => String(s).replace(/([\[\]\\])/g, '\\$1');
// <img src="a.png" width="300" style="zoom:50%"> → ![](a.png){width=50%}
export function htmlImageToPandoc(tag) {
  const src = attr(tag, 'src'); if (!src) return tag;
  const alt = attr(tag, 'alt') || '';
  const zoom = /zoom\s*:\s*([\d.]+%?)/i.exec(attr(tag, 'style') || '');
  let width = zoom ? (zoom[1].endsWith('%') ? zoom[1] : Math.round(parseFloat(zoom[1]) * 100) + '%') : attr(tag, 'width');
  if (width && /^\d+(\.\d+)?$/.test(width)) width += 'px';
  const target = /[\s()<>]/.test(src) ? `<${src}>` : src;
  return `![${escapeAlt(alt)}](${target})` + (width && /^\d+(\.\d+)?(px|%|cm|mm|in)$/.test(width) ? `{width=${width}}` : '');
}

// Returns { text, diagrams: [{ file, lang, source }], toc } — `toc` is true when a [toc] marker was
// removed for a non-Word target (the caller then passes --toc).
export function preparePandocMarkdown(input, { target = 'docx', mathNumbering = 'none' } = {}) {
  const lines = String(input).replace(/\r\n?/g, '\n').split('\n');
  const out = [], diagrams = [], code = new Set(), labels = {};
  let toc = false, i = 0, equation = 1;
  // Leave YAML front matter untouched; Pandoc reads it as metadata.
  if (lines[0] === '---') { const end = lines.findIndex((l, k) => k > 0 && /^(---|\.\.\.)\s*$/.test(l)); if (end > 0) { out.push(...lines.slice(0, end + 1)); i = end + 1; } }
  for (; i < lines.length; i++) {
    const line = lines[i], fence = FENCE.exec(line);
    if (fence) {
      const [, indent, mark, info] = fence, close = new RegExp(`^ {0,3}${mark[0] === '`' ? '`' : '~'}{${mark.length},}\\s*$`);
      let j = i + 1; while (j < lines.length && !close.test(lines[j])) j++;
      const body = lines.slice(i + 1, j);
      if (DIAGRAM_LANGS.has(info.toLowerCase())) {
        const file = `qy-diagram-${diagrams.length + 1}.png`;
        diagrams.push({ file, lang: info.toLowerCase(), source: body.map(l => l.startsWith(indent) ? l.slice(indent.length) : l).join('\n') });
        out.push(`${indent}![](${file})`);
      } else for (const l of lines.slice(i, Math.min(j + 1, lines.length))) { code.add(out.length); out.push(l); }
      i = j; continue;
    }
    // Display math: same numbering as the editor (math-numbers.mjs). Pandoc drops \tag and cannot
    // read \label / \eqref, so the number is written beside the equation and labels are kept here.
    const math = /^( {0,3})\$\$(.*)$/.exec(line), single = !!math && math[2].trim().length > 2 && math[2].trim().endsWith('$$');
    if (math && (single || !math[2].includes('$$'))) {
      const [, indent, first] = math;
      let j = i, body;
      if (single) body = first.trim().slice(0, -2);
      else { j = i + 1; while (j < lines.length && !lines[j].trimEnd().endsWith('$$')) j++; body = [first, ...lines.slice(i + 1, j), (lines[j] ?? '').trimEnd().slice(0, -2)].join('\n').trim(); }
      const r = numberBlock(body, mathNumbering, equation);
      equation = r.next;
      for (const [k, v] of r.labels) if (!Object.hasOwn(labels, k)) labels[k] = v;
      out.push(`${indent}$$`, ...r.tex.replace(/\\tag\*?\{([^{}]*)\}/g, '\\qquad ($1)').split('\n'), `${indent}$$`);
      i = Math.min(j, lines.length - 1); continue;
    }
    const alert = ALERT.exec(line);
    if (alert) {
      // Unwrap in place so the loop still handles diagrams, [toc] and images inside the box.
      const type = alert[1].toLowerCase(), body = [];
      for (let k = i + 1; k < lines.length && /^ {0,3}>/.test(lines[k]); k++) body.push(lines[k].replace(/^ {0,3}> ?/, ''));
      lines.splice(i, 1 + body.length, ...body, ':::');
      out.push(`::: {.${type}}`, '::: title', ALERT_TYPES[type], ':::');
      i--; continue;
    }
    if (TOC.test(line)) {
      if (target === 'docx') out.push('```{=openxml}', DOCX_TOC_FIELD, '```'); else toc = true;
      continue;
    }
    // Inline code spans are skipped so `<img>` written as code stays code.
    out.push(line.replace(/(`+)[\s\S]*?\1|<img\b[^>]*>/gi, m => m.startsWith('`') ? m : htmlImageToPandoc(m)));
  }
  // \eqref{k} → (n), \ref{k} → n, outside code (valid both in math and in plain text).
  if (/\\(?:eq)?ref\{/.test(input)) for (let k = 0; k < out.length; k++) if (!code.has(k)) out[k] = out[k].replace(/(`+)[\s\S]*?\1|\\(eqref|ref)\{([^{}]*)\}/g, (m, ticks, kind, key) => {
    if (ticks) return m;
    const value = Object.hasOwn(labels, key.trim()) ? labels[key.trim()] : '?';
    return kind === 'eqref' ? `(${value})` : value;
  });
  return { text: out.join('\n'), diagrams, toc };
}
