// Editor ↔ Pandoc bridge (main process). Owns the Markdown dialect handed to Pandoc, the import
// writer that produces editor-native syntax, the themed Word reference document and the staging of
// export jobs. Processes are started through pandoc-engine.run (cancellation, size and time limits).
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const zlib = require('node:zlib');
const { pathToFileURL } = require('node:url');
const engine = require('./pandoc-engine.cjs');

// Reader dialect = the editor's syntax. east_asian_line_breaks keeps a soft line break between CJK
// characters from turning into a space; alerts reads GitHub `> [!NOTE]` boxes; -smart keeps quotes
// and dashes exactly as typed unless the user enabled smart punctuation.
const PANDOC_FROM = 'markdown-smart+emoji+east_asian_line_breaks+alerts+task_lists+pipe_tables+footnotes+tex_math_dollars+strikeout+subscript+superscript+mark';
// Older external Pandoc builds lack `mark`; any other unknown extension is dropped the same way.
const PANDOC_FROM_LEGACY = PANDOC_FROM.replace('+mark', '');
// Import writer: Pandoc Markdown restricted to what the editor renders natively (==mark==, ~sub~,
// ^sup^, $$math$$, pipe tables) instead of falling back to raw HTML.
const IMPORT_TO = 'markdown-grid_tables-multiline_tables-simple_tables-fenced_divs-bracketed_spans-header_attributes-link_attributes-native_divs-native_spans-raw_attribute-smart+mark+pipe_tables+tex_math_dollars';

const TARGETS = { odt: 'odt', rst: 'rst', mediawiki: 'mediawiki', textile: 'textile', opml: 'opml', org: 'org', asciidoc: 'asciidoc', pptx: 'pptx', docx: 'docx', epub: 'epub3', latex: 'latex', rtf: 'rtf', html: 'html5' };
const SOURCES = { '.docx': 'docx', '.odt': 'odt', '.html': 'html', '.htm': 'html', '.epub': 'epub', '.tex': 'latex', '.latex': 'latex', '.rst': 'rst', '.org': 'org', '.textile': 'textile', '.wiki': 'mediawiki', '.opml': 'opml', '.rtf': 'rtf', '.ipynb': 'ipynb', '.csv': 'csv', '.tsv': 'tsv', '.adoc': 'asciidoc', '.txt': 'markdown', '.typ': 'typst', '.dj': 'djot', '.xlsx': 'xlsx', '.pptx': 'pptx' };

const withoutExtension = (from, ext) => from.replace(new RegExp(`[+-]${ext}(?=[+-]|$)`), '');
// Runs `make(from)` and, when Pandoc reports an unknown reader extension, retries without it.
async function withDialect(from, make) {
  for (let attempt = 0; ; attempt++) {
    try { return await make(from); }
    catch (error) {
      const unknown = /Unknown extension:?\s*([a-z_\d]+)/i.exec(error.message || '');
      const next = unknown && withoutExtension(from, unknown[1]);
      if (!unknown || attempt >= 6 || next === from) throw error;
      from = next;
    }
  }
}
const readerFor = ({ smart = false } = {}) => smart ? PANDOC_FROM.replace('markdown-smart', 'markdown') : PANDOC_FROM;

