// 0.17.0 interface skins: registry, stylesheet coverage and wiring.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const root = new URL('../', import.meta.url), read = p => readFileSync(new URL(p, root), 'utf8');
const { SKINS } = await import(new URL('ui/skins.mjs', root));

test('every non-classic skin has a stylesheet block and a preview', () => {
  assert.deepEqual(SKINS.map(s => s.id), ['classic', 'glass', 'bento', 'desk', 'blocks', 'dots']);
  const css = read('ui/skins.css');
  for (const s of SKINS.filter(s => s.id !== 'classic')) {
    assert.ok(css.includes(`:root[data-skin="${s.id}"] {`), s.id + ' tokens');
    assert.ok(css.includes(`.sk-${s.id}`), s.id + ' preview');
  }
});
test('skins are wired into the page, settings and app', () => {
  assert.match(read('ui/index.html'), /href="skins\.css"/);
  assert.match(read('ui/settings.mjs'), /skinChoices/);
  assert.match(read('ui/app.mjs'), /createSkins/);
  assert.ok(!read('ui/home/layouts.mjs').includes('character'), 'character home layout removed');
});
