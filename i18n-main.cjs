// Main-process translations (native menus, dialogs, file filters). Shares the renderer's
// dictionaries in ui/i18n/*.json, keyed by the original Simplified Chinese text.
const path = require('node:path');
const fs = require('node:fs');
const SUPPORTED = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko'];
let language = 'zh-CN', dict = null;
function setLanguage(code) {
  language = SUPPORTED.includes(code) ? code : 'zh-CN';
  dict = null;
  if (language !== 'zh-CN') { try { dict = JSON.parse(fs.readFileSync(path.join(__dirname, 'ui', 'i18n', language + '.json'), 'utf8')).strings; } catch { dict = null; } }
  return language;
}
const T = text => (dict && typeof text === 'string' && dict[text]) || text;
// Template with {placeholders}: the template itself is the dictionary key.
const TF = (template, vars = {}) => T(template).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
// Chromium locale switch (spell-check dictionary, native UI) for the chosen language.
const chromiumLocale = code => ({ 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', en: 'en-US', ja: 'ja', ko: 'ko' })[code] || 'zh-CN';
module.exports = { setLanguage, T, TF, getLanguage: () => language, chromiumLocale, SUPPORTED };
