// node:child_process on Android. The only program the shared desktop modules start is Pandoc
// (pandoc-engine.cjs, markdown-tools.cjs). spawn('…/pandoc', args, {cwd}) is answered by the
// official Pandoc WebAssembly build running in a Web Worker: files the command line refers to
// are copied into the worker's virtual file system, and what the engine writes is copied back.
import { Buffer } from 'buffer';
import path from 'path';
import fs from './fs-promises.js';
import { parseArguments, extensionLines, HELP, FILE_KEYS, FILE_LIST_KEYS } from '../pandoc/args.js';

const RESOURCE_TYPES = new Set(['png', 'jpg', 'jpeg', 'gif', 'svg', 'webp', 'bmp', 'tif', 'tiff', 'ico', 'avif', 'css', 'woff', 'woff2', 'ttf', 'otf']);
const TEXT_TYPES = new Set(['bib', 'csl', 'yaml', 'yml', 'json', 'lua', 'tex', 'latex', 'html', 'htm', 'md', 'markdown', 'txt', 'csv', 'tsv', 'xml']);
const LIMITS = { files: 2000, bytes: 160 * 1024 * 1024, depth: 4, textBytes: 2 * 1024 * 1024 };

let worker = null, sequence = 0, idleTimer = null;
const pending = new Map();
function engine() {
  clearTimeout(idleTimer);
  if (worker) return worker;
  worker = new Worker(new URL('mobile/pandoc-worker.js', document.baseURI));
  worker.onmessage = event => { const job = pending.get(event.data.id); if (!job) return; pending.delete(event.data.id); if (event.data.ok) job.resolve(event.data.result); else job.reject(new Error(event.data.error)); release(); };
  worker.onerror = event => { stop(new Error('转换引擎异常退出：' + (event.message || '内存不足或文件过大'))); };
  return worker;
}
function stop(error) { worker?.terminate(); worker = null; for (const job of pending.values()) job.reject(error); pending.clear(); }
// The engine holds a few hundred megabytes; let it go when it has been idle for a while.
function release() { clearTimeout(idleTimer); if (!pending.size) idleTimer = setTimeout(() => { if (!pending.size) { worker?.terminate(); worker = null; } }, 90000); }
function request(message, transfer = []) {
  const id = ++sequence;
  return { id, promise: new Promise((resolve, reject) => { pending.set(id, { resolve, reject }); engine().postMessage({ ...message, id }, transfer); }) };
}

const isPandoc = command => /(^|[\\/])pandoc(\.exe)?$/i.test(String(command));

