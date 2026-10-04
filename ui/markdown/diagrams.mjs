// Offline Markdown diagrams. Load each engine only when its fence first appears.
import { legacyToMermaid } from './diagrams-legacy.mjs';
import { DOMPurify } from '../../vendor/markdown/qingye-markdown-vendor.mjs';
let loading = null, queue = Promise.resolve(), counter = 0, configured = '';
const cache = new Map();
const scripts = new Map();
const FONT = '"Segoe UI Variable Text", "Segoe UI", "Microsoft YaHei UI", "PingFang SC", system-ui, sans-serif';

const palette = dark => dark ? {
  darkMode: true, background: '#16211c', primaryColor: '#1a3629', primaryBorderColor: '#5ccb98', primaryTextColor: '#e4eee8',
  secondaryColor: '#22493a', secondaryBorderColor: '#3fae80', secondaryTextColor: '#e4eee8', tertiaryColor: '#1f2d27', tertiaryBorderColor: '#33483d', tertiaryTextColor: '#c0cfc7',
  lineColor: '#8b9f95', textColor: '#e4eee8', mainBkg: '#1a3629', nodeBorder: '#5ccb98', clusterBkg: '#1a2621', clusterBorder: '#33483d', edgeLabelBackground: '#16211c',
  titleColor: '#e4eee8', noteBkgColor: '#362b17', noteTextColor: '#f1e2c2', noteBorderColor: '#e8c071', actorBkg: '#1a3629', actorBorder: '#5ccb98', actorTextColor: '#e4eee8', signalColor: '#c0cfc7', signalTextColor: '#e4eee8', labelBoxBkgColor: '#1a3629', labelTextColor: '#e4eee8',
} : {
  darkMode: false, background: '#ffffff', primaryColor: '#e1f1e8', primaryBorderColor: '#1d7a57', primaryTextColor: '#15201b',
  secondaryColor: '#c9e6d6', secondaryBorderColor: '#3fae80', secondaryTextColor: '#15201b', tertiaryColor: '#f4f7f5', tertiaryBorderColor: '#c8d5ce', tertiaryTextColor: '#34453d',
  lineColor: '#66786f', textColor: '#15201b', mainBkg: '#e1f1e8', nodeBorder: '#1d7a57', clusterBkg: '#f7faf8', clusterBorder: '#c8d5ce', edgeLabelBackground: '#ffffff',
  titleColor: '#15201b', noteBkgColor: '#fbf1dc', noteTextColor: '#3b2c0c', noteBorderColor: '#c9a24a', actorBkg: '#e1f1e8', actorBorder: '#1d7a57', actorTextColor: '#15201b', signalColor: '#34453d', signalTextColor: '#15201b', labelBoxBkgColor: '#e1f1e8', labelTextColor: '#15201b',
};
const isDark = () => document.body.classList.contains('dark');

function script(file) {
  if (!scripts.has(file)) scripts.set(file, new Promise((resolve, reject) => {
    const tag = document.createElement('script');
    tag.src = new URL('../../vendor/diagrams/' + file, import.meta.url).href;
    tag.onload = resolve;
    tag.onerror = () => reject(new Error('无法加载本地图表库：' + file));
    document.head.append(tag);
  }));
  return scripts.get(file);
}

async function engine(kind) {
  if (kind === 'sequence') {
    await script('raphael.min.js');
    await script('underscore.min.js');
    await script('sequence-diagram-raphael-min.js');
    if (!window.Diagram?.parse) throw new Error('序列图库不可用。');
  } else {
    await script('flowchart.min.js');
    if (!window.flowchart?.parse) throw new Error('流程图库不可用。');
  }
}

