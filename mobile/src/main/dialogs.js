// Replacements for Electron's native dialogs: a message box and a file browser drawn in the page.
// All visible text is Simplified Chinese; ui/i18n translates it like the rest of the interface.
import path from 'path';
import fs from '../shims/fs-promises.js';
import { paths } from '../shims/env.js';
import { isNative, Native, backend } from '../shims/backend.js';

const el = (tag, props = {}, ...children) => { const node = document.createElement(tag); for (const [k, v] of Object.entries(props)) { if (k === 'class') node.className = v; else if (k === 'text') node.textContent = v; else if (k.startsWith('on')) node[k] = v; else if (v !== false && v != null) node.setAttribute(k, v === true ? '' : v); } node.append(...children.filter(c => c != null)); return node; };
function modal(className) {
  const dialog = el('dialog', { class: 'qmDialog ' + className });
  document.body.append(dialog);
  const close = () => { if (dialog.open) dialog.close(); dialog.remove(); };
  return { dialog, close };
}

export function showMessageBox(_window, options = {}) {
  return new Promise(resolve => {
    const { dialog, close } = modal('qmMessage');
    const buttons = options.buttons?.length ? options.buttons : ['确定'];
    const cancelId = Number.isInteger(options.cancelId) ? options.cancelId : buttons.length - 1;
    const finish = response => { close(); resolve({ response }); };
    dialog.append(
      el('h2', { text: options.message || options.title || '' }),
      options.detail ? el('p', { class: 'qmDetail', text: options.detail }) : null,
      el('div', { class: 'qmButtons' }, ...buttons.map((label, index) => el('button', { type: 'button', class: index === (options.defaultId ?? 0) ? 'primary' : '', text: label, onclick: () => finish(index) }))));
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(cancelId); });
    dialog.showModal();
  });
}
export function toast(text, ms = 2600) {
  const node = el('div', { class: 'qmToast', role: 'status', text }); document.body.append(node);
  setTimeout(() => node.remove(), ms);
}

// ——— storage access ———
export async function storageState() {
  if (!isNative) return { granted: true };
  try { return applyLocations(await Native.storageState()); } catch { return { granted: false }; }
}
// The shared-storage locations only become real paths once access has been granted.
function applyLocations(state) { for (const name of ['storage', 'documents', 'inbox', 'userData', 'temp']) if (typeof state?.[name] === 'string') paths[name] = state[name]; return state; }
export const requestStorageAccess = () => requestStorage();
async function requestStorage() { if (!isNative) return { granted: true }; try { return applyLocations(await Native.requestStorage()); } catch { return { granted: false }; } }

