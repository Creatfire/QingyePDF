// Display-language dictionaries and the Windows file-association module (0.8.2).
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
const require = createRequire(import.meta.url);
const root = new URL('../', import.meta.url);
const load = code => JSON.parse(readFileSync(new URL(`ui/i18n/${code}.json`, root), 'utf8'));

test('every language has the same keys, valid patterns and intact placeholders', () => {
  const en = load('en'), keys = Object.keys(en.strings).sort();
  assert.ok(keys.length > 900, 'dictionary size ' + keys.length);
  for (const code of ['zh-TW', 'ja', 'ko']) {
    const d = load(code);
    assert.deepEqual(Object.keys(d.strings).sort(), keys, code + ' keys');
    for (const [re] of d.patterns) new RegExp(re);
    for (const [src, out] of Object.entries(d.strings)) for (const ph of src.match(/\{\w+\}/g) || []) assert.ok(out.includes(ph), `${code}: ${ph} missing in ${out}`);
  }
  for (const [src, out] of Object.entries(en.strings)) assert.ok(!/[一-鿿]/.test(out) || src === out, 'English contains Chinese: ' + out);
});

test('main-process translator follows the chosen language and falls back to Chinese', () => {
  const m = require('../i18n-main.cjs');
  assert.equal(m.setLanguage('en'), 'en');
  assert.equal(m.T('保存'), 'Save');
  assert.equal(m.TF('“{name}”有未保存的修改。', { name: 'a.md' }), '"a.md" has unsaved changes.');
  assert.equal(m.setLanguage('xx'), 'zh-CN');
  assert.equal(m.T('保存'), '保存');
});

test('file associations report unsupported outside packaged Windows builds', async () => {
  const { createAssociations } = require('../file-associations.cjs');
  const a = createAssociations({ app: { isPackaged: false }, shell: { openExternal: async () => {} } });
  const st = await a.status();
  assert.equal(st.supported, false);
  assert.match(st.reason, process.platform === 'darwin' ? /Mac.*访达/ : process.platform === 'win32' ? /开发模式/ : /仅 Windows/);
  await assert.rejects(a.register(), { message: st.reason });
});