// Raphaël shares marker definitions across papers. Copy missing references into this SVG,
// then give every ID a unique prefix so each exported image is self-contained.
function isolateReferences(svg) {
  const references = () => [...svg.querySelectorAll('*')].flatMap(el => [...el.attributes].flatMap(attr => {
    if (/^(?:xlink:)?href$/i.test(attr.name) && attr.value.startsWith('#')) return [attr.value.slice(1)];
    return [...attr.value.matchAll(/url\(['"]?#([^)'"\s]+)['"]?\)/g)].map(m => m[1]);
  }));
  const seen = new Set();
  for (let ids = references(); ids.length; ids = references().filter(id => !seen.has(id))) {
    for (const id of ids) {
      seen.add(id);
      if ([...svg.querySelectorAll('[id]')].some(el => el.id === id)) continue;
      const target = document.getElementById(id);
      if (target?.closest('svg')) {
        let defs = svg.querySelector('defs');
        if (!defs) { defs = document.createElementNS('http://www.w3.org/2000/svg', 'defs'); svg.prepend(defs); }
        defs.append(target.cloneNode(true));
      }
    }
  }
  const prefix = 'qingye-diagram-' + (++counter) + '-', ids = new Map();
  for (const el of svg.querySelectorAll('[id]')) { ids.set(el.id, prefix + el.id); el.id = prefix + el.id; }
  for (const el of svg.querySelectorAll('*')) for (const attr of [...el.attributes]) {
    if (/url\(([^)]*)\)/g.test(attr.value) && [...attr.value.matchAll(/url\(([^)]*)\)/g)].some(m => !m[1].replace(/^['"]|['"]$/g, '').startsWith('#'))) { el.removeAttribute(attr.name); continue; }
    let value = attr.value.replace(/url\(['"]?#([^)'"\s]+)['"]?\)/g, (all, id) => ids.has(id) ? `url(#${ids.get(id)})` : all);
    if (/^(?:xlink:)?href$/i.test(attr.name) && value.startsWith('#') && ids.has(value.slice(1))) value = '#' + ids.get(value.slice(1));
    if (value !== attr.value) el.setAttributeNS(attr.namespaceURI, attr.name, value);
  }
}

// Raphaël measures text with getBBox, so detached export DOMs use a temporary live mount.
export async function renderLegacySvg(kind, source, { dark = isDark() } = {}) {
  await engine(kind);
  const p = palette(dark), mount = document.createElement('div');
  mount.style.cssText = 'position:fixed;left:-100000px;top:0;opacity:0;pointer-events:none';
  document.body.append(mount);
  try {
    if (kind === 'sequence') window.Diagram.parse(source).drawSVG(mount, { theme: 'raphaelSimple', 'font-family': FONT, 'font-size': 14 });
    else window.flowchart.parse(source).drawSVG(mount, { 'font-family': FONT, 'font-size': 14, 'font-color': p.textColor, 'line-color': p.lineColor, 'element-color': p.nodeBorder, fill: p.mainBkg });
    const svg = mount.querySelector('svg');
    if (!svg) throw new Error('图表库未输出 SVG。');
    // Generated links and images are unnecessary for diagrams and must never load remote assets.
    for (const a of [...svg.querySelectorAll('a')]) a.replaceWith(...a.childNodes);
    svg.querySelectorAll('image, foreignObject').forEach(node => node.remove());
    for (const el of svg.querySelectorAll('*')) {
      for (const attr of [...el.attributes]) if (/^on/i.test(attr.name) || (/^(?:xlink:)?href$/i.test(attr.name) && !attr.value.startsWith('#'))) el.removeAttribute(attr.name);
    }
    if (kind === 'sequence') {
      for (const el of svg.querySelectorAll('text')) el.setAttribute('fill', p.textColor);
      for (const el of svg.querySelectorAll('rect')) { el.setAttribute('fill', p.actorBkg); el.setAttribute('stroke', p.actorBorder); }
      for (const el of svg.querySelectorAll('path')) if (el.getAttribute('stroke') && el.getAttribute('stroke') !== 'none') el.setAttribute('stroke', p.lineColor);
    }
    isolateReferences(svg);
    if (kind === 'sequence') for (const el of svg.querySelectorAll('marker use')) {
      for (const name of ['fill', 'stroke']) if (el.getAttribute(name) && el.getAttribute(name) !== 'none') el.setAttribute(name, p.lineColor);
    }
    const width = parseFloat(svg.getAttribute('width')) || svg.getBBox().width;
    const height = parseFloat(svg.getAttribute('height')) || svg.getBBox().height;
    if (!(width > 0 && height > 0)) throw new Error('图表尺寸无效。');
    svg.setAttribute('xmlns', 'http://www.w3.org/2000/svg');
    svg.setAttribute('width', String(width)); svg.setAttribute('height', String(height));
    if (!svg.hasAttribute('viewBox')) svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
    return DOMPurify.sanitize(svg.outerHTML, { USE_PROFILES: { svg: true, svgFilters: true }, ADD_TAGS: ['use'] });
  } finally { mount.remove(); }
}

async function mermaidFor(dark) {
  loading ||= import('../../vendor/mermaid/mermaid.esm.min.mjs').then(m => m.default);
  const mermaid = await loading;
  const key = dark ? 'dark' : 'light';
  if (configured !== key) {
    mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme: 'base', themeVariables: { ...palette(dark), fontFamily: FONT, fontSize: '14px' }, fontFamily: FONT, flowchart: { curve: 'basis', padding: 12 }, suppressErrorRendering: true });
    configured = key;
  }
  return mermaid;
}

// Renders one diagram source to an SVG string (serialized: Mermaid keeps global state).
export function renderMermaid(source, { dark = isDark() } = {}) {
  const key = (dark ? 'd:' : 'l:') + source;
  if (cache.has(key)) return cache.get(key);
  const job = queue.then(async () => {
    const mermaid = await mermaidFor(dark);
    const id = 'qingye-mermaid-' + (++counter);
    // Render inside a fixed, off-screen host: Mermaid's temporary element would otherwise be appended
    // to <body> and push the flex layout down for the duration of the render (visible on theme changes).
    let host = document.getElementById('qingyeMermaidHost');
    if (!host) { host = document.createElement('div'); host.id = 'qingyeMermaidHost'; host.setAttribute('aria-hidden', 'true'); host.style.cssText = 'position:fixed;left:-20000px;top:0;width:1600px;visibility:hidden;pointer-events:none;contain:layout'; document.body.append(host); }
    try { return (await mermaid.render(id, source, host)).svg; }
    finally { document.getElementById(id)?.remove(); document.getElementById('d' + id)?.remove(); }
  });
  queue = job.catch(() => {});
  cache.set(key, job);
  job.catch(() => cache.delete(key));
  if (cache.size > 200) cache.delete(cache.keys().next().value);
  return job;
}

