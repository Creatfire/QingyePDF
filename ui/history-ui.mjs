// Undo / redo and the edit-history dialog. A PDF has two histories: PDF.js's own annotation editor
// history and this app's byte snapshots (ui/history.mjs); whichever has a step wins.
export function createHistoryUi({ $, guard, current, isMd, markdown, commit, replaceDocument, syncDirty }) {
  async function step(redo = false) {
    const s = current();
    if (isMd(s)) { if (s.loaded) redo ? markdown.redo(s) : markdown.undo(s); return; }
    if (!s?.loaded || s.editBusy || s.saving) return;
    commit(s); const manager = s.app.pdfViewer._layerProperties.annotationEditorUIManager;
    if (s.nativeHistory?.[redo ? 'hasSomethingToRedo' : 'hasSomethingToUndo']) { manager[redo ? 'redo' : 'undo'](); syncDirty(s); return; }
    const bytes = s.history?.[redo ? 'redo' : 'undo'](); if (!bytes) return; s.editBusy = true;
    try { await replaceDocument(s, bytes); } catch (error) { s.history[redo ? 'undo' : 'redo'](); throw error; } finally { s.editBusy = false; sync(); }
  }
  function sync() {
    const s = current();
    if (isMd(s)) { $('undoButton').disabled = !s.loaded || !markdown.canUndo(s); $('redoButton').disabled = !s.loaded || !markdown.canRedo(s); return; }
    for (const [id, redo] of [['undoButton', false], ['redoButton', true]]) { const b = $(id); if (b) b.disabled = !s?.loaded || !(s.nativeHistory?.[redo ? 'hasSomethingToRedo' : 'hasSomethingToUndo'] || s.history?.[redo ? 'canRedo' : 'canUndo']); }
  }
  const dialog = document.createElement('dialog'); dialog.id = 'historyDialog'; document.body.append(dialog);
  function show(continuation) {
    dialog.replaceChildren(); const h = document.createElement('h2'); h.textContent = continuation ? '保存前检查修改' : '编辑历史'; dialog.append(h);
    const s = current(); for (const row of s?.history?.rows || []) { const p = document.createElement('p'); p.textContent = (row.applied ? '✓ ' : '↶ 已撤销 · ') + row.time + ' · ' + row.label; dialog.append(p); }
    const note = document.createElement('p'); note.textContent = s?.dirty ? '当前文档有未保存修改（包括批注）。历史保留最近 20 次文档操作，上限 128 MB。' : '当前文档没有未保存修改。'; dialog.append(note);
    const close = document.createElement('button'); close.textContent = continuation ? '取消' : '关闭'; close.onclick = () => dialog.close(); dialog.append(close);
    if (s?.loaded) { const entries = [...(s.app.pdfDocument.annotationStorage.serializable.map || [])]; for (const [, entry] of entries.slice(0, 40)) { const p = document.createElement('p'); const types = { 3: '自由文本', 9: '高亮', 13: '印章 / 图片', 15: '墨迹' }; p.textContent = '批注 · 第 ' + ((entry.pageIndex ?? 0) + 1) + ' 页 · ' + (types[entry.annotationType] || '批注 / 表单') + (entry.value ? ' · ' + String(entry.value).slice(0, 80) : '') + (entry.deleted ? ' · 已删除' : ''); dialog.append(p); } }
    if (continuation) { const save = document.createElement('button'); save.textContent = '继续保存'; save.className = 'primary'; save.onclick = () => { dialog.close(); guard(continuation); }; dialog.append(save); }
    dialog.showModal();
  }
  $('undoButton').onclick = () => guard(() => step()); $('redoButton').onclick = () => guard(() => step(true)); $('historyButton').onclick = () => show();
  return { step, sync, show };
}
