// Shared preparation for every export format: render the Markdown document to a clean, detached DOM
// (images resolved, diagrams drawn, app-only controls removed) and small image helpers.
import { md, sanitize, analyze } from './parser.mjs';

export const IMAGE_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif', ico: 'image/x-icon' };
export const bytesToBase64 = bytes => { let s = ''; const step = 0x8000; for (let i = 0; i < bytes.length; i += step) s += String.fromCharCode.apply(null, bytes.subarray(i, i + step)); return btoa(s); };
export const dataUrl = (bytes, type) => `data:${type};base64,${bytesToBase64(bytes)}`;
const isRemote = src => /^(https?:)?\/\//i.test(src);

// Front matter as { key: value } (flat "key: value" lines only).
export function frontMatter(text) {
  const m = /^---\r?\n([\s\S]*?)\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.exec(text);
  if (!m) return {};
  const out = {};
  for (const line of m[1].split(/\r?\n/)) { const kv = /^([A-Za-z_][\w-]*):\s*(.*?)\s*$/.exec(line); if (kv) out[kv[1].toLowerCase()] = kv[2].replace(/^["']|["']$/g, ''); }
  return out;
}
export function documentTitle(text, fallback = '未命名') {
  const fm = frontMatter(text); if (fm.title) return fm.title;
  const h = /^\s{0,3}#\s+(.+?)\s*#*\s*$/m.exec(text.replace(/^---[\s\S]*?\n---\s*\n/, ''));
  return h ? h[1].replace(/[*_`~]/g, '') : fallback.replace(/\.(md|markdown|mdown|mkd|mkdn|mdwn)$/i, '');
}

// options: { resolveAsset(src) -> {bytes,type}|null, diagrams: 'svg'|'none', embedImages: 'data'|'keep' }
export async function renderExportDom(text, options = {}) {
  // Built inside an inert document so the browser never starts loading <img> sources.
  const inert = document.implementation.createHTMLDocument('');
  const container = inert.createElement('div');
  container.className = 'mdExport';
  container.append(inert.importNode(sanitize(md.render(text, { taskIndex: 0 })), true));
  // A standalone HTML <img> is a block from markdown-it; document exporters consume paragraphs.
  for (const img of [...container.children].filter(el => el.tagName === 'IMG')) { const p = inert.createElement('p'); img.replaceWith(p); p.append(img); }
  for (const el of container.querySelectorAll('.mdCopy, .mdZoom, .mdMermaid .mdCodeHead')) el.remove();
  for (const box of container.querySelectorAll('.mdCodeBlock')) { box.querySelector('.mdCodeHead')?.remove(); const pre = box.querySelector('pre'); if (pre) { pre.className = 'mdCodePre'; box.replaceWith(pre); } }
  for (const el of container.querySelectorAll('.mdFrontMatter')) el.remove();
  for (const input of container.querySelectorAll('input.mdTask')) input.setAttribute('disabled', '');
  // Images
  const assets = new Map();
  for (const img of container.querySelectorAll('img')) {
    const src = img.getAttribute('src') || '';
    if (!src || /^data:/i.test(src) || isRemote(src)) continue;
    if (!assets.has(src)) assets.set(src, Promise.resolve(options.resolveAsset?.(decodeSrc(src))).catch(() => null));
    const asset = await assets.get(src);
    if (!asset) { img.dataset.missing = '1'; continue; }
    img.dataset.originalSrc = src;
    img._asset = asset;
    if (options.embedImages !== 'keep') img.setAttribute('src', dataUrl(asset.bytes, asset.type));
  }
  // Diagrams
  if (options.diagrams !== 'none' && container.querySelector('.mdMermaid')) {
    const { renderDiagrams } = await import('./diagrams.mjs');
    await renderDiagrams(container, { dark: false, fit: false });
    for (const box of container.querySelectorAll('.mdMermaid')) { box.querySelectorAll('.mdZoom').forEach(e => e.remove()); }
  }
  return container;
}
const decodeSrc = src => { try { return decodeURI(src); } catch { return src; } };

// Any browser-decodable image → PNG bytes with natural size (used by Word / RTF / ePub).
export async function toPng(bytes, type, { maxWidth = 2400 } = {}) {
  const blob = new Blob([bytes], { type });
  const bitmap = await createImageBitmap(blob).catch(() => null);
  if (!bitmap) return null;
  const scale = Math.min(1, maxWidth / bitmap.width), w = Math.max(1, Math.round(bitmap.width * scale)), h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = new OffscreenCanvas(w, h), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; if (!/png|svg|webp|gif|avif/.test(type)) ctx.fillRect(0, 0, w, h);
  ctx.drawImage(bitmap, 0, 0, w, h);
  const out = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  return { bytes: out, width: w, height: h, type: 'image/png' };
}
export async function svgToPng(svgText, { scale = 2 } = {}) {
  const parsed = new DOMParser().parseFromString(svgText, 'image/svg+xml').documentElement;
  const vb = (parsed.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
  let w = parseFloat(parsed.getAttribute('width')) || vb[2] || 800, h = parseFloat(parsed.getAttribute('height')) || vb[3] || 600;
  if (/%/.test(parsed.getAttribute('width') || '') && vb[2]) { w = vb[2]; h = vb[3]; }
  parsed.setAttribute('width', w); parsed.setAttribute('height', h);
  if (!parsed.getAttribute('xmlns')) parsed.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
  const xml = new XMLSerializer().serializeToString(parsed);
  const img = new Image();
  img.src = 'data:image/svg+xml;charset=utf-8,' + encodeURIComponent(xml);
  await img.decode();
  const canvas = new OffscreenCanvas(Math.round(w * scale), Math.round(h * scale)), ctx = canvas.getContext('2d');
  ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  const out = new Uint8Array(await (await canvas.convertToBlob({ type: 'image/png' })).arrayBuffer());
  return { bytes: out, width: canvas.width, height: canvas.height, type: 'image/png' };
}
// TeX source of a rendered KaTeX element.
export const texOf = el => (el.querySelector('annotation[encoding="application/x-tex"]') || el.querySelector('annotation'))?.textContent ?? el.textContent ?? '';
export { analyze };
