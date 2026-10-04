// Main-process helpers for the Markdown editor's Typora-style features: folder trees, version
// history, Pandoc, PDF / image export, themes and image folders. Pure Node so they can be tested
// without Electron; Electron-only pieces (BrowserWindow, dialog) are passed in by main.cjs.
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const markdownFiles = require('./markdown-files.cjs');
const pandocEngine = require('./pandoc-engine.cjs');

const SKIP_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '$RECYCLE.BIN', 'System Volume Information', '__pycache__']);
const isHidden = name => name.startsWith('.');

// ——— Folder tree (Markdown files only; folders without any are pruned) ———
async function listTree(root, { maxEntries = 4000, maxDepth = 8 } = {}) {
  let count = 0;
  const walk = async (dir, depth) => {
    let entries;
    try { entries = await fs.readdir(dir, { withFileTypes: true }); } catch { return []; }
    entries.sort((a, b) => (a.isDirectory() === b.isDirectory() ? a.name.localeCompare(b.name, 'zh-CN', { numeric: true, sensitivity: 'base' }) : a.isDirectory() ? -1 : 1));
    const out = [];
    for (const e of entries) {
      if (count >= maxEntries) break;
      if (isHidden(e.name) || SKIP_DIRS.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        if (depth >= maxDepth) continue;
        const children = await walk(full, depth + 1);
        if (children.length) out.push({ name: e.name, path: full, type: 'dir', children });
      } else if (e.isFile() && markdownFiles.isMarkdown(e.name)) { count++; out.push({ name: e.name, path: full, type: 'file' }); }
    }
    return out;
  };
  return { root, children: await walk(root, 0), truncated: count >= maxEntries };
}
function flattenTree(tree, out = []) { for (const n of tree.children || []) { if (n.type === 'file') out.push(n); else flattenTree(n, out); } return out; }

// ——— KaTeX CSS with fonts inlined (for standalone HTML) ———
let katexCache = null;
async function katexCss(appDir) {
  if (katexCache) return katexCache;
  const dir = path.join(appDir, 'vendor', 'markdown', 'katex');
  let css = await fs.readFile(path.join(dir, 'katex.min.css'), 'utf8');
  const fonts = new Map();
  for (const m of css.matchAll(/url\(\s*['"]?(fonts\/[^'")]+\.woff2)['"]?\s*\)/g)) if (!fonts.has(m[1])) { try { fonts.set(m[1], 'data:font/woff2;base64,' + (await fs.readFile(path.join(dir, m[1]))).toString('base64')); } catch {} }
  // Keep only the woff2 source of every @font-face.
  css = css.replace(/src:\s*([^;}]+)/g, (all, list) => {
    const first = /url\(\s*['"]?(fonts\/[^'")]+\.woff2)['"]?\s*\)/.exec(list);
    return first && fonts.has(first[1]) ? `src:url(${fonts.get(first[1])}) format("woff2")` : all;
  });
  return (katexCache = css);
}

// ——— Version history (local snapshots kept per file) ———
const historyDir = (base, file) => path.join(base, crypto.createHash('sha1').update(path.resolve(file).toLowerCase()).digest('hex').slice(0, 20));
async function snapshot(base, file, text, { keep = 40 } = {}) {
  if (!file || typeof text !== 'string') return false;
  const dir = historyDir(base, file);
  await fs.mkdir(dir, { recursive: true });
  const names = (await fs.readdir(dir)).filter(n => n.endsWith('.md')).sort();
  if (names.length) { const last = await fs.readFile(path.join(dir, names.at(-1)), 'utf8').catch(() => null); if (last === text) return false; }
  await fs.writeFile(path.join(dir, `${Date.now()}.md`), text, 'utf8');
  for (const n of names.slice(0, Math.max(0, names.length + 1 - keep))) await fs.rm(path.join(dir, n), { force: true });
  await fs.writeFile(path.join(dir, 'source.txt'), path.resolve(file), 'utf8').catch(() => {});
  return true;
}
async function listVersions(base, file) {
  const dir = historyDir(base, file);
  const names = (await fs.readdir(dir).catch(() => [])).filter(n => /^\d+\.md$/.test(n)).sort().reverse();
  return Promise.all(names.map(async n => ({ name: n, time: Number(n.slice(0, -3)), size: (await fs.stat(path.join(dir, n))).size })));
}
async function readVersion(base, file, name) {
  if (!/^\d+\.md$/.test(name)) throw new Error('无效的版本。');
  return fs.readFile(path.join(historyDir(base, file), name), 'utf8');
}

