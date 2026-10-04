// Data-safety acceptance: save conflicts, save/apply/close races, undo-then-close
// choices, forced-exit recovery with a real killed process, and history limits.
// Runs headless via `npm run safety`; QINGYE_SAFETY_ROLE drives the crash/verify
// drill children spawned by the parent run.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');

const smokeRoot = () => path.resolve(process.env.QINGYE_SMOKE_ROOT || process.cwd());

// Creates a real FreeText editor through PDF.js's editor layer and commits it.
function freeTextSource(label, y = 240) {
  return `(async () => {
    const s = [...qingye.sessions.values()].at(-1); qingye.activate(s.id);
    const a = s.app; a.pdfViewer.currentPageNumber = 1; await a.pdfViewer.pagesPromise;
    a.eventBus.dispatch('switchannotationeditormode', { source: window, mode: 3 });
    await new Promise(resolve => setTimeout(resolve, 500));
    const layer = a.pdfViewer.getPageView(0).annotationEditorLayer.annotationEditorLayer;
    const rect = layer.div.getBoundingClientRect();
    layer.div.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, button: 0, pointerId: 1, clientX: rect.left + 120, clientY: rect.top + ${y} }));
    layer.div.dispatchEvent(new PointerEvent('pointerup', { bubbles: true, button: 0, pointerId: 1, clientX: rect.left + 120, clientY: rect.top + ${y} }));
    await new Promise(resolve => setTimeout(resolve, 200));
    const editor = [...s.frame.contentDocument.querySelectorAll('.freeTextEditor .internal')].at(-1);
    if (!editor) throw new Error('FreeText editor was not created');
    editor.textContent = ${JSON.stringify(label)};
    editor.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertText', data: ${JSON.stringify(label)} }));
    qingye.commit(s); qingye.syncDirty(s);
    return { dirty: s.dirty, storage: a.pdfDocument.annotationStorage.size };
  })()`;
}

// Reopens raw PDF bytes inside the renderer and reports page-1 FreeText contents.
const inspectSource = bytes => `(async () => {
  const s = [...qingye.sessions.values()].at(-1);
  const loading = s.frame.contentWindow.pdfjsLib.getDocument({ data: new Uint8Array(${JSON.stringify(bytes)}) });
  const doc = await loading.promise;
  const annots = await (await doc.getPage(1)).getAnnotations();
  const texts = annots.filter(x => x.subtype === 'FreeText').map(x => x.contentsObj?.str || x.contents || '');
  const pageText = (await (await doc.getPage(1)).getTextContent()).items.map(i => i.str).join(' ');
  await loading.destroy();
  return { freeText: texts, pageText };
})()`;

async function crashDrill({ window, app, output, openFiles }) {
  const run = source => window.webContents.executeJavaScript(source, true);
  // Register the document through the real open path so the main process knows
  // its id; synthetic ids would be filtered out of every checkpoint.
  const opened = await openFiles([process.env.QINGYE_DRILL_DOC]);
  await run(`qingye.addDocuments(${JSON.stringify(opened.map(d => ({ ...d, state: {}, bytes: Array.from(d.bytes) })))})`);
  await run(freeTextSource('DRILL-UNSAVED-TEXT'));
  const editedAt = Date.now();
  await run('qingye.checkpoint()');
  const checkpointAt = Date.now();
  await fs.writeFile(path.join(output, 'safety', 'drill-crash.json'), JSON.stringify({ pid: process.pid, editedAt, checkpointAt }, null, 2));
  // Stay alive with the draft on disk; the parent force-kills this process.
  console.log(`SAFETY-DRILL-ARMED pid=${process.pid}`);
}

