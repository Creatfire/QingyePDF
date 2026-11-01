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
  await until(`[...document.querySelectorAll('.annotationSelectRow')].some(r => r.textContent.includes('矩形'))`, 'annotation list');
  await run(`(() => { const row = [...document.querySelectorAll('.annotationSelectRow')].find(r => r.textContent.includes('矩形')); const box = row.querySelector('input'); box.checked = true; box.dispatchEvent(new Event('change')); document.getElementById('deleteAnnotations').click(); })()`);
  await until(`(${count('Square')}).then(n => n === 0)`, 'rectangle deleted');
  assert.equal(await annotations('Line'), 1, 'other annotations stay');
  report.checks.deleteAnnotation = true;
  // 0.19: annotations in the file can be selected, moved, restyled and deleted.
  await until(`!${P}.editBusy`, 'idle before annotation editing');
  await run(`qingye.shapes.start('rect')`);
  await drag(0.2, 0.55, 0.45, 0.7);
  await until(`(${count('Square')}).then(n => n === 1)`, 'rectangle for editing');
  await run(`${P}.frame.contentDocument.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }))`);
  await until(`!${P}.editBusy && !qingye.shapes.active()`, 'shape tool closed');
  const squareRect = `(async () => { try { if (${P}.editBusy || !${P}.loaded) return null; const page = await ${P}.app.pdfDocument.getPage(1); const a = (await page.getAnnotations()).find(x => x.subtype === 'Square'); return a ? { rect: a.rect.map(Math.round), color: a.color ? [...a.color] : null } : null; } catch { return null; } })()`;
  const click = (x, y) => run(`(() => {
    const doc = ${P}.frame.contentDocument, page = doc.querySelector('.page[data-page-number="1"]'), box = page.querySelector('.canvasWrapper').getBoundingClientRect();
    const at = { clientX: box.left + box.width * ${x}, clientY: box.top + box.height * ${y}, button: 0, bubbles: true, cancelable: true };
    const target = doc.elementFromPoint(at.clientX, at.clientY) || page;
    target.dispatchEvent(new PointerEvent('pointerdown', at)); target.dispatchEvent(new PointerEvent('pointerup', at));
  })()`);
  const squareBefore = await run(squareRect);
  // The page is still redrawing after the shape edit, and a redraw clears the selection.
  await pause(1500);
  await click(0.32, 0.62);
  await until(`qingye.annotEdit.selected()?.kind === 'Square' && !document.querySelector('.annotEditBar').hidden`, 'rectangle selected');
  await pause(200); await fs.writeFile(path.join(output, 'annot-selected.png'), (await window.webContents.capturePage()).toPNG());
  // Drag the selection frame 10% to the right.
  await run(`(() => {
    const doc = ${P}.frame.contentDocument, frame = doc.querySelector('.qyAnnotSel'), r = frame.getBoundingClientRect(), page = doc.querySelector('.page[data-page-number="1"] .canvasWrapper').getBoundingClientRect();
    const x = r.left + r.width / 2, y = r.top + r.height / 2, dx = page.width * 0.1;
    frame.dispatchEvent(new PointerEvent('pointerdown', { clientX: x, clientY: y, button: 0, bubbles: true, cancelable: true }));
    doc.dispatchEvent(new PointerEvent('pointermove', { clientX: x + dx / 2, clientY: y, bubbles: true }));
    doc.dispatchEvent(new PointerEvent('pointermove', { clientX: x + dx, clientY: y, bubbles: true }));
    doc.dispatchEvent(new PointerEvent('pointerup', { clientX: x + dx, clientY: y, bubbles: true }));
  })()`);
  await until(`${squareRect}.then(v => !!v && v.rect[0] > ${squareBefore.rect[0]} + 20)`, 'rectangle moved');
  await until(`qingye.annotEdit.selected()?.kind === 'Square'`, 'still selected after the move');
  // Recolour from the bar.
  await run(`(() => { const c = document.querySelector('.annotEditBar [data-edit="color"]'); c.value = '#1565c0'; c.dispatchEvent(new Event('change', { bubbles: true })); })()`);
  await until(`${squareRect}.then(v => !!v && v.color && v.color[2] > 150 && v.color[0] < 60)`, 'rectangle recoloured');
  await until(`qingye.annotEdit.selected()?.kind === 'Square'`, 'selected after recolour');
  // Save the style as a preset: the shape tool shows it as a swatch.
  await run(`document.querySelector('.annotEditBar [data-edit="preset"]').click()`);
  await run(`qingye.shapes.start('rect')`);
  report.checks.presetSwatches = await run(`[...document.querySelectorAll('.shapeBar:not(.annotEditBar) .shapePreset')].map(b => b.style.getPropertyValue('--preset'))`);
  assert.equal(report.checks.presetSwatches[0], '#1565c0', 'newest preset first');
  await run(`qingye.shapes.stop()`);
  // Delete with the Delete key.
  await click(0.42, 0.62);
  await until(`qingye.annotEdit.selected()?.kind === 'Square'`, 'selected for deletion');
  await run(`${P}.frame.contentDocument.body.dispatchEvent(new KeyboardEvent('keydown', { key: 'Delete', bubbles: true, cancelable: true }))`);
  await until(`(${count('Square')}).then(n => n === 0)`, 'rectangle deleted with Delete');
  report.checks.annotEdit = true;

  // 0.19: side-by-side compare marks text differences and steps through them.
  {
    const a = path.join(output, 'compare-a.pdf'), b = path.join(output, 'compare-b.pdf');
    await fs.writeFile(a, samplePdf('Compare version 0.18', true)); await fs.writeFile(b, samplePdf('Compare version 0.19', true));
    const pair = await openFiles([a, b]);
    await run(`qingye.addDocuments(${JSON.stringify(pair.map(d => ({ ...d, bytes: Array.from(d.bytes) })))})`);
    const [A, B] = pair.map(d => `qingye.sessions.get(${JSON.stringify(d.id)})`);
    await until(`${A}?.loaded && ${B}?.loaded`, 'compare documents');
    await run(`qingye.compare(${JSON.stringify(pair[0].id)}, ${JSON.stringify(pair[1].id)})`);
    await until(`!document.getElementById('compareBar').hidden`, 'compare bar');
    await run(`document.getElementById('compareDiffRun').click()`);
    await until(`/共 \\d+ 处差异/.test(document.getElementById('compareDiffCount').textContent)`, 'differences counted');
    report.checks.compareCount = await run(`document.getElementById('compareDiffCount').textContent`);
    await run(`document.getElementById('compareDiffNext').click()`);
    await until(`document.getElementById('compareDiffCount').textContent.startsWith('第 1 /')`, 'first difference');
    await until(`!!${A}.frame.contentDocument.querySelector('.qyDiffMark.isRemoved.isCurrent') && !!${B}.frame.contentDocument.querySelector('.qyDiffMark.isAdded.isCurrent')`, 'current difference marked on both sides');
    report.checks.compareStatus = await run(`document.getElementById('statusText').textContent`);
    assert.match(report.checks.compareStatus, /删除：0\.18.*新增：0\.19|删除：18.*新增：19/);
    await pause(300); await fs.writeFile(path.join(output, 'compare-diff.png'), (await window.webContents.capturePage()).toPNG());
    await run(`document.getElementById('endCompare').click()`);
    assert.equal(await run(`!!${A}.frame.contentDocument.querySelector('.qyDiffMark')`), false, 'marks cleared when compare ends');
    report.checks.compareDiff = true;
    await run(`qingye.activate(${JSON.stringify(opened[0].id)})`);
  }

  // Smart crop: auto-crop page 1 to its content, applied to the open document.
  await until(`!${P}.editBusy`, 'idle before crop');
  const sizeExpr = `(async () => { try { if (${P}.editBusy || !${P}.loaded) return null; const v = (await ${P}.app.pdfDocument.getPage(1)).view; return [v[2] - v[0], v[3] - v[1]]; } catch { return null; } })()`;
  const before = await run(sizeExpr);
  await run(`qingye.tools.open('crop')`);
  await until(`document.getElementById('toolAction').value === 'crop' && !document.getElementById('toolCropMode').closest('[data-for]').hidden`, 'crop fields');
  await run(`(() => { const $ = id => document.getElementById(id); $('toolPages').value = '1'; $('toolSubset').value = 'all'; $('toolCropMode').value = 'auto'; $('toolCropMode').dispatchEvent(new Event('change')); $('applyToolDraft').click(); })()`);
  await until(`${sizeExpr}.then(v => !!v && v[0] < ${before[0]} - 20 && v[1] < ${before[1]} - 20)`, 'page cropped to content');
  report.checks.autoCrop = true;
  await run(`document.getElementById('toolsDialog').open && document.getElementById('closeTools').click()`);
  // Office files open as PDF through the bundled LibreOffice (0.15).
  const office = require('../office-convert.cjs');
  if (office.sofficePath({ packaged: app.isPackaged, resources: process.resourcesPath })) {
    const pandoc = require('../pandoc-engine.cjs'), md = path.join(output, 'office.md'), docx = path.join(output, '季度 报告.docx');
    await fs.writeFile(md, '# 季度报告\n\n中文正文与表格。\n\n| 项目 | 金额 |\n|---|---|\n| 收入 | 100 |\n');
    await pandoc.run(pandoc.bundledPath(), ['-o', docx, md]);
    const before = await fs.readFile(docx);
    // 0.19: a progress card shows the conversion stages and elapsed time while the file converts.
    const pendingOpen = openFiles([docx]);
    await until(`!!document.querySelector('.officeJob .officeJobName')?.textContent.includes('季度 报告.docx')`, 'office progress card');
    report.checks.officeStages = await run(`document.querySelector('.officeJob').dataset.stage`);
    const openedOffice = await pendingOpen;
    assert.equal(openedOffice.length, 1); assert.equal(openedOffice[0].name, '季度 报告.pdf'); assert.equal(openedOffice[0].path, null);
    await run(`qingye.addDocuments(${JSON.stringify(openedOffice.map(d => ({ ...d, bytes: Array.from(d.bytes) })))})`);
    const O = `qingye.sessions.get(${JSON.stringify(openedOffice[0].id)})`;
    await until(`${O}?.loaded`, 'converted document');
    report.checks.officeText = await run(`(async () => (await (await ${O}.app.pdfDocument.getPage(1)).getTextContent()).items.map(i => i.str).join(''))()`);
    // Text runs in the converted PDF come back in an order that depends on the fonts of the
    // converting machine (CI runners substitute CJK fonts and reorder fragments), so content is
    // asserted by character presence rather than by contiguous match.
    const officeHas = word => { const have = new Map(), need = new Map(); for (const ch of report.checks.officeText) have.set(ch, (have.get(ch) || 0) + 1); for (const ch of word) need.set(ch, (need.get(ch) || 0) + 1); return [...need].every(([ch, n]) => (have.get(ch) || 0) >= n); };
    assert.ok(officeHas('季度报告'), 'office text lacks 季度报告: ' + report.checks.officeText); assert.ok(officeHas('收入'), 'office text lacks 收入: ' + report.checks.officeText);
    const again = await openFiles([docx]);
    assert.equal(again[0].id, openedOffice[0].id, 'reopening focuses the existing PDF tab');
    assert.deepEqual(await fs.readFile(docx), before, 'the Word file is not modified');
    await pause(300); await fs.writeFile(path.join(output, 'office-as-pdf.png'), (await window.webContents.capturePage()).toPNG());
    await until(`![...document.querySelectorAll('.officeJob')].some(c => !['done'].includes(c.dataset.stage)) || !document.querySelector('.officeJob')`, 'card finishes');
    report.checks.officeAsPdf = true;

    // The home page lists the Word file in the recent list (Office filter, DOC badge, opens as PDF).
    report.checks.recentOffice = await run(`(async () => {
      qingye.activate(null); document.querySelector('.recentFilter [data-filter="office"]').click(); await new Promise(r => setTimeout(r, 50));
      const rows = [...document.querySelectorAll('#recent .recentRow')].map(r => ({ badge: r.querySelector('.recentIcon').textContent, kind: r.querySelector('.recentIcon').className, name: r.querySelector('.recentName').textContent, asPdf: !!r.querySelector('.recentAsPdf') }));
      document.querySelector('.recentFilter [data-filter="all"]').click();
      return { rows, tile: document.querySelector('#welcomeOpen strong').textContent };
    })()`);
    assert.deepEqual(report.checks.recentOffice.rows, [{ badge: 'DOC', kind: 'recentIcon word', name: '季度 报告.docx', asPdf: true }]);
    assert.equal(report.checks.recentOffice.tile, '打开');

    // Cancelling a conversion leaves no tab and no error dialog.
    const other = path.join(output, '另一份.docx');
    await fs.writeFile(md, '# 另一份\n\n' + '很长的段落。'.repeat(4000) + '\n');
    await pandoc.run(pandoc.bundledPath(), ['-o', other, md]);
    const canceledOpen = openFiles([other]);
    // Find the card by name instead of document order: on an occluded CI window the renderer's
    // removal timers are throttled, so older finished cards can linger ahead of this one.
    await until(`[...document.querySelectorAll('.officeJob')].some(c => c.querySelector('.officeJobName')?.textContent.includes('另一份') && !c.querySelector('.officeJobCancel')?.hidden)`, 'cancellable card');
    await pause(250); await fs.writeFile(path.join(output, 'office-progress.png'), (await window.webContents.capturePage()).toPNG());
    await run(`[...document.querySelectorAll('.officeJob')].find(c => c.textContent.includes('另一份')).querySelector('.officeJobCancel').click()`);
    assert.deepEqual(await canceledOpen, [], 'cancelled file opens nothing');
    await until(`[...document.querySelectorAll('.officeJob')].some(c => c.dataset.stage === 'canceled') || ![...document.querySelectorAll('.officeJob')].some(c => c.textContent.includes('另一份'))`, 'canceled card');
    report.checks.officeCancel = true;

    // Editing the original offers "convert again", which replaces the tab's PDF (undoable).
    await fs.writeFile(md, '# 季度报告（修订）\n\n新增的结论。\n');
    await pandoc.run(pandoc.bundledPath(), ['-o', docx, md]);
    await until(`!!document.querySelector('.officeNotice .officeNoticeActions .primary')`, 'source changed notice', 400);
    await run(`document.querySelector('.officeNotice .officeNoticeActions .primary').click()`);
    // Character presence, not a contiguous match: CI font substitution scrambles extracted run order.
    await until(`(async () => { try { if (${O}.editBusy || !${O}.loaded) return false; const text = (await (await ${O}.app.pdfDocument.getPage(1)).getTextContent()).items.map(i => i.str).join(''); return [...'新增的结论'].every(ch => text.includes(ch)); } catch { return false; } })()`, 'reconverted text');
    report.checks.officeReconvert = true;
  } else report.checks.officeAsPdf = 'skipped: LibreOffice not prepared';
  // Annotation panel (0.20): tag in the PDF, filter by tag, card ↔ page selection.
  await run(`qingye.activate(${JSON.stringify(opened[0].id)})`); await until(`!${P}.editBusy && ${P}.loaded`, 'markup document idle');
  await run(`qingye.navigation.show('comments')`);
  await until(`document.querySelectorAll('.annotCard').length > 0`, 'annotation cards');
  report.checks.annotPanel = await run(`(async () => {
    const wait = ms => new Promise(r => setTimeout(r, ms)), cards = () => [...document.querySelectorAll('.annotCard')];
    const total = cards().length, first = cards()[0], key = first.dataset.key;
    const box = first.querySelector('input'); box.checked = true; box.dispatchEvent(new Event('change'));
    const menu = document.querySelector('.annotTagMenu'); menu.value = '+重要结论'; menu.dispatchEvent(new Event('change'));
    for (let i = 0; i < 100 && !cards().some(c => c.querySelector('.annotTags')?.textContent.includes('重要结论')); i++) await wait(100);
    const tagged = cards().filter(c => c.querySelector('.annotTags')?.textContent.includes('重要结论')).length;
    const tagFilter = [...document.querySelectorAll('.annotFilters select')].find(s => s.getAttribute('aria-label') === '全部标签');
    tagFilter.value = '重要结论'; tagFilter.dispatchEvent(new Event('change')); const filtered = cards().length;
    tagFilter.value = ''; tagFilter.dispatchEvent(new Event('change'));
    const card = cards().find(c => c.querySelector('.annotCardHead').textContent.includes('直线')) || cards()[0];
    card.querySelector('.annotCardBody').click();
    for (let i = 0; i < 60 && !qingye.annotEdit.selected(); i++) await wait(50);
    const picked = qingye.annotEdit.selected(), current = document.querySelector('.annotCard.isCurrent')?.dataset.key;
    qingye.annotEdit.clear();
    return { total, tagged, filtered, selectedInPage: !!picked, cardHighlighted: current === (picked && picked.page + ':' + picked.xref) };
  })()`);
  assert.equal(report.checks.annotPanel.tagged, 1, 'one annotation tagged');
  assert.equal(report.checks.annotPanel.filtered, 1, 'tag filter shows it alone');
  assert.ok(report.checks.annotPanel.selectedInPage && report.checks.annotPanel.cardHighlighted, 'card and page selection follow each other');
  await fs.writeFile(path.join(output, 'annot-panel.png'), (await window.webContents.capturePage()).toPNG());
  await run(`qingye.navigation.close()`);
  // Visual page manager (0.20): rotate, copy, blank page, insert another PDF, drag to the end, apply
  // as one undoable edit.
  {
    const file = path.join(output, 'pages.pdf'); await fs.writeFile(file, samplePdf('Pages check'));
    const docs = await openFiles([file]);
    await run(`qingye.addDocuments(${JSON.stringify(docs.map(d => ({ ...d, ...(d.bytes ? { bytes: Array.from(d.bytes) } : {}) })))})`);
    const G = `qingye.sessions.get(${JSON.stringify(docs[0].id)})`;
    await until(`${G}?.loaded`, 'pages document'); await run(`qingye.activate(${JSON.stringify(docs[0].id)})`);
    const inserted = Array.from(samplePdf('Inserted page'));
    report.checks.pageManager = await run(`(async () => {
      const pm = qingye.pageManager, d = document.getElementById('pageManager'), q = s => d.querySelector(s), wait = ms => new Promise(r => setTimeout(r, ms));
      pm.open(${G}); await wait(300);
      const cards = () => [...d.querySelectorAll('.pmCard')];
      const first = cards().length;
      cards()[1].click(); q('#pmRotateRight').click(); q('#pmDuplicate').click(); q('#pmBlank').click();
      await pm.insertFiles([new File([new Uint8Array(${JSON.stringify(inserted)})], 'ins.pdf', { type: 'application/pdf' })], pm.plan.length);
      // Drag page 1 behind the last card.
      const dt = new DataTransfer(), source = cards()[0], target = cards().at(-1), box = target.getBoundingClientRect();
      source.click();
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, dataTransfer: dt }));
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: box.right - 4, clientY: box.top + 10 }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: box.right - 4, clientY: box.top + 10 }));
      await wait(400);
      const order = q('#pmOrder').textContent, labels = cards().map(c => c.querySelector('.pmLabel').textContent);
      return { first, labels, order, apply: !q('#pmApply').disabled };
    })()`);
    await pause(300); await fs.writeFile(path.join(output, 'page-manager.png'), (await window.webContents.capturePage()).toPNG());
    assert.equal(report.checks.pageManager.first, 2);
    assert.deepEqual(report.checks.pageManager.labels, ['第 2 页 · 90°', '第 2 页 · 90°', '空白页', 'ins.pdf · 第 1 页', 'ins.pdf · 第 2 页', '第 1 页']);
    assert.equal(report.checks.pageManager.order, '最终页序：2（旋转 90°）, 2（旋转 90°）, 空白页, ins.pdf 1–2, 1');
    await run(`document.getElementById('pmApply').click()`);
    await until(`!${G}.editBusy && ${G}.app.pagesCount === 6`, 'page plan applied', 400);
    report.checks.pageManagerApplied = await run(`(async () => {
      const doc = ${G}.app.pdfDocument, text = async n => (await (await doc.getPage(n)).getTextContent()).items.map(i => i.str).join(' ');
      return { p1: (await text(1)).includes('Chapter 2'), rotate: (await doc.getPage(1)).rotate, blank: !(await text(3)).trim(), p4: (await text(4)).includes('Inserted page'), p6: (await text(6)).includes('Pages check'), dirty: ${G}.dirty };
    })()`);
    assert.deepEqual(report.checks.pageManagerApplied, { p1: true, rotate: 90, blank: true, p4: true, p6: true, dirty: true });
    await run(`qingye.historyStep()`);
    await until(`!${G}.editBusy && ${G}.app.pagesCount === 2`, 'page plan undone', 400);
    report.checks.pageManagerUndo = true;

    // Task center (0.20): a second toolbox job waits in the queue; both end up in the task list.
    report.checks.taskQueue = await run(`(async () => {
      const wait = ms => new Promise(r => setTimeout(r, ms));
      await qingye.tools.open('export'); document.getElementById('toolFormat').value = 'txt';
      const before = qingye.taskCenter.tasks().length;
      const first = qingye.tools.execute(); await wait(20); await qingye.tools.execute();
      await first;
      for (let i = 0; i < 200 && qingye.taskCenter.tasks().some(t => t.status === 'running' || t.status === 'queued'); i++) await wait(100);
      document.getElementById('closeTools').click();
      const list = qingye.taskCenter.tasks().slice(0, qingye.taskCenter.tasks().length - before);
      return { added: list.length, done: list.filter(t => t.status === 'done').length, pill: document.getElementById('taskPill').textContent };
    })()`);
    assert.deepEqual({ added: report.checks.taskQueue.added, done: report.checks.taskQueue.done }, { added: 2, done: 2 }, 'queued toolbox job ran after the first');
    // A result that arrives after the document was edited again is not applied silently.
    report.checks.staleResult = await run(`(async () => {
      const s = ${G}, storage = s.app.pdfDocument.annotationStorage;
      const job = qingye.applyEdit(s, { action: 'pages-plan', plan: [{ src: 0, page: 1 }, { src: 0, page: 0 }] }, '测试：处理期间被修改', () => { storage.setValue('qy-stale-test', { value: 'edited meanwhile' }); return true; });
      const result = await job; storage.remove('qy-stale-test');
      const task = qingye.taskCenter.tasks().find(t => t.label === '测试：处理期间被修改');
      return { canceled: !!result.canceled, pages: s.app.pagesCount, task: task?.status, note: task?.note };
    })()`);
    assert.deepEqual(report.checks.staleResult, { canceled: true, pages: 2, task: 'canceled', note: '处理期间文档有新的修改，已放弃这次结果。' });
    await run(`qingye.taskCenter.open()`); await pause(200);
    await fs.writeFile(path.join(output, 'task-center.png'), (await window.webContents.capturePage()).toPNG());
    await run(`document.getElementById('taskPanel').hidePopover()`);
  }
  await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2));
  return report;
};