// ——— Pandoc ———
async function run(cmd, args, { cwd, input, timeout = 120000 } = {}) {
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(cmd, args, { cwd, windowsHide: true }); } catch (error) { reject(error); return; }
    let out = Buffer.alloc(0), err = '', done = false;
    const timer = setTimeout(() => { if (!done) { child.kill(); reject(new Error('Pandoc 运行超时。')); } }, timeout);
    child.stdout.on('data', d => { out = Buffer.concat([out, d]); });
    child.stderr.on('data', d => { err += d.toString(); });
    child.on('error', error => { clearTimeout(timer); done = true; reject(error); });
    child.on('close', code => { clearTimeout(timer); done = true; code === 0 ? resolve({ stdout: out, stderr: err }) : reject(new Error((err || `退出码 ${code}`).trim().slice(0, 800))); });
    if (input != null) child.stdin.end(input); else child.stdin.end();
  });
}
async function findPandoc(custom = '') {
  const candidates = [];
  if (custom) candidates.push(custom);
  candidates.push(pandocEngine.bundledPath());
  candidates.push('pandoc');
  if (process.platform === 'win32') for (const base of [process.env.LOCALAPPDATA && path.join(process.env.LOCALAPPDATA, 'Pandoc'), process.env.ProgramFiles && path.join(process.env.ProgramFiles, 'Pandoc'), process.env['ProgramFiles(x86)'] && path.join(process.env['ProgramFiles(x86)'], 'Pandoc')].filter(Boolean)) candidates.push(path.join(base, 'pandoc.exe'));
  for (const cmd of candidates) {
    try { const { stdout } = await run(cmd, ['--version'], { timeout: 8000 }); return { found: true, path: cmd, bundled: cmd === pandocEngine.bundledPath(), version: stdout.toString().split('\n')[0].trim() }; } catch {}
  }
  return { found: false, path: '', version: '' };
}
const PANDOC_TARGETS = { odt: 'odt', rst: 'rst', mediawiki: 'mediawiki', textile: 'textile', opml: 'opml', org: 'org', asciidoc: 'asciidoc', pptx: 'pptx', docx: 'docx', epub: 'epub3', latex: 'latex', rtf: 'rtf', html: 'html5' };
const PANDOC_SOURCES = { '.docx': 'docx', '.odt': 'odt', '.html': 'html', '.htm': 'html', '.epub': 'epub', '.tex': 'latex', '.latex': 'latex', '.rst': 'rst', '.org': 'org', '.textile': 'textile', '.wiki': 'mediawiki', '.opml': 'opml', '.rtf': 'rtf', '.ipynb': 'ipynb', '.csv': 'csv', '.tsv': 'tsv', '.adoc': 'asciidoc', '.txt': 'markdown' };
// Markdown reader extensions. `mark` (==highlight==) exists only in Pandoc 3.1+; older versions stop
// with "Unknown extension: mark", so the conversion is retried once without it.
const PANDOC_FROM = 'markdown+emoji+task_lists+pipe_tables+footnotes+tex_math_dollars+strikeout+subscript+superscript+mark';
const PANDOC_FROM_LEGACY = PANDOC_FROM.replace('+mark', '');
async function runPandocConvert(pandoc, restArgs, options = {}) {
  try { return await run(pandoc, ['-f', PANDOC_FROM, ...restArgs], options); }
  catch (error) {
    if (!/Unknown extension/i.test(error.message)) throw error;
    return run(pandoc, ['-f', PANDOC_FROM_LEGACY, ...restArgs], options);
  }
}
async function pandocExport(pandoc, { format, text, out, cwd }) {
  const target = PANDOC_TARGETS[format];
  if (!target) throw new Error('不支持的 Pandoc 格式：' + format);
  await runPandocConvert(pandoc, ['-t', target, '-o', out, '--standalone', ...(cwd ? ['--resource-path', cwd] : [])], { cwd, input: text });
  return out;
}
async function pandocImport(pandoc, file, { mediaDir } = {}) {
  const from = PANDOC_SOURCES[path.extname(file).toLowerCase()];
  if (!from) throw new Error('不支持导入此类型的文件。');
  const args = ['-f', from, '-t', 'gfm+footnotes+tex_math_dollars', '--wrap=none', ...(mediaDir ? ['--extract-media', mediaDir] : [])];
  const { stdout } = await run(pandoc, [...args, file], { cwd: path.dirname(file) });
  return stdout.toString('utf8');
}