const SAFE_NAME = /^[\w.-]{1,120}$/;
// Converts editor Markdown with Pandoc. `files` are extra resources (rendered diagrams) addressed by
// bare file name from the Markdown; `reference` is a .docx/.odt/.pptx Buffer used as style template.
async function exportDocument(pandoc, { format, text, cwd, files = [], toc = false, lang = 'zh-CN', smart = false, reference = null, css = '', citeproc = false, bibliography = '', csl = '', signal, timeout = 300000 }) {
  const target = TARGETS[format];
  if (!target) throw new Error('不支持的 Pandoc 格式：' + format);
  if (typeof text !== 'string') throw new Error('无效的内容。');
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'qy-mdexport-'));
  try {
    const input = path.join(stage, 'input.md'), out = path.join(stage, 'output.' + (format === 'epub' ? 'epub' : format === 'latex' ? 'tex' : format));
    await fs.writeFile(input, text, 'utf8');
    for (const file of files) {
      if (!SAFE_NAME.test(file?.name || '') || file.name === 'input.md') throw new Error('无效的附加资源名称。');
      await fs.writeFile(path.join(stage, file.name), Buffer.from(file.data));
    }
    const args = ['-t', target, '-o', out, '--standalone', '--resource-path', [stage, cwd].filter(Boolean).join(path.delimiter)];
    if (lang) args.push('-M', 'lang=' + lang);
    if (toc) args.push('--toc');
    if (reference && ['docx', 'odt', 'pptx'].includes(format)) { const ref = path.join(stage, 'reference.' + format); await fs.writeFile(ref, reference); args.push('--reference-doc', ref); }
    if (css && ['epub', 'html'].includes(format)) { const sheet = path.join(stage, 'style.css'); await fs.writeFile(sheet, css, 'utf8'); args.push('--css', sheet); }
    if (format === 'html') args.push('--embed-resources');
    // Citations ([@key]) from the reference library or the document's own bibliography.
    if (citeproc) {
      args.push('--citeproc', '-M', 'link-citations=true');
      if (lang === 'zh-CN') args.push('-M', 'reference-section-title=参考文献');
      if (bibliography) { if (!SAFE_NAME.test(bibliography) || !files.some(f => f.name === bibliography)) throw new Error('无效的文献库文件。'); args.push('--bibliography', path.join(stage, bibliography)); }
      if (csl) { const file = path.resolve(csl); if (!/\.csl$/i.test(file) || !(await fs.stat(file).then(s => s.isFile(), () => false))) throw new Error('找不到引用样式文件（.csl）：' + csl); args.push('--csl', file); }
    }
    args.push(input);
    const result = await withDialect(readerFor({ smart }), from => engine.run(pandoc, ['-f', from, ...args], { cwd: cwd || stage, signal, timeout }));
    return { bytes: await fs.readFile(out), warnings: result.stderr };
  } finally {
    const actual = path.resolve(stage);
    if (path.dirname(actual) === path.resolve(os.tmpdir()) && path.basename(actual).startsWith('qy-mdexport-')) await fs.rm(actual, { recursive: true, force: true });
  }
}

// Kept for the editor's "more formats" path and existing callers: text in, file at `out`.
async function pandocExport(pandoc, { format, text, out, cwd }) {
  const { bytes } = await exportDocument(pandoc, { format, text, cwd, lang: '' });
  await fs.writeFile(out, bytes);
  return out;
}

async function pandocImport(pandoc, file, { mediaDir, trackChanges = 'accept', signal } = {}) {
  const from = SOURCES[path.extname(file).toLowerCase()];
  if (!from) throw new Error('不支持导入此类型的文件。');
  const args = ['-f', from === 'markdown' ? PANDOC_FROM : from, '-t', IMPORT_TO, '--wrap=none'];
  if (from === 'docx') args.push('--track-changes=' + (['accept', 'reject', 'all'].includes(trackChanges) ? trackChanges : 'accept'));
  if (mediaDir) args.push('--extract-media', mediaDir);
  const { stdout } = await engine.run(pandoc, [...args, file], { cwd: path.dirname(file), signal });
  return stdout.toString('utf8');
}

