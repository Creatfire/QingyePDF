// 0.21 toolbar and tool center: the shared tool table, search ranking, pins and recent tools,
// and the static wiring between the toolbar markup, the toolbox form and the dictionaries.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { TOOLS, TOOL_GROUPS, DEFAULT_COMMON, MAX_PINNED, tool, toolForAction, needsPdf, searchTools, rankItems, pushRecent, togglePin, validIds } from '../ui/tool-registry.mjs';

const read = file => readFileSync(new URL('../' + file, import.meta.url), 'utf8');

test('every tool has a known group, an icon and exactly one way to open', () => {
  const groups = new Set(TOOL_GROUPS.map(([id]) => id)), icons = new Set([...read('ui/icons.css').matchAll(/data-icon="([a-z-]+)"\]/g)].map(m => m[1]));
  assert.equal(new Set(TOOLS.map(t => t.id)).size, TOOLS.length, 'unique ids');
  for (const t of TOOLS) {
    assert.ok(groups.has(t.group), t.id + ' group');
    assert.ok(icons.has(t.icon), t.id + ' icon ' + t.icon);
    assert.ok(!!t.action !== !!t.run, t.id + ' has either action or run');
    assert.ok(t.label && t.desc, t.id + ' label and description');
  }
  for (const id of DEFAULT_COMMON) assert.ok(tool(id) && !tool(id).hidden, 'common tool ' + id);
});

test('every toolbox action is reachable from the tool table, and every table action exists in the form', () => {
  const form = new Set([...read('ui/tools.mjs').matchAll(/<option value="([a-z-]+)">/g)].map(m => m[1]));
  const actions = new Set(TOOLS.filter(t => t.action).map(t => t.action));
  for (const action of actions) assert.ok(form.has(action), 'form has ' + action);
  for (const action of ['export', 'import', 'organize', 'compress', 'ocr', 'compare', 'text', 'redact', 'stamp', 'image', 'page-stamp', 'watermark', 'number', 'shape', 'annotation', 'form', 'crop', 'flatten', 'outline', 'encrypt', 'decrypt', 'sharpen', 'scan']) assert.ok(actions.has(action), 'table covers ' + action);
  assert.equal(toolForAction('export').id, 'export-office', 'plain export opens the Word entry');
  assert.equal(toolForAction('text').id, 'text', 'hidden tools still resolve');
  assert.equal(needsPdf(tool('import')), false); assert.equal(needsPdf(tool('converter')), false); assert.equal(needsPdf(tool('compress')), true);
});

test('search ranks label matches first and needs every term', () => {
  assert.equal(searchTools('压缩')[0].id, 'compress');
  assert.equal(searchTools('密码')[0].id, 'encrypt', 'label prefix beats keyword');
  assert.deepEqual(searchTools('word').map(t => t.id).slice(0, 1), ['export-office']);
  assert.ok(searchTools('印章 图片').every(t => /图片|印章/.test(t.label + t.keys)), 'all terms must match');
  assert.deepEqual(searchTools('不存在的工具'), []);
  assert.equal(searchTools('').length, TOOLS.length, 'empty query lists everything');
  const items = [{ label: '打印', keys: 'print' }, { label: '扁平化', keys: '打印前固定' }];
  assert.deepEqual(rankItems(items, '打印').map(i => i.label), ['打印', '扁平化']);
  assert.deepEqual(rankItems(items, 'PRINT').map(i => i.label), ['打印'], 'case-insensitive');
});

test('recent and pinned lists stay valid, ordered and bounded', () => {
  assert.deepEqual(pushRecent(['ocr', 'compress'], 'compress'), ['compress', 'ocr']);
  assert.deepEqual(pushRecent(['ocr'], 'no-such-tool'), ['ocr']);
  assert.equal(pushRecent(TOOLS.map(t => t.id), 'ocr', 6).length, 6);
  assert.deepEqual(togglePin(['ocr'], 'ocr'), []);
  assert.deepEqual(togglePin(['ocr'], 'compress'), ['ocr', 'compress']);
  const full = TOOLS.slice(0, MAX_PINNED).map(t => t.id);
  assert.deepEqual(togglePin(full, TOOLS[MAX_PINNED].id), full, 'no more than the limit');
  assert.deepEqual(validIds(['ocr', 'ocr', 'gone', 3]), ['ocr']);
  assert.deepEqual(validIds('not a list'), []);
});

test('toolbar markup: menus exist, kept ids are present, the old toolbox header is gone', () => {
  const html = read('ui/index.html'), tools = read('ui/tools.mjs');
  for (const id of ['saveButton', 'saveAsButton', 'saveMenuButton', 'printButton', 'undoButton', 'redoButton', 'historyButton', 'selectTextButton', 'handToolButton', 'annotateButton', 'directButton', 'pdfNotesButton', 'searchButton', 'outlineButton', 'viewButton', 'pinnedTools', 'toolsButton', 'moreButton', 'aiButton', 'commandButton', 'compareView', 'newWindowView'])
    assert.match(html, new RegExp(`id="${id}"`), id);
  for (const [, button, menu] of html.matchAll(/id="([A-Za-z]+)"[^>]*popovertarget="([A-Za-z]+)"/g))
    assert.match(html, new RegExp(`<section id="${menu}"`), button + ' opens ' + menu);
  assert.doesNotMatch(tools, /id="compareTool"|id="newWindowTool"|toolCategories/, 'compare and new window moved to the view menu');
  assert.match(tools, /id="toolHome"/); assert.match(tools, /id="toolDetail"/);
});

test('new interface strings are translated in every language', () => {
  const load = code => JSON.parse(read(`ui/i18n/${code}.json`)).strings;
  const en = load('en');
  for (const text of ['打印', '全部工具…', '固定到工具栏', '搜索命令', '修改页面内容，保存后写入 PDF', '标记与评论，不改动原文', '放不下的按钮', '没有找到匹配的命令。'])
    for (const code of ['en', 'zh-TW', 'ja', 'ko']) assert.ok(load(code)[text], `${code}: ${text}`);
  // Text without Chinese characters (e.g. "DOCX、XLSX、PPTX") is shown as written in every language.
  const chinese = text => /[\u3400-\u9fff]/.test(text);
  for (const t of TOOLS) for (const text of [t.label, t.desc]) if (chinese(text)) assert.ok(en[text], 'tool text translated: ' + text);
});
