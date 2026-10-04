// Mobile counterpart of i18n-main.cjs: same API, dictionaries fetched from the bundled ui/i18n.
const SUPPORTED = ['zh-CN', 'zh-TW', 'en', 'ja', 'ko'];
let language = 'zh-CN', dict = null, loading = Promise.resolve();
const cache = new Map();
function setLanguage(code) {
  language = SUPPORTED.includes(code) ? code : 'zh-CN'; dict = cache.get(language) || null;
  if (language !== 'zh-CN' && !dict) { const wanted = language; loading = fetch(new URL(`i18n/${wanted}.json`, document.baseURI)).then(r => r.json()).then(data => { cache.set(wanted, data.strings || {}); if (language === wanted) dict = cache.get(wanted); }).catch(() => {}); }
  return language;
}
const T = text => (dict && typeof text === 'string' && dict[text]) || text;
const TF = (template, vars = {}) => T(template).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
const chromiumLocale = code => code;
const whenLoaded = () => loading;
export { setLanguage, T, TF, chromiumLocale, SUPPORTED, whenLoaded };
export const getLanguage = () => language;
export default { setLanguage, T, TF, getLanguage, chromiumLocale, SUPPORTED, whenLoaded };
