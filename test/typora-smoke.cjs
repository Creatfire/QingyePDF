// Exercises visible controls and the real preload/IPC paths against disposable test files.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { dialog, Menu } = require('electron');

exports.run = async ({ window, openFiles, output }) => {
  const run = code => window.webContents.executeJavaScript(code, true).catch(error => { console.error('Failed renderer script:', code); throw error; });
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async code => { for (let n = 0; n < 80; n++) { if (await run(code)) return; await wait(100); } throw new Error('Timed out: ' + code); };
  const dir = path.join(output, 'typora');
  await fs.mkdir(dir, { recursive: true });
  const source = '# Feature verification\n\nEditable paragraph.\n\n| Name | Value |\n| --- | --- |\n| First | 1 |\n\n<img src="icon.png" width="64">\n\n```sequence\nAlice->Bob: Request\nNote right of Bob: Processing\nBob-->Alice: Response\n```\n\n```flow\nst=>start: Begin\nop=>operation: Work\ne=>end: End\nst->op->e\n```\n\n```mermaid\nflowchart LR\nA[Input] --> B[Output]\n```\n';
  const file = path.join(dir, 'features.md');
  await fs.writeFile(file, source);
  await fs.copyFile(path.join(__dirname, '../ui/icon.png'), path.join(dir, 'icon.png'));
  const opened = await openFiles([file]), id = opened[0].id;
  await run(`qingye.addDocuments(${JSON.stringify(opened)})`);
  const S = `qingye.sessions.get(${JSON.stringify(id)})`;
  await until(`${S}?.loaded && ${S}.ui.panel.querySelectorAll('.mdMermaid[data-state="done"]').length === 3`);
  const result = {}, save = dialog.showSaveDialog, message = dialog.showMessageBox;
  const key = async (keyCode, modifiers = []) => {
    window.focus(); await run(`${S}.editor.focus()`);
    window.webContents.sendInputEvent({ type: 'keyDown', keyCode, modifiers });
    window.webContents.sendInputEvent({ type: 'keyUp', keyCode, modifiers });
    await wait(100);
  };
  const escape = () => run(`document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', code: 'Escape', bubbles: true }))`);
  try {
    result.menus = await run(`(() => { const tops = [...${S}.ui.menubar.querySelectorAll('.mdMenuTop')]; return tops.map(b => { b.click(); const open = b.getAttribute('aria-expanded') === 'true' && !!document.querySelector('[role="menu"]'); b.click(); return { name: b.textContent, open }; }); })()`);
    assert.deepEqual(result.menus.map(x => x.name), ['文件', '编辑', '段落', '格式', '视图', '主题', '帮助']);
    assert.ok(result.menus.every(x => x.open));
    await key('P', ['control', 'shift']);
    await until(`!!document.querySelector('.mdModal')`); result.commandPalette = true;
    await fs.writeFile(path.join(dir, 'command-palette.png'), (await window.webContents.capturePage()).toPNG());
    await escape();
    await key('P', ['control']);
    await until(`!!document.querySelector('.mdModal')`); result.quickOpen = true;
    await escape();
    await key('F8'); assert.equal(await run(`${S}.editor.focusMode`), true);
    await key('F8'); assert.equal(await run(`${S}.editor.focusMode`), false);
    await key('F9'); assert.equal(await run(`${S}.editor.typewriter`), true);
    await key('F9'); assert.equal(await run(`${S}.editor.typewriter`), false); result.modes = true;
    result.sidebar = await run(`(() => { const s = ${S}; return [...s.ui.sideTabs.querySelectorAll('button[data-tab]')].map(b => { b.click(); return { tab: b.dataset.tab, selected: b.getAttribute('aria-selected'), visible: !s.ui.outline.querySelector('[data-pane="' + b.dataset.tab + '"]').hidden }; }); })()`);
    assert.equal(result.sidebar.length, 2); assert.ok(result.sidebar.every(x => x.selected === 'true' && x.visible));
    // 0.8: a Markdown tab has its own chrome — no PDF toolbar, no global status line, three view modes.
    result.chrome = await run(`(() => { const s = ${S}; const shown = el => !!el && getComputedStyle(el).display !== 'none'; return { mode: document.body.dataset.mode, pdfToolbar: shown(document.getElementById('pdfToolbar')), globalStatus: shown(document.querySelector('body > .status')), statusBar: shown(s.ui.panel.querySelector('.mdStatusBar')), modes: [...s.ui.modes.querySelectorAll('button')].map(b => b.dataset.mode) }; })()`);
    assert.deepEqual(result.chrome, { mode: 'md', pdfToolbar: false, globalStatus: false, statusBar: true, modes: ['read', 'live', 'source'] });
    result.viewModes = await run(`(() => { const s = ${S}, out = []; for (const m of ['read', 'source', 'live']) { s.ui.modes.querySelector('[data-mode="' + m + '"]').click(); out.push([m, !!s.readonly, s.editor.sourceMode, s.ui.modes.querySelector('[aria-pressed="true"]').dataset.mode]); } return out; })()`);
    assert.deepEqual(result.viewModes, [['read', true, false, 'read'], ['source', false, true, 'source'], ['live', false, false, 'live']]);
    await run(`qingye.markdown.command(${S}, 'shortcutsHelp')`);
    await until(`!!document.querySelector('.mdKeyFilter')`);
    await run(`(() => { const filter = document.querySelector('.mdKeyFilter'); filter.value = 'focusMode'; filter.dispatchEvent(new Event('input')); const input = document.querySelector('.mdKeyRow input'); input.dispatchEvent(new KeyboardEvent('keydown', { key: 'F7', code: 'F7', ctrlKey: true, bubbles: true })); })()`);
    assert.equal(await run(`qingye.markdown.typora.prefs.get('shortcuts').focusMode`), 'Ctrl+F7');
    await escape(); await key('F7', ['control']); assert.equal(await run(`${S}.editor.focusMode`), true);
    await key('F7', ['control']);
    await run(`qingye.markdown.typora.prefs.setShortcut('focusMode', null)`); result.shortcutEditing = true;
    await run(`${S}.editor.activateAt(${S}.editor.text.indexOf('First'))`);
    await until(`!document.querySelector('.mdTableBar').hidden`); result.tableBar = true;
    await run(`${S}.editor.deactivate(); ${S}.ui.panel.querySelector('.mdDoc img').click()`);
    await until(`!document.querySelector('.mdImageBar').hidden`); result.imageBar = true;
    await run(`qingye.markdown.typora.hideImageBar(); ${S}.editor.deactivate()`);
    const tree = await run(`desktop.mdOpenFolder(${JSON.stringify(id)})`);
    assert.ok(JSON.stringify(tree).includes('features.md')); result.folderTree = true;
    await run(`${S}.editor.apply([{ from: 0, to: 0, insert: 'History snapshot\\n\\n' }], null, { activate: false }); qingye.saveSession(${S}, false)`);
    const versions = await run(`desktop.mdHistory(${JSON.stringify(id)})`);
    assert.ok(versions.length > 0);
    const historical = await run(`desktop.mdHistoryRead(${JSON.stringify(id)}, ${JSON.stringify(versions[0].name)})`);
    assert.ok(typeof historical === 'string' && historical.length > 0); result.history = true;
    window.show(); await wait(100);
    assert.equal(await run('desktop.alwaysOnTop(true)'), true); assert.equal(window.isAlwaysOnTop(), true);
    assert.equal(await run('desktop.alwaysOnTop(false)'), false); result.alwaysOnTop = true;
    const copies = await run(`desktop.mdFileOp({id:${JSON.stringify(id)}}, 'duplicate')`);
    const copy = copies[0]; assert.ok(copy.path !== file); assert.equal(await fs.readFile(copy.path, 'utf8'), await fs.readFile(file, 'utf8'));
    const renamed = await run(`desktop.mdFileOp({id:${JSON.stringify(copy.id)}}, 'rename', 'renamed-${Date.now()}.md')`);
    await fs.access(renamed.path);
    const moved = path.join(dir, `moved-${Date.now()}.md`);
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: moved });
    assert.equal((await run(`desktop.mdFileOp({id:${JSON.stringify(copy.id)}}, 'move')`)).path, moved);
    await fs.access(moved);
    dialog.showMessageBox = async () => ({ response: 0 });
    assert.equal((await run(`desktop.mdFileOp({id:${JSON.stringify(copy.id)}}, 'trash')`)).trashed, true);
    assert.equal(await fs.stat(moved).then(() => true, () => false), false); result.fileOperations = true;
    const pandoc = await run(`desktop.mdPandocInfo('')`);
    result.pandocInstalled = pandoc.found;
    if (!pandoc.found) {
      for (const call of [`desktop.mdPandocImport('')`, `desktop.mdPandocExport(${JSON.stringify(id)}, 'odt', 'test', '')`]) {
        const error = await run(`(${call}).then(() => '', e => e.message)`);
        assert.match(error, /未找到 Pandoc/);
      }
      result.pandocMissingMessage = true;
    }
    result.exports = {};
    for (const format of ['html', 'docx', 'epub', 'rtf', 'latex', 'pdf', 'image']) {
      const target = path.join(dir, 'export-' + format);
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
      const saved = await run(`(async () => {
        const { buildExport } = await import('./markdown/export.mjs');
        const s = ${S}; const value = await buildExport(${JSON.stringify(format)}, { text: s.editor.text, name: s.name, resolveAsset: src => desktop.markdownAsset(s.id, src) });
        if (value.kind === 'pdf') return desktop.mdExportPdf(s.id, value.html, { pageSize: 'A4' });
        if (value.kind === 'image') return desktop.mdExportImage(s.id, value.html, { width: 940 });
        return desktop.mdExportSave(s.id, value.ext, value.data);
      })()`);
      const bytes = await fs.readFile(saved.path);
      assert.ok(bytes.length > 100);
      if (['docx', 'epub', 'latex'].includes(format)) assert.equal(bytes.subarray(0, 2).toString(), 'PK');
      if (format === 'pdf') assert.equal(bytes.subarray(0, 4).toString(), '%PDF');
      if (format === 'image') assert.equal(bytes.subarray(1, 4).toString(), 'PNG');
      result.exports[format] = { file: saved.path, bytes: bytes.length };
    }
    const server = require('node:http').createServer((_request, response) => { requests++; response.end('blocked-test'); });
    let requests = 0;
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    try {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(dir, 'offline-export.png') });
      const html = `<html><body><p>Offline export</p><img src="http://127.0.0.1:${server.address().port}/image.png"></body></html>`;
      await run(`desktop.mdExportImage(${JSON.stringify(id)}, ${JSON.stringify(html)})`);
      assert.equal(requests, 0, 'export window must block network'); result.exportNetworkBlocked = true;
    } finally { await new Promise(resolve => server.close(resolve)); }
    await run(`document.body.classList.add('dark'); ${S}.editor.scrollTop = 0`);
    await until(`${S}.ui.panel.querySelectorAll('.mdMermaid[data-theme="dark"]').length === 3`);
    await fs.writeFile(path.join(dir, 'editor-dark.png'), (await window.webContents.capturePage()).toPNG());
    await run(`document.body.classList.remove('dark')`);
    await until(`${S}.ui.panel.querySelectorAll('.mdMermaid[data-theme="light"]').length === 3`);
    await fs.writeFile(path.join(dir, 'editor-light.png'), (await window.webContents.capturePage()).toPNG());
    result.themeRedraw = true;
    // Verify the renderer leaves the context-menu event available to Chromium when spelling is on.
    result.spellContextAllowed = await run(`(() => { qingye.markdown.typora.prefs.set('spellcheck', true); const e = new MouseEvent('contextmenu', { bubbles: true, cancelable: true, button: 2, clientX: 400, clientY: 250 }); ${S}.editor.doc.dispatchEvent(e); return !e.defaultPrevented; })()`);
    assert.equal(result.spellContextAllowed, true);
    window.webContents.emit('context-menu', {}, { misspelledWord: 'mispeling', dictionarySuggestions: ['misspelling'] });
    await until(`[...document.querySelectorAll('[role="menuitem"]')].some(x => x.textContent.includes('misspelling'))`);
    result.spellSuggestionBridge = true;
    await escape();
    await run(`${S}.editor.replaceAll('mispeling '); ${S}.editor.activateAt(2); ${S}.editor.active.el.lang = 'en-US'`);
    window.webContents.focus();
    await run(`${S}.editor.active.el.scrollIntoView({block:'center'}); new Promise(resolve=>requestAnimationFrame(()=>requestAnimationFrame(resolve)))`);
    const point = await run(`(() => { const e = ${S}.editor.active.el, r = e.getBoundingClientRect(); const p = { x: Math.round(r.left + 18), y: Math.round(Math.max(0,r.top) + Math.min(r.height / 2,12)) }; const hit = document.elementFromPoint(p.x,p.y); if (!hit?.isContentEditable || !e.contains(hit)) throw new Error('Spelling target is not ready for native input'); return p; })()`);
    const popup = Menu.prototype.popup; let nativeMenus = 0;
    Menu.prototype.popup = function () { nativeMenus++; };
    try {
      const context = new Promise(resolve => {
        const timer = setTimeout(() => { window.webContents.removeListener('context-menu', listener); resolve(null); }, 3000);
        const listener = (_event, params) => { clearTimeout(timer); resolve({ word: params.misspelledWord, suggestions: params.dictionarySuggestions, editable: params.isEditable }); };
        window.webContents.once('context-menu', listener);
      });
      window.webContents.sendInputEvent({ type: 'mouseDown', button: 'right', clickCount: 1, ...point });
      window.webContents.sendInputEvent({ type: 'mouseUp', button: 'right', clickCount: 1, ...point });
      result.nativeSpelling = await context;
      assert.ok(result.nativeSpelling?.editable, 'real Chromium context-menu event');
      await wait(150); assert.equal(nativeMenus, 0, 'native menu must not cover Markdown suggestions');
      result.markdownContextMenuUnobstructed = true;
    } finally { Menu.prototype.popup = popup; }
    return result;
  } finally { dialog.showSaveDialog = save; dialog.showMessageBox = message; }
};
