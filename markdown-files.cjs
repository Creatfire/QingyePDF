// Markdown file handling for the main process: decoding with encoding / BOM / line-ending
// preservation, faithful re-encoding on save, local asset resolution and change watching.
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd', '.mkdn', '.mdwn'];
const MAX_MARKDOWN_BYTES = 32 * 1024 * 1024;
const MAX_ASSET_BYTES = 40 * 1024 * 1024;
const IMAGE_TYPES = { '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.gif': 'image/gif', '.webp': 'image/webp', '.svg': 'image/svg+xml', '.bmp': 'image/bmp', '.avif': 'image/avif', '.ico': 'image/x-icon' };

const isMarkdown = file => MARKDOWN_EXTENSIONS.includes(path.extname(String(file)).toLowerCase());

function decodeMarkdown(buffer) {
  if (buffer.length > MAX_MARKDOWN_BYTES) throw new Error('Markdown 文件超过 32 MB，暂不支持打开。');
  let encoding = 'utf-8', bom = false, text, notice = '';
  if (buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf) { bom = true; text = new TextDecoder('utf-8').decode(buffer.subarray(3)); }
  else if (buffer[0] === 0xff && buffer[1] === 0xfe) { encoding = 'utf-16le'; bom = true; text = new TextDecoder('utf-16le').decode(buffer.subarray(2)); }
  else if (buffer[0] === 0xfe && buffer[1] === 0xff) { encoding = 'utf-16be'; bom = true; text = new TextDecoder('utf-16be').decode(buffer.subarray(2)); notice = '此文件为 UTF-16 BE 编码，保存时将转换为 UTF-8。'; }
  else {
    try { text = new TextDecoder('utf-8', { fatal: true }).decode(buffer); }
    catch { text = new TextDecoder('gb18030').decode(buffer); encoding = 'gb18030'; notice = '此文件为 GBK / GB18030 编码，保存时将转换为 UTF-8。'; }
  }
  if (text.includes('\u0000')) throw new Error('文件包含二进制数据，不是文本 Markdown。');
  const crlf = (text.match(/\r\n/g) || []).length, lf = (text.match(/(?<!\r)\n/g) || []).length;
  const eol = crlf > lf ? '\r\n' : '\n';
  return { text: text.replace(/\r\n?/g, '\n'), encoding, bom, eol, notice };
}

// Writes with the file's original line endings and BOM. Legacy encodings are saved as UTF-8
// (the user was told when the file was opened); UTF-16 LE is kept.
function encodeMarkdown(text, meta = {}) {
  if (typeof text !== 'string') throw new Error('无效的 Markdown 内容。');
  const body = meta.eol === '\r\n' ? text.replace(/\r?\n/g, '\r\n') : text.replace(/\r\n/g, '\n');
  if (meta.encoding === 'utf-16le') return Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(body, 'utf16le')]);
  const bytes = Buffer.from(body, 'utf8');
  if (bytes.length > MAX_MARKDOWN_BYTES) throw new Error('Markdown 内容超过 32 MB，无法保存。');
  return meta.bom && meta.encoding === 'utf-8' ? Buffer.concat([Buffer.from([0xef, 0xbb, 0xbf]), bytes]) : bytes;
}
// After a save the file's encoding is whatever encodeMarkdown wrote.
const savedEncoding = meta => (meta.encoding === 'utf-16le' ? { encoding: 'utf-16le', bom: true } : { encoding: 'utf-8', bom: meta.encoding === 'utf-8' ? !!meta.bom : false });

// Resolves a Markdown link or image target to a local file. Remote and data URLs are never
// touched here: the application stays offline.
function resolveLocal(documentPath, target) {
  let value = String(target || '').trim();
  if (!value || /^(https?:|data:|blob:|mailto:|javascript:)/i.test(value)) return null;
  if (value.startsWith('<') && value.endsWith('>')) value = value.slice(1, -1);
  let fragment = '';
  const hash = value.indexOf('#');
  if (hash >= 0) { fragment = value.slice(hash + 1); value = value.slice(0, hash); }
  value = value.replace(/\?.*$/, '');
  if (/^file:/i.test(value)) { try { value = fileURLToPath(value); } catch { return null; } }
  else { try { value = decodeURI(value); } catch {} }
  if (!value) return { file: documentPath, fragment };
  const base = documentPath ? path.dirname(documentPath) : null;
  const file = path.isAbsolute(value) ? path.normalize(value) : base ? path.resolve(base, value) : null;
  return file ? { file, fragment } : null;
}
async function readAsset(documentPath, source) {
  const resolved = resolveLocal(documentPath, source);
  if (!resolved) return null;
  const type = IMAGE_TYPES[path.extname(resolved.file).toLowerCase()];
  if (!type) return null;
  try {
    const stat = await fs.stat(resolved.file);
    if (!stat.isFile() || stat.size > MAX_ASSET_BYTES) return null;
    return { bytes: await fs.readFile(resolved.file), type };
  } catch { return null; }
}
// Path written into Markdown: relative to the document where possible, "/" separators,
// angle brackets when the path contains spaces or parentheses.
function markdownPath(documentPath, file) {
  let value = documentPath ? path.relative(path.dirname(documentPath), file) : file;
  if (!value || path.isAbsolute(value) && documentPath && path.parse(value).root !== path.parse(path.dirname(documentPath)).root) value = file;
  value = value.split(path.sep).join('/');
  return /[\s()<>]/.test(value) ? `<${value}>` : value;
}

// Watches the containing folder (robust across atomic renames) and reports changes to one file.
function createWatcher(file, onChange) {
  let timer, watcher;
  const base = path.basename(file).toLowerCase();
  try {
    watcher = fsSync.watch(path.dirname(file), { persistent: false }, (_event, name) => {
      if (name && String(name).toLowerCase() !== base) return;
      clearTimeout(timer); timer = setTimeout(onChange, 350);
    });
    watcher.on('error', () => {});
  } catch {}
  return { close() { clearTimeout(timer); try { watcher?.close(); } catch {} } };
}

module.exports = { MARKDOWN_EXTENSIONS, IMAGE_TYPES, isMarkdown, decodeMarkdown, encodeMarkdown, savedEncoding, resolveLocal, readAsset, markdownPath, createWatcher };
