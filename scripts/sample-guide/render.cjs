// Electron fallback renderer for build.py when Playwright is not installed (e.g. on Windows):
//   electron scripts/sample-guide/render.cjs <page.html> <out.pdf>
// Same options as the Playwright path: CSS page size, backgrounds, document outline, tagged PDF.
const { app, BrowserWindow } = require('electron');
const fs = require('node:fs/promises');
const { pathToFileURL } = require('node:url');

const [input, output] = process.argv.slice(-2);
app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false, webPreferences: { offscreen: true, sandbox: true } });
  try {
    await win.loadURL(pathToFileURL(input).href);
    await win.webContents.executeJavaScript('document.fonts.ready.then(() => new Promise(r => setTimeout(r, 500)))');
    const pdf = await win.webContents.printToPDF({ preferCSSPageSize: true, printBackground: true, generateDocumentOutline: true, generateTaggedPDF: true });
    await fs.writeFile(output, pdf);
    app.exit(0);
  } catch (error) { console.error(error); app.exit(1); }
});
