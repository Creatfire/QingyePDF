const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { execFileSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'))); pkg.version = '0.9.0';
if (!pkg.scripts.test.includes('test/converter.test.cjs')) pkg.scripts.test += ' test/converter.test.cjs'; pkg.scripts['smoke:conversion'] = 'electron . --conversion-smoke';
for (const file of ['pandoc-engine.cjs', 'converter-ipc.cjs', 'test/conversion-smoke.cjs', 'CONVERSION.md', 'RELEASE-TARGET.json']) if (!pkg.build.files.includes(file)) pkg.build.files.push(file);
if (!pkg.build.extraResources.some(item => item.to === 'pandoc')) pkg.build.extraResources.push({ from: 'vendor/pandoc', to: 'pandoc', filter: ['**/*'] });
fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify(pkg, null, 2) + '\n');
const lock = JSON.parse(fs.readFileSync(path.join(root, 'package-lock.json'))); lock.version = pkg.version; lock.packages[''].version = pkg.version; fs.writeFileSync(path.join(root, 'package-lock.json'), JSON.stringify(lock, null, 2) + '\n');
const exe = path.join(root, 'vendor/pandoc/pandoc.exe'), sha256 = crypto.createHash('sha256').update(fs.readFileSync(exe)).digest('hex');
const manifest = { name: 'Pandoc', version: '3.12', license: 'GPL-2.0-or-later', upstream: 'https://github.com/jgm/pandoc/tree/3.12', commit: '381230ee36d8fa871c28f8982e22579f1a8f723b', executable: 'pandoc.exe', sha256, engineModified: false, build: execFileSync(exe, ['--version'], { encoding: 'utf8', windowsHide: true }).replace(/User data directory:.*\r?\n/, 'User data directory: per-user Pandoc default\n') };
fs.writeFileSync(path.join(root, 'vendor/pandoc/manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
for (const name of ['README.md', 'FEATURES.md', 'HANDOFF.md']) { const file = path.join(root, name); let text = fs.readFileSync(file, 'utf8'); text = text.replace(/QingyePDF-\d+\.\d+\.\d+-(win-x64\.exe|(?:dependency-)?source\.zip|Setup-x64\.exe)/g, 'QingyePDF-0.9.0-$1').replace(/SHA256-0\.8\.2/g, 'SHA256-0.9.0').replace(/LICENSE-0\.8\.2/g, 'LICENSE-0.9.0').replace('当前版本 0.8.2', '当前版本 0.9.0'); text = text.replace('装有 Pandoc 时还可', '使用内置 Pandoc 引擎还可').replace('安装 Pandoc 后还可以', '通过内置转换引擎还可以'); fs.writeFileSync(file, text); }
console.log(JSON.stringify({ version: pkg.version, pandoc: manifest.version, sha256 }));
