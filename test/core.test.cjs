const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs/promises');
const path = require('node:path');
const { atomicWrite, fingerprint, pdfBytes, samplePdf, digest } = require('../core.cjs');

test('save replaces the file, rejects external modification and preserves original on failure', async () => {
  const root = path.join(__dirname, '..', 'test-output');
  await fs.mkdir(root, { recursive: true });
  const dir = await fs.mkdtemp(path.join(root, 'save-'));
  const file = path.join(dir, 'sample.pdf');
  const initial = samplePdf('Initial reader');
  const edited = samplePdf('Edited reader');
  assert.ok(pdfBytes(initial).equals(initial));
  assert.throws(() => pdfBytes(Buffer.from('not a pdf')), /PDF/);
  assert.throws(() => pdfBytes({ arbitrary: true }), /PDF/);
  await atomicWrite(file, initial, null);
  assert.equal(await fingerprint(file), digest(initial));
  await atomicWrite(file, edited, digest(initial));
  assert.ok((await fs.readFile(file)).equals(edited));
  await fs.writeFile(file, initial);
  await assert.rejects(() => atomicWrite(file, edited, digest(edited)), /其他程序修改/);
  assert.ok((await fs.readFile(file)).equals(initial));
  assert.deepEqual(await fs.readdir(dir), ['sample.pdf']);
  await assert.rejects(() => atomicWrite(path.join(dir, 'missing', 'sample.pdf'), edited, null), { code: 'ENOENT' });
  assert.ok((await fs.readFile(file)).equals(initial));
});

test('bundled PDF feature guide (home page "示例：PDF") is a small, complete PDF', () => {
  const bytes = require('node:fs').readFileSync(require('node:path').join(__dirname, '..', 'ui', 'sample-guide.pdf'));
  assert.equal(bytes.subarray(0, 5).toString(), '%PDF-');
  assert.ok(bytes.length > 100000 && bytes.length < 2 * 1024 * 1024, 'size ' + bytes.length);
  assert.equal((bytes.toString('latin1').match(/\/Type\s*\/Page(?![s\w])/g) || []).length, 7, 'seven pages');
  assert.ok(bytes.toString('latin1').includes('/Outlines'), 'has bookmarks');
});
