// Checks that every relative link in the repository's own Markdown points at a file that exists.
// Run by `npm run check:docs` and by `npm run verify`. Fenced code blocks, inline code and external
// schemes are ignored: the docs deliberately show examples like `[paper.pdf](<file:///…>)`.
'use strict';
const fs = require('node:fs');
const path = require('node:path');

const root = path.resolve(__dirname, '..');
// Vendored trees, generated output and the third-party licence texts are not our documentation.
const SKIP = new Set(['node_modules', 'vendor', 'dist', 'build', 'test-output', '.git', '.backend-build', '.downloads', 'licenses', 'third-party-source', 'bin', 'www', 'images']);

function markdownFiles(dir, found = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (SKIP.has(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) markdownFiles(full, found);
    else if (entry.name.endsWith('.md')) found.push(full);
  }
  return found;
}

/** Code blocks and inline code can contain anything, including links to example files. */
const stripCode = text => text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');

function brokenLinks() {
  const broken = [];
  for (const file of markdownFiles(root)) {
    const text = stripCode(fs.readFileSync(file, 'utf8'));
    for (const match of text.matchAll(/\]\(([^)\s]+)\)/g)) {
      const target = match[1].replace(/^<|>$/g, '');
      if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
      const local = target.split('#')[0];
      if (!local) continue;
      const resolved = path.resolve(path.dirname(file), decodeURIComponent(local));
      if (!fs.existsSync(resolved)) broken.push({ file: path.relative(root, file).split(path.sep).join('/'), line: text.slice(0, match.index).split('\n').length, target });
    }
  }
  return broken;
}

const broken = brokenLinks();
if (broken.length) {
  console.error('Broken documentation links:');
  for (const link of broken) console.error(`  ${link.file}:${link.line} -> ${link.target}`);
  process.exit(1);
}
console.log(`Documentation links OK (${markdownFiles(root).length} files).`);
