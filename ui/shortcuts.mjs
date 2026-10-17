// Keyboard shortcuts for the whole window. The PDF.js frames call the same handler with their own
// session, so a key pressed inside a document acts on that document.
export function createShortcuts(ctx) {
  const { $, api, guard, sessions, current, activeId, isMd, activate, nextTab, closeTab, open, newMarkdown, reviewSave, historyStep, readingTrail, markdown, navigation } = ctx;
  let closeInProgress = false;
  function handle(event, s = current()) {
    // Notes mode, the library dialog and the AI panel are created after this module; they arrive
    // as getters and are read on every key press, exactly like the originals were.
    const notes = ctx.notes(), library = ctx.library(), ai = ctx.ai();
    if (event.key === 'Escape') {
      if ($('viewPanel').matches(':popover-open')) { $('viewPanel').hidePopover(); event.preventDefault(); event.stopImmediatePropagation(); return; }
      api.exitFullscreen().catch(console.warn);
    }
    const ctrl = event.ctrlKey || event.metaKey;
    if (event.altKey && !ctrl && !event.shiftKey && !event.isComposing && ['ArrowLeft', 'ArrowRight'].includes(event.key) && !event.target.closest('input,textarea,[contenteditable]')) { event.preventDefault(); event.stopImmediatePropagation(); guard(() => event.key === 'ArrowLeft' ? readingTrail.back() : readingTrail.forward()); return; }
    if (ctrl && (event.code === 'KeyZ' || event.code === 'KeyY') && !event.target.closest('input,textarea,[contenteditable=true]')) { event.preventDefault(); event.stopImmediatePropagation(); guard(() => historyStep(event.code === 'KeyY' || event.shiftKey)); return; }
    let action;
    if (ctrl && event.code === 'KeyO') action = () => open();
    if (ctrl && !event.shiftKey && event.code === 'Backslash' && notes) action = () => notes.toggle();
    if (ctrl && event.shiftKey && event.code === 'KeyE' && s?.loaded && !isMd(s) && notes?.notesFor(s)) action = () => notes.excerptSelection(s);
    if (ctrl && event.shiftKey && event.code === 'KeyU' && notes?.pdfOfSplit()) action = () => notes.pickRegion();
    if (ctrl && event.shiftKey && !event.altKey && event.code === 'KeyF' && library) action = () => library.open();
    if (ctrl && !event.shiftKey && event.code === 'KeyF' && s?.loaded) action = isMd(s) ? () => markdown.openFind(s, false) : () => navigation.show('search');
    if (ctrl && !event.shiftKey && event.code === 'KeyH' && isMd(s) && s.loaded) action = () => markdown.openFind(s, true);
    if (ctrl && event.code === 'KeyG' && s?.pager) action = () => s.pager.focus();
    if (ctrl && !event.shiftKey && event.code === 'KeyN') action = () => newMarkdown();
    if (ctrl && !event.shiftKey && !event.altKey && event.code === 'KeyP' && isMd(s) && s.loaded) action = () => markdown.command(s, 'openQuickly');
    if (ctrl && event.code === 'KeyS') action = () => reviewSave(s, event.shiftKey);
    if (ctrl && event.code === 'KeyW') action = async () => { if (closeInProgress) return; closeInProgress = true; try { await closeTab(s?.id); } finally { closeInProgress = false; } };
    if (ctrl && event.shiftKey && event.code === 'KeyA' && document.body.dataset.mode !== 'home') action = () => ai.toggle();
    if (ctrl && event.code === 'Tab') action = () => nextTab(event.shiftKey ? -1 : 1);
    if (ctrl && /^[1-9]$/.test(event.key) && !(isMd(s) && event.target?.closest?.('.mdEditor'))) action = () => activate([...sessions.keys()][Number(event.key) - 1] || activeId());
    if (action) { event.preventDefault(); event.stopImmediatePropagation(); guard(action); }
  }
  return { handle };
}
