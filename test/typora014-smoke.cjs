// 0.14 editor behaviour in the real renderer: Typora-style inline marker reveal and the editing
// conveniences added in this release.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');

exports.run = async ({ window, openFiles, output }) => {
  const run = code => window.webContents.executeJavaScript(code, true).catch(error => { console.error('Failed renderer script:', code); throw error; });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async code => { for (let n = 0; n < 80; n++) { if (await run(code)) return; await wait(100); } throw new Error('Timed out: ' + code); };
  const dir = path.join(output, 'typora014');
  await fs.mkdir(dir, { recursive: true });
  const file = path.join(dir, 'reveal.md');
  await fs.writeFile(file, '前文 **粗体** 中间 [链接](https://example.invalid/x) 和 `code` 后文\n');
  const opened = await openFiles([file]), id = opened[0].id;
  await run(`qingye.addDocuments(${JSON.stringify(opened)})`);
  const S = `qingye.sessions.get(${JSON.stringify(id)})`;
  await until(`${S}?.loaded`);
  const result = {};
  // Visible text of the active block (display:none markers excluded) plus which constructs are open.
  const probe = pos => run(`(async () => {
    const ed = ${S}.editor; ed.activateAt(${pos}); await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const el = ed.active.el, visible = [...el.querySelectorAll('*')].length && (() => { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let t = ''; for (let n; (n = w.nextNode());) if (n.parentElement.checkVisibility()) t += n.data; return t; })();
    return { visible, open: [...el.querySelectorAll('.isOpen')].map(e => e.className.split(' ')[0]), caret: ed.getCaret(), text: el.textContent };
  })()`);
  const start = await probe(1);
  assert.equal(start.text, '前文 **粗体** 中间 [链接](https://example.invalid/x) 和 `code` 后文', 'DOM text is still the exact source');
  assert.equal(start.visible, '前文 粗体 中间 链接 和 code 后文', 'markers hidden away from the caret');
  assert.deepEqual(start.open, []);
  const inBold = await probe(6);
  assert.deepEqual(inBold.open, ['sx-strong']); assert.equal(inBold.visible, '前文 **粗体** 中间 链接 和 code 后文');
  assert.deepEqual(inBold.caret, { start: 6, end: 6 });
  await fs.writeFile(path.join(dir, 'reveal-bold.png'), (await window.webContents.capturePage()).toPNG());
  const inLink = await probe(15);
  assert.deepEqual(inLink.open, ['sx-link']); assert.match(inLink.visible, /\[链接\]\(https:\/\/example\.invalid\/x\)/);
  // Typing inside a revealed construct edits the right offset.
  await run(`(() => { const ed = ${S}.editor; ed.activateAt(6); document.execCommand('insertText', false, '新'); ed.syncFromDom(true); })()`);
  assert.equal(await run(`${S}.editor.text`), '前文 **粗新体** 中间 [链接](https://example.invalid/x) 和 `code` 后文\n');
  result.reveal = true;

  // Copy / cut with no selection takes the whole line; smart input; Ctrl + wheel zoom.
  result.conveniences = await run(`(async () => {
    const s = ${S}, ed = s.editor;
    ed.replaceAll('第一行\\n第二行\\n第三行\\n'); ed.activateAt(5);
    const clip = type => { const data = new DataTransfer(); ed.active.el.dispatchEvent(new ClipboardEvent(type, { clipboardData: data, bubbles: true, cancelable: true })); return data.getData('text/plain'); };
    const copied = clip('copy'); const cut = clip('cut'); const afterCut = ed.text;
    ed.prefs.smartInput = true;
    ed.replaceAll('他说 a'); ed.activateAt(3);
    const key = k => ed.active.el.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, cancelable: true }));
    ed.replaceAll('x -'); ed.activateAt(3); key('-'); const enDash = ed.text; key('-'); const emDash = ed.text;
    ed.replaceAll('-'); ed.activateAt(1); key('-'); const structural = ed.text;
    ed.prefs.smartInput = false;
    ed.replaceAll('他说 a'); ed.activateAt(3); const quotes = (() => { ed.prefs.smartInput = true; key('"'); ed.activateAt(ed.text.length); key('"'); ed.prefs.smartInput = false; return ed.text; })();
    const zoom = ed.prefs.zoom; ed.active.el.dispatchEvent(new WheelEvent('wheel', { deltaY: -100, ctrlKey: true, bubbles: true, cancelable: true }));
    const zoomed = ed.prefs.zoom; ed.active.el.dispatchEvent(new WheelEvent('wheel', { deltaY: 100, ctrlKey: true, bubbles: true, cancelable: true }));
    return { copied, cut, afterCut, quotes, enDash, emDash, structural, zoomUp: Math.round((zoomed - zoom) * 100), zoomBack: ed.prefs.zoom === zoom };
  })()`);
  assert.equal(result.conveniences.copied, '第二行\n'); assert.equal(result.conveniences.cut, '第二行\n');
  assert.equal(result.conveniences.afterCut, '第一行\n第三行\n');
  assert.equal(result.conveniences.quotes, '他说 “a”');
  assert.equal(result.conveniences.enDash, 'x –'); assert.equal(result.conveniences.emDash, 'x —');
  assert.equal(result.conveniences.structural, '-', 'a rule / list marker line is not converted');
  assert.equal(result.conveniences.zoomUp, 10); assert.ok(result.conveniences.zoomBack);

  // Large document timings (measured, reported; budgets are generous to stay stable on CI).
  const sample = await fs.readFile(path.join(__dirname, '../ui/markdown/sample.md'), 'utf8');
  let big = ''; while (big.length < 1024 * 1024) big += sample + '\n\n';
  const bigFile = path.join(dir, 'big.md'); await fs.writeFile(bigFile, big);
  const t0 = Date.now();
  const bigOpened = await openFiles([bigFile]);
  await run(`qingye.addDocuments(${JSON.stringify(bigOpened)})`);
  const B = `qingye.sessions.get(${JSON.stringify(bigOpened[0].id)})`;
  await until(`${B}?.loaded`);
  result.large = { bytes: big.length, openMs: Date.now() - t0, ...(await run(`(async () => {
    const ed = ${B}.editor, frame = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
    const time = async fn => { const t = performance.now(); fn(); await frame(); return Math.round(performance.now() - t); };
    const mid = Math.floor(ed.text.length / 2), at = ed.text.indexOf('\\n\\n', mid) - 5;
    const activate = await time(() => ed.activateAt(at));
    const type = await time(() => { document.execCommand('insertText', false, '字'); ed.syncFromDom(); });
    const enter = await time(() => ed.handleEnter(false, false));
    const blocks = ed.blocks.length, nodes = ed.doc.querySelectorAll('*').length;
    // Breakdown of one keystroke once nearby blocks have rendered (diagnostic).
    ed.activateAt(at); await new Promise(r => setTimeout(r, 1500));
    const parts = {}; const wrap = (obj, name) => { const fn = obj[name]; obj[name] = function (...a) { const t = performance.now(); try { return fn.apply(this, a); } finally { parts[name] = Math.round((parts[name] || 0) + performance.now() - t); obj[name] = fn; } }; };
    wrap(ed, 'applyRaw'); wrap(ed, 'paint'); wrap(ed, 'schedulePreview'); const onChange = ed.options.onChange; ed.options.onChange = () => { const t = performance.now(); onChange(); parts.onChange = Math.round(performance.now() - t); };
    const onSel = ed.options.onSelection; ed.options.onSelection = () => { const t = performance.now(); onSel(); parts.onSelection = Math.round((parts.onSelection || 0) + performance.now() - t); };
    const t1 = performance.now(); document.execCommand('insertText', false, '字'); parts.execCommand = Math.round(performance.now() - t1);
    const t2 = performance.now(); ed.syncFromDom(); parts.sync = Math.round(performance.now() - t2);
    await frame(); parts.total = Math.round(performance.now() - t1);
    ed.options.onChange = onChange; ed.options.onSelection = onSel;
    // Breakdown of one structural edit (Enter).
    await new Promise(r => setTimeout(r, 500));
    const { analyze } = await import('./markdown/parser.mjs');
    let t = performance.now(); analyze(ed.text); parts.analyze = Math.round(performance.now() - t);
    const rec = ed.reconcile; ed.reconcile = function () { const s = performance.now(); try { return rec.call(this); } finally { parts.reconcile = Math.round(performance.now() - s); ed.reconcile = rec; } };
    t = performance.now(); ed.handleEnter(false, false); parts.enterJs = Math.round(performance.now() - t);
    await frame(); parts.enterTotal = Math.round(performance.now() - t);
    window.__keystroke = parts;
    return { blocks, domNodes: nodes, activateMs: activate, typeMs: type, enterMs: enter, keystroke: window.__keystroke };
  })()`)) };
  console.log('LARGE DOCUMENT', JSON.stringify(result.large));
  // Regression budgets for a 1 MB document (0.13 did not finish opening it within 7 minutes).
  assert.ok(result.large.openMs < 15000, 'opens a 1 MB document');
  assert.ok(result.large.domNodes < 80000, 'off-screen blocks stay as placeholders');
  assert.ok(result.large.keystroke.total < 1000 && result.large.keystroke.enterTotal < 4000, JSON.stringify(result.large.keystroke));
  await run(`qingye.closeTab?.(${JSON.stringify(bigOpened[0].id)}, { force: true })`).catch(() => {});
  return result;
};
