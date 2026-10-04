// Regenerate offline diagram assets after installing pinned build dependencies:
// npm install --no-save --package-lock=false esbuild@0.27.0 flowchart.js@1.18.0 raphael@2.3.0 underscore@1.13.8
// js-sequence-diagrams is fetched from bramp's tagged v2.0.1 commit; the npm name is a security placeholder.
import { build } from 'esbuild';
import { copyFile, mkdir, readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'vendor/diagrams');
const licenses = path.join(out, 'LICENSES');
await mkdir(licenses, { recursive: true });
const sequenceCommit = 'a6c252b2ed0d1e6b1d16be066f582afd2895e6c9';
const sequenceBase = `https://raw.githubusercontent.com/bramp/js-sequence-diagrams/${sequenceCommit}/`;
const files = [];
async function record(file, source, version) {
  const bytes = await readFile(path.join(out, file));
  files.push({ file, version, source, sha256: createHash('sha256').update(bytes).digest('hex') });
}
async function copy(from, to, source, version) {
  await copyFile(path.join(root, 'node_modules', from), path.join(out, to));
  await record(to, source, version);
}
async function fetchFile(url, to, version) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  await writeFile(path.join(out, to), Buffer.from(await response.arrayBuffer()));
  await record(to, url, version);
}

await build({ entryPoints: [path.join(root, 'node_modules/flowchart.js/index.js')], bundle: true, format: 'iife', platform: 'browser', minify: true, legalComments: 'inline', target: 'chrome120', outfile: path.join(out, 'flowchart.min.js') });
await record('flowchart.min.js', 'https://registry.npmjs.org/flowchart.js/-/flowchart.js-1.18.0.tgz (esbuild 0.27.0 bundle, includes raphael 2.3.0 and eve-raphael 0.5.0)', '1.18.0');
await copy('raphael/raphael.min.js', 'raphael.min.js', 'https://registry.npmjs.org/raphael/-/raphael-2.3.0.tgz', '2.3.0');
await copy('underscore/underscore-min.js', 'underscore.min.js', 'https://registry.npmjs.org/underscore/-/underscore-1.13.8.tgz', '1.13.8');
await fetchFile(sequenceBase + 'dist/sequence-diagram-raphael-min.js', 'sequence-diagram-raphael-min.js', '2.0.1');
await copy('flowchart.js/license', 'LICENSES/flowchart.txt', 'https://registry.npmjs.org/flowchart.js/-/flowchart.js-1.18.0.tgz', '1.18.0');
await copy('raphael/license.txt', 'LICENSES/raphael.txt', 'https://registry.npmjs.org/raphael/-/raphael-2.3.0.tgz', '2.3.0');
await copy('underscore/LICENSE', 'LICENSES/underscore.txt', 'https://registry.npmjs.org/underscore/-/underscore-1.13.8.tgz', '1.13.8');
await copy('eve-raphael/LICENSE', 'LICENSES/eve-raphael.txt', 'https://registry.npmjs.org/eve-raphael/-/eve-raphael-0.5.0.tgz', '0.5.0');
await fetchFile(sequenceBase + 'LICENCE', 'LICENSES/js-sequence-diagrams.txt', '2.0.1');
await writeFile(path.join(out, 'SOURCES.json'), JSON.stringify(files, null, 2) + '\n');
console.log('Wrote', files.length, 'diagram vendor files');
