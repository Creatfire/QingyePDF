// Keyboard combos: parsing, matching, display and conflict handling for Markdown commands.
const NAMED = { Enter: 'Enter', Backspace: 'Backspace', Tab: 'Tab', Delete: 'Delete', Home: 'Home', End: 'End', Escape: 'Escape', Space: 'Space', PageUp: 'PageUp', PageDown: 'PageDown', ArrowUp: 'ArrowUp', ArrowDown: 'ArrowDown', ArrowLeft: 'ArrowLeft', ArrowRight: 'ArrowRight' };
const CODE_KEYS = { Backquote: '`', Minus: '-', Equal: '=', BracketLeft: '[', BracketRight: ']', Backslash: '\\', Semicolon: ';', Quote: "'", Comma: ',', Period: '.', Slash: '/' };
export function eventCombo(e) {
  const parts = [];
  if (e.ctrlKey || e.metaKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.shiftKey) parts.push('Shift');
  const code = e.code || '';
  let key = /^Key[A-Z]$/.test(code) ? code.slice(3) : /^Digit\d$/.test(code) ? code.slice(5) : /^F\d{1,2}$/.test(code) ? code : CODE_KEYS[code] || NAMED[e.key] || NAMED[code] || (e.key && e.key.length === 1 ? e.key.toUpperCase() : '');
  if (!key || ['Control', 'Shift', 'Alt', 'Meta'].includes(e.key)) return '';
  parts.push(key);
  return parts.join('+');
}
export const normalizeCombo = combo => {
  const parts = String(combo || '').split('+').map(p => p.trim()).filter(Boolean);
  const key = parts.pop() || '';
  const mods = ['Ctrl', 'Alt', 'Shift'].filter(m => parts.some(p => p.toLowerCase() === m.toLowerCase() || (m === 'Ctrl' && /^(cmd|command|meta|mod)$/i.test(p))));
  return [...mods, key.length === 1 ? key.toUpperCase() : key].join('+');
};
// Resolves the effective combo per command: user override wins; "" means unbound.
export function effectiveKeys(commands, overrides = {}) {
  const map = new Map(); // combo -> command id
  const disabled = new Set();
  for (const c of commands) {
    const custom = overrides[c.id];
    if (custom !== undefined) { for (const d of c.keys || []) disabled.add(normalizeCombo(d)); if (custom) map.set(normalizeCombo(custom), c.id); }
  }
  for (const c of commands) if (overrides[c.id] === undefined) for (const d of c.keys || []) { const n = normalizeCombo(d); if (!map.has(n)) map.set(n, c.id); }
  return { map, disabled };
}
export function findConflicts(commands, overrides) {
  const seen = new Map(), out = [];
  for (const c of commands) {
    const combos = overrides[c.id] !== undefined ? (overrides[c.id] ? [overrides[c.id]] : []) : c.keys || [];
    for (const k of combos) { const n = normalizeCombo(k); if (seen.has(n) && seen.get(n) !== c.id) out.push([n, seen.get(n), c.id]); else seen.set(n, c.id); }
  }
  return out;
}
