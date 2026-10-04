const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
exports.run = async ({ window, app, dialog, diagnostics, output }) => {
  await fs.mkdir(output, { recursive: true }); const run = source => window.webContents.executeJavaScript(source, true), pause = ms => new Promise(r => setTimeout(r, ms));
  const until = async source => { for (let n = 0; n < 160; n++) { if (await run(source)) return; await pause(100); } throw new Error('Conversion UI timed out: ' + source); };
  const oldOpen = dialog.showOpenDialog, oldSave = dialog.showSaveDialog;
  const input = path.join(output, '中文文档.md'); await fs.writeFile(input, '# 青页转换测试\n\n中文段落、**bold** 和公式 $\\frac{a}{b}$.\n\n- 项目一\n- 项目二\n');
  const info = await run('desktop.converterInfo()'); assert.equal(info.bundled, true); assert.equal(info.version, 'pandoc 3.12'); assert.equal(info.readers.length, 51); assert.equal(info.writers.length, 76);
  const report = { version: app.getVersion(), engine: info.version, readers: info.readers.length, writers: info.writers.length, exports: {} };
  try {
    await run('document.getElementById("homeConvertButton").click()'); await until('document.getElementById("convertTo").options.length === 79');
    assert.equal(await run('document.getElementById("converterDialog").open'), true); assert.equal(await run('document.getElementById("convertFrom").options.length'), 52);
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [input] });
    await run('document.getElementById("convertPickInputs").click()'); await until('document.querySelectorAll("#convertFiles li").length === 1');
    await pause(700); await fs.writeFile(path.join(output, 'conversion-center.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    for (const format of ['docx', 'odt', 'epub3', 'html5', 'pdf-chromium', 'chunkedhtml']) {
      const ext = { epub3: 'epub', html5: 'html', 'pdf-chromium': 'pdf', chunkedhtml: 'zip' }[format] || format, target = path.join(output, 'converted-' + format + '.' + ext);
      await run(`(() => { const el = document.getElementById('convertTo'); el.value = ${JSON.stringify(format)}; el.dispatchEvent(new Event('change')); })()`);
      dialog.showSaveDialog = async () => ({ canceled: false, filePath: target });
      await run('document.getElementById("convertPickOutput").click()'); await until('!!document.getElementById("convertOutput").textContent');
      await run('document.getElementById("convertStart").click()'); await until('!document.getElementById("convertStart").disabled');
      assert.equal(await run('document.getElementById("convertStatus").textContent'), '转换完成', await run('document.getElementById("convertLog").textContent'));
      const bytes = await fs.readFile(target); assert.ok(bytes.length > 100); if (format === 'pdf-chromium') assert.equal(bytes.subarray(0, 4).toString(), '%PDF'); if (format === 'chunkedhtml') assert.equal(bytes.readUInt32LE(), 0x04034b50);
      report.exports[format] = { bytes: bytes.length, path: target };
    }
    // A failed run must keep the user's previously successful file.
    const last = report.exports.chunkedhtml.path, saved = await fs.readFile(last);
    await run('document.getElementById("convertArgs").value = JSON.stringify(["--nonexistent-qingye-option"]); document.getElementById("convertStart").click()');
    await until('!document.getElementById("convertStart").disabled'); assert.equal(await run('document.getElementById("convertStatus").textContent'), '转换失败'); assert.deepEqual(await fs.readFile(last), saved); report.failedOutputPreserved = true;
    await run('document.getElementById("convertArgs").value = "[]"; document.getElementById("convertClose").click()');
    assert.equal(await run('document.getElementById("converterDialog").open'), false);
    assert.equal((await run('desktop.mdPandocInfo("")')).bundled, true); report.markdownBundledEngine = true;
    await run('qingye.i18n.setLanguage("en")'); await run('document.getElementById("convertButton").click()');
    await until('document.getElementById("converterTitle").textContent === "Document conversion"'); report.english = true;
    await run('document.getElementById("convertClose").click(); qingye.i18n.setLanguage("zh-CN")');
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2) + '\n'); diagnostics.success(); return report;
  } finally { dialog.showOpenDialog = oldOpen; dialog.showSaveDialog = oldSave; }
};