async function runPandoc(args, { cwd, stdin, onStart }) {
  const parsed = parseArguments(args);
  if (parsed.query) {
    if (parsed.query === 'help') return { stdout: HELP, stderr: '' };
    const job = request({ kind: 'query', options: parsed.query === 'extensions-for-format' ? { query: parsed.query, format: parsed.format } : { query: parsed.query } }); onStart(job);
    const { value } = await job.promise;
    if (parsed.query === 'version') return { stdout: `pandoc ${value}\nFeatures: +lua (WebAssembly)\n`, stderr: '' };
    if (parsed.query === 'extensions-for-format') return { stdout: extensionLines(value), stderr: '' };
    return { stdout: (Array.isArray(value) ? value.join('\n') : String(value)) + '\n', stderr: '' };
  }
  const base = path.resolve(cwd || '/');
  const absolute = file => path.resolve(base, file);
  // The virtual root is the working directory; files elsewhere keep their absolute location.
  const virtual = file => { const full = absolute(file); return full === base ? '.' : full.startsWith(base === '/' ? '/' : base + '/') ? full.slice(base === '/' ? 1 : base.length + 1) : full; };
  const inside = file => !path.isAbsolute(virtual(file));
  const files = new Map(), outsideRoots = new Set();
  let total = 0;
  const add = async (file, required) => {
    const full = absolute(file), key = virtual(file).replace(/^\//, '');
    if (files.has(key)) return true;
    let bytes; try { bytes = await fs.readFile(full); } catch (error) { if (required) throw new Error(`${file}: 文件不存在或无法读取。`); return false; }
    total += bytes.length; if (total > LIMITS.bytes) throw new Error('转换涉及的文件总大小超过安卓版的 160 MB 上限。');
    files.set(key, new Uint8Array(bytes)); if (!inside(file)) outsideRoots.add(path.dirname(full)); return true;
  };
  const options = { ...parsed.options };
  if (!parsed.inputs.length && stdin == null) throw new Error('没有输入文件。');
  for (const input of parsed.inputs) await add(input, true);
  if (parsed.inputs.length) options['input-files'] = parsed.inputs.map(virtual);
  for (const key of FILE_KEYS) if (typeof options[key] === 'string' && !/^[a-z][a-z\d+.-]*:\/\//i.test(options[key])) { if (await add(options[key], key === 'reference-doc' || key === 'epub-cover-image')) options[key] = virtual(options[key]); }
  for (const key of FILE_LIST_KEYS) if (Array.isArray(options[key])) { const list = []; for (const item of options[key]) { if (await add(item, key !== 'bibliography' ? true : true)) list.push(virtual(item)); } options[key] = list; }
  for (const filter of options.filters || []) if (filter.type === 'lua') { await add(filter.path, true); filter.path = virtual(filter.path); }
  if (typeof options.template === 'string' && !files.has(virtual(options.template).replace(/^\//, ''))) { /* a built-in template name */ }
  // Images and other resources the documents may refer to, relative to the working directory
  // and to every --resource-path entry.
  const resourceRoots = [base, ...(options['resource-path'] || []).map(absolute)];
  let count = 0;
  const scan = async (folder, depth) => {
    let entries; try { entries = await fs.readdir(folder, { withFileTypes: true }); } catch { return; }
    for (const entry of entries) {
      if (count >= LIMITS.files || entry.name.startsWith('.') || entry.name === 'node_modules') continue;
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) { if (depth < LIMITS.depth) await scan(full, depth + 1); continue; }
      const type = path.extname(entry.name).slice(1).toLowerCase();
      if (!RESOURCE_TYPES.has(type) && !TEXT_TYPES.has(type)) continue;
      if (TEXT_TYPES.has(type)) { const info = await fs.stat(full).catch(() => null); if (!info || info.size > LIMITS.textBytes) continue; }
      if (total > LIMITS.bytes * .75) return;
      count++; await add(full, false).catch(() => {});
    }
  };
  // The app's own folders (private data, the temporary staging folder) never hold user resources.
  for (const root of new Set(resourceRoots)) if (root !== '/' && !/\/(cache|files)\/qingye/.test(root + '/')) await scan(root, 0);
  if (options['resource-path']) options['resource-path'] = options['resource-path'].map(virtual);
  const directories = [];
  const outputFile = typeof options['output-file'] === 'string' && options['output-file'] !== '-' ? options['output-file'] : null;
  if (outputFile) { options['output-file'] = virtual(outputFile); directories.push(path.dirname(virtual(outputFile)).replace(/^\//, '')); if (!inside(outputFile)) outsideRoots.add(path.dirname(absolute(outputFile))); }
  else delete options['output-file'];
  if (typeof options['extract-media'] === 'string') { const media = options['extract-media']; if (!inside(media)) outsideRoots.add(absolute(media)); options['extract-media'] = virtual(media); }
  const list = [...files].map(([name, bytes]) => ({ path: name, bytes }));
  const job = request({ kind: 'convert', options, stdin: stdin ? new Uint8Array(stdin) : null, files: list, directories: directories.filter(d => d && d !== '.') }, list.map(item => item.bytes.buffer));
  onStart(job);
  const result = await job.promise;
  const warnings = (result.warnings || []).map(w => '[WARNING] ' + (w.pretty || w.message || (typeof w === 'string' ? w : JSON.stringify(w)))).join('\n');
  const failed = /^ERROR:|^pandoc: /m.test(result.stderr || '') || (!!result.stderr?.trim() && !result.created.length && !result.stdout.length);
  if (failed) { const error = new Error((result.stderr || '转换失败。').replace(/^ERROR:\s*/m, '').trim()); error.exitCode = 1; error.stderr = result.stderr; throw error; }
  // Copy what the engine wrote back to the device.
  const roots = [...outsideRoots].map(root => root.replace(/^\//, ''));
  for (const item of result.created) {
    const outside = roots.find(root => item.path === root || item.path.startsWith(root + '/'));
    const target = outside ? '/' + item.path : path.join(base, item.path);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, item.bytes);
  }
  return { stdout: result.stdout, stderr: [result.stderr, warnings].filter(Boolean).join('\n') };
}

// ——— the small part of ChildProcess that the desktop modules use ———
class Emitter {
  constructor() { this.listeners = new Map(); }
  on(name, listener) { if (!this.listeners.has(name)) this.listeners.set(name, []); this.listeners.get(name).push(listener); return this; }
  once(name, listener) { const wrapped = (...args) => { this.off(name, wrapped); listener(...args); }; return this.on(name, wrapped); }
  off(name, listener) { const list = this.listeners.get(name); if (list) this.listeners.set(name, list.filter(l => l !== listener)); return this; }
  emit(name, ...args) { for (const listener of [...(this.listeners.get(name) || [])]) listener(...args); }
}
export function spawn(command, args = [], options = {}) {
  const child = new Emitter(); child.pid = 0; child.stdout = new Emitter(); child.stderr = new Emitter(); child.stdin = new Emitter();
  let killed = false, job = null, input = null, started = false;
  const finish = (code, stdout, stderr) => { if (stdout?.length) child.stdout.emit('data', Buffer.from(stdout)); if (stderr) child.stderr.emit('data', Buffer.from(stderr)); child.emit('close', code); };
  const start = () => {
    if (started) return; started = true;
    if (!isPandoc(command)) { queueMicrotask(() => child.emit('error', Object.assign(new Error('安卓版不支持启动外部程序。'), { code: 'ENOENT' }))); return; }
    runPandoc(args.map(String), { cwd: options.cwd, stdin: input, onStart: value => { job = value; } }).then(
      result => { if (!killed) finish(0, typeof result.stdout === 'string' ? Buffer.from(result.stdout) : result.stdout, result.stderr); },
      error => { if (!killed) finish(error.exitCode || (error.unsupported ? 6 : 1), null, (error.stderr || error.message || String(error)) + '\n'); });
  };
  child.stdin.end = data => { if (data != null) input = typeof data === 'string' ? Buffer.from(data, 'utf8') : data; start(); };
  // WebAssembly cannot be interrupted: cancelling replaces the engine.
  child.kill = () => { if (killed) return true; killed = true; if (job && pending.has(job.id)) stop(new Error('已取消文档转换。')); queueMicrotask(() => child.emit('close', null)); return true; };
  // Callers that never touch stdin still get their process.
  setTimeout(start, 0);
  return child;
}
export default { spawn };
