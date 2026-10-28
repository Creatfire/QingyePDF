'use strict';
// npm may skip dependency install scripts; make sure the locked Electron binary exists.
const fs = require('node:fs');
const path = require('node:path');
const { execFileSync } = require('node:child_process');
const dir = path.dirname(require.resolve('electron/package.json'));
const marker = path.join(dir, 'path.txt');
const expected = require(path.join(dir, 'package.json')).version;
const versionFile = path.join(dir, 'dist', 'version');
const installed = fs.existsSync(marker) && fs.existsSync(path.join(dir, 'dist', fs.readFileSync(marker, 'utf8').trim())) && fs.existsSync(versionFile) && fs.readFileSync(versionFile, 'utf8').trim().replace(/^v/, '') === expected;
if (!installed) execFileSync(process.execPath, [path.join(dir, 'install.js')], { stdio: 'inherit' });
