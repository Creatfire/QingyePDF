// Interface text is written once, for Windows ("Ctrl+S", "资源管理器"). This adapts what is shown
// to the platform the app runs on, after translation (see i18n/i18n.mjs):
//   macOS   → Mac modifier symbols and names (⌘S, 访达)
//   Android → keyboard hints are removed; a touch screen has no use for them
// Document content is never touched: the caller skips those areas.

const KEY = String.raw`F\d{1,2}|Tab|Enter|Esc|Escape|Space|Backspace|Delete|Home|End|PageUp|PageDown|[←→↑↓]|[A-Za-z0-9\\/\[\]\-=` + '`' + String.raw`;',.]|\+`;
const COMBO = String.raw`(?:(?:Ctrl|Alt|Shift)\s*\+\s*)+(?:${KEY})(?![A-Za-z0-9])`;
const combo = new RegExp(String.raw`(?<![A-Za-z])((?:(?:Ctrl|Alt|Shift)\s*\+\s*)+)(${KEY})(?![A-Za-z0-9])`, 'g');
const QUICK = /Ctrl|Alt|Shift\s*\+|\bF\d{1,2}\b|Esc|资源管理器|檔案總管|Explorer|エクスプローラー|탐색기|Windows|右键|鼠标|悬停|ight[- ]click/;

// Command belongs to the system for these keys on a Mac (app switcher, hide); the Control key works.
const CONTROL_ONLY = new Set(['TAB', 'H']);
const MAC_KEYS = { Enter: '↩', Backspace: '⌫', Delete: '⌦', Escape: 'Esc', Space: '空格' };
function macCombo(_all, modifiers, key) {
  const has = name => new RegExp(name, 'i').test(modifiers), shown = key.length === 1 ? key.toUpperCase() : MAC_KEYS[key] || key;
  const control = has('Ctrl') && CONTROL_ONLY.has(shown.toUpperCase());
  return (control ? '⌃' : '') + (has('Alt') ? '⌥' : '') + (has('Shift') ? '⇧' : '') + (has('Ctrl') && !control ? '⌘' : '') + shown;
}
const MAC_WORDS = [
  [/(?<![A-Za-z⌘⌃⌥⇧])F11(?![0-9])/g, '⌃⌘F'],
  [/(?<![A-Za-z])Ctrl(?![A-Za-z])/g, '⌘'], [/(?<![A-Za-z])Alt(?![A-Za-z])/g, '⌥'],
  [/在资源管理器中/g, '在访达中'], [/资源管理器/g, '访达'], [/檔案總管/g, 'Finder'], [/\bFile Explorer\b|\bWindows Explorer\b|\bExplorer\b/g, 'Finder'], [/エクスプローラー/g, 'Finder'], [/탐색기/g, 'Finder'],
];
export function macText(text) {
  let out = text.replace(combo, macCombo);
  for (const [pattern, value] of MAC_WORDS) out = out.replace(pattern, value);
  return out;
}

const HINT = String.raw`(?:${COMBO}|(?<![A-Za-z])F\d{1,2}(?![0-9])|(?<![A-Za-z])Esc(?![A-Za-z]))`;
const TOUCH_RULES = [
  // "保存 · Ctrl+S", "搜索 · Ctrl+F / F3"
  [new RegExp(String.raw`\s*[·•]\s*${HINT}(?:\s*[/、]\s*${HINT})*(?:\s*(?:取消|退出))?`, 'g'), ''],
  // "（Ctrl+\）", "(Ctrl+Shift+E)"
  [new RegExp(String.raw`\s*[（(]\s*${HINT}(?:\s*[/、]\s*${HINT})*\s*[）)]`, 'g'), ''],
  // "；Ctrl+\ 退出", "，按 Esc 取消", "或按 Ctrl+Shift+E"
  [new RegExp(String.raw`[；;，,]\s*(?:或)?(?:按\s*)?${HINT}\s*(?:退出|取消|关闭)?`, 'g'), ''],
  [new RegExp(String.raw`\s*或\s*(?:按\s*)?${HINT}`, 'g'), ''],
  // "可以用 Ctrl+Z 撤销" → "可以撤销"
  [new RegExp(String.raw`(?:可以)?用\s*${HINT}\s*(撤销|重做|保存)`, 'g'), '可以$1'],
  // A long press is the right click of a touch screen.
  [/单击右键|右键单击|右键点击|点击右键|右键/g, '长按'], [/拖动鼠标/g, '拖动'], [/鼠标悬停|悬停/g, '轻点'], [/\bright[- ]click/gi, 'long-press'],
];
const onlyHint = new RegExp(String.raw`^\s*${HINT}(?:\s*[/、]\s*${HINT})*\s*$`);
export function touchText(text) {
  if (onlyHint.test(text)) return '';
  let out = text;
  for (const [pattern, value] of TOUCH_RULES) out = out.replace(pattern, value);
  return out;
}

export function platformText(text, platform) {
  if (typeof text !== 'string' || !QUICK.test(text)) return text;
  return platform === 'darwin' ? macText(text) : platform === 'android' ? touchText(text) : text;
}
/** The adapter for the platform this window runs on, or null when nothing needs adapting. */
export function adapterFor(platform) { return platform === 'darwin' || platform === 'android' ? text => platformText(text, platform) : null; }
