// Draft recovery: every few seconds the unsaved content of every open document is handed to the
// main process, so a crash or a forced exit can be restored (recovery.cjs on the other side).
export function createDraftRecovery({ api, sessions, isMd, viewState, syncDirty, commit, editingHash, markdown, status, userError, activeId, isClosing }) {
  let busy = false, timer;
  async function checkpoint() {
    if (busy || isClosing() || [...sessions.values()].some(s => s.editBusy)) return false; busy = true;
    try {
      const items = [];
      for (const s of sessions.values()) if (s.loaded && !s.saving) {
        if (isMd(s)) { syncDirty(s); const version = s.editor.version, changed = s.dirty && s.draftVersion !== version; items.push({ id: s.id, state: viewState(s), dirty: s.dirty, ...(changed ? { text: markdown.text(s), history: s.editor.exportHistory() } : {}) }); if (changed) s.nextDraftVersion = version; continue; }
        syncDirty(s); let hash = editingHash(s); const changed = s.dirty && (s.draftHash !== hash || s.pendingInput);
        let bytes;
        if (changed) {
          // FreeText's live DOM isn't serialized until commit. Resume its focus and caret
          // immediately after starting the snapshot, instead of interrupting the user's typing.
          const doc = s.frame.contentDocument, active = doc.activeElement, selection = s.frame.contentWindow.getSelection();
          const range = selection.rangeCount ? selection.getRangeAt(0).cloneRange() : null;
          const manager = s.app.pdfViewer._layerProperties.annotationEditorUIManager; let editing;
          if (s.pendingInput && active?.closest('.freeTextEditor')) { for (let p = 0; p < s.app.pagesCount; p++) for (const editor of manager.getEditors(p)) if (editor.contentDiv?.contains(active)) editing = editor; }
          if (s.pendingInput) commit(s); hash = editingHash(s);
          const pending = s.app.pdfDocument.saveDocument();
          if (editing && !editing.deleted) { editing.enableEditMode(); manager.setActiveEditor(editing); active.focus(); if (range?.startContainer.isConnected) { selection.removeAllRanges(); selection.addRange(range); } }
          bytes = await pending;
        }
        items.push({ id: s.id, state: viewState(s), dirty: s.dirty, ...(bytes ? { bytes } : {}) });
        if (bytes) s.nextDraftHash = hash;
      }
      await api.checkpoint(items, activeId());
      for (const s of sessions.values()) { if (s.nextDraftHash) { s.draftHash = s.nextDraftHash; delete s.nextDraftHash; } if (s.nextDraftVersion != null) { s.draftVersion = s.nextDraftVersion; delete s.nextDraftVersion; } }
      return true;
    } catch (error) { console.warn('Draft recovery:', error); status('草稿备份未完成：' + userError(error)); return false; }
    finally { busy = false; }
  }
  function schedule() { clearTimeout(timer); timer = setTimeout(checkpoint, 3000); }
  return { checkpoint, schedule };
}
