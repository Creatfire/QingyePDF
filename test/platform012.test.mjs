// 0.12.0: interface text per platform — Mac modifier symbols, and no keyboard hints on Android.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { macText, touchText, platformText, adapterFor } from '../ui/platform-text.mjs';

test('macOS: shortcuts are written with Mac modifier symbols in Mac order', () => {
  assert.equal(macText('保存 · Ctrl+S'), '保存 · ⌘S');
  assert.equal(macText('另存为 · Ctrl+Shift+S'), '另存为 · ⇧⌘S');
  assert.equal(macText('Ctrl+Alt+Shift+k'), '⌥⇧⌘K');
  assert.equal(macText('返回阅读位置 · Alt+←'), '返回阅读位置 · ⌥←');
  assert.equal(macText('笔记模式：左右双开 · Ctrl+\\'), '笔记模式：左右双开 · ⌘\\');
  assert.equal(macText('Ctrl+Enter'), '⌘↩'); assert.equal(macText('Ctrl+/'), '⌘/'); assert.equal(macText('Ctrl+1'), '⌘1'); assert.equal(macText('Shift+Tab'), '⇧Tab');
  assert.equal(macText('打开：Ctrl+O；搜索：Ctrl+F；切换标签：Ctrl+Tab\n保存：Ctrl+S；另存为：Ctrl+Shift+S；全屏：F11'), '打开：⌘O；搜索：⌘F；切换标签：⌃Tab\n保存：⌘S；另存为：⇧⌘S；全屏：⌃⌘F');
});
test('macOS: keys that Command gives to the system keep the Control key', () => {
  assert.equal(macText('Ctrl+Tab'), '⌃Tab'); assert.equal(macText('Ctrl+Shift+Tab'), '⌃⇧Tab');
  assert.equal(macText('查找与替换 · Ctrl+H'), '查找与替换 · ⌃H');
});
test('macOS: bare modifier names and system names', () => {
  assert.equal(macText('按住 Ctrl 单击链接'), '按住 ⌘ 单击链接'); assert.equal(macText('Alt 拖动'), '⌥ 拖动');
  assert.equal(macText('在资源管理器中显示'), '在访达中显示'); assert.equal(macText('Show in File Explorer'), 'Show in Finder');
  assert.equal(macText('F2 重命名'), 'F2 重命名'); assert.equal(macText('Controls and Alternatives'), 'Controls and Alternatives', 'ordinary words are left alone');
});
test('Android: keyboard hints are removed, the rest of the sentence stays', () => {
  assert.equal(touchText('保存 · Ctrl+S'), '保存'); assert.equal(touchText('搜索 · Ctrl+F / F3'), '搜索'); assert.equal(touchText('关闭文档 · Ctrl+W'), '关闭文档');
  assert.equal(touchText('Ctrl+Shift+P'), '', 'a label that is only a shortcut disappears');
  assert.equal(touchText('标题栏的“笔记模式”按钮（Ctrl+\\）选择右侧文档'), '标题栏的“笔记模式”按钮选择右侧文档');
  assert.equal(touchText('笔记模式：点击任一侧即可在其中操作；Ctrl+\\ 退出'), '笔记模式：点击任一侧即可在其中操作');
  assert.equal(touchText('在 PDF 页面上拖动鼠标框选要摘录的区域 · Esc 取消'), '在 PDF 页面上拖动框选要摘录的区域');
  assert.equal(touchText('摘录（右键或 Ctrl+Shift+E）'), '摘录（长按）');
  assert.equal(touchText('右键标签可指定左右'), '长按标签可指定左右'); assert.equal(touchText('Right-click a tab'), 'long-press a tab');
  assert.equal(touchText('修改不会自动保存，可以用 Ctrl+Z 撤销。'), '修改不会自动保存，可以撤销。');
  assert.equal(touchText('没有快捷键的普通句子。'), '没有快捷键的普通句子。');
});
test('the adapter is chosen by platform and leaves Windows text untouched', () => {
  assert.equal(adapterFor('win32'), null); assert.equal(adapterFor('linux'), null);
  assert.equal(adapterFor('darwin')('Ctrl+S'), '⌘S'); assert.equal(adapterFor('android')('保存 · Ctrl+S'), '保存');
  assert.equal(platformText('Ctrl+S', 'win32'), 'Ctrl+S'); assert.equal(platformText(null, 'darwin'), null); assert.equal(platformText('第 3 页', 'darwin'), '第 3 页');
});
test('every shortcut the interface shows is understood by the adapter', () => {
  // Any "Ctrl+…" left in adapted text would be a hint the adapter failed to recognise.
  const sources = ['ui/app.mjs', 'ui/notes-mode.mjs', 'ui/direct.mjs', 'ui/chrome.mjs', 'ui/markdown/host.mjs', 'ui/markdown/registry.mjs', 'ui/index.html'].map(f => readFileSync(new URL('../' + f, import.meta.url), 'utf8')).join('\n');
  const combos = [...new Set(sources.match(/(?:Ctrl|Alt|Shift)(?:\+(?:Ctrl|Alt|Shift))*\+(?:F\d{1,2}|Tab|Enter|[←→↑↓]|\\\\|[A-Za-z0-9/\[\]\-=`;',.])(?![A-Za-z])/g) || [])].map(c => c.replace('\\\\', '\\'));
  assert.ok(combos.length > 40, 'combos found: ' + combos.length);
  for (const text of combos) { assert.doesNotMatch(macText(text), /Ctrl|Alt|Shift/, text); assert.equal(touchText('标签 · ' + text), '标签', text); }
});
