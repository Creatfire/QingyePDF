import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { patchPdfjs } from './pdfjs-patches.cjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const version = '6.3.289';
const url = `https://github.com/mozilla/pdf.js/releases/download/v${version}/pdfjs-${version}-dist.zip`;
const archive = path.join(root, '.downloads', `pdfjs-${version}-dist.zip`);
const vendor = path.join(root, 'vendor', 'pdfjs');
const expectedHash = '98c5832ffe7af4edd59853476a478c0d4d4d76dd49c1701f4c86f7182725cdf9';
const needsVendor = !await fs.stat(path.join(vendor, 'web', 'viewer.html')).catch(() => null);
await fs.mkdir(path.dirname(archive), { recursive: true });
if (needsVendor && !await fs.stat(archive).catch(() => null)) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`PDF.js download: ${response.status}`);
  await fs.writeFile(archive, new Uint8Array(await response.arrayBuffer()));
}
const archiveHash = await fs.stat(archive).catch(() => null) ? createHash('sha256').update(await fs.readFile(archive)).digest('hex') : expectedHash;
if (archiveHash !== expectedHash) throw new Error('PDF.js archive checksum mismatch.');
if (needsVendor) {
  const literal = value => `'${value.replaceAll("'", "''")}'`;
  execFileSync('powershell.exe', ['-NoProfile', '-Command', `Expand-Archive -LiteralPath ${literal(archive)} -DestinationPath ${literal(vendor)} -Force`], { windowsHide: true });
}
const htmlPath = path.join(vendor, 'web', 'viewer.html');
let html = await fs.readFile(htmlPath, 'utf8');
html = html.replace('<title>PDF.js viewer</title>', '<title>青页 PDF 阅读器</title>');
if (!html.includes('../../../ui/viewer.css')) html = html.replace('</head>', '  <link rel="stylesheet" href="../../../ui/viewer.css" />\n  </head>');
await fs.writeFile(htmlPath, html);
const enginePath=path.join(vendor,'build','pdf.mjs');
await fs.writeFile(enginePath,patchPdfjs(await fs.readFile(enginePath,'utf8')));
await fs.writeFile(path.join(vendor, 'QINGYE-MODIFICATIONS.md'), `PDF.js ${version}\nSource: ${url}\nArchive SHA-256: ${archiveHash}\n\nQingye modifications: web/viewer.html title and reference to ui/viewer.css; build/pdf.mjs skips serialization of image editors before their bitmap is ready and releases the picker on image-load errors. Reproducible patch: scripts/pdfjs-patches.cjs. Original copyright and license are retained.\n`);
console.log(`Prepared PDF.js ${version}, archive SHA-256 ${archiveHash}`);