// ——— Images ———
function imageFolder(documentPath, { mode = 'assets', folder = 'assets', root = '' } = {}) {
  const dir = path.dirname(documentPath);
  if (mode === 'named') return path.join(dir, path.parse(documentPath).name + '.assets');
  if (mode === 'custom') { const f = String(folder || 'assets'); return path.isAbsolute(f) ? f : path.join(dir, f); }
  if (root) return path.isAbsolute(root) ? root : path.join(dir, root);
  return path.join(dir, 'assets');
}
async function uniqueFile(dir, name) {
  const { name: base, ext } = path.parse(name);
  let file = path.join(dir, name), n = 2;
  while (await fs.stat(file).catch(() => null)) file = path.join(dir, `${base}-${n++}${ext}`);
  return file;
}
async function copyImageInto(source, dir) {
  await fs.mkdir(dir, { recursive: true });
  if (path.dirname(path.resolve(source)).toLowerCase() === path.resolve(dir).toLowerCase()) return source;
  const target = await uniqueFile(dir, path.basename(source));
  await fs.copyFile(source, target, fsSync.constants.COPYFILE_EXCL);
  return target;
}

// ——— Custom themes ———
async function listThemes(dir) {
  const names = (await fs.readdir(dir).catch(() => [])).filter(n => /\.css$/i.test(n)).sort();
  return names.map(n => ({ id: n, name: n.replace(/\.css$/i, '') }));
}
async function readTheme(dir, id) {
  if (!/^[^\\/]+\.css$/i.test(id)) throw new Error('无效的主题。');
  const stat = await fs.stat(path.join(dir, id));
  if (stat.size > 2 * 1024 * 1024) throw new Error('主题文件超过 2 MB。');
  return fs.readFile(path.join(dir, id), 'utf8');
}

// ——— Misc ———
const safeFileName = name => String(name || '').replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_').replace(/^\.+/, '').trim().slice(0, 150);
async function tempHtml(html) {
  const file = path.join(os.tmpdir(), `qingye-export-${crypto.randomUUID()}.html`);
  await fs.writeFile(file, html, 'utf8');
  return file;
}
const DECODERS = { 'utf-8': 'utf-8', gbk: 'gbk', gb18030: 'gb18030', big5: 'big5', 'shift_jis': 'shift_jis', 'euc-kr': 'euc-kr', 'utf-16le': 'utf-16le', 'utf-16be': 'utf-16be', 'windows-1252': 'windows-1252', 'iso-8859-1': 'iso-8859-1' };
function decodeWith(buffer, encoding) {
  const name = DECODERS[encoding];
  if (!name) throw new Error('不支持的编码：' + encoding);
  let b = buffer, bomLen = 0;
  if (name === 'utf-8' && b[0] === 0xef && b[1] === 0xbb && b[2] === 0xbf) bomLen = 3;
  if (name === 'utf-16le' && b[0] === 0xff && b[1] === 0xfe) bomLen = 2;
  if (name === 'utf-16be' && b[0] === 0xfe && b[1] === 0xff) bomLen = 2;
  const text = new TextDecoder(name).decode(b.subarray(bomLen));
  const crlf = (text.match(/\r\n/g) || []).length, lf = (text.match(/(?<!\r)\n/g) || []).length;
  return { text: text.replace(/\r\n?/g, '\n'), bom: bomLen > 0, eol: crlf > lf ? '\r\n' : '\n' };
}

module.exports = { listTree, flattenTree, katexCss, snapshot, listVersions, readVersion, findPandoc, pandocExport, pandocImport, runPandocConvert, PANDOC_FROM, PANDOC_FROM_LEGACY, PANDOC_TARGETS, PANDOC_SOURCES, imageFolder, uniqueFile, copyImageInto, listThemes, readTheme, safeFileName, tempHtml, decodeWith, DECODERS, run };
