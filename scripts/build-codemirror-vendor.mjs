// Rebuilds vendor/codemirror/qingye-codemirror.mjs — CodeMirror 6 for the Markdown source mode.
// Everything is bundled locally so the editor works offline.
//
//   npm i --no-save esbuild@0.25.12 @codemirror/state@6.5.2 @codemirror/view@6.38.6 \
//     @codemirror/commands@6.9.0 @codemirror/language@6.11.3 @codemirror/lang-markdown@6.4.0 @lezer/highlight@1.2.3
//   node scripts/build-codemirror-vendor.mjs [--modules <folder containing node_modules>]
//
// CodeMirror and Lezer are MIT licensed (Marijn Haverbeke and others); licenses are copied beside the bundle.
import { createRequire } from 'node:module';
import { mkdir, readdir, copyFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const at = process.argv.indexOf('--modules'), modules = path.resolve(at > 0 ? process.argv[at + 1] : root, 'node_modules');
const { build } = createRequire(path.join(modules, 'noop.js'))('esbuild');
const out = path.join(root, 'vendor', 'codemirror');
await mkdir(path.join(out, 'licenses'), { recursive: true });
await build({ entryPoints: [path.join(root, 'scripts', 'codemirror-vendor-entry.mjs')], bundle: true, format: 'esm', minify: true, legalComments: 'linked', target: 'chrome120', nodePaths: [modules], outfile: path.join(out, 'qingye-codemirror.mjs') });
for (const scope of ['@codemirror', '@lezer']) {
  for (const name of await readdir(path.join(modules, scope)).catch(() => [])) {
    const license = path.join(modules, scope, name, 'LICENSE');
    if (await stat(license).then(s => s.isFile(), () => false)) await copyFile(license, path.join(out, 'licenses', `${scope.slice(1)}-${name}-LICENSE`));
  }
}
for (const name of ['style-mod', 'w3c-keyname', 'crelt']) {
  const license = path.join(modules, name, 'LICENSE');
  if (await stat(license).then(s => s.isFile(), () => false)) await copyFile(license, path.join(out, 'licenses', `${name}-LICENSE`));
}
console.log('CodeMirror vendor bundle written to', out);
