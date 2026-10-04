// Qingye integration of the unmodified official Pandoc 3.12 engine (GPL-2.0-or-later).
const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { randomUUID } = require('node:crypto');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');
const { atomicWrite, fingerprint } = require('./core.cjs');

const executableName = process.platform === 'win32' ? 'pandoc.exe' : 'pandoc';
function bundledPath() { return path.join(process.resourcesPath && __dirname.includes('app.asar') ? process.resourcesPath : path.join(__dirname, 'vendor'), 'pandoc', executableName); }
function abortError() { const e = new Error('已取消文档转换。'); e.code = 'CONVERSION_CANCELED'; return e; }
function run(executable, args, { cwd, input, signal, timeout = 300000, maxBytes = 128e6 } = {}) {
  if (signal?.aborted) return Promise.reject(abortError());
  if (process.platform === 'win32' && cwd?.length > 240) return Promise.reject(new Error('转换工作目录路径过长，请选择较短的目录。'));
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { cwd, windowsHide: true, shell: false, stdio: ['pipe', 'pipe', 'pipe'] });
    const chunks = [], errors = []; let size = 0, errorSize = 0, failure = null;
    const stop = error => {
      if (failure) return; failure = error;
      if (process.platform === 'win32' && child.pid) { const killer = spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }); killer.on('error', () => child.kill()); }
      else child.kill();
    };
    const cancel = () => stop(abortError());
    const timer = setTimeout(() => stop(new Error('文档转换超时。')), timeout); timer.unref();
    signal?.addEventListener('abort', cancel, { once: true }); if (signal?.aborted) cancel();
    const finish = () => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); };
    // Failed Windows spawn may also emit a socket error on stdout/stderr. Treat it as a task error.
    child.stdout?.on('error', stop); child.stderr?.on('error', stop);
    child.stdout.on('data', data => { size += data.length; if (size > maxBytes) stop(new Error('转换输出超过大小限制。')); else chunks.push(data); });
    child.stderr.on('data', data => { errorSize += data.length; if (errorSize <= 4e6) errors.push(data); });
    child.on('error', error => { finish(); reject(failure || error); });
    child.on('close', code => { finish(); const stderr = Buffer.concat(errors).toString('utf8'); if (failure) reject(failure); else if (code !== 0) { const error = new Error(stderr.trim() || `Pandoc 退出码 ${code}`); error.exitCode = code; reject(error); } else resolve({ stdout: Buffer.concat(chunks), stderr }); });
    child.stdin.on('error', error => { if (error.code !== 'EPIPE') stop(error); }); child.stdin.end(input ?? undefined);
  });
}
const infoCache = new Map();
async function describe(executable = bundledPath()) {
  if (!infoCache.has(executable)) infoCache.set(executable, (async () => {
    const queries = await Promise.all(['--version', '--list-input-formats', '--list-output-formats', '--help'].map(flag => run(executable, [flag], { timeout: 15000 })));
    return { found: true, path: executable, bundled: path.resolve(executable) === path.resolve(bundledPath()), version: queries[0].stdout.toString().split(/\r?\n/)[0], readers: queries[1].stdout.toString().trim().split(/\r?\n/), writers: queries[2].stdout.toString().trim().split(/\r?\n/), help: queries[3].stdout.toString() };
  })().catch(error => { infoCache.delete(executable); throw error; }));
  return infoCache.get(executable);
}
const FORMAT_EXTENSIONS = { markdown: 'md', commonmark: 'md', commonmark_x: 'md', gfm: 'md', markdown_strict: 'md', markdown_phpextra: 'md', markdown_github: 'md', markdown_mmd: 'md', html: 'html', html4: 'html', html5: 'html', chunkedhtml: 'zip', latex: 'tex', beamer: 'tex', context: 'tex', plain: 'txt', native: 'txt', ansi: 'txt', epub: 'epub', epub2: 'epub', epub3: 'epub', opendocument: 'xml', openxml: 'xml', csljson: 'json', bibtex: 'bib', biblatex: 'bib', asciidoc: 'adoc', asciidoc_legacy: 'adoc', mediawiki: 'wiki', ms: 'ms', man: 'man', pdf: 'pdf', 'pdf-chromium': 'pdf', custom: 'txt', typst: 'typ', haddock: 'txt', texinfo: 'texi' };
function extension(format) { return FORMAT_EXTENSIONS[format] || (/^(docbook|jats|tei)/.test(format) ? 'xml' : ['revealjs', 'slidy', 's5', 'slideous', 'dzslides'].includes(format) ? 'html' : format.replace(/[^a-z\d]/g, '') || 'txt'); }
function validateExtra(value) {
  if (!Array.isArray(value) || value.length > 400 || value.some(s => typeof s !== 'string' || s.length > 32768 || s.includes('\0'))) throw new Error('高级参数必须是字符串组成的 JSON 数组。');
  // The center owns the output transaction. Query/server modes are separate from conversion.
  for (const s of value) if (/^(?:--output(?:=|$)|-o|--(?:help|version|server|list-[\w-]+|print-[\w-]+)(?:=|$))/.test(s) || s === '--') throw new Error('高级参数不能指定输出位置或启动查询 / 服务模式。');
  return value;
}
async function zipDirectory(dir) {
  const entries = [];
  const walk = async folder => { for (const entry of await fs.readdir(folder, { withFileTypes: true })) { const file = path.join(folder, entry.name); if (entry.isSymbolicLink()) throw new Error('转换输出包含不支持的符号链接。'); if (entry.isDirectory()) await walk(file); else entries.push({ name: path.relative(dir, file).split(path.sep).join('/'), data: await fs.readFile(file) }); } };
  await walk(dir); const { makeZip } = await import(pathToFileURL(path.join(__dirname, 'ui/markdown/zip.mjs')).href); return Buffer.from(await makeZip(entries));
}
async function convertFile({ executable = bundledPath(), inputs, target, from = 'auto', to, standalone = true, toc = false, numberSections = false, citeproc = false, extraArgs = [], signal, renderPdf, exclusive = false, validateTarget = async () => {}, onProgress = () => {} }) {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 100 || inputs.some(file => typeof file !== 'string' || !path.isAbsolute(file))) throw new Error('请选择 1–100 个本地输入文件。');
  if (typeof target !== 'string' || !path.isAbsolute(target)) throw new Error('请选择输出文件。');
  const info = await describe(executable), extra = validateExtra(extraArgs), base = value => value.split(/[+-]/)[0];
  if (to === 'custom' && !extra.some(arg => /^(?:--(?:to|write|defaults)(?:=|$)|-[td])/.test(arg))) throw new Error('请在高级参数指定写出器或 Defaults 配置。');
  if (from !== 'auto' && !info.readers.includes(base(from))) throw new Error('输入格式无效。');
  if (!info.writers.includes(base(to)) && !['pdf-chromium', 'pdf', 'custom'].includes(to)) throw new Error('输出格式无效。');
  const originals = await Promise.all(inputs.map(async file => { const real = await fs.realpath(file), stat = await fs.stat(real); if (!stat.isFile() || stat.size > 1024e6) throw new Error('输入不是普通文件或超过 1 GB。'); return real; }));
  const normalized = file => path.resolve(file).toLowerCase();
  const targetReal = await fs.realpath(target).catch(error => { if (error.code !== 'ENOENT') throw error; return target; });
  if (originals.some(file => normalized(file) === normalized(targetReal))) throw new Error('输出不能覆盖输入文件。');
  const expected = await fingerprint(target);
  // Keep cwd and mkdtemp short; the final transaction still takes place beside the output file.
  const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'qy-convert-'));
  const out = path.join(stage, 'result.' + (to === 'pdf-chromium' ? 'html' : to === 'chunkedhtml' ? 'html' : extension(to)));
  try {
    if (signal?.aborted) throw abortError(); onProgress('正在转换文档…');
    const inputDirectory = path.dirname(originals[0]);
    const longCwd = process.platform === 'win32' && inputDirectory.length > 240;
    const args = longCwd ? await absoluteFileArgs(extra, inputDirectory) : [...extra];
    if (from !== 'auto') args.push('--from', from);
    if (to !== 'custom' && to !== 'pdf') args.push('--to', to === 'pdf-chromium' ? 'html5' : to);
    if (standalone || to === 'pdf-chromium') args.push('--standalone');
    if (toc) args.push('--toc'); if (numberSections) args.push('--number-sections'); if (citeproc) args.push('--citeproc');
    if (to === 'pdf-chromium') args.push('--mathml', '--embed-resources');
    if (longCwd && !extra.some(arg => /^--resource-path(?:=|$)/.test(arg))) args.push('--resource-path', inputDirectory);
    args.push('--output', out, ...originals);
    const result = await run(executable, args, { cwd: longCwd ? stage : inputDirectory, signal });
    if (signal?.aborted) throw abortError();
    const stat = await fs.stat(out).catch(() => null); if (!stat) throw new Error('转换引擎没有生成输出文件。');
    let bytes = stat.isDirectory() ? await zipDirectory(out) : await fs.readFile(out);
    if (to === 'pdf-chromium') { if (typeof renderPdf !== 'function') throw new Error('内置 PDF 排版器尚未连接。'); onProgress('正在排版 PDF…'); bytes = Buffer.from(await renderPdf(bytes.toString('utf8'))); }
    if (signal?.aborted) throw abortError(); onProgress('正在保存输出…');
    await validateTarget(target);
    if (signal?.aborted) throw abortError();
    await atomicWrite(target, bytes, exclusive ? null : expected, { exclusive });
    return { path: target, bytes: bytes.length, warnings: result.stderr, version: info.version };
  } finally {
    const actual = path.resolve(stage); if (path.dirname(actual) === path.resolve(os.tmpdir()) && path.basename(actual).startsWith('qy-convert-')) await fs.rm(actual, { recursive: true, force: true });
  }
}
async function absoluteFileArgs(values, base) {
  const flags = new Set(['--bibliography', '--csl', '--template', '--reference-doc', '--lua-filter', '--filter', '--defaults', '--metadata-file', '--css', '--include-in-header', '--include-before-body', '--include-after-body', '--syntax-definition', '--abbreviations', '--epub-cover-image', '--epub-metadata', '--from', '--to', '--read', '--write', '-L', '-F', '-d', '-c', '-H', '-B', '-A']);
  const args = [...values];
  const directoryFlags = new Set(['--resource-path', '--extract-media', '--data-dir']);
  const directory = (flag, value) => (flag === '--resource-path' ? value.split(path.delimiter) : [value]).map(p => path.isAbsolute(p) ? p : path.resolve(base, p || '.')).join(flag === '--resource-path' ? path.delimiter : '');
  const absolute = async value => { if (path.isAbsolute(value) || /^[a-z]+:\/\//i.test(value)) return value; const file = path.resolve(base, value); return await fs.stat(file).then(s => s.isFile() ? file : value, () => value); };
  for (let i = 0; i < args.length; i++) {
    const equal = args[i].indexOf('=');
    if (equal > 0 && directoryFlags.has(args[i].slice(0, equal))) args[i] = args[i].slice(0, equal + 1) + directory(args[i].slice(0, equal), args[i].slice(equal + 1));
    else if (directoryFlags.has(args[i]) && i + 1 < args.length) { const flag = args[i++]; args[i] = directory(flag, args[i]); }
    else if (equal > 0 && flags.has(args[i].slice(0, equal))) args[i] = args[i].slice(0, equal + 1) + await absolute(args[i].slice(equal + 1));
    else if (flags.has(args[i]) && i + 1 < args.length) { i++; args[i] = await absolute(args[i]); }
  }
  return args;
}
async function convertBatch({ inputs, directory, onItem = () => {}, ...options }) {
  if (!Array.isArray(inputs) || inputs.length < 1 || inputs.length > 100 || inputs.some(p => typeof p !== 'string' || !path.isAbsolute(p))) throw new Error('请选择 1–100 个本地输入文件。');
  if (typeof directory !== 'string' || !path.isAbsolute(directory) || !(await fs.stat(directory)).isDirectory()) throw new Error('请选择输出文件夹。');
  await describe(options.executable); validateExtra(options.extraArgs || []);
  const blocked = new Set(inputs.map(p => path.resolve(p).toLowerCase())), items = [];
  for (let index = 0; index < inputs.length; index++) {
    const input = inputs[index], item = { input, index, status: 'pending' }; items.push(item);
    if (options.signal?.aborted) { item.status = 'canceled'; onItem({ ...item }); continue; }
    item.status = 'running'; onItem({ ...item });
    try {
      const stem = path.parse(input).name.replace(/[<>:"/\\|?*\x00-\x1f]/g, '_').replace(/[ .]+$/g, '') || 'converted';
      for (let n = 1; n <= 10000; n++) {
        const target = path.join(directory, stem + (n === 1 ? '' : ` (${n})`) + '.' + extension(options.to));
        if (blocked.has(path.resolve(target).toLowerCase()) || await fs.lstat(target).then(() => true, e => { if (e.code === 'ENOENT') return false; throw e; })) continue;
        try { Object.assign(item, await convertFile({ ...options, inputs: [input], target, exclusive: true }), { status: 'success' }); break; }
        catch (e) { if (e.code === 'EEXIST') continue; throw e; }
      }
      if (item.status !== 'success') throw new Error('无法分配新的输出文件名。');
    } catch (e) { item.status = e.code === 'CONVERSION_CANCELED' || options.signal?.aborted ? 'canceled' : 'failed'; item.error = e.message; }
    onItem({ ...item });
  }
  return { items, succeeded: items.filter(i => i.status === 'success').length, failed: items.filter(i => i.status === 'failed').length, canceled: items.filter(i => i.status === 'canceled').length };
}
module.exports = { bundledPath, run, describe, extension, validateExtra, convertFile, convertBatch };
