// Display language for the application UI (0.8.2).
// The interface is written in Simplified Chinese; other languages are dictionaries keyed by the
// original text (ui/i18n/<code>.json → { strings: {原文: 译文}, patterns: [[regex, replacement]] }).
// A MutationObserver translates text nodes and title / aria-label / placeholder attributes as the
// UI renders them, and remembers the original so switching language (or back to Chinese) works
// without reloading. Document content (Markdown text, PDF pages, file names) is never touched.
export const LANGUAGES = [
  ['auto', '跟随系统'],
  ['zh-CN', '简体中文'],
  ['zh-TW', '繁體中文'],
  ['en', 'English'],
  ['ja', '日本語'],
  ['ko', '한국어'],
];
import { adapterFor } from '../platform-text.mjs';
const KEY = 'qingye.language';
// Shortcuts and a few system names are shown the way the platform writes them (macOS, Android).
const adapt = adapterFor(globalThis.desktop?.platform) || (text => text);
const ATTRS = ['title', 'aria-label', 'placeholder', 'alt'];
// Areas whose text belongs to the user's documents or file system.
const SKIP = '[translate="no"], .mdEditorHost, .mdOutlineList, .mdFileList, .mdFileRoot, .recentText, .tabText, #compareNames, #statusDetail, #toolDocument, .mdPaletteList small, .mdPrintStaging, .mdVersionRow small, script, style, textarea, code, pre, kbd';
let lang = 'zh-CN', dict = null, patterns = [], observer = null;
const textState = new WeakMap(), attrState = new WeakMap();
const listeners = new Set();

export function resolve(choice) {
  if (choice && choice !== 'auto') return LANGUAGES.some(([c]) => c === choice) ? choice : 'zh-CN';
  const nav = (navigator.languages?.[0] || navigator.language || 'zh-CN').toLowerCase();
  if (nav.startsWith('zh')) return /tw|hk|mo|hant/.test(nav) ? 'zh-TW' : 'zh-CN';
  if (nav.startsWith('ja')) return 'ja';
  if (nav.startsWith('ko')) return 'ko';
  return nav.startsWith('en') ? 'en' : 'en';
}
export const choice = () => { try { return localStorage.getItem(KEY) || 'auto'; } catch { return 'auto'; } };
export const current = () => lang;

export function t(text) {
  if (!dict || typeof text !== 'string' || !/[㐀-鿿！-～]/.test(text)) return text;
  const lead = text.match(/^\s*/)[0], trail = text.match(/\s*$/)[0], core = text.trim();
  if (!core) return text;
  let out = dict[core];
  if (out == null) for (const [re, rep] of patterns) { if (re.test(core)) { out = core.replace(re, (...m) => rep.replace(/\$(\d)/g, (_, i) => t(m[Number(i)] ?? ''))); break; } }
  return out == null ? text : lead + out + trail;
}
// Template with {placeholders}; the template is the dictionary key.
export const tf = (template, vars = {}) => t(template).replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');

const skipped = el => !!el?.closest?.(SKIP);
function translateText(node) {
  const value = node.nodeValue;
  let rec = textState.get(node);
  if (!rec || value !== rec.shown) rec = { orig: value };
  const out = adapt(lang === 'zh-CN' ? rec.orig : t(rec.orig));
  rec.shown = out; textState.set(node, rec);
  if (out !== value) node.nodeValue = out;
}
function translateAttrs(el) {
  let recs = attrState.get(el);
  for (const name of ATTRS) {
    if (!el.hasAttribute(name)) continue;
    const value = el.getAttribute(name);
    recs ||= {};
    let rec = recs[name];
    if (!rec || value !== rec.shown) rec = { orig: value };
    const out = adapt(lang === 'zh-CN' ? rec.orig : t(rec.orig));
    rec.shown = out; recs[name] = rec;
    if (out !== value) el.setAttribute(name, out);
  }
  if (recs) attrState.set(el, recs);
}
function walk(root) {
  if (root.nodeType === 3) { if (!skipped(root.parentElement)) translateText(root); return; }
  if (root.nodeType !== 1 && root.nodeType !== 9 && root.nodeType !== 11) return;
  if (root.nodeType === 1 && skipped(root)) return;
  if (root.nodeType === 1) translateAttrs(root);
  const w = document.createTreeWalker(root, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: n => n.nodeType === 1 && n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  for (let n = w.nextNode(); n; n = w.nextNode()) n.nodeType === 3 ? translateText(n) : translateAttrs(n);
}
let titleOrig = null;
function translateTitle() { titleOrig ??= document.title; document.title = lang === 'zh-CN' ? titleOrig : t(titleOrig); }

function observe() {
  observer?.disconnect();
  observer = new MutationObserver(records => {
    for (const r of records) {
      if (r.type === 'characterData') { if (!skipped(r.target.parentElement)) translateText(r.target); }
      else if (r.type === 'attributes') { if (!skipped(r.target)) translateAttrs(r.target); }
      else for (const n of r.addedNodes) walk(n);
    }
  });
  observer.observe(document.documentElement, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
}

async function load(code) {
  if (code === 'zh-CN') return { strings: null, patterns: [] };
  const url = new URL(`./${code}.json`, import.meta.url);
  const data = await (await fetch(url)).json();
  return { strings: data.strings || {}, patterns: (data.patterns || []).map(([re, rep]) => [new RegExp(re), rep]) };
}

export async function setLanguage(next, { remember = true } = {}) {
  if (remember) { try { next === 'auto' ? localStorage.removeItem(KEY) : localStorage.setItem(KEY, next); } catch {} }
  const code = resolve(next);
  try { const data = await load(code); lang = code; dict = data.strings; patterns = data.patterns; }
  catch (error) { console.warn('Language', code, error); lang = 'zh-CN'; dict = null; patterns = []; }
  document.documentElement.lang = lang === 'zh-CN' ? 'zh-CN' : lang;
  walk(document.body); translateTitle();
  if (!observer) observe();
  for (const fn of listeners) try { fn(lang); } catch (error) { console.warn(error); }
  return lang;
}
export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
export const init = () => setLanguage(choice(), { remember: false });
