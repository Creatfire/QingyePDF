// HTML export: a standalone document (embedded CSS, images and diagrams) or plain HTML without styles.
import { exportCss } from './export-css.mjs';
import { renderExportDom, documentTitle } from './export-dom.mjs';

const esc = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
export async function buildHtml(text, { name = '', theme = 'qingye', plain = false, katexCss = '', custom = '', font = '', size = '', width = '', resolveAsset, forPrint = false } = {}) {
  const container = await renderExportDom(text, { resolveAsset, embedImages: 'data' });
  const title = documentTitle(text, name);
  const hasMath = !!container.querySelector('.katex');
  const body = container.innerHTML;
  if (plain) {
    return `<!doctype html>\n<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title></head>\n<body>\n${body}\n</body></html>\n`;
  }
  const css = exportCss(theme, { custom, font, size, width });
  return `<!doctype html>\n<html lang="zh-CN" data-mdtheme="${esc(theme)}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="generator" content="Qingye PDF"><title>${esc(title)}</title>\n<style>\n${css}\n</style>${hasMath && katexCss ? `\n<style>\n${katexCss}\n</style>` : ''}\n</head>\n<body${forPrint ? ' class="mdPrint"' : ''}>\n<article class="mdExport">\n${body}\n</article>\n</body></html>\n`;
}
