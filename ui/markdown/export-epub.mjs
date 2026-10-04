// ePub 3 exporter: one XHTML chapter, navigation from headings, images packaged as files.
import { makeZip } from './zip.mjs';
import { exportCss } from './export-css.mjs';
import { toPng, svgToPng, documentTitle, frontMatter } from './export-dom.mjs';

const xml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : 'qy-' + Date.now());
export async function buildEpub(root, { text = '', name = '', theme = 'qingye', lang = 'zh-CN' } = {}) {
  const title = documentTitle(text, name), fm = frontMatter(text), files = [];
  // Unique heading ids
  const seen = new Set(), heads = [];
  for (const h of root.querySelectorAll('h1,h2,h3,h4,h5,h6')) { let id = h.id || `h${heads.length + 1}`; if (seen.has(id)) { let n = 1; while (seen.has(`${id}-${n}`)) n++; id = `${id}-${n}`; } seen.add(id); h.id = id; heads.push({ level: Number(h.tagName[1]), id, text: h.textContent.trim() }); }
  // Images → files
  let n = 1;
  const add = (bytes, type) => { const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/svg+xml': 'svg', 'image/webp': 'webp' }[type] || 'png'; const path = `images/img${n++}.${ext}`; files.push({ path, bytes, type }); return path; };
  for (const img of root.querySelectorAll('img')) {
    const asset = img._asset;
    if (asset) { let { bytes, type } = asset; if (!/^image\/(png|jpeg|gif|svg\+xml)$/.test(type)) { const png = await toPng(bytes, type); if (!png) { img.remove(); continue; } ({ bytes, type } = png); } img.setAttribute('src', add(bytes, type)); }
    else if (/^data:/.test(img.getAttribute('src') || '')) { const m = /^data:([^;,]+);base64,(.*)$/.exec(img.getAttribute('src')); if (m) img.setAttribute('src', add(Uint8Array.from(atob(m[2]), c => c.charCodeAt(0)), m[1])); }
    else if (/^https?:/i.test(img.getAttribute('src') || '')) { const alt = document.createElement('span'); alt.textContent = `[${img.getAttribute('alt') || img.getAttribute('src')}]`; img.replaceWith(alt); }
    img.removeAttribute('width'); img.removeAttribute('height');
  }
  for (const box of root.querySelectorAll('.mdMermaid')) {
    const svg = box.querySelector('svg');
    if (svg) { try { const png = await svgToPng(svg.outerHTML); const im = document.createElement('img'); im.setAttribute('src', add(png.bytes, 'image/png')); im.setAttribute('alt', 'Mermaid 图表'); box.replaceChildren(im); } catch { box.replaceWith(Object.assign(document.createElement('pre'), { textContent: box.querySelector('.mdMermaidSource code')?.textContent || '' })); } }
    else box.remove();
  }
  // KaTeX: keep MathML only
  for (const k of root.querySelectorAll('.katex-html')) k.remove();
  const hasMath = !!root.querySelector('math');
  for (const el of root.querySelectorAll('[id^="fn-"], [id^="fnref-"]')) { /* ids stay valid XML names */ }
  for (const el of root.querySelectorAll('input')) { const box = document.createElement('span'); box.textContent = el.checked || el.hasAttribute('checked') ? '☑ ' : '☐ '; el.replaceWith(box); }
  const doc = document.implementation.createHTMLDocument(title);
  doc.documentElement.setAttribute('lang', lang);
  const link = doc.createElement('link'); link.setAttribute('rel', 'stylesheet'); link.setAttribute('type', 'text/css'); link.setAttribute('href', 'style.css'); doc.head.append(link);
  const article = doc.createElement('article'); article.setAttribute('class', 'mdExport');
  article.innerHTML = root.innerHTML;
  doc.body.append(article);
  for (const el of doc.querySelectorAll('[style*="margin-left"]')) { /* toc indents are fine */ }
  const xhtml = '<?xml version="1.0" encoding="UTF-8"?>\n<!DOCTYPE html>\n' + new XMLSerializer().serializeToString(doc.documentElement);
  const css = exportCss(theme).replace(/\.mdExport \{[^}]*\}/, '.mdExport { padding: 0 .5em; }').replace(/html \{[^}]*\}/, '').replace(/@media print[^}]*\}[^}]*\}/, '');
  const id = `urn:uuid:${uuid()}`;
  const manifestImages = files.map((f, i) => `<item id="img${i + 1}" href="${f.path}" media-type="${f.type}"/>`).join('\n    ');
  const opf = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="bookid" xml:lang="${lang}">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/">
    <dc:identifier id="bookid">${id}</dc:identifier>
    <dc:title>${xml(title)}</dc:title>
    <dc:language>${lang}</dc:language>${fm.author ? `\n    <dc:creator>${xml(fm.author)}</dc:creator>` : ''}
    <meta property="dcterms:modified">${new Date().toISOString().replace(/\.\d+Z$/, 'Z')}</meta>
  </metadata>
  <manifest>
    <item id="nav" href="nav.xhtml" media-type="application/xhtml+xml" properties="nav"/>
    <item id="text" href="text.xhtml" media-type="application/xhtml+xml"${hasMath ? ' properties="mathml"' : ''}/>
    <item id="css" href="style.css" media-type="text/css"/>
    ${manifestImages}
  </manifest>
  <spine><itemref idref="text"/></spine>
</package>`;
  const nav = `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE html>
<html xmlns="http://www.w3.org/1999/xhtml" xmlns:epub="http://www.idpf.org/2007/ops" lang="${lang}"><head><meta charset="utf-8"/><title>${xml(title)}</title></head><body>
<nav epub:type="toc" id="toc"><h1>${xml(title)}</h1><ol>${heads.length ? heads.map(h => `<li><a href="text.xhtml#${xml(h.id)}">${xml(h.text || '（无标题）')}</a></li>`).join('') : `<li><a href="text.xhtml">${xml(title)}</a></li>`}</ol></nav></body></html>`;
  return makeZip([
    { name: 'mimetype', data: 'application/epub+zip', store: true },
    { name: 'META-INF/container.xml', data: '<?xml version="1.0" encoding="UTF-8"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>' },
    { name: 'OEBPS/content.opf', data: opf }, { name: 'OEBPS/nav.xhtml', data: nav }, { name: 'OEBPS/text.xhtml', data: xhtml }, { name: 'OEBPS/style.css', data: css },
    ...files.map(f => ({ name: `OEBPS/${f.path}`, data: f.bytes })),
  ]);
}
