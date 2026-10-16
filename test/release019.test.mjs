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
