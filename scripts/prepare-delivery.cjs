const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '..');
const version = require('../package.json').version;
const output = path.resolve(process.argv[2] || path.join(root, '../output/qingye-pdf'));
const artifacts = [`QingyePDF-${version}-Setup-x64.exe`, `QingyePDF-${version}-win-x64.zip`, `QingyePDF-${version}-source.zip`, `QingyePDF-${version}-dependency-source.zip`];
const copies = new Map(artifacts.map(name => [name, path.join(root, 'dist', name)]));
copies.set('README.md', path.join(root, 'README.md'));
function addDocs(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const source = path.join(dir, entry.name);
    if (entry.isDirectory()) addDocs(source);
    else if (entry.isFile()) copies.set(path.relative(root, source), source);
  }
}
addDocs(path.join(root, 'docs'));
for (const [name, source] of copies) assert.ok(fs.existsSync(source), `Missing ${name}`);
const digest = file => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const records = [];
for (const [name, source] of copies) {
  const target = path.join(output, name);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(source, target);
  assert.equal(digest(target), digest(source), `Copy mismatch: ${name}`);
  records.push({ name: name.split(path.sep).join('/'), bytes: fs.statSync(target).size, sha256: digest(target) });
}
fs.writeFileSync(path.join(output, `SHA256-${version}.json`), JSON.stringify(records, null, 2));
console.log(JSON.stringify({ version, output, files: records.length }));
