const fs = require('node:fs/promises'); const path = require('node:path'); const assert = require('node:assert/strict');
const { runOffline } = require('../offline.cjs');
(async () => {
  const dir = path.resolve(__dirname, '../test-output/conversion'), bytes = await fs.readFile(path.join(dir, 'converted-pdf-chromium.pdf'));
  const info = await runOffline({ bytes, request: { action: 'inspect' } }); assert.ok(info.data.pages >= 1);
  const text = await runOffline({ bytes, request: { action: 'export', format: 'txt' } }); assert.match(text.files[0].bytes.toString('utf8'), /青页转换测试/); assert.match(text.files[0].bytes.toString('utf8'), /中文段落/);
  const images = await runOffline({ bytes, request: { action: 'export', format: 'png', dpi: 110 } }); const zip = path.join(dir, 'pdf-preview.zip'); await fs.writeFile(zip, images.files[0].bytes);
  require('node:child_process').execFileSync(process.argv[2] || 'python', ['-c', 'import zipfile,sys,pathlib; dest=pathlib.Path(sys.argv[2]).resolve(); z=zipfile.ZipFile(sys.argv[1]); assert all((dest / n).resolve().is_relative_to(dest) for n in z.namelist()); z.extractall(dest)', zip, path.join(dir, 'pdf-preview')], { windowsHide: true });
  await fs.writeFile(path.join(dir, 'pdf-check.json'), JSON.stringify({ pages: info.data.pages, chineseTextPreserved: true, rendered: true }, null, 2)); console.log('PDF text and rendered preview verified.');
})().catch(error => { console.error(error); process.exitCode = 1; });