async function verifyDrill({ window, app, output }) {
  const run = source => window.webContents.executeJavaScript(source, true);
  const result = await run(`(async () => {
    const list = await desktop.recoveryList();
    const item = list.find(i => i.drafts > 0);
    if (!item) return { found: false, list };
    const opened = await desktop.restoreSession(item.token);
    await qingye.addDocuments(opened);
    const s = [...qingye.sessions.values()].at(-1);
    qingye.syncDirty(s);
    const annots = await (await s.app.pdfDocument.getPage(1)).getAnnotations();
    return {
      found: true, names: item.names, drafts: item.drafts, dirty: s.dirty,
      path: s.path, page: s.app.pdfViewer.currentPageNumber,
      text: annots.filter(a => a.contentsObj?.str?.includes('DRILL-UNSAVED-TEXT')).length > 0,
    };
  })()`);
  await fs.writeFile(path.join(output, 'safety', 'drill-verify.json'), JSON.stringify(result, null, 2));
  assert.equal(result.found, true, 'crashed session must appear in recovery list');
  assert.equal(result.dirty, true, 'restored draft must be marked unsaved');
  assert.equal(result.text, true, 'restored draft must contain the unsaved edit');
  app.exit(0);
}

// Serial large-file drill: open, jump to last page, full-document search,
// watermark apply to every page, undo, and a canceled OCR job — the operation
// mix that previously lost the debug connection on a 500-page document.
// Bytes travel through the same command('opened') structured-clone channel a
// real file-open uses; never through executeJavaScript's JSON string.
async function largeFileRun({ window, app, openFiles, diagnostics }) {
  const output = path.join(smokeRoot(), 'test-output', 'perf');
  await fs.mkdir(output, { recursive: true });
  const run = source => window.webContents.executeJavaScript(source, true);
  const file = process.env.QINGYE_LARGE_FILE || path.join(output, 'large-scan.pdf');
  const result = { file, sizeMB: +((await fs.stat(file)).size / 1e6).toFixed(1) };
  let peak = 0;
  const sampler = setInterval(() => {
    const total = app.getAppMetrics().reduce((n, p) => n + p.memory.workingSetSize, 0);
    if (total > peak) peak = total;
  }, 500);
  try {
    let t = Date.now();
    const opened = await openFiles([file]);
    window.webContents.send('command', 'opened', opened);
    for (let i = 0; i < 600; i++) {
      if (await run('[...qingye.sessions.values()].at(-1)?.loaded === true && [...qingye.sessions.values()].at(-1)?.app?.pdfViewer?.pageViewsReady')) break;
      await new Promise(resolve => setTimeout(resolve, 250));
    }
    result.openMs = Date.now() - t;
    result.pages = await run('[...qingye.sessions.values()].at(-1).app.pagesCount');

    t = Date.now();
    await run(`(async () => { const s = [...qingye.sessions.values()].at(-1); s.app.pdfViewer.scrollMode = 3; s.app.pdfViewer.currentPageNumber = ${result.pages}; await new Promise(r => setTimeout(r, 600)); })()`);
    result.lastPageMs = Date.now() - t;

    t = Date.now();
    result.searchMatches = await run(`(async () => {
      const s = [...qingye.sessions.values()].at(-1);
      await qingye.navigation.search(s, 'NEEDLE');
      for (let i = 0; i < 240; i++) {
        const total = s.app.findController.pageMatches.reduce((n, x) => n + (x?.length || 0), 0);
        if (total >= 10) return total;
        await new Promise(r => setTimeout(r, 500));
      }
      return s.app.findController.pageMatches.reduce((n, x) => n + (x?.length || 0), 0);
    })()`);
    result.searchMs = Date.now() - t;

    t = Date.now();
    await run(`(async () => qingye.applyEdit([...qingye.sessions.values()].at(-1), { action: 'watermark', text: 'PERF 水印', rect: [.2, .45, .8, .55], size: 24, opacity: .3 }, '性能水印 · 全部页'))()`);
    result.applyWatermarkMs = Date.now() - t;

    t = Date.now();
    await run('qingye.historyStep()');
    result.undoMs = Date.now() - t;

    t = Date.now();
    const dialog = require('electron').dialog, realSaveDialog = dialog.showSaveDialog;
    // The cancel probe is a non-draft job; if the cancel ever failed to abort,
    // fall back to a canceled stub instead of blocking on a native dialog.
    dialog.showSaveDialog = async () => ({ canceled: true });
    try {
      result.cancelMessage = await run(`(async () => {
        const s = [...qingye.sessions.values()].at(-1);
        const jobId = crypto.randomUUID();
        const job = desktop.toolsJob(s.id, await qingye.tools.snapshot(s), { action: 'ocr', pages: '1-40', jobId }).then(() => 'completed').catch(error => error.message);
        await new Promise(r => setTimeout(r, 4000));
        await desktop.cancelJob(jobId);
        return await job;
      })()`);
    } finally { dialog.showSaveDialog = realSaveDialog; }
    result.cancelMs = Date.now() - t;

    const messageDialog = require('electron').dialog, realMessageBox = messageDialog.showMessageBox;
    messageDialog.showMessageBox = async () => ({ response: 1 });
    try { await run('qingye.closeTab([...qingye.sessions.values()].at(-1).id)'); }
    finally { messageDialog.showMessageBox = realMessageBox; }

    clearInterval(sampler);
    result.peakMemoryMB = Math.round(peak / 1024);
    result.exitReason = 'clean-exit-0';
    if (result.searchMatches < 10) throw new Error(`search found only ${result.searchMatches} matches`);
    if (!/已取消/.test(result.cancelMessage)) throw new Error(`OCR cancel failed: ${result.cancelMessage}`);
    await fs.writeFile(path.join(output, 'large-file-result.json'), JSON.stringify(result, null, 2));
    console.log('LARGE FILE PASS', JSON.stringify(result));
    diagnostics.success();
    app.exit(0);
  } catch (error) {
    clearInterval(sampler);
    await fs.writeFile(path.join(output, 'large-file-result.json'), JSON.stringify({ ...result, failed: error.message }, null, 2)).catch(() => {});
    throw error;
  }
}

