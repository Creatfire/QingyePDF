// Assembles mobile/www from the shared desktop sources:
//   ../ui, ../vendor/{pdfjs,markdown,mermaid,diagrams,ocr}  → copied unchanged
//   src/index.js                                            → www/ui/mobile/bridge.js
//   src/worker/pdf-worker.js (+ MuPDF WebAssembly)          → www/ui/mobile/pdf-worker.js
// ui/index.html gets the bridge script, the mobile stylesheet, a phone viewport and a CSP.
import { build } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url)), mobile = path.resolve(here, '..'), root = path.resolve(mobile, '..'), www = path.join(mobile, 'www');
const pkg = JSON.parse(await fs.readFile(path.join(mobile, 'package.json'), 'utf8'));
const dev = process.argv.includes('--dev');
const shim = name => path.join(mobile, 'src/shims', name);
const replaced = { 'core.cjs': 'src/main/core.js', 'offline.cjs': 'src/main/offline.js', 'i18n-main.cjs': 'src/main/i18n-main.js', 'ai-api-server.cjs': 'src/main/ai-api-server.js' };
const nodeModules = { fs: shim('fs.js'), 'fs/promises': shim('fs-promises.js'), path: 'path-browserify', os: shim('os.js'), crypto: shim('crypto.js'), url: shim('url.js'), child_process: shim('child_process.js'), electron: path.join(mobile, 'src/main/electron-renderer.js'), http: shim('empty.js') };
const sharedPlugin = {
  name: 'qingye-mobile',
  setup(b) {
    b.onResolve({ filter: /^(node:)?(fs|fs\/promises|path|os|crypto|url|child_process|http|electron)$/ }, async args => {
      const target = nodeModules[args.path.replace(/^node:/, '')];
      return path.isAbsolute(target) ? { path: target } : b.resolve(target, { resolveDir: mobile, kind: args.kind });
    });
    // Desktop modules that cannot run in a WebView are swapped for their mobile counterparts.
    b.onResolve({ filter: /\.cjs$/ }, async args => {
      const name = path.basename(args.path), target = replaced[name];
      if (!target || args.importer.startsWith(path.join(mobile, 'src/main') + path.sep) && path.basename(args.importer) === path.basename(target)) return null;
      if (path.resolve(path.dirname(args.importer), args.path) !== path.join(root, name)) return null;
      const file = path.join(mobile, target);
      return await fs.stat(file).then(() => ({ path: file }), () => null);
    });
  },
};
const common = { bundle: true, minify: !dev, sourcemap: dev ? 'inline' : false, target: ['chrome100'], logLevel: 'warning', legalComments: 'none',
  define: { __APP_VERSION__: JSON.stringify(pkg.version), 'process.platform': '"android"', __dirname: '"/__app"', 'process.env.NODE_ENV': '"production"', global: 'globalThis' },
  inject: [shim('process.js')], plugins: [sharedPlugin] };

await fs.rm(www, { recursive: true, force: true });
await fs.mkdir(path.join(www, 'ui/mobile'), { recursive: true });
await fs.cp(path.join(root, 'ui'), path.join(www, 'ui'), { recursive: true });
for (const name of ['pdfjs', 'markdown', 'mermaid', 'diagrams', 'ocr']) await fs.cp(path.join(root, 'vendor', name), path.join(www, 'vendor', name), { recursive: true });

// The phone opens the touch edition of the sample guide; the desktop editions stay out of the APK.
for (const name of ['sample-guide.pdf', 'sample-guide-mac.pdf']) await fs.rm(path.join(www, 'ui', name), { force: true });
// Not needed on a phone: source maps and the PDF.js demo document.
for (const file of await fs.readdir(path.join(www, 'vendor'), { recursive: true })) if (/\.map$|tracemonkey.*\.pdf$/.test(file)) await fs.rm(path.join(www, 'vendor', file), { force: true });

await build({ ...common, entryPoints: [path.join(mobile, 'src/index.js')], outfile: path.join(www, 'ui/mobile/bridge.js'), format: 'iife' });
await build({ ...common, entryPoints: [path.join(mobile, 'src/pandoc/host-worker.js')], outfile: path.join(www, 'ui/mobile/pandoc-worker.js'), format: 'iife', inject: [] });
await fs.copyFile(path.join(mobile, 'src/ui/mobile.css'), path.join(www, 'ui/mobile/mobile.css'));

// Document conversion: the official Pandoc WebAssembly build (unmodified, GPL-2.0-or-later).
await fs.mkdir(path.join(www, 'vendor/pandoc'), { recursive: true });
await fs.copyFile(path.join(mobile, 'node_modules/pandoc-wasm/src/pandoc.wasm'), path.join(www, 'vendor/pandoc/pandoc.wasm'));
await fs.copyFile(path.join(mobile, 'node_modules/pandoc-wasm/LICENSE'), path.join(www, 'vendor/pandoc/LICENSE'));

