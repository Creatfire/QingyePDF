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
export function preparePandocMarkdown(input, { target = 'docx' } = {}) {
  const lines = String(input).replace(/\r\n?/g, '\n').split('\n');
  const out = [], diagrams = [];
  let toc = false, i = 0;
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
      } else out.push(...lines.slice(i, Math.min(j + 1, lines.length)));
      i = j; continue;
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
  return { text: out.join('\n'), diagrams, toc };
}
