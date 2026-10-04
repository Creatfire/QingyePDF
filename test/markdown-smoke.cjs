// Markdown end-to-end check in the real Electron app (npm run smoke:markdown):
// open, render local images, byte-exact save (BOM + CRLF), editing, external change detection
// and reload, save conflict handling, Save As, crash-recovery drafts, pasted images, close prompt.
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { dialog } = require('electron');

const PNG = Buffer.from('89504e470d0a1a0a0000000d4948445200000001000000010806000000' + '1f15c4890000000d4944415478da63f8cfc0f01f0005000201a7b3d3a50000000049454e44ae426082', 'hex');

exports.run = async ({ window, openFiles, output, recoveryFolder }) => {
  window.webContents.on('console-message', event => { if (event.level === 'error') console.error('RENDERER:', event.message); });
  const run = code => window.webContents.executeJavaScript(code, true);
  const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
  const until = async (code, ms = 5000) => { const end = Date.now() + ms; while (Date.now() < end) { if (await run(code)) return true; await wait(80); } throw new Error('Timed out: ' + code); };
  const dir = path.join(output, 'markdown');
  await fs.rm(dir, { recursive: true, force: true });
  await fs.mkdir(path.join(dir, 'img'), { recursive: true });
  const file = path.join(dir, 'note.md');
  const original = Buffer.from('﻿# 标题\r\n\r\n段落 ![图](img/p.png) 与公式 $x^2$\r\n\r\n- [ ] 任务\r\n', 'utf8');
  await fs.writeFile(file, original);
  await fs.writeFile(path.join(dir, 'img', 'p.png'), PNG);
  const result = {};
  const originalBox = dialog.showMessageBox, originalSave = dialog.showSaveDialog;
  try {
    const opened = await openFiles([file]);
    assert.equal(opened[0].kind, 'markdown');
    await run(`qingye.addDocuments(${JSON.stringify(opened)})`);
    await until(`[...qingye.sessions.values()].some(s => s.kind === 'markdown' && s.loaded)`);
    const S = `[...qingye.sessions.values()].find(s => s.kind === 'markdown')`;
    await until(`!!document.querySelector('.mdDoc img[src^="blob:"]')`);
    result.imageLoaded = true;
    result.rendered = await run(`({ h1: !!document.querySelector('.mdDoc h1'), math: !!document.querySelector('.mdDoc .katex'), task: !!document.querySelector('.mdDoc input.mdTask') })`);
    assert.deepEqual(result.rendered, { h1: true, math: true, task: true });

    // Saving an unchanged document writes identical bytes (BOM and CRLF preserved).
    assert.equal(await run(`qingye.saveSession(${S}, false)`), true);
    assert.deepEqual(await fs.readFile(file), original, 'unchanged save is byte-identical');
    result.byteIdentical = true;

    // Edit, then save: line endings follow the file.
    await run(`(() => { const s = ${S}; s.editor.apply([{ from: s.editor.text.length, to: s.editor.text.length, insert: '\\n新增一行\\n' }], null, { activate: false }); })()`);
    await until(`${S}.dirty`);
    assert.equal(await run(`qingye.saveSession(${S}, false)`), true);
    const saved = (await fs.readFile(file)).toString('utf8');
    assert.ok(saved.startsWith('﻿') && saved.includes('新增一行\r\n') && !/[^\r]\n/.test(saved), 'edited save keeps BOM and CRLF');
    result.crlfPreserved = true;

    // External change while clean: reloads automatically (undoable).
    await wait(500);
    await fs.writeFile(file, Buffer.from('﻿# 外部修改\r\n\r\n来自其他程序\r\n'));
    await until(`${S}.editor.text.startsWith('# 外部修改')`, 8000);
    result.autoReload = true;
    assert.equal(await run(`${S}.dirty`), false);

    // External change while dirty: banner; saving asks before overwriting.
    await run(`(() => { const s = ${S}; s.editor.apply([{ from: 0, to: 0, insert: '本地修改\\n\\n' }], null, { activate: false }); })()`);
    await fs.writeFile(file, Buffer.from('第三方版本\r\n'));
    await until(`!document.querySelector('.mdBanner').hidden`, 8000);
    result.banner = true;
    dialog.showMessageBox = async () => ({ response: 2 });
    assert.equal(await run(`qingye.saveSession(${S}, false)`), false, 'cancel keeps the disk version');
    assert.equal((await fs.readFile(file, 'utf8')), '第三方版本\r\n');
    dialog.showMessageBox = async (_w, options) => { assert.match(options.message, /已被其他程序修改/); return { response: 1 }; };
    assert.equal(await run(`qingye.saveSession(${S}, false)`), true, 'overwrite after confirmation');
    assert.ok((await fs.readFile(file, 'utf8')).replace(/^\uFEFF/, '').startsWith('本地修改'));
    result.conflictHandled = true;

    // Crash-recovery draft for unsaved Markdown.
    await run(`(() => { const s = ${S}; s.editor.apply([{ from: 0, to: 0, insert: '草稿内容 ' }], null, { activate: false }); })()`);
    await until(`${S}.dirty`);
    await run('qingye.checkpoint()');
    const drafts = (await fs.readdir(recoveryFolder)).filter(name => name.endsWith('.md'));
    assert.ok(drafts.length >= 1, 'draft written');
    assert.ok((await fs.readFile(path.join(recoveryFolder, drafts.at(-1)), 'utf8')).startsWith('草稿内容'));
    result.draft = true;

    // Pasted images are saved beside the document.
    const relative = await run(`desktop.markdownSaveImage(${S}.id, new Uint8Array([${[...PNG].join(',')}]), 'png')`);
    assert.match(relative, /^assets\/image-\d+/);
    await fs.access(path.join(dir, relative));
    result.pastedImage = relative;

    // New document → Save As adds the .md extension.
    await run(`(async () => qingye.addDocuments(await desktop.newMarkdown()))()`);
    await until(`[...qingye.sessions.values()].filter(s => s.kind === 'markdown' && s.loaded).length === 2`);
    const N = `[...qingye.sessions.values()].filter(s => s.kind === 'markdown').at(-1)`;
    await run(`(() => { const s = ${N}; s.editor.apply([{ from: 0, to: 0, insert: '# 新文档\\n' }], null, { activate: false }); })()`);
    dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(dir, 'new') });
    assert.equal(await run(`qingye.saveSession(${N}, false)`), true);
    assert.equal(await fs.readFile(path.join(dir, 'new.md'), 'utf8'), '# 新文档\n');
    result.saveAs = true;

    // Closing a dirty tab asks first.
    await run(`(() => { const s = ${N}; s.editor.apply([{ from: 0, to: 0, insert: 'x' }], null, { activate: false }); })()`);
    await until(`${N}.dirty`);
    let asked = false;
    dialog.showMessageBox = async (_w, options) => { asked = /未保存的修改/.test(options.message); return { response: 1 }; };
    assert.equal(await run(`qingye.closeTab(${N}.id)`), true);
    assert.equal(asked, true);
    result.closePrompt = true;
    console.log('Checking diagrams'); result.diagrams = await require('./diagrams-smoke.cjs').run(window);
    console.log('Checking Typora controls and IPC'); result.typora = await require('./typora-smoke.cjs').run({ window, openFiles, output });
    await fs.writeFile(path.join(output, 'markdown.png'), (await window.webContents.capturePage()).toPNG());
    return result;
  } finally { dialog.showMessageBox = originalBox; dialog.showSaveDialog = originalSave; }
};