// ——— Clipboard HTML (Word, web pages) → Markdown ———
// Word's clipboard HTML carries conditional comments, Office XML, <o:p>, MsoList paragraphs with
// typed-in numbers and tables without header cells. These are normalised to plain HTML first;
// Pandoc then rebuilds the structure (headings, lists, tables, emphasis, links).
const WORD_LIST = /<p\b[^>]*class="?MsoList[^>]*>[\s\S]*?<\/p>/gi;
function wordLists(html) {
  return html.replace(/(?:<p\b[^>]*class="?MsoList[^>]*>[\s\S]*?<\/p>\s*)+/gi, run => {
    const items = run.match(WORD_LIST).map(p => {
      const level = Number((/level(\d+)/i.exec(p) || [])[1] || 1);
      const marker = (/<!\[if !supportLists\]>([\s\S]*?)<!\[endif\]>/i.exec(p) || [])[1] || '';
      const text = marker.replace(/<[^>]+>/g, '').replace(/&nbsp;|\s/g, '');
      const body = p.replace(/<!\[if !supportLists\]>[\s\S]*?<!\[endif\]>/i, '').replace(/^<p\b[^>]*>/i, '').replace(/<\/p>$/i, '');
      return { level, ordered: /^[(（]?[\dA-Za-z一二三四五六七八九十ivxIVX]+[.)、．）]$/.test(text), body };
    });
    let out = '', stack = [];
    for (const it of items) {
      while (stack.length > it.level) out += '</li></' + stack.pop() + '>';
      if (stack.length === it.level) out += '</li>';
      while (stack.length < it.level) { const tag = it.ordered ? 'ol' : 'ul'; stack.push(tag); out += '<' + tag + '>'; }
      out += '<li>' + it.body;
    }
    while (stack.length) out += '</li></' + stack.pop() + '>';
    return out;
  });
}
// A table without <th> gets its first row as the header (Markdown pipe tables need one).
function tableHeaders(html) {
  return html.replace(/<table\b[\s\S]*?<\/table>/gi, table => {
    if (/<th\b/i.test(table)) return table;
    return table.replace(/<tr\b[^>]*>[\s\S]*?<\/tr>/i, row => row.replace(/<(\/?)td\b/gi, '<$1th'));
  });
}
function cleanClipboardHtml(html) {
  let s = String(html || '');
  const start = s.indexOf('<!--StartFragment-->'), end = s.indexOf('<!--EndFragment-->');
  if (start >= 0 && end > start) s = s.slice(start + 20, end);
  s = s.replace(/<(style|script|xml|head)\b[\s\S]*?<\/\1>/gi, '')
    .replace(/<!--\[if (?!!supportLists)[\s\S]*?<!\[endif\]-->/gi, '');
  s = wordLists(s);
  s = s.replace(/<!\[if [^\]]*\]>[\s\S]*?<!\[endif\]>/gi, '').replace(/<\/?o:p>/gi, '').replace(/<\/?(?:o|v|w|m):[^>]*>/gi, '').replace(/<!--[\s\S]*?-->/g, '');
  return tableHeaders(s);
}
const PASTE_FROM = 'html-native_divs-native_spans';
async function pandocHtmlToMarkdown(pandoc, html, { signal } = {}) {
  const { stdout } = await engine.run(pandoc, ['-f', PASTE_FROM, '-t', IMPORT_TO, '--wrap=none'], { input: Buffer.from(cleanClipboardHtml(html), 'utf8'), signal, timeout: 20000 });
  // One space after list markers, as typed in the editor.
  return stdout.toString('utf8').replace(/\r\n?/g, '\n').replace(/^(\s*)([-*+]|\d+[.)])[ ]{2,}(?=\S)/gm, '$1$2 ').replace(/\n{3,}/g, '\n\n').trim();
}