// Wide diagrams break out of the text column to the full editor width and shrink to fit,
// like Typora; "原始大小" shows them at 100 % with horizontal scrolling.
export function fit(view) {
  const svg = view.querySelector('svg'), box = view.closest('.mdMermaid');
  if (!svg || !box) return;
  const natural = svg.viewBox?.baseVal?.width || parseFloat(svg.style.maxWidth) || 0;
  svg.removeAttribute('height'); svg.style.maxWidth = 'none'; svg.style.height = 'auto';
  view.style.marginLeft = ''; view.style.width = '';
  const column = box.clientWidth, scroller = box.closest('.mdScroll');
  let available = column;
  if (natural > column && scroller && !box.closest('.mdPrintStaging')) {
    const gutter = 28, s = scroller.getBoundingClientRect(), b = box.getBoundingClientRect();
    const width = scroller.clientWidth - gutter * 2, shift = Math.max(0, b.left - s.left - gutter);
    if (width > column) { view.style.marginLeft = -shift + 'px'; view.style.width = width + 'px'; available = width; }
  }
  if (!natural || !available) { svg.style.width = '100%'; return; }
  const actual = box.dataset.zoom === 'actual';
  const scale = actual ? 1 : Math.min(1, Math.max(available / natural, 0.25));
  svg.style.width = natural * scale + 'px';
  view.classList.toggle('isWide', natural * scale > available + 1);
  const zoom = box.querySelector('.mdZoom');
  if (zoom) { zoom.hidden = natural <= available; zoom.textContent = actual ? '适应宽度' : '原始大小'; zoom.dataset.icon = actual ? 'compress' : 'fullscreen'; }
}

export async function renderDiagrams(root, options = {}) {
  const jobs = [...root.querySelectorAll('.mdMermaid')].map(async box => {
    const source = box.querySelector('.mdMermaidSource code')?.textContent ?? '';
    const dark = options.dark ?? isDark();
    if (box.dataset.state === 'done' && box.dataset.theme === (dark ? 'dark' : 'light')) return;
    const view = box.querySelector('.mdMermaidView') || box.appendChild(Object.assign(document.createElement('div'), { className: 'mdMermaidView' }));
    const ticket = String(++counter);
    box.dataset.ticket = ticket;
    box.dataset.state = box.dataset.state === 'done' ? 'done' : 'loading';
    try {
      let svg;
      if (box.dataset.kind) {
        try { svg = await renderLegacySvg(box.dataset.kind, source, { dark }); }
        catch { svg = await renderMermaid(legacyToMermaid(box.dataset.kind, source), { dark }); }
      } else svg = await renderMermaid(source, { dark });
      if (box.dataset.ticket !== ticket) return;
      view.innerHTML = svg;
      view.setAttribute('role', 'img');
      view.setAttribute('aria-label', box.dataset.kind === 'sequence' ? '序列图' : box.dataset.kind === 'flow' ? '流程图' : 'Mermaid 图表');
      box.dataset.state = 'done'; box.dataset.theme = dark ? 'dark' : 'light';
      box.querySelector('.mdMermaidError')?.remove();
      if (options.fit !== false) requestAnimationFrame(() => fit(view));
    } catch (error) {
      if (box.dataset.ticket !== ticket) return;
      view.replaceChildren();
      box.dataset.state = 'error';
      let note = box.querySelector('.mdMermaidError');
      if (!note) { note = document.createElement('p'); note.className = 'mdMermaidError'; box.insertBefore(note, box.querySelector('.mdMermaidSource')); }
      note.textContent = '图表语法有误：' + String(error?.message || error).split('\n').filter(Boolean).slice(0, 3).join(' ');
    }
  });
  await Promise.all(jobs);
}

// Re-render visible diagrams when the app theme changes, and refit on resize.
new MutationObserver(() => {
  for (const box of document.querySelectorAll('.mdMermaid[data-state="done"]')) {
    const root = box.closest('.mdRendered, .mdLivePreview');
    if (root) renderDiagrams(root);
  }
}).observe(document.body, { attributes: true, attributeFilter: ['class'] });
let resizeTimer;
window.addEventListener('resize', () => { clearTimeout(resizeTimer); resizeTimer = setTimeout(() => { for (const view of document.querySelectorAll('.mdMermaid[data-state="done"] .mdMermaidView')) fit(view); }, 150); });