exports.run = async ({ window, openFiles, documents, samplePdf, app, recovery, diagnostics, role }) => {
  const output = path.join(smokeRoot(), 'test-output');
  await fs.mkdir(output, { recursive: true });
  if (role === 'crash') return crashDrill({ window, app, output, openFiles });
  if (role === 'verify') return verifyDrill({ window, app, output });
  if (role === 'largefile') return largeFileRun({ window, app, openFiles, diagnostics });

  const safetyDir = path.join(output, 'safety');
  await fs.mkdir(safetyDir, { recursive: true });
  const errors = [];
  window.webContents.on('console-message', (_event, ...args) => {
    const details = typeof args[0] === 'object' ? args[0] : { level: args[0], message: args[1] };
    if (details.level === 'error' || details.level === 3) errors.push(details.message);
  });
  const run = source => window.webContents.executeJavaScript(source, true);
  const timeout = (promise, ms = 60000) => Promise.race([promise, new Promise((_, reject) => setTimeout(() => reject(new Error('Safety test timed out')), ms))]);
  const openDoc = async file => {
    const opened = await openFiles([file]);
    await timeout(run(`qingye.addDocuments(${JSON.stringify(opened.map(d => ({ ...d, state: {}, bytes: Array.from(d.bytes) })))})`));
    return opened[0].id;
  };
  const sessionCount = () => run('qingye.sessions.size');
  const dialog = require('electron').dialog;
  const realMessageBox = dialog.showMessageBox, realSaveDialog = dialog.showSaveDialog;
  const stubChoice = response => { dialog.showMessageBox = async () => ({ response }); };
  const restoreDialogs = () => { dialog.showMessageBox = realMessageBox; dialog.showSaveDialog = realSaveDialog; };
  const results = {};

  // ── S1: external tool rewrites the file on disk, then the user saves ──────
  {
    const file = path.join(safetyDir, 'conflict.pdf');
    await fs.writeFile(file, samplePdf('Safety conflict'));
    await openDoc(file);
    await timeout(run(freeTextSource('SAFETY-CONFLICT')));
    assert.equal(await run(`(async () => qingye.saveSession([...qingye.sessions.values()].at(-1), false))()`), true, 'baseline save must succeed');
    const external = samplePdf('Externally rewritten by another tool');
    await fs.writeFile(file, external); // simulates an outside editor
    await timeout(run(freeTextSource('SECOND-EDIT', 340)));
    const outcome = await run(`(async () => {
      document.getElementById('saveButton').click();
      await new Promise(resolve => setTimeout(resolve, 800));
      const s = [...qingye.sessions.values()].at(-1);
      return { status: document.getElementById('statusText').textContent, message: document.getElementById('messageBody').textContent, dirty: s.dirty, dialogShown: document.getElementById('messageDialog').open };
    })()`);
    const diskNow = await fs.readFile(file);
    const leftovers = (await fs.readdir(safetyDir)).filter(name => name.includes('.tmp'));
    assert.equal(diskNow.equals(external), true, 'conflicted save must not touch the externally modified file');
    assert.equal(leftovers.length, 0, 'conflicted save must not leave temporary files');
    assert.match(outcome.message, /其他程序修改/, 'user-visible error must explain the conflict');
    assert.equal(outcome.dirty, true, 'session must stay unsaved after a conflicted save');
    stubChoice(1); // discard the local edits
    assert.equal(await timeout(run(`qingye.closeTab([...qingye.sessions.values()].at(-1).id)`)), true);
    restoreDialogs();
    results.externalConflict = { messageShown: outcome.message, filePreserved: diskNow.equals(external), tempFiles: leftovers.length };
  }

  // ── S2: save / apply / close race timing ─────────────────────────────────
  {
    const file = path.join(safetyDir, 'race.pdf');
    await fs.writeFile(file, samplePdf('Race timing'));
    const id = await openDoc(file);
    const applyPromise = run(`(async () => qingye.applyEdit([...qingye.sessions.values()].at(-1), { action: 'stamp', pages: '1', text: 'RACE-STAMP', rect: [.1, .1, .5, .2], size: 14 }, '竞争印章'))()`);
    await new Promise(resolve => setTimeout(resolve, 60));
    const saveDuringApply = await run('qingye.saveSession([...qingye.sessions.values()].at(-1), false)');
    const closeDuringApply = await run(`qingye.closeTab(${JSON.stringify(id)})`);
    const applyOutcome = await timeout(applyPromise);
    assert.ok(applyOutcome && applyOutcome.canceled !== true, 'apply itself must succeed');
    assert.equal(saveDuringApply, false, 'save during apply must be refused');
    assert.equal(closeDuringApply, false, 'close during apply must be refused');
    assert.equal(await sessionCount(), 1, 'refused close must keep the tab');

    // Renderer guard: closeTab issued in the same tick as a save is refused.
    const sameTick = await timeout(run(`(async () => {
      const s = [...qingye.sessions.values()].at(-1);
      const saving = qingye.saveSession(s, false);
      const closeAttempt = qingye.closeTab(s.id);
      return { saved: await saving, closed: await closeAttempt, sessions: qingye.sessions.size };
    })()`));
    assert.equal(sameTick.saved, true, 'the save itself must complete');
    assert.equal(sameTick.closed, false, 'renderer close during save must be refused');
    assert.equal(sameTick.sessions, 1, 'refused close must keep the tab');

    // Main-process guards: a duplicate save and a close-document fired while the
    // first save is between its own awaits must both be rejected.
    const ipc = await timeout(run(`(async () => {
      const s = [...qingye.sessions.values()].at(-1);
      const bytes = s.app.pdfDocument.annotationStorage.size ? await s.app.pdfDocument.saveDocument() : await s.app.pdfDocument.getData();
      const call = (promise, channel) => promise.then(() => ({ channel, ok: true })).catch(error => ({ channel, ok: false, message: error.message }));
      const first = desktop.save(s.id, bytes, false);
      const outcome = await Promise.all([call(first, 'save-1'), call(desktop.save(s.id, bytes, false), 'save-2'), call(desktop.closeDocument(s.id, {}), 'close')]);
      return outcome;
    })()`));
    const byChannel = Object.fromEntries(ipc.map(item => [item.channel, item]));
    assert.equal(byChannel['save-1'].ok, true, 'first save must succeed');
    assert.equal(byChannel['save-2'].ok, false, 'duplicate concurrent save must be rejected');
    assert.match(byChannel['save-2'].message, /正在保存/);
    assert.equal(byChannel.close.ok, false, 'close-document during save must be rejected');
    assert.match(byChannel.close.message, /正在保存/);
    const savedBytes = Array.from(await fs.readFile(file));
    const verified = await timeout(run(inspectSource(savedBytes)));
    assert.match(verified.pageText, /RACE-STAMP/, 'contended save must persist the applied edit');
    stubChoice(1);
    assert.equal(await timeout(run(`qingye.closeTab(${JSON.stringify(id)})`)), true);
    restoreDialogs();
    results.races = { saveDuringApply, closeDuringApply, ...byChannel };
  }

  // ── S3: save, undo, then close with each of the three choices ────────────
  {
    const cancelFile = path.join(safetyDir, 'undo-close.pdf');
    await fs.writeFile(cancelFile, samplePdf('Undo close cancel'));
    const id = await openDoc(cancelFile);
    await timeout(run(freeTextSource('UNDO-CLOSE')));
    assert.equal(await run(`(async () => qingye.saveSession([...qingye.sessions.values()].at(-1), false))()`), true);
    const withEdit = Array.from(await fs.readFile(cancelFile));
    const undone = await run(`(async () => { const s = [...qingye.sessions.values()].at(-1); await qingye.historyStep(); qingye.syncDirty(s); return { dirty: s.dirty, canUndo: s.nativeHistory?.hasSomethingToUndo === false }; })()`);
    assert.equal(undone.dirty, true, 'undo after save must mark the document unsaved');
    try {
      stubChoice(2); // 取消
      assert.equal(await timeout(run(`qingye.closeTab(${JSON.stringify(id)})`)), false, 'cancel must abort the close');
      assert.equal(await sessionCount(), 1, 'cancelled close must keep the tab');
      assert.deepEqual(Array.from(await fs.readFile(cancelFile)), withEdit, 'cancel must not touch the file');
      stubChoice(0); // 保存
      assert.equal(await timeout(run(`qingye.closeTab(${JSON.stringify(id)})`)), true, 'save-and-close must succeed');
      // Reopen from disk; the renderer has no session left to inspect through.
      await openDoc(cancelFile);
      const verified = await run(`(async () => {
        const s = [...qingye.sessions.values()].at(-1);
        const annots = await (await s.app.pdfDocument.getPage(1)).getAnnotations();
        return annots.filter(x => x.subtype === 'FreeText').map(x => x.contentsObj?.str || x.contents || '');
      })()`);
      assert.equal(verified.some(t => t.includes('UNDO-CLOSE')), false, 'save-after-undo must persist the undone state');
      await timeout(run('qingye.closeTab([...qingye.sessions.values()].at(-1).id)'));
      assert.equal(await sessionCount(), 0);
      assert.equal(recovery.entries.some(e => e.id === id), false, 'closed document must leave no recovery draft');
    } finally { restoreDialogs(); }
    const discardFile = path.join(safetyDir, 'undo-discard.pdf');
    await fs.writeFile(discardFile, samplePdf('Undo close discard'));
    const id2 = await openDoc(discardFile);
    await timeout(run(freeTextSource('DISCARD-CASE')));
    assert.equal(await run(`(async () => qingye.saveSession([...qingye.sessions.values()].at(-1), false))()`), true);
    const beforeDiscard = Array.from(await fs.readFile(discardFile));
    await run('qingye.historyStep()');
    try {
      stubChoice(1); // 不保存
      assert.equal(await timeout(run(`qingye.closeTab(${JSON.stringify(id2)})`)), true, 'discard-and-close must succeed');
      assert.deepEqual(Array.from(await fs.readFile(discardFile)), beforeDiscard, 'discard must keep the last saved state');
      assert.equal(recovery.entries.some(e => e.id === id2), false, 'discarded document must leave no recovery draft');
    } finally { restoreDialogs(); }
    results.undoClose = { dirtyAfterUndo: undone.dirty, savePersistsUndo: true, discardKeepsSaved: true };
  }

  // ── Q09: how fast does the unsaved marker clear after annotation undo? ───
  {
    await timeout(run('(async () => qingye.addDocuments(await desktop.example()))()'));
    await timeout(run(freeTextSource('Q09-TIMING')));
    const timing = await timeout(run(`(async () => {
      const s = [...qingye.sessions.values()].at(-1);
      await qingye.historyStep();
      // No manual syncDirty here: measure what the app itself clears and when.
      const start = performance.now(); const samples = []; let firstFalse = -1;
      for (let i = 0; i < 24; i++) {
        samples.push(s.dirty);
        if (!s.dirty && firstFalse < 0) firstFalse = performance.now() - start;
        await new Promise(resolve => setTimeout(resolve, 50));
      }
      const marker = document.querySelector('#tabs .tab .tabTitle').textContent;
      return { firstFalse, samples, marker, dirty: s.dirty };
    })()`));
    const redo = await run(`(async () => { const s = [...qingye.sessions.values()].at(-1); await qingye.historyStep(true); qingye.syncDirty(s); return s.dirty; })()`);
    const clearIndex = timing.samples.indexOf(false);
    assert.ok(timing.firstFalse >= 0 && timing.firstFalse <= 1500, `unsaved marker must clear within one poll cycle, took ${timing.firstFalse}ms`);
    assert.ok(timing.samples.slice(clearIndex).every(v => v === false), 'marker must not flap back after clearing');
    assert.ok(!timing.marker.includes('●'), 'tab marker must drop the unsaved dot');
    assert.equal(redo, true, 'redo must re-mark the document unsaved');
    stubChoice(1);
    await timeout(run('qingye.closeTab([...qingye.sessions.values()].at(-1).id)'));
    restoreDialogs();
    results.q09 = timing;
  }

  // ── S4: forced process kill, then recovery in a fresh process ────────────
  {
    const profile = path.join(output, 'safety-drill-profile');
    await fs.rm(profile, { recursive: true, force: true });
    const drillDoc = path.join(safetyDir, 'drill.pdf');
    await fs.writeFile(drillDoc, samplePdf('Recovery drill'));
    const electronBin = process.execPath;
    const appArgs = app.isPackaged ? ['--safety-smoke'] : [app.getAppPath(), '--safety-smoke'];
    const launch = role => new Promise((resolve, reject) => {
      const child = spawn(electronBin, appArgs, {
        windowsHide: true, env: { ...process.env, QINGYE_SAFETY_ROLE: role, QINGYE_DRILL_DOC: drillDoc, QINGYE_SMOKE_ROOT: smokeRoot() },
      });
      child.stdout.on('data', chunk => { for (const line of String(chunk).split('\n')) if (line.includes('SAFETY-DRILL-ARMED')) child.armed = true; });
      child.once('error', reject);
      resolve(child);
    });

    const crashChild = await launch('crash');
    const armedAt = Date.now();
    while (!crashChild.armed && Date.now() - armedAt < 90000) await new Promise(resolve => setTimeout(resolve, 250));
    assert.equal(crashChild.armed, true, 'crash drill child must reach the armed state');
    await new Promise(resolve => setTimeout(resolve, 200)); // let stdout/JSON flush
    const crashReport = JSON.parse(await fs.readFile(path.join(safetyDir, 'drill-crash.json'), 'utf8'));
    const killedBy = spawn('taskkill', ['/PID', String(crashReport.pid), '/F', '/T'], { windowsHide: true });
    await new Promise(resolve => killedBy.on('close', resolve));
    const exitCode = await new Promise(resolve => crashChild.once('close', resolve));
    const manifests = [];
    for (const name of await fs.readdir(path.join(profile, 'recovery'))) {
      if (/^[\da-f-]{36}\.json$/i.test(name)) manifests.push(JSON.parse(await fs.readFile(path.join(profile, 'recovery', name), 'utf8')));
    }
    const crashedManifest = manifests.find(m => m.pid === crashReport.pid);
    assert.ok(crashedManifest, 'killed process must leave a recovery manifest');
    assert.equal(crashedManifest.entries.some(e => e.dirty && e.draft), true, 'killed process must leave a dirty draft');
    const verifyChild = await launch('verify');
    const verifyCode = await new Promise(resolve => verifyChild.once('close', resolve));
    assert.equal(verifyCode, 0, 'verify drill child must pass');
    const verified = JSON.parse(await fs.readFile(path.join(safetyDir, 'drill-verify.json'), 'utf8'));
    // The verify child exits via app.exit, so its own manifest legitimately
    // remains; the crashed session's manifest must have been consumed.
    const leftover = [];
    for (const name of await fs.readdir(path.join(profile, 'recovery'))) {
      if (/^[\da-f-]{36}\.json$/i.test(name)) leftover.push(JSON.parse(await fs.readFile(path.join(profile, 'recovery', name), 'utf8')).pid);
    }
    assert.equal(leftover.includes(crashReport.pid), false, 'restored session must consume the crashed manifest');
    results.forcedExit = {
      exitCode, checkpointLagMs: crashReport.checkpointAt - crashReport.editedAt,
      manifestLagMs: crashedManifest.updated - crashReport.editedAt, restored: verified,
    };
  }

  // ── S5: more applies than the history limit keeps current edits ──────────
  {
    await timeout(run('(async () => qingye.addDocuments(await desktop.example()))()'));
    const id = await run('[...qingye.sessions.values()].at(-1).id');
    for (let i = 1; i <= 22; i++) {
      await timeout(run(`(async () => qingye.applyEdit([...qingye.sessions.values()].at(-1), { action: 'stamp', pages: '1', text: 'S5-${String(i).padStart(2, '0')}', rect: [${(0.05 + (i % 5) * 0.05).toFixed(2)}, ${(0.3 + Math.floor(i / 5) * 0.06).toFixed(2)}, ${(0.55 + (i % 5) * 0.05).toFixed(2)}, ${(0.4 + Math.floor(i / 5) * 0.06).toFixed(2)}], size: 10 }, '历史上限 ${i}'))()`), 90000);
    }
    const state = await run(`(async () => {
      const s = [...qingye.sessions.values()].at(-1);
      const rows = s.history.rows.length;
      await qingye.historyStep();
      const undone = (await (await s.app.pdfDocument.getPage(1)).getTextContent()).items.map(i => i.str).join(' ');
      await qingye.historyStep(true);
      const redone = (await (await s.app.pdfDocument.getPage(1)).getTextContent()).items.map(i => i.str).join(' ');
      qingye.syncDirty(s);
      return { rows, pages: s.app.pagesCount, hasFinal: redone.includes('S5-22'), lostFinal: !undone.includes('S5-22'), dirty: s.dirty };
    })()`);
    assert.ok(state.rows <= 20, `history must cap at 20 rows, kept ${state.rows}`);
    assert.equal(state.pages, 2, 'current document must survive history eviction');
    assert.equal(state.hasFinal, true, 'newest edit must survive history eviction');
    assert.equal(state.lostFinal, true, 'undo must still work after history eviction');
    assert.equal(state.dirty, true, 'unsaved state must survive history eviction');
    try {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(safetyDir, 'history-limit.pdf') });
      const saved = await run('(async () => qingye.saveSession([...qingye.sessions.values()].at(-1), true))()');
      assert.equal(saved, true, 'save-as after eviction must succeed');
    } finally { restoreDialogs(); }
    const historyBytes = Array.from(await fs.readFile(path.join(safetyDir, 'history-limit.pdf')));
    const persisted = await timeout(run(inspectSource(historyBytes)));
    assert.match(persisted.pageText, /S5-22/, 'file after eviction must contain every applied edit');
    assert.match(persisted.pageText, /S5-01/, 'early edits must remain despite evicted undo points');
    stubChoice(1);
    await timeout(run(`qingye.closeTab(${JSON.stringify(id)})`));
    restoreDialogs();
    results.historyLimit = state;
  }

  // ── Thumbnail reordering through real drag events ─────────────────────────
  {
    await timeout(run('(async () => qingye.addDocuments(await desktop.example()))()'));
    const drag = await timeout(run(`(async () => {
      const s = [...qingye.sessions.values()].at(-1); qingye.activate(s.id);
      await qingye.navigation.show('thumbnails');
      await new Promise(resolve => setTimeout(resolve, 300));
      const cards = [...document.querySelectorAll('.thumbnailCard')];
      const source = cards.find(c => c.dataset.page === '2');
      const target = cards.find(c => c.dataset.page === '1');
      const data = new DataTransfer();
      source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: data }));
      target.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: data }));
      target.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: data }));
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true, dataTransfer: data }));
      const dragged = s.pageOrganizer.order.join(',');
      document.querySelector('#navigationControls .pageActions button').click();
      const undone = s.pageOrganizer.order.join(',');
      qingye.navigation.close();
      return { dragged, undone };
    })()`));
    assert.equal(drag.dragged, '2,1', 'real drag events must reorder thumbnails');
    assert.equal(drag.undone, '1,2', 'undo must restore the original order');
    stubChoice(1);
    await timeout(run('qingye.closeTab([...qingye.sessions.values()].at(-1).id)'));
    restoreDialogs();
    results.thumbnailDrag = drag;
  }

  // ── S6: independent re-check of files the toolbox GUI actually wrote ─────
  {
    // Two same-named documents: one batch run must produce a colliding (2) copy.
    const folderA = path.join(safetyDir, 'same-name', 'a'), folderB = path.join(safetyDir, 'same-name', 'b');
    await fs.mkdir(folderA, { recursive: true }); await fs.mkdir(folderB, { recursive: true });
    await fs.writeFile(path.join(folderA, 'gui-output.pdf'), samplePdf('GUI OUTPUT CHECK A'));
    await fs.writeFile(path.join(folderB, 'gui-output.pdf'), samplePdf('GUI OUTPUT CHECK B'));
    const scenarioStart = Date.now();
    await openDoc(path.join(folderA, 'gui-output.pdf'));
    await openDoc(path.join(folderB, 'gui-output.pdf'));
    await timeout(run(`(async () => {
      await qingye.tools.open('export');
      document.getElementById('toolFormat').value = 'txt';
      document.getElementById('toolBatch').checked = true;
      await qingye.tools.execute();
      document.getElementById('closeTools').click();
      return document.getElementById('toolProgress').textContent;
    })()`), 120000);
    const batchDirs = (await fs.readdir(output)).filter(name => name.startsWith('batch-'));
    let plain = null, collision = null;
    for (const dir of batchDirs) {
      const folder = path.join(output, dir);
      if ((await fs.stat(folder)).mtimeMs < scenarioStart) continue; // only this run's outputs
      for (const name of await fs.readdir(folder)) {
        const text = (await fs.readFile(path.join(folder, name), 'utf8')).slice(0, 4000);
        if (name === 'gui-output-export (2).txt') collision = { dir, name, text };
        else if (name === 'gui-output-export.txt') plain = { dir, name, text };
      }
    }
    assert.ok(plain && /GUI OUTPUT CHECK [AB]/.test(plain.text), 'GUI batch export must write the real document text');
    assert.ok(collision && /GUI OUTPUT CHECK [AB]/.test(collision.text), 'same-name batch output must get a (2) suffix, not overwrite');
    assert.equal(plain.dir, collision.dir, 'collision must happen inside one batch run');
    // Refuse to export over a document that is currently open. Compress emits
    // a .pdf, so the stubbed path can collide with the open document itself;
    // text exports cannot (the extension is forced to .txt).
    let overwriteRejected = '';
    try {
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: path.join(folderA, 'gui-output.pdf') });
      await timeout(run(`(async () => {
        const s = [...qingye.sessions.values()].at(-1);
        await desktop.toolsJob(s.id, await qingye.tools.snapshot(s), { action: 'compress' });
      })()`), 60000);
    } catch (error) { overwriteRejected = error.message; }
    finally { restoreDialogs(); }
    assert.match(overwriteRejected, /不能覆盖正在打开的文档/, 'exporting onto an open document must be rejected');
    for (let left = await sessionCount(); left > 0; left = await sessionCount()) {
      stubChoice(1);
      await timeout(run('qingye.closeTab([...qingye.sessions.values()].at(-1).id)'));
    }
    restoreDialogs();
    results.guiOutput = { collisionSuffix: collision?.name, overwriteRejected };
  }

  await fs.writeFile(path.join(output, 'safety-result.json'), JSON.stringify({ runId: diagnostics.runId, ...results, errors }, null, 2));
  await fs.writeFile(path.join(safetyDir, 'safety-home.png'), (await window.webContents.capturePage()).toPNG());
  if (errors.some(e => /Uncaught|Refused to|Failed to load module/i.test(e))) throw new Error(errors.join('\n'));
  console.log('SAFETY PASS', JSON.stringify({ externalConflict: results.externalConflict, races: results.races, q09FirstFalseMs: results.q09.firstFalse, forcedExit: results.forcedExit, historyRows: results.historyLimit.rows, thumbnailDrag: results.thumbnailDrag }));
  diagnostics.success();
  app.exit(0);
};
