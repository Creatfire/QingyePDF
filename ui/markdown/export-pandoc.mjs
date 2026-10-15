// Renderer half of a Pandoc export: rewrites the Markdown (pandoc-prep.mjs), renders diagrams to
// PNG with the editor's own Mermaid, and describes the current theme for the Word template.
import { preparePandocMarkdown } from './pandoc-prep.mjs';
import { renderExportDom, svgToPng } from './export-dom.mjs';
import { themeTokens } from './export-css.mjs';

// Pandoc formats the editor routes through the engine when it is available.
export const PANDOC_PRIMARY = new Set(['docx', 'epub']);

const GENERIC = /^(serif|sans-serif|monospace|system-ui|cursive|fantasy|inherit|-apple-system|blinkmacsystemfont)$/i;
const CJK_FONT = /(yahei|pingfang|hei|song|kai|fang|noto (sans|serif) (sc|tc|cjk)|source han|simsun|simhei|dengxian|等线|宋|黑|楷)/i;
const WINDOWS_NAME = { 'microsoft yahei ui': 'Microsoft YaHei', 'pingfang sc': 'Microsoft YaHei', 'songti sc': 'SimSun', 'noto serif sc': 'SimSun', 'noto sans sc': 'Microsoft YaHei' };
const families = stack => String(stack || '').split(',').map(s => s.trim().replace(/^["']|["']$/g, '')).filter(s => s && !GENERIC.test(s));
// Picks a Latin and an East Asian font from a CSS font stack for Word.
export function wordFonts(stack) {
  const list = families(stack), serif = /serif/i.test(stack) && !/sans-serif/i.test(stack.split(',').pop());
  const latin = list.find(f => !CJK_FONT.test(f) && !/^segoe ui variable/i.test(f)) || (serif ? 'Cambria' : 'Calibri');
  const cjkRaw = list.find(f => CJK_FONT.test(f));
  const cjk = cjkRaw ? (WINDOWS_NAME[cjkRaw.toLowerCase()] || cjkRaw) : (serif ? 'SimSun' : 'Microsoft YaHei');
  return { latin: latin.replace(/^Segoe UI Variable.*$/i, 'Segoe UI'), cjk };
}
export function docxStyle(theme, prefs = {}) {
  const t = themeTokens(theme === 'night' ? 'qingye' : theme); // Word pages are white; keep dark themes readable
  const body = wordFonts(prefs.fontFamily || t.font), heading = t.display && t.display !== 'inherit' ? wordFonts(t.display) : body;
  const px = parseFloat(prefs.fontSize || t.size) || 16;
  return { latin: body.latin, cjk: body.cjk, headingLatin: heading.latin, headingCjk: heading.cjk, color: t.ink, headingColor: t.accent, sizePt: Math.round(px * 0.75 * 2) / 2 };
}
function epubCss(theme, prefs = {}) {
  const t = themeTokens(theme === 'night' ? 'qingye' : theme);
  return `body{font-family:${prefs.fontFamily || t.font};color:${t.ink};line-height:${t.lh}}h1,h2,h3,h4,h5,h6{color:${t.accent};line-height:1.3}`
    + `blockquote{border-left:3px solid ${t.line};margin-left:0;padding-left:1em;color:${t.muted}}code{font-family:Consolas,"Cascadia Mono",monospace}pre{background:${t.code};padding:.6em .8em;white-space:pre-wrap}`
    + `table{border-collapse:collapse}th,td{border:1px solid ${t.line};padding:.25em .6em}img{max-width:100%}`;
}

// Returns { text, options } for api.mdPandocExport.
export async function preparePandocJob(source, { format, prefs = {}, theme = 'qingye' }) {
  const prep = preparePandocMarkdown(source, { target: format });
  let text = prep.text;
  const files = [];
  if (prep.diagrams.length) {
    const md = prep.diagrams.map(d => '```' + d.lang + '\n' + d.source + '\n```').join('\n\n');
    let boxes = [];
    try { boxes = [...(await renderExportDom(md, { embedImages: 'keep' })).querySelectorAll('.mdMermaid')]; } catch {}
    for (const [k, d] of prep.diagrams.entries()) {
      const svg = boxes[k]?.querySelector('svg');
      const png = svg ? await svgToPng(svg.outerHTML).catch(() => null) : null;
      // A diagram that does not render keeps its source as a code block instead of a broken image.
      const replacement = png ? `![](${d.file}){width=${Math.round(png.width / 2)}px}` : '```' + d.lang + '\n' + d.source + '\n```';
      text = text.replace(`![](${d.file})`, () => replacement);
      if (png) files.push({ name: d.file, data: png.bytes });
    }
  }
  const options = { files, toc: prep.toc, smart: !!prefs.smartPunctuation };
  if (format === 'docx') options.docxStyle = docxStyle(theme, prefs);
  if (format === 'epub') options.css = epubCss(theme, prefs);
  return { text, options };
}
