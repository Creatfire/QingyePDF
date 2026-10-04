// Markdown preferences (per user, stored in the renderer's local storage; every access is guarded).
export const DEFAULTS = {
  // editing
  autoPair: true, smartPaste: true, copyMarkdown: true, emoji: true, spellcheck: false, autoSave: false, autoSaveSeconds: 30, finalNewline: false,
  smartPunctuation: false, preserveBreaks: false, indentFirstLine: false, showBr: false,
  // appearance
  theme: 'qingye', customTheme: '', fontFamily: '', fontSize: 16, lineHeight: 1.78, pageWidth: 860, zoom: 1,
  // view
  sidebar: true, sidebarTab: 'outline', statusBar: true, openInReadMode: false, menubar: true, outlineMode: 'tree', highlightHeading: true,
  focusMode: false, typewriterMode: false,
  // images
  imageInsert: 'assets', imageFolder: 'assets', imageRoot: '', preferRelative: true,
  // export
  pandocPath: '', pdfPageSize: 'A4', pdfMargin: 'normal', pdfLandscape: false, pdfHeaderFooter: false, pdfBackground: true, htmlEmbedCss: true,
  // shortcuts: { commandId: 'Ctrl+Alt+X' | '' }
  shortcuts: {},
};
const KEY = 'qingye.md.prefs';
const read = () => { try { return JSON.parse(localStorage.getItem(KEY) || '{}'); } catch { return {}; } };
export function createPrefs() {
  const values = { ...DEFAULTS, ...read() };
  const listeners = new Set();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(values)); } catch {} };
  const api = {
    values,
    get: name => values[name],
    set(name, value, { silent } = {}) { if (values[name] === value) return; values[name] = value; save(); if (!silent) for (const fn of listeners) fn(name, value); },
    toggle(name) { api.set(name, !values[name]); return values[name]; },
    setShortcut(id, combo) { const next = { ...values.shortcuts }; if (combo == null) delete next[id]; else next[id] = combo; api.set('shortcuts', next); },
    reset() { for (const k of Object.keys(DEFAULTS)) values[k] = DEFAULTS[k]; save(); for (const fn of listeners) fn('*', null); },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };
  return api;
}
