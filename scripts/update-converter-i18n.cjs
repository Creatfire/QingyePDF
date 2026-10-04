const fs = require('node:fs'); const path = require('node:path'); const root = path.resolve(__dirname, '..');
const entries = JSON.parse(fs.readFileSync(path.join(__dirname, 'i18n/converter.json'))), catalogFile = path.join(__dirname, 'i18n/catalog.json'), catalog = JSON.parse(fs.readFileSync(catalogFile));
const rows = [];
for (const [source, values] of Object.entries(entries)) { if (!catalog.includes(source)) catalog.push(source); rows.push([catalog.indexOf(source), ...values].join('\t')); }
fs.writeFileSync(catalogFile, JSON.stringify(catalog, null, 2) + '\n'); fs.writeFileSync(path.join(__dirname, 'i18n/src/07-converter.tsv'), rows.join('\n') + '\n');
for (const [n, language] of ['en', 'zh-TW', 'ja', 'ko'].entries()) { const file = path.join(root, 'ui/i18n', language + '.json'), data = JSON.parse(fs.readFileSync(file)); for (const [key, values] of Object.entries(entries)) data.strings[key] = values[n]; fs.writeFileSync(file, JSON.stringify(data, null, 2) + '\n'); }
