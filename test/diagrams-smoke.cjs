// Real Electron renderer: local engines, both palettes, SVG rasterization and export payloads.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');

exports.run = async window => {
  assert.equal(await window.webContents.executeJavaScript(`document.querySelectorAll('script[src*="/vendor/diagrams/"]').length`), 0, 'engines load only when needed');
  const result = await window.webContents.executeJavaScript(`(async () => {
    const { md, sanitize } = await import('./markdown/parser.mjs');
    const { renderDiagrams, renderLegacySvg } = await import('./markdown/diagrams.mjs');
    const { svgToPng } = await import('./markdown/export-dom.mjs');
    const { buildExport } = await import('./markdown/export.mjs');
    const source = [
      '# Diagram check',
      '\\x60\\x60\\x60sequence', 'Alice->Bob: Hello', 'Bob-->Alice: Reply', '\\x60\\x60\\x60',
      '\\x60\\x60\\x60flow', 'st=>start: Begin', 'op=>operation: Work', 'e=>end: Done', 'st->op->e', '\\x60\\x60\\x60',
      '\\x60\\x60\\x60mermaid', 'flowchart LR', 'A-->B', '\\x60\\x60\\x60'
    ].join('\\n');
    const root = document.createElement('div');
    root.style.cssText = 'position:fixed;left:-100000px;top:0;width:900px';
    root.append(sanitize(md.render(source, { taskIndex: 0 })));
    document.body.append(root);
    const read = async dark => {
      await renderDiagrams(root, { dark, fit: false });
      const boxes = [...root.querySelectorAll('.mdMermaid')];
      const diagrams = await Promise.all(boxes.map(async box => {
        const svg = box.querySelector('svg');
        if (!svg) return { state: box.dataset.state, error: box.querySelector('.mdMermaidError')?.textContent };
        const png = await svgToPng(svg.outerHTML);
        const missingReferences = [...svg.querySelectorAll('*')].flatMap(el => [...el.attributes].flatMap(a => {
          const ids = a.name.endsWith('href') && a.value.startsWith('#') ? [a.value.slice(1)] : [...a.value.matchAll(/url\\(#([^)]*)\\)/g)].map(m => m[1]);
          return ids.filter(id => ![...svg.querySelectorAll('[id]')].some(node => node.id === id));
        }));
        return { state: box.dataset.state, viewBox: svg.getAttribute('viewBox'), png: png.bytes.length, missingReferences,
          textFill: svg.querySelector('text')?.getAttribute('fill') || '' };
      }));
      return diagrams;
    };
    try {
      const light = await read(false), dark = await read(true);
      const html = await buildExport('html', { text: source });
      const docx = await buildExport('docx', { text: source });
      const epub = await buildExport('epub', { text: source });
      const rtf = await buildExport('rtf', { text: source });
      const pdf = await buildExport('pdf', { text: source });
      const image = await buildExport('image', { text: source });
      const fallbackRoot = document.createElement('div');
      fallbackRoot.append(sanitize(md.render('\\x60\\x60\\x60sequence\\nA->B: fallback\\n\\x60\\x60\\x60')));
      const parse = window.Diagram.parse;
      try { window.Diagram.parse = () => { throw new Error('forced engine failure'); }; await renderDiagrams(fallbackRoot, { fit: false }); }
      finally { window.Diagram.parse = parse; }
      const fallback = fallbackRoot.querySelector('.mdMermaid').dataset.state;
      fallbackRoot.replaceChildren(sanitize(md.render('\\x60\\x60\\x60sequence\\ninvalid source\\n\\x60\\x60\\x60')));
      await renderDiagrams(fallbackRoot, { fit: false });
      const invalid = !!fallbackRoot.querySelector('.mdMermaid[data-state="error"] .mdMermaidError');
      const linked = await renderLegacySvg('flow', 'st=>start: Begin:>https://example.invalid\\ne=>end: End\\nst->e');
      return { light, dark, engines: { sequence: !!window.Diagram, flow: !!window.flowchart },
        fallback, invalid, externalLinksRemoved: !/https:\\/\\/example.invalid|<a[ >]/.test(linked),
        htmlSvg: (html.data.match(/<svg/g) || []).length, docxBytes: docx.data.length,
        epubBytes: epub.data.length, rtfImages: (rtf.data.match(/\\\\pict\\\\pngblip/g) || []).length,
        pdfSvg: (pdf.html.match(/<svg/g) || []).length, imageSvg: (image.html.match(/<svg/g) || []).length };
    } finally { root.remove(); }
  })().catch(error => { console.error(error.stack || error.message); throw error; })`, true);
  for (const [theme, diagrams] of [['light', result.light], ['dark', result.dark]]) {
    assert.equal(diagrams.length, 3, theme);
    for (const diagram of diagrams) {
      assert.equal(diagram.state, 'done', `${theme}: ${diagram.error || ''}`);
      assert.match(diagram.viewBox, /^-?[\d.]+ -?[\d.]+ [\d.]+ [\d.]+$/);
      assert.ok(diagram.png > 100, theme + ' rasterized');
      assert.deepEqual(diagram.missingReferences, [], theme + ' self-contained SVG');
    }
  }
  assert.deepEqual(result.engines, { sequence: true, flow: true }, 'used real local libraries');
  assert.equal(result.htmlSvg, 3); assert.equal(result.pdfSvg, 3); assert.equal(result.imageSvg, 3);
  assert.ok(result.docxBytes > 1000 && result.epubBytes > 1000);
  assert.equal(result.rtfImages, 3);
  assert.equal(result.fallback, 'done'); assert.equal(result.invalid, true); assert.equal(result.externalLinksRemoved, true);
  // Read the installed reference examples only as test inputs; do not redistribute Typora text.
  const docs = process.env.QINGYE_TYPORA_DOCS || require('node:path').join(process.env.LOCALAPPDATA || '', 'Programs/Typora/resources/Docs/Draw Diagrams With Markdown.md');
  const examples = await fs.readFile(docs, 'utf8').then(text => [...text.matchAll(/^```(sequence|flow|flowchart)[ \t]*\r?\n([\s\S]*?)^```/gm)].map(m => ({ kind: m[1] === 'flowchart' ? 'flow' : m[1], source: m[2] })), () => []);
  result.installedTyporaExamples = [];
  for (const example of examples) {
    const rendered = await window.webContents.executeJavaScript(`(async () => {
      const { renderLegacySvg } = await import('./markdown/diagrams.mjs');
      const { svgToPng } = await import('./markdown/export-dom.mjs');
      const example = ${JSON.stringify(example)};
      const svg = await renderLegacySvg(example.kind, example.source);
      const png = await svgToPng(svg);
      return { kind: example.kind, svg: svg.length, png: png.bytes.length };
    })()`, true);
    assert.ok(rendered.svg > 100 && rendered.png > 100); result.installedTyporaExamples.push(rendered);
  }
  return result;
};
