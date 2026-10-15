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
  return result;
};
