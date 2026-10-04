// Rebuilds vendor/markdown/qingye-markdown-vendor.mjs — the only third-party code used by
// the Markdown editor. Everything is bundled locally so Markdown works fully offline.
//
//   npm i --no-save esbuild@0.27 markdown-it@14.1.1 katex@0.16.45 highlight.js@10.7.3 dompurify@3.4.2
//   node scripts/build-markdown-vendor.mjs
//
// Pinned versions (as shipped): markdown-it 14.1.1 (linkify-it 5.0.0, mdurl 2.0.0, uc.micro 2.1.0,
// entities 4.5.0, punycode.js 2.3.1), KaTeX 0.16.45, highlight.js 10.7.3, DOMPurify 3.4.2.
import { build } from 'esbuild';
import { cp, mkdir, readdir, copyFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const out = path.join(root, 'vendor', 'markdown');
await mkdir(path.join(out, 'katex', 'fonts'), { recursive: true });
await build({ entryPoints: [path.join(root, 'scripts', 'markdown-vendor-entry.mjs')], bundle: true, format: 'esm', minify: true, legalComments: 'linked', target: 'chrome120', outfile: path.join(out, 'qingye-markdown-vendor.mjs') });
const katexDist = path.join(root, 'node_modules', 'katex', 'dist');
await copyFile(path.join(katexDist, 'katex.min.css'), path.join(out, 'katex', 'katex.min.css'));
for (const font of await readdir(path.join(katexDist, 'fonts'))) if (font.endsWith('.woff2')) await cp(path.join(katexDist, 'fonts', font), path.join(out, 'katex', 'fonts', font));
console.log('Markdown vendor bundle written to', out);