// PDF backend: the desktop worker.py runs in Pyodide; wheels are pinned by vendor-mobile/wheels/SHA256SUMS.
for (const name of ['pdf-worker.js', 'qy_mobile.py']) await fs.copyFile(path.join(mobile, 'src/worker', name), path.join(www, 'ui/mobile', name));
await fs.copyFile(path.join(root, 'backend/worker.py'), path.join(www, 'ui/mobile/worker.py'));
const pyodide = path.join(mobile, 'node_modules/pyodide'), pyodideOut = path.join(www, 'ui/mobile/pyodide');
await fs.mkdir(path.join(pyodideOut, 'wheels'), { recursive: true });
for (const name of ['pyodide.js', 'pyodide.asm.js', 'pyodide.asm.wasm', 'python_stdlib.zip', 'pyodide-lock.json']) await fs.copyFile(path.join(pyodide, name), path.join(pyodideOut, name));
const wheelDir = path.join(mobile, 'vendor-mobile/wheels');
const sums = (await fs.readFile(path.join(wheelDir, 'SHA256SUMS'), 'utf8')).trim().split('\n').map(line => line.trim().split(/\s+/));
const { createHash } = await import('node:crypto');
// Dependencies first, PyMuPDF and the Office writers after them.
const order = name => ['typing_extensions', 'et_xmlfile', 'lxml', 'pillow', 'xlsxwriter', 'pymupdf', 'openpyxl', 'python_docx', 'python_pptx'].findIndex(prefix => name.toLowerCase().startsWith(prefix));
const wheels = sums.map(([, name]) => name).sort((a, b) => order(a) - order(b));
for (const [sum, name] of sums) {
  const bytes = await fs.readFile(path.join(wheelDir, name)).catch(() => { throw new Error(`Missing ${name}: run "npm run fetch:wheels" in mobile/.`); });
  if (createHash('sha256').update(bytes).digest('hex') !== sum) throw new Error('Checksum mismatch: ' + name);
  await fs.writeFile(path.join(pyodideOut, 'wheels', name), bytes);
}
await fs.writeFile(path.join(pyodideOut, 'wheels/manifest.json'), JSON.stringify(wheels));
const tess = path.join(www, 'vendor/tesseract'); await fs.mkdir(tess, { recursive: true });
for (const name of ['tesseract-core-lstm.js', 'tesseract-core-lstm.wasm', 'tesseract-core-simd-lstm.js', 'tesseract-core-simd-lstm.wasm']) await fs.copyFile(path.join(mobile, 'node_modules/tesseract.js-core', name), path.join(tess, name));

// Mobile-only interface strings are merged into the shared dictionaries.
for (const file of await fs.readdir(path.join(mobile, 'i18n')).catch(() => [])) {
  const target = path.join(www, 'ui/i18n', file), extra = JSON.parse(await fs.readFile(path.join(mobile, 'i18n', file), 'utf8')), base = JSON.parse(await fs.readFile(target, 'utf8'));
  base.strings = { ...extra.strings, ...base.strings }; base.patterns = [...(base.patterns || []), ...(extra.patterns || [])]; await fs.writeFile(target, JSON.stringify(base));
}

const csp = "default-src 'self'; script-src 'self' 'wasm-unsafe-eval'; worker-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src 'self' blob: data:; font-src 'self' blob: data:; connect-src 'self' blob: data:; object-src 'none'; base-uri 'none'";
const indexFile = path.join(www, 'ui/index.html');
let html = await fs.readFile(indexFile, 'utf8');
html = html.replace('<meta name="viewport" content="width=device-width,initial-scale=1">', `<meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">\n  <meta http-equiv="Content-Security-Policy" content="${csp}">`)
  .replace('<script type="module" src="app.mjs"></script>', '<link rel="stylesheet" href="mobile/mobile.css">\n  <script src="mobile/polyfills.js"></script>\n  <script src="mobile/bridge.js"></script>\n  <script type="module" src="app.mjs"></script>');
if (!html.includes('mobile/bridge.js') || !html.includes('Content-Security-Policy')) throw new Error('ui/index.html no longer matches the mobile build patches.');
await fs.writeFile(indexFile, html);

// Polyfills: app page (above), the PDF.js viewer frame and the PDF.js worker.
const polyfills = await fs.readFile(path.join(mobile, 'src/ui/polyfills.js'), 'utf8');
await fs.writeFile(path.join(www, 'ui/mobile/polyfills.js'), polyfills);
const viewerFile = path.join(www, 'vendor/pdfjs/web/viewer.html');
let viewer = await fs.readFile(viewerFile, 'utf8');
viewer = viewer.replace('<script src="../build/pdf.mjs" type="module"></script>', `<meta http-equiv="Content-Security-Policy" content="${csp}">\n<script src="../../../ui/mobile/polyfills.js"></script>\n<script src="../build/pdf.mjs" type="module"></script>`)
  .replace('<link rel="stylesheet" href="../../../ui/viewer.css" />', '<link rel="stylesheet" href="../../../ui/viewer.css" />\n    <link rel="stylesheet" href="../../../ui/mobile/viewer-mobile.css" />');
if (!viewer.includes('mobile/polyfills.js') || !viewer.includes('viewer-mobile.css')) throw new Error('vendor/pdfjs/web/viewer.html no longer matches the mobile build patches.');
await fs.writeFile(viewerFile, viewer);
await fs.copyFile(path.join(mobile, 'src/ui/viewer-mobile.css'), path.join(www, 'ui/mobile/viewer-mobile.css'));
const workerFile = path.join(www, 'vendor/pdfjs/build/pdf.worker.mjs');
await fs.writeFile(workerFile, polyfills + '\n' + await fs.readFile(workerFile, 'utf8'));
await fs.writeFile(path.join(www, 'index.html'), '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>青页 PDF</title><script src="start.js"></script>\n');
await fs.writeFile(path.join(www, 'start.js'), "location.replace('ui/index.html');\n");
console.log('www ready:', www);