// ——— Themed reference.docx ———
// Minimal ZIP reader for the reference document Pandoc prints (stored or deflated entries).
function readZip(buffer) {
  let end = buffer.length - 22;
  while (end >= 0 && buffer.readUInt32LE(end) !== 0x06054b50) end--;
  if (end < 0) throw new Error('无效的 ZIP 数据。');
  const count = buffer.readUInt16LE(end + 10); let p = buffer.readUInt32LE(end + 16);
  const entries = [];
  for (let i = 0; i < count; i++) {
    const method = buffer.readUInt16LE(p + 10), size = buffer.readUInt32LE(p + 20), nameLen = buffer.readUInt16LE(p + 28), extra = buffer.readUInt16LE(p + 30), comment = buffer.readUInt16LE(p + 32), local = buffer.readUInt32LE(p + 42);
    const name = buffer.toString('utf8', p + 46, p + 46 + nameLen);
    const start = local + 30 + buffer.readUInt16LE(local + 26) + buffer.readUInt16LE(local + 28), raw = buffer.subarray(start, start + size);
    entries.push({ name, data: method === 8 ? zlib.inflateRawSync(raw) : Buffer.from(raw) });
    p += 46 + nameLen + extra + comment;
  }
  return entries;
}
const xmlAttr = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
const fonts = (latin, cjk) => `<w:rFonts w:ascii="${xmlAttr(latin)}" w:hAnsi="${xmlAttr(latin)}" w:eastAsia="${xmlAttr(cjk)}" w:cs="${xmlAttr(latin)}"/>`;
const hex = c => /^#?[0-9a-f]{6}$/i.test(c || '') ? c.replace('#', '').toUpperCase() : null;
// style: { latin, cjk, headingLatin, headingCjk, color, headingColor, sizePt }
function themeStyles(xml, style = {}) {
  const latin = style.latin || 'Calibri', cjk = style.cjk || 'Microsoft YaHei';
  const sz = Math.round(Math.min(36, Math.max(8, Number(style.sizePt) || 11)) * 2);
  xml = xml.replace(/(<w:rPrDefault>\s*<w:rPr>)([\s\S]*?)(<\/w:rPr>)/, (m, a, body, b) => a
    + body.replace(/<w:rFonts[\s\S]*?\/>/, fonts(latin, cjk)).replace(/<w:sz w:val="\d+"\s*\/>/, `<w:sz w:val="${sz}"/>`).replace(/<w:szCs w:val="\d+"\s*\/>/, `<w:szCs w:val="${sz}"/>`)
    + (hex(style.color) && !/<w:color/.test(body) ? `<w:color w:val="${hex(style.color)}"/>` : '') + b);
  const headingFonts = fonts(style.headingLatin || latin, style.headingCjk || cjk), headingColor = hex(style.headingColor);
  return xml.replace(/<w:style [^>]*w:styleId="(Heading[1-9]|Title|Subtitle)"[^>]*>[\s\S]*?<\/w:style>/g, block => {
    let out = block.replace(/<w:rFonts[\s\S]*?\/>/, headingFonts);
    if (headingColor) out = out.replace(/<w:color[\s\S]*?\/>/, `<w:color w:val="${headingColor}"/>`);
    return out;
  });
}
const referenceCache = new Map();
async function referenceDocx(pandoc, style = {}) {
  const key = pandoc + '|' + JSON.stringify(style);
  if (!referenceCache.has(key)) referenceCache.set(key, (async () => {
    const { stdout } = await engine.run(pandoc, ['--print-default-data-file', 'reference.docx'], { timeout: 30000 });
    const entries = readZip(stdout).map(e => e.name === 'word/styles.xml' ? { name: e.name, data: themeStyles(e.data.toString('utf8'), style) } : e);
    const { makeZip } = await import(pathToFileURL(path.join(__dirname, 'ui/markdown/zip.mjs')).href);
    return Buffer.from(await makeZip(entries));
  })().catch(error => { referenceCache.delete(key); throw error; }));
  return referenceCache.get(key);
}

module.exports = { PANDOC_FROM, PANDOC_FROM_LEGACY, IMPORT_TO, TARGETS, SOURCES, withDialect, readerFor, exportDocument, pandocExport, pandocImport, referenceDocx, themeStyles, readZip, cleanClipboardHtml, pandocHtmlToMarkdown };
