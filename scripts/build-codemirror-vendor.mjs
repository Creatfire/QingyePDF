// Rebuilds vendor/codemirror/qingye-codemirror.mjs — CodeMirror 6 for the Markdown source mode.
// Everything is bundled locally so the editor works offline.
//
//   npm i --no-save esbuild@0.25.12 @codemirror/state@6.5.2 @codemirror/view@6.38.6 @codemirror/lint@6.8.5 \
//     @codemirror/commands@6.9.0 @codemirror/language@6.11.3 @codemirror/lang-markdown@6.4.0 @lezer/highlight@1.2.3 \
//     @codemirror/lang-javascript@6.2.4 @codemirror/lang-python@6.2.1 @codemirror/lang-css@6.3.1 @codemirror/lang-html@6.4.9 \
//     @codemirror/lang-json@6.0.2 @codemirror/lang-cpp@6.0.3 @codemirror/lang-java@6.0.2 @codemirror/lang-rust@6.0.2 \
//     @codemirror/lang-sql@6.9.1 @codemirror/lang-xml@6.1.0 @codemirror/lang-go@6.0.1 @codemirror/lang-yaml@6.1.2 @codemirror/legacy-modes@6.5.1
//   (keep a single copy of @codemirror/state and /view: `npm ls @codemirror/state` must show one version)
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
