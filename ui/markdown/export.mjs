// Export entry point: turns a Markdown session into a file payload for the main process to save.
import { renderExportDom, documentTitle, svgToPng, toPng } from './export-dom.mjs';
import { buildHtml } from './export-html.mjs';
import { toPlainText, toLatex, toRtf } from './export-text.mjs';

export const FORMAT_INFO = {
  pdf: { ext: 'pdf', name: 'PDF 文档' }, html: { ext: 'html', name: 'HTML 网页' }, htmlPlain: { ext: 'html', name: 'HTML 网页' },
  docx: { ext: 'docx', name: 'Word 文档' }, epub: { ext: 'epub', name: 'ePub 电子书' }, latex: { ext: 'tex', name: 'LaTeX 源文件' },
  rtf: { ext: 'rtf', name: 'RTF 文档' }, txt: { ext: 'txt', name: '纯文本' }, image: { ext: 'png', name: 'PNG 图片' },
  odt: { ext: 'odt', name: 'OpenDocument 文本' }, rst: { ext: 'rst', name: 'reStructuredText' }, mediawiki: { ext: 'wiki', name: 'MediaWiki' },
  textile: { ext: 'textile', name: 'Textile' }, opml: { ext: 'opml', name: 'OPML' }, org: { ext: 'org', name: 'Org-mode' }, asciidoc: { ext: 'adoc', name: 'AsciiDoc' }, pptx: { ext: 'pptx', name: 'PowerPoint 演示文稿' },
};
export const isPandocFormat = f => ['odt', 'rst', 'mediawiki', 'textile', 'opml', 'org', 'asciidoc', 'pptx'].includes(f);

// ctx: { text, name, prefs, katexCss, custom, resolveAsset }
// Returns { ext, data } (string | Uint8Array) or { ext, html, kind: 'pdf' | 'image' } for renderer-based formats.
export async function buildExport(format, ctx) {
  const { text, name = '', prefs = {}, resolveAsset } = ctx;
  const title = documentTitle(text, name), info = FORMAT_INFO[format];
  if (!info) throw new Error('不支持的导出格式：' + format);
  const themeArgs = { name, theme: prefs.theme && prefs.theme !== 'custom' ? prefs.theme : 'qingye', katexCss: ctx.katexCss || '', custom: ctx.custom || '', font: prefs.fontFamily || '', size: prefs.fontSize ? prefs.fontSize + 'px' : '', width: prefs.pageWidth ? prefs.pageWidth + 'px' : '', resolveAsset };
  switch (format) {
    case 'html': return { ext: 'html', data: await buildHtml(text, { ...themeArgs }) };
    case 'htmlPlain': return { ext: 'html', data: await buildHtml(text, { ...themeArgs, plain: true }) };
    case 'pdf': return { ext: 'pdf', kind: 'pdf', html: await buildHtml(text, { ...themeArgs, forPrint: true }) };
    case 'image': return { ext: 'png', kind: 'image', html: await buildHtml(text, { ...themeArgs }) };
    case 'txt': { const dom = await renderExportDom(text, { resolveAsset, diagrams: 'none', embedImages: 'keep' }); return { ext: 'txt', data: toPlainText(dom) }; }
    case 'latex': {
      const dom = await renderExportDom(text, { resolveAsset, embedImages: 'keep' }), images = [];
      for (const box of dom.querySelectorAll('.mdMermaid')) {
        const svg = box.querySelector('svg'); if (!svg) continue;
        const name = `diagrams/diagram-${images.length + 1}.png`, png = await svgToPng(svg.outerHTML);
        images.push({ name, data: png.bytes });
        const p = dom.ownerDocument.createElement('p'), img = dom.ownerDocument.createElement('img');
        img.setAttribute('src', name); p.append(img); box.replaceWith(p);
      }
      for (const img of dom.querySelectorAll('img')) {
        if (!img._asset) continue;
        const png = await toPng(img._asset.bytes, img._asset.type); if (!png) continue;
        const name = `images/image-${images.length + 1}.png`;
        images.push({ name, data: png.bytes }); img.setAttribute('src', name); delete img.dataset.originalSrc;
      }
      const data = toLatex(dom, { title, text });
      if (!images.length) return { ext: 'tex', data };
      const { makeZip } = await import('./zip.mjs');
      return { ext: 'zip', data: await makeZip([{ name: 'document.tex', data }, ...images]) };
    }
    case 'rtf': { const dom = await renderExportDom(text, { resolveAsset, embedImages: 'keep' }); return { ext: 'rtf', data: await toRtf(dom, { title }) }; }
    case 'docx': { const { buildDocx } = await import('./export-docx.mjs'); const dom = await renderExportDom(text, { resolveAsset, embedImages: 'keep' }); return { ext: 'docx', data: await buildDocx(dom, { title, text }) }; }
    case 'epub': { const { buildEpub } = await import('./export-epub.mjs'); const dom = await renderExportDom(text, { resolveAsset, embedImages: 'keep' }); return { ext: 'epub', data: await buildEpub(dom, { text, name, theme: themeArgs.theme }) }; }
    default: if (isPandocFormat(format)) return { ext: info.ext, kind: 'pandoc', format };
  }
  throw new Error('不支持的导出格式：' + format);
}