const sizeText = n => n < 1024 ? n + ' B' : n < 1048576 ? (n / 1024).toFixed(0) + ' KB' : (n / 1048576).toFixed(1) + ' MB';
const dateText = ms => { if (!ms) return ''; const d = new Date(ms), p = n => String(n).padStart(2, '0'); return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`; };
const LAST = 'qingye.mobile.lastFolder';
const remembered = () => { try { return localStorage.getItem(LAST) || ''; } catch { return ''; } };
const remember = dir => { try { localStorage.setItem(LAST, dir); } catch {} };
const extensionsOf = filters => { const list = (filters || []).flatMap(f => f.extensions || []).map(e => String(e).toLowerCase()); return !list.length || list.includes('*') ? null : new Set(list); };

// mode: 'open' | 'save' | 'directory'
function browse({ mode, title, filters, multiple, defaultPath }) {
  return new Promise(resolve => {
    const { dialog, close } = modal('qmFiles');
    const allowed = extensionsOf(filters);
    const firstFilter = (filters || []).find(f => f.extensions?.length && !f.extensions.includes('*'));
    const defaultExt = firstFilter ? '.' + firstFilter.extensions[0] : '';
    let dir = paths.documents, selected = new Map(), granted = true, showAll = false;
    const finish = value => { close(); resolve(value); };
    const heading = el('h2', { text: title || (mode === 'save' ? '保存到' : mode === 'directory' ? '选择文件夹' : '打开文件') });
    const closeButton = el('button', { type: 'button', class: 'qmClose', 'aria-label': '关闭', text: '✕', onclick: () => finish(null) });
    const notice = el('div', { class: 'qmNotice', hidden: true });
    const places = el('div', { class: 'qmPlaces', role: 'group', 'aria-label': '常用位置' });
    const crumbs = el('div', { class: 'qmCrumbs' });
    const list = el('div', { class: 'qmList', role: 'listbox' });
    const nameInput = el('input', { type: 'text', class: 'qmName', 'aria-label': '文件名', autocomplete: 'off', spellcheck: 'false', enterkeyhint: 'done' });
    const confirm = el('button', { type: 'button', class: 'primary qmConfirm' });
    const newFolder = el('button', { type: 'button', text: '新建文件夹' });
    const importButton = el('button', { type: 'button', text: '从其他应用导入…' });
    const filterToggle = el('button', { type: 'button', class: 'qmFilterToggle', text: '显示全部文件' });
    const footer = el('div', { class: 'qmFooter' });
    if (mode === 'save') footer.append(nameInput);
    footer.append(el('div', { class: 'qmButtons' }, mode !== 'open' ? newFolder : null, mode === 'open' && isNative ? importButton : null, mode === 'open' && allowed ? filterToggle : null, confirm));
    dialog.append(el('header', {}, heading, closeButton), notice, places, crumbs, list, footer);

    const placeList = () => [['内部存储', paths.storage], ['文档', paths.documents], ['下载', path.join(paths.storage, 'Download')], ['青页文件夹', paths.inbox]];
    const updateConfirm = () => {
      if (mode === 'open') { confirm.textContent = multiple && selected.size > 1 ? `打开（${selected.size}）` : '打开'; confirm.disabled = !selected.size; confirm.hidden = !multiple; }
      else if (mode === 'save') confirm.textContent = '保存';
      else confirm.textContent = '选择此文件夹';
    };
    async function show(next) {
      dir = path.resolve(next); selected = new Map(); list.textContent = ''; crumbs.textContent = '';
      places.textContent = '';
      for (const [label, target] of granted ? placeList() : [['青页文件夹', paths.inbox]]) places.append(el('button', { type: 'button', class: path.resolve(target) === dir ? 'isCurrent' : '', text: label, onclick: () => show(target) }));
      const root = granted ? paths.storage : paths.inbox;
      const inside = dir === root || dir.startsWith(root + '/');
      const parts = inside ? path.relative(root, dir).split('/').filter(Boolean) : dir.split('/').filter(Boolean);
      const base = inside ? root : '/';
      crumbs.append(el('button', { type: 'button', text: inside ? (granted ? '内部存储' : '青页文件夹') : '/', onclick: () => show(base) }));
      parts.forEach((part, index) => crumbs.append(el('span', { text: '›', 'aria-hidden': 'true' }), el('button', { type: 'button', text: part, translate: 'no', onclick: () => show(path.join(base, ...parts.slice(0, index + 1))) })));
      crumbs.scrollLeft = crumbs.scrollWidth;
      let entries;
      try { await fs.mkdir(dir, { recursive: true }).catch(() => {}); entries = await backend.readdir(dir); }
      catch (error) { list.append(el('p', { class: 'qmEmpty', text: '无法读取此文件夹。' })); updateConfirm(); return; }
      const rows = [];
      for (const entry of entries) {
        if (entry.name.startsWith('.')) continue;
        const full = path.join(dir, entry.name), isDir = entry.type === 'dir';
        if (!isDir && mode === 'directory') continue;
        const ext = path.extname(entry.name).slice(1).toLowerCase();
        const matches = isDir || !allowed || showAll || allowed.has(ext);
        if (!matches && mode === 'open') continue;
        rows.push({ name: entry.name, full, isDir, info: { size: entry.size, mtimeMs: entry.mtime }, dim: !matches });
      }
      rows.sort((a, b) => a.isDir === b.isDir ? a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' }) : a.isDir ? -1 : 1);
      if (dir !== base && inside) rows.unshift({ name: '..', full: path.dirname(dir), isDir: true, up: true });
      for (const row of rows) {
        const kind = row.isDir ? 'folder' : /pdf$/i.test(row.name) ? 'pdf' : /\.(md|markdown|mdown|mkd|mkdn|mdwn)$/i.test(row.name) ? 'md' : /\.(png|jpe?g|gif|webp|bmp|svg|avif)$/i.test(row.name) ? 'img' : 'file';
        const item = el('button', { type: 'button', class: 'qmRow' + (row.dim ? ' isDim' : ''), role: 'option', 'data-kind': kind },
          row.up || kind === 'folder' || kind === 'img' || kind === 'file' ? el('span', { class: 'qmIcon', 'aria-hidden': 'true', 'data-icon': row.up ? 'up' : kind === 'folder' ? 'open' : kind === 'img' ? 'image' : 'file' }) : el('span', { class: 'qmIcon', 'aria-hidden': 'true', text: kind === 'pdf' ? 'PDF' : 'MD' }),
          el('span', { class: 'qmText' }, el('strong', row.up ? { text: '上一级' } : { text: row.name, translate: 'no' }), row.isDir || !row.info ? null : el('small', { text: `${sizeText(row.info.size)} · ${dateText(row.info.mtimeMs)}` })));
        item.onclick = () => {
          if (row.isDir) return show(row.full);
          if (mode === 'save') { nameInput.value = row.name; return; }
          if (!multiple) return finish({ paths: [row.full], dir });
          if (selected.has(row.full)) { selected.delete(row.full); item.classList.remove('isSelected'); item.setAttribute('aria-selected', 'false'); }
          else { selected.set(row.full, true); item.classList.add('isSelected'); item.setAttribute('aria-selected', 'true'); }
          updateConfirm();
        };
        list.append(item);
      }
      if (!rows.some(row => !row.up)) list.append(el('p', { class: 'qmEmpty', text: mode === 'open' ? '此文件夹中没有可打开的文件。' : '此文件夹是空的。' }));
      list.scrollTop = 0; updateConfirm();
    }
    confirm.onclick = async () => {
      if (mode === 'open') return finish({ paths: [...selected.keys()], dir });
      if (mode === 'directory') return finish({ paths: [dir], dir });
      let name = nameInput.value.trim().replace(/[\\/:*?"<>|\x00-\x1f]/g, '_');
      if (!name || name === '.' || name === '..') { nameInput.focus(); return; }
      if (defaultExt && !path.extname(name)) name += defaultExt;
      const target = path.join(dir, name);
      if (await fs.stat(target).catch(() => null)) { const choice = await showMessageBox(null, { message: `“${name}”已存在。`, detail: '是否替换已有文件？', buttons: ['替换', '取消'], defaultId: 1, cancelId: 1 }); if (choice.response !== 0) return; }
      finish({ paths: [target], dir });
    };
    nameInput.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); confirm.click(); } };
    newFolder.onclick = async () => {
      const name = await promptText('新建文件夹', '文件夹名称', '新建文件夹'); if (!name) return;
      try { await fs.mkdir(path.join(dir, name.replace(/[\\/:*?"<>|\x00-\x1f]/g, '_'))); await show(path.join(dir, name)); } catch (error) { toast('无法创建文件夹：' + (error.code === 'EEXIST' ? '同名项目已存在' : error.message)); }
    };
    filterToggle.onclick = () => { showAll = !showAll; filterToggle.textContent = showAll ? '只显示支持的文件' : '显示全部文件'; show(dir); };
    importButton.onclick = async () => {
      importButton.disabled = true;
      try { const result = await Native.pickAndImport({ multiple: !!multiple, extensions: allowed ? [...allowed] : [] }); if (result?.paths?.length) finish({ paths: result.paths, dir }); }
      catch (error) { toast('导入失败：' + (error?.message || error)); }
      finally { importButton.disabled = false; }
    };
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
    (async () => {
      const state = await storageState(); granted = !!state.granted;
      if (!granted) {
        notice.hidden = false;
        notice.append(el('span', { text: '尚未授予“所有文件访问权限”，目前只能使用青页自己的文件夹；其他位置的文件请用“从其他应用导入”。' }), el('button', { type: 'button', class: 'primary', text: '去授权', onclick: async () => { const next = await requestStorage(); if (next.granted) { granted = true; notice.hidden = true; show(paths.documents); } } }));
      }
      let start = defaultPath ? (mode === 'save' ? path.dirname(defaultPath) : defaultPath) : remembered() || (granted ? paths.documents : paths.inbox);
      if (!granted && !(start === paths.inbox || start.startsWith(paths.inbox + '/'))) start = paths.inbox;
      if (!await fs.stat(start).then(s => s.isDirectory(), () => false)) start = granted ? paths.documents : paths.inbox;
      if (mode === 'save') nameInput.value = defaultPath ? path.basename(defaultPath) : '未命名' + defaultExt;
      dialog.showModal(); await show(start);
    })();
  }).then(result => { if (result?.dir) remember(result.dir); return result; });
}
export function promptText(title, label, value = '') {
  return new Promise(resolve => {
    const { dialog, close } = modal('qmMessage');
    const input = el('input', { type: 'text', 'aria-label': label, value, autocomplete: 'off', enterkeyhint: 'done' });
    const finish = result => { close(); resolve(result); };
    dialog.append(el('h2', { text: title }), input, el('div', { class: 'qmButtons' }, el('button', { type: 'button', text: '取消', onclick: () => finish(null) }), el('button', { type: 'button', class: 'primary', text: '确定', onclick: () => finish(input.value.trim() || null) })));
    input.onkeydown = event => { if (event.key === 'Enter') { event.preventDefault(); finish(input.value.trim() || null); } };
    dialog.addEventListener('cancel', event => { event.preventDefault(); finish(null); });
    dialog.showModal(); input.select();
  });
}
export async function showOpenDialog(_window, options = {}) {
  const props = options.properties || [];
  const directory = props.includes('openDirectory');
  const result = await browse({ mode: directory ? 'directory' : 'open', title: options.title, filters: options.filters, multiple: props.includes('multiSelections'), defaultPath: options.defaultPath });
  return result?.paths?.length ? { canceled: false, filePaths: result.paths } : { canceled: true, filePaths: [] };
}
export async function showSaveDialog(_window, options = {}) {
  let defaultPath = options.defaultPath;
  if (defaultPath && !path.isAbsolute(defaultPath)) defaultPath = path.join(remembered() || paths.documents, defaultPath);
  const result = await browse({ mode: 'save', title: options.title, filters: options.filters, defaultPath });
  return result?.paths?.length ? { canceled: false, filePath: result.paths[0] } : { canceled: true };
}
export const dialog = { showMessageBox, showOpenDialog, showSaveDialog };
