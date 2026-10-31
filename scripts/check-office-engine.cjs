#!/usr/bin/env node
// Runs the real on-demand path against the real package: install into a temporary folder, then convert
// a small file with the result. A package the prepare scripts already fetched into .downloads/ is reused
// (its checksum is still verified). CI runs this on every platform, because msiexec and hdiutil cannot
// be exercised anywhere else.
'use strict';
const fs = require('node:fs/promises');
const os = require('node:os');
const path = require('node:path');
const engine = require('../office-engine.cjs');
const office = require('../office-convert.cjs');

(async () => {
  const pkg = engine.packageFor();
  if (!pkg) { console.log(`No package for ${process.platform}-${process.arch}; nothing to check.`); return; }
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'qy-engine-'));
  delete process.env.QINGYE_LIBREOFFICE_DIR;
  try {
    const engineDir = path.join(dir, 'engine');
    await fs.mkdir(engineDir, { recursive: true });
    await fs.copyFile(path.join(__dirname, '..', '.downloads', pkg.file), path.join(engineDir, pkg.file)).catch(() => {});
    const started = Date.now();
    const dest = await engine.install({ engineDir, fetch: globalThis.fetch, pkg, onProgress: p => { if (p.stage === 'installing') console.log('installing'); } });
    console.log(`installed in ${Math.round((Date.now() - started) / 1000)} s:`, dest);
    const left = await fs.readdir(engineDir);
    if (left.join() !== engine.VERSION) throw new Error('leftovers beside the engine: ' + left.join());
    const input = path.join(dir, 'check.csv');
    await fs.writeFile(input, '城市,人口\n北京,2189\n');
    const options = { engineDir, profileDir: path.join(dir, 'profile') };
    await fs.access(engine.executableIn(dest));
    // Force this engine even in a checkout that also has vendor/libreoffice.
    process.env.QINGYE_LIBREOFFICE_DIR = dest;
    const { bytes } = await office.toPdf(input, options);
    if (bytes.subarray(0, 4).toString() !== '%PDF') throw new Error('not a PDF');
    console.log(`converted: ${bytes.length} bytes with`, office.engineInfo(options));
  } finally { await fs.rm(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 1000 }).catch(() => {}); }
})().catch(error => { console.error(error); process.exit(1); });
