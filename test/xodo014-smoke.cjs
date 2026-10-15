// 0.14 PDF annotation features in the real viewer: the text markup bar, single-letter shortcuts and
// undo of backend-written markup.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.run = async ({ window, app, openFiles, samplePdf, output }) => {
  await fs.mkdir(output, { recursive: true });
  window.webContents.on('console-message', (_event, ...args) => console.log('RENDERER', typeof args[0] === 'object' ? args[0].message : args[1]));
  const run = code => window.webContents.executeJavaScript(code, true).catch(error => { console.error('FAILED STEP', code.slice(0, 600)); throw error; });
  const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (code, label, tries = 300) => { for (let i = 0; i < tries; i++) { if (await run(code)) return; await pause(50); } throw new Error('0.14 smoke timed out: ' + label); };
  const report = { version: app.getVersion(), checks: {} };
  const pdf = path.join(output, 'markup.pdf');
  await fs.writeFile(pdf, samplePdf('Markup check 0.14', true));
  const opened = await openFiles([pdf]);
  await run(`qingye.addDocuments(${JSON.stringify(opened.map(d => ({ ...d, ...(d.bytes ? { bytes: Array.from(d.bytes) } : {}) })))})`);
  const P = `qingye.sessions.get(${JSON.stringify(opened[0].id)})`;
  await until(`${P}?.loaded`, 'document');
  await run(`qingye.activate(${JSON.stringify(opened[0].id)})`);
  const layer = `${P}.frame.contentDocument.querySelector('.page[data-page-number="1"] .textLayer span:not(:empty)')`;
  await until(`!!${layer}`, 'text layer');
  // Selects the first text run on page 1 and releases the mouse inside the viewer.
  const select = () => run(`(() => {
    const doc = ${P}.frame.contentDocument, span = ${layer}, range = doc.createRange();
    range.selectNodeContents(span); const sel = doc.getSelection(); sel.removeAllRanges(); sel.addRange(range);
    span.dispatchEvent(new PointerEvent('pointerup', { button: 0, bubbles: true }));
    return span.textContent;
  })()`);
  // Annotation count on page 1; -1 while the document is being replaced.
  const count = subtype => `(async () => { try { if (!${P}.loaded || ${P}.editBusy) return -1; const page = await ${P}.app.pdfDocument.getPage(1); return (await page.getAnnotations()).filter(a => a.subtype === ${JSON.stringify(subtype)}).length; } catch { return -1; } })()`;
  const annotations = subtype => run(count(subtype));

  report.checks.selected = await select();
  await until(`!document.querySelector('.markupBar').hidden`, 'markup bar shown');
  report.checks.barButtons = await run(`[...document.querySelectorAll('.markupBar button')].map(b => b.dataset.kind)`);
  assert.deepEqual(report.checks.barButtons, ['highlight', 'underline', 'strikeout', 'squiggly', 'copy']);
  // The bar sits next to the selection, inside the window.
  report.checks.barPlacement = await run(`(() => {
    const bar = document.querySelector('.markupBar').getBoundingClientRect(), frame = ${P}.frame.getBoundingClientRect();
    const sel = ${P}.frame.contentDocument.getSelection().getRangeAt(0).getBoundingClientRect();
    return { bar: [bar.left, bar.top, bar.width, bar.height].map(Math.round), selection: [sel.left + frame.left, sel.bottom + frame.top].map(Math.round), viewport: [innerWidth, innerHeight] };
  })()`);
  const { bar, selection, viewport } = report.checks.barPlacement;
  assert.ok(bar[2] > 100 && bar[3] > 20 && bar[0] >= 0 && bar[1] >= 0 && bar[0] + bar[2] <= viewport[0] && bar[1] + bar[3] <= viewport[1], JSON.stringify(report.checks.barPlacement));
  assert.ok(Math.abs(bar[1] - selection[1]) < 60, 'bar is right below the selection ' + JSON.stringify(report.checks.barPlacement));
  await pause(300); await fs.writeFile(path.join(output, 'markup-bar.png'), (await window.webContents.capturePage()).toPNG());
  await run(`document.querySelector('.markupBar [data-kind="underline"]').click()`);
  await until(`(${count('Underline')}).then(n => n === 1)`, 'underline written');
  assert.equal(await annotations('Underline'), 1);
  assert.equal(await run(`document.querySelector('.markupBar').hidden`), true);
  report.checks.underline = true;

  // Undo removes it through the normal edit history.
  await until(`!${P}.editBusy && !document.getElementById('undoButton').disabled`, 'undo available');
  await run(`document.getElementById('undoButton').click()`);
  await until(`(${count('Underline')}).then(n => n === 0)`, 'underline undone');
  report.checks.undo = true;

  // Single-letter shortcut on a selection: S = strikeout.
  await until(`!${P}.editBusy && !!${layer}`, 'ready after undo');
  await select();
  await run(`${P}.frame.contentDocument.body.dispatchEvent(new KeyboardEvent('keydown', { key: 's', bubbles: true, cancelable: true }))`);
  await until(`(${count('StrikeOut')}).then(n => n === 1)`, 'strikeout via shortcut');
  report.checks.shortcut = true;
  // Without a selection, I switches to the ink tool and P leaves annotation mode.
  await until(`!${P}.editBusy`, 'idle');
  await run(`${P}.frame.contentDocument.getSelection().removeAllRanges(); ${P}.frame.contentDocument.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'i', bubbles: true, cancelable: true }))`);
  await until(`${P}.app.pdfViewer.annotationEditorMode === 15`, 'ink tool');
  await run(`${P}.frame.contentDocument.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'p', bubbles: true, cancelable: true }))`);
  await until(`${P}.app.pdfViewer.annotationEditorMode <= 0`, 'left annotation mode');
  report.checks.toolKeys = true;

  // Redaction by content in the toolbox: find, confirm hits, apply to the open document.
  await until(`!${P}.editBusy`, 'idle before redaction');
  await run(`qingye.tools.open('redact')`);
  await until(`document.getElementById('toolsDialog').open && document.getElementById('toolAction').value === 'redact'`, 'toolbox open');
  await run(`document.getElementById('redactTerms').value = 'open-source'; document.getElementById('redactFind').click()`);
  await until(`document.querySelectorAll('#redactHits .redactHit').length > 0`, 'redaction hits listed');
  report.checks.redactHits = await run(`[...document.querySelectorAll('#redactHits .redactHit span')].map(s => s.textContent)`);
  assert.deepEqual(report.checks.redactHits, ['open-source']);
  await until(`document.querySelectorAll('#toolCanvasWrap .toolHit').length === 1`, 'hit drawn on preview');
  await pause(200); await fs.writeFile(path.join(output, 'redact-find.png'), (await window.webContents.capturePage()).toPNG());
  await run(`document.getElementById('applyToolDraft').click()`);
  await until(`(async () => { try { if (${P}.editBusy || !${P}.loaded) return false; const page = await ${P}.app.pdfDocument.getPage(1); const text = (await page.getTextContent()).items.map(i => i.str).join(' '); return !text.includes('open-source') && text.includes('An'); } catch { return false; } })()`, 'redacted text removed');
  report.checks.redactApplied = true;
  // Page numbers with Bates numbering on even pages only, applied to the open document.
  await until(`!${P}.editBusy`, 'idle before numbering');
  await run(`(async () => { const a = document.getElementById('toolAction'); a.value = 'number'; a.dispatchEvent(new Event('change')); })()`);
  await until(`!document.querySelector('.stampVars').hidden && !document.getElementById('toolSubset').closest('[data-for]').hidden`, 'numbering fields');
  await run(`(() => { const $ = id => document.getElementById(id); $('toolPages').value = ''; $('toolText').value = ''; document.querySelector('.stampVarButtons [data-var="{bates}"]').click(); $('toolSubset').value = 'even'; $('batesPrefix').value = 'QY-'; $('batesStart').value = '5'; $('batesDigits').value = '3'; })()`);
  report.checks.numberRequest = await run(`(() => { const t = document.getElementById('toolText').value; return t; })()`);
  assert.equal(report.checks.numberRequest, '{bates}');
  await run(`document.getElementById('applyToolDraft').click()`);
  await until(`(async () => { try { if (${P}.editBusy || !${P}.loaded) return false; const doc = ${P}.app.pdfDocument; const one = (await (await doc.getPage(1)).getTextContent()).items.map(i => i.str).join(' '), two = (await (await doc.getPage(2)).getTextContent()).items.map(i => i.str).join(' '); return two.includes('QY-005') && !one.includes('QY-'); } catch { return false; } })()`, 'Bates number on page 2 only');
  report.checks.bates = true;
  await run(`document.getElementById('toolsDialog').open && document.getElementById('closeTools').click()`);
  // Shapes: drag a rectangle (menu / API), then an arrow via the A key; both stay as live annotations.
  await until(`!${P}.editBusy`, 'idle before shapes');
  const drag = (x0, y0, x1, y1) => run(`(() => {
    const doc = ${P}.frame.contentDocument, page = doc.querySelector('.page[data-page-number="1"]'), box = page.querySelector('.canvasWrapper').getBoundingClientRect();
    const at = (x, y) => ({ clientX: box.left + box.width * x, clientY: box.top + box.height * y, button: 0, pointerId: 1, bubbles: true, cancelable: true });
    page.dispatchEvent(new PointerEvent('pointerdown', at(${x0}, ${y0})));
    doc.dispatchEvent(new PointerEvent('pointermove', at((${x0} + ${x1}) / 2, (${y0} + ${y1}) / 2)));
    doc.dispatchEvent(new PointerEvent('pointermove', at(${x1}, ${y1})));
    doc.dispatchEvent(new PointerEvent('pointerup', at(${x1}, ${y1})));
  })()`);
  assert.equal(await run(`qingye.shapes.start('rect')`), true);
  await until(`!document.querySelector('.shapeBar').hidden`, 'shape bar');
  await drag(0.55, 0.55, 0.85, 0.7);
  await until(`(${count('Square')}).then(n => n === 1)`, 'rectangle drawn');
  assert.equal(await run(`qingye.shapes.active()`), 'rect', 'tool stays active for the next shape');
  await until(`!${P}.editBusy`, 'idle after rectangle');
  await run(`${P}.frame.contentDocument.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'a', bubbles: true, cancelable: true }))`);
  assert.equal(await run(`qingye.shapes.active()`), 'arrow');
  await drag(0.1, 0.8, 0.5, 0.75);
  await until(`(${count('Line')}).then(n => n === 1)`, 'arrow drawn');
  await pause(200); await fs.writeFile(path.join(output, 'shapes.png'), (await window.webContents.capturePage()).toPNG());
  await run(`${P}.frame.contentDocument.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
  assert.equal(await run(`qingye.shapes.active()`), null);
  report.checks.shapes = true;

  // The annotation list can delete annotations written into the file.
  await until(`!${P}.editBusy`, 'idle before delete');
  await run(`qingye.navigation.show('comments')`);
  await until(`[...document.querySelectorAll('.annotationSelectRow')].some(r => r.textContent.includes('Square'))`, 'annotation list');
  await run(`(() => { const row = [...document.querySelectorAll('.annotationSelectRow')].find(r => r.textContent.includes('Square')); const box = row.querySelector('input'); box.checked = true; box.dispatchEvent(new Event('change')); document.getElementById('deleteAnnotations').click(); })()`);
  await until(`(${count('Square')}).then(n => n === 0)`, 'rectangle deleted');
  assert.equal(await annotations('Line'), 1, 'other annotations stay');
  report.checks.deleteAnnotation = true;
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  return report;
};
