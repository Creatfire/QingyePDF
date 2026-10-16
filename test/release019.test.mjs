// 0.19 pure logic: compare differences, annotation picking, style presets.
import test from 'node:test';
import assert from 'node:assert/strict';
import { pageTokens, diffTokens, hunksOf } from '../ui/compare-diff.mjs';

const item = (str, x, y, width) => ({ str, transform: [10, 0, 0, 10, x, y], width, height: 10 });

test('compare: CJK per character, words otherwise, boxes follow the text', () => {
  const tokens = pageTokens([item('青页 PDF', 0, 100, 60), item('   ', 70, 100, 10)]);
  assert.deepEqual(tokens.map(t => t.text), ['青', '页', 'PDF']);
  assert.ok(tokens[0].rect[0] === 0 && tokens[0].rect[2] > 0 && tokens[2].rect[0] > tokens[1].rect[2] - 0.01);
});

test('compare: hunks group consecutive changes with removed / added text', () => {
  const L = pageTokens([item('第一段 保持 不变 旧词 结尾', 0, 100, 200)]);
  const R = pageTokens([item('第一段 保持 不变 新的词 结尾 追加', 0, 100, 240)]);
  const hunks = hunksOf(diffTokens(L, R), L, R, 3, 4);
  assert.deepEqual(hunks.map(h => [h.left.text, h.right.text]), [['旧', '新的'], ['', '追加']]);
  assert.equal(hunks[0].left.page, 3); assert.equal(hunks[0].right.page, 4);
  assert.ok(hunks[0].left.rects.length === 1 && hunks[0].right.rects.length === 2);
  assert.deepEqual(diffTokens([], [{ text: 'a' }]), [['+', 0]]);
  assert.equal(diffTokens(new Array(3000).fill({ text: 'a' }), new Array(3000).fill({ text: 'b' }), 1e6), null, 'oversized pages fall back');
});

test('annotation picking prefers the smallest box and finds thin lines', async () => {
  const { pickAnnotation } = await import('../ui/annot-edit.mjs');
  const big = { kind: 'Square', box: [0, 0, 200, 200] }, small = { kind: 'Text', box: [50, 50, 70, 70] }, line = { kind: 'Line', box: [0, 300, 200, 300], line: [{ x: 0, y: 300 }, { x: 200, y: 300 }] };
  assert.equal(pickAnnotation([big, small, line], { x: 60, y: 60 }), small);
  assert.equal(pickAnnotation([big, small, line], { x: 150, y: 150 }), big);
  assert.equal(pickAnnotation([big, small, line], { x: 100, y: 304 }), line);
  assert.equal(pickAnnotation([big, small, line], { x: 100, y: 320 }), null);
});

test('style presets: newest first, deduplicated, four per type', async () => {
  const store = new Map();
  globalThis.localStorage = { getItem: k => store.get(k) ?? null, setItem: (k, v) => store.set(k, String(v)) };
  const { readPresets, writePreset } = await import('../ui/annot-presets.mjs');
  assert.equal(readPresets('Square').length, 4, 'defaults');
  writePreset('Square', { color: '#123456', width: 3, fill: '', opacity: 1 });
  writePreset('Square', { color: '#123456', width: 3, fill: '', opacity: 1 });
  const list = readPresets('Square');
  assert.equal(list[0].color, '#123456'); assert.equal(list.filter(p => p.color === '#123456').length, 1); assert.equal(list.length, 4);
  assert.equal(writePreset('Square', { color: 'red' })[0].color, '#123456', 'invalid colours are ignored');
});

test('update check: version order, latest release fields, release page only', async () => {
  const { createRequire } = await import('node:module');
  const u = createRequire(import.meta.url)('../update-check.cjs');
  assert.equal(u.compareVersions('0.19.0', '0.18.0'), 1);
  assert.equal(u.compareVersions('v0.19.0', '0.19.0'), 0);
  assert.equal(u.compareVersions('0.19.0-beta.2', '0.19.0'), -1);
  assert.equal(u.compareVersions('0.10.0', '0.9.9'), 1);
  const seen = [];
  const fetch = async (url, options) => { seen.push([url, options.headers.Accept]); return { ok: true, status: 200, json: async () => ({ tag_name: 'v0.20.0', name: '0.20', html_url: 'https://github.com/Creatfire/QingyePDF/releases/tag/v0.20.0', body: 'notes', assets: [{ name: 'QingyePDF-0.20.0-Setup-x64.exe', size: 300e6 }, { name: 'QingyePDF-0.20.0-x64.zip', size: 400e6 }] }) }; };
  const r = await u.checkForUpdate({ current: '0.19.0', fetch });
  assert.deepEqual([r.latest, r.newer, r.url, r.installer.name, r.zip.name], ['0.20.0', true, 'https://github.com/Creatfire/QingyePDF/releases/tag/v0.20.0', 'QingyePDF-0.20.0-Setup-x64.exe', 'QingyePDF-0.20.0-x64.zip']);
  assert.deepEqual(seen, [[u.LATEST, 'application/vnd.github+json']]);
  assert.equal((await u.checkForUpdate({ current: '0.20.0', fetch })).newer, false);
  const evil = async () => ({ ok: true, status: 200, json: async () => ({ tag_name: 'v9.0.0', html_url: 'https://evil.example/x' }) });
  assert.equal((await u.checkForUpdate({ current: '0.19.0', fetch: evil })).url, 'https://github.com/Creatfire/QingyePDF/releases');
  assert.equal(u.isReleasePage('https://github.com/Creatfire/QingyePDF/releases/tag/v1'), true);
  assert.equal(u.isReleasePage('https://github.com/Creatfire/QingyePDF.evil/releases'), false);
  await assert.rejects(u.checkForUpdate({ current: '0.19.0', fetch: async () => { throw new TypeError('net'); } }), /无法连接/);
  assert.equal((await u.checkForUpdate({ current: '0.19.0', fetch: async () => ({ ok: false, status: 404 }) })).newer, false);
});
