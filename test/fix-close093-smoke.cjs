const fs = require('node:fs/promises');
const sync = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');
exports.run = async ({ window, app, dialog, output, diagnostics }) => {
  await fs.mkdir(output, { recursive: true });
  const pdf = process.argv.includes('--pdf-close');
  const input = path.join(output, 'large.md'); await fs.writeFile(input, '# Large\n\n' + 'large paragraph for exit\n\n'.repeat(pdf ? 5000 : 250000));
  const run = code => window.webContents.executeJavaScript(code, true);
  dialog.showOpenDialog = async (_w, options) => ({ canceled: false, filePaths: options.properties.includes('openDirectory') ? [output] : [input] });
  const until = async code => { for (let n = 0; n < 100; n++) { if (await run(code)) return; await new Promise(r => setTimeout(r, 50)); } throw new Error('Close test did not start'); };
  await run('qingye.converter.open()'); await until('document.getElementById("convertTo").options.length>1');
  if (pdf) await run('document.getElementById("convertTo").value="pdf-chromium";document.getElementById("convertTo").dispatchEvent(new Event("change"))');
  await run('document.getElementById("convertMode").value="batch";document.getElementById("convertMode").dispatchEvent(new Event("change"));document.getElementById("convertPickInputs").click()');
  await until('document.querySelectorAll("#convertFiles li").length===1'); await run('document.getElementById("convertPickOutput").click()');
  await until('!!document.getElementById("convertOutput").textContent'); await run('document.getElementById("convertStart").click()');
  await until('!!document.querySelector("#convertResults [data-state=running]")');
  if (pdf) await until('document.getElementById("convertStatus").textContent==="正在排版 PDF…"');
  const start = Date.now();
  app.once('will-quit', () => {
    const files = sync.readdirSync(output); assert.ok(!files.some(n => n.startsWith('.qy-') || n.endsWith('.html')));
    sync.writeFileSync(path.join(output, 'report.json'), JSON.stringify({ quitAfterCancellation: true, outputDirectoryClean: true, pdfLayout: pdf, quitMs: Date.now() - start })); diagnostics.success();
  });
  window.close();
};
