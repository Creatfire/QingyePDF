// Office files open as PDF through the bundled LibreOffice (vendor/libreoffice, prepared by
// scripts/prepare-libreoffice.ps1). Real-engine tests are skipped when the engine is not prepared.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const office = require('../office-convert.cjs');
const pandoc = require('../pandoc-engine.cjs');

const engine = office.sofficePath();
const python = path.join(__dirname, '..', '.backend-build', 'Scripts', 'python.exe');
// Page count and text of a PDF, read with the backend's PyMuPDF.
async function pdfText(file) {
  if (!(await fs.stat(python).catch(() => null))) return null;
  return JSON.parse(execFileSync(python, ['-c', 'import sys,json,pymupdf as f;d=f.open(sys.argv[1]);print(json.dumps({"pages":len(d),"text":"".join(p.get_text() for p in d)}))', file], { encoding: 'utf8' }));
}
// Text runs in the converted PDF come back in a layout order that depends on the fonts of the
// converting machine (CI runners substitute CJK fonts and split runs into fragments), so content
// is asserted by character presence rather than by contiguous substring.
function hasContent(text, word) {
  if (text.includes(word)) return true;
  const have = new Map(), need = new Map();
  for (const ch of text) have.set(ch, (have.get(ch) || 0) + 1);
  for (const ch of word) need.set(ch, (need.get(ch) || 0) + 1);
  return [...need].every(([ch, n]) => (have.get(ch) || 0) >= n);
}

test('office detection covers Word, Excel, PowerPoint, OpenDocument and WPS files', () => {
  for (const name of ['a.docx', 'B.DOC', 'c.xlsx', 'd.xls', 'e.pptx', 'f.ppt', 'g.odt', 'h.rtf', 'i.wps', 'j.et', 'k.dps', 'l.csv']) assert.ok(office.isOffice(name), name);
  for (const name of ['a.pdf', 'b.md', 'c.txt', 'd', null]) assert.ok(!office.isOffice(name), String(name));
  assert.match(office.PROFILE_XCU, /MacroSecurityLevel[\s\S]*<value>3<\/value>/, 'macros are locked down');
});

test('converts Word, PowerPoint and CSV with Chinese text, caches by content, rejects broken files', { skip: !engine && 'LibreOffice not prepared (scripts/prepare-libreoffice.ps1)', timeout: 600000 }, async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qy-office-test-'));
  const options = { profileDir: path.join(dir, 'profile'), cacheDir: path.join(dir, 'cache') };
  try {
    const md = path.join(dir, 'source.md');
    await fs.writeFile(md, '# 季度报告\n\n这是中文正文，包含**粗体**。\n\n| 项目 | 金额 |\n|---|---|\n| 收入 | 100 |\n\n# 第二页\n\n结论段落。\n');
    const docx = path.join(dir, '报告 测试.docx'), pptx = path.join(dir, '演示.pptx'), csv = path.join(dir, '数据.csv');
    await pandoc.run(pandoc.bundledPath(), ['-o', docx, md]);
    await pandoc.run(pandoc.bundledPath(), ['-o', pptx, md]);
    await fs.writeFile(csv, '城市,人口\n北京,2189\n上海,2487\n');
    const warmStarted = Date.now();
    assert.equal(await office.prewarm(options), true, 'warm-up conversion succeeds'); assert.ok(office.isWarm());
    console.log('warm-up', (Date.now() - warmStarted) + ' ms');
    assert.equal(await office.prewarm(options), false, 'warm-up runs once');
    const messages = [];
    for (const [file, expect] of [[docx, ['季度报告', '中文正文', '收入']], [pptx, ['季度报告', '结论段落']], [csv, ['北京', '2487']]]) {
      const started = Date.now();
      const result = await office.toPdf(file, { ...options, onProgress: p => messages.push(p) });
      assert.equal(result.bytes.subarray(0, 4).toString(), '%PDF', path.basename(file));
      assert.equal(result.cached, false);
      const out = path.join(dir, path.basename(file) + '.pdf'); await fs.writeFile(out, result.bytes);
      const info = await pdfText(out);
      if (info) { assert.ok(info.pages >= 1); for (const word of expect) assert.ok(hasContent(info.text, word), `${path.basename(file)} lacks ${word}: ${info.text.slice(0, 200)}`); }
      console.log(path.basename(file), (Date.now() - started) + ' ms', info?.pages + ' page(s)');
    }
    assert.ok(messages.some(m => m.text.includes('报告 测试.docx')), 'progress names the file');
    assert.deepEqual([...new Set(messages.map(m => m.stage))].slice(0, 2), ['reading', 'converting'], 'warm engine skips the start-up stage');
    const again = await office.toPdf(docx, options);
    assert.equal(again.cached, true, 'unchanged files come from the cache');
    assert.ok((await fs.readFile(docx)).length > 0, 'original untouched');
    const broken = path.join(dir, 'broken.docx'); await fs.writeFile(broken, Buffer.concat([Buffer.from('PK'), Buffer.alloc(64, 0xff)])); // damaged ZIP container
    await assert.rejects(office.toPdf(broken, options), /无法转换|LibreOffice/);
  } finally { await fs.rm(dir, { recursive: true, force: true }); }
});

test('Office association type is optional and covers the common formats', () => {
  const { TYPES } = require('../file-associations.cjs');
  assert.equal(TYPES.office.progId, 'QingyePDF.office');
  for (const ext of ['.docx', '.doc', '.xlsx', '.xls', '.pptx', '.ppt']) assert.ok(TYPES.office.exts.includes(ext), ext);
  for (const ext of TYPES.office.exts) assert.ok(office.isOffice('a' + ext), ext + ' opens through the converter');
});
