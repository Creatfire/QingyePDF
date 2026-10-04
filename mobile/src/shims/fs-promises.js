// node:fs/promises subset used by the shared main-process modules.
import { Buffer } from 'buffer';
import { backend, fail } from './backend.js';

const stats = (info) => ({ size: info.size, mtimeMs: info.mtime, mtime: new Date(info.mtime), isFile: () => info.type === 'file', isDirectory: () => info.type === 'dir', isSymbolicLink: () => false });
const dirent = e => ({ name: e.name, isFile: () => e.type === 'file', isDirectory: () => e.type === 'dir', isSymbolicLink: () => false });
const encodingOf = options => typeof options === 'string' ? options : options?.encoding || null;
const toBytes = (data, options) => typeof data === 'string' ? Buffer.from(data, encodingOf(options) || 'utf8') : data instanceof Uint8Array ? data : new Uint8Array(data.buffer || data);

export async function readFile(path, options) { const bytes = Buffer.from((await backend.read(String(path))).buffer); const encoding = encodingOf(options); return encoding ? bytes.toString(encoding) : bytes; }
export async function writeFile(path, data, options) { const flag = typeof options === 'object' && options?.flag; if (flag === 'wx' && await backend.stat(String(path)).then(() => true, () => false)) throw fail('EEXIST', path, 'file already exists'); await backend.write(String(path), toBytes(data, options)); }
export async function mkdir(path, options) { await backend.mkdir(String(path), !!options?.recursive); }
export async function readdir(path, options) { const entries = await backend.readdir(String(path)); return options?.withFileTypes ? entries.map(dirent) : entries.map(e => e.name); }
export async function stat(path) { return stats(await backend.stat(String(path))); }
export const lstat = stat;
export async function access(path) { await backend.stat(String(path)); }
export async function rm(path, options) { try { await backend.rm(String(path), !!options?.recursive); } catch (error) { if (!(options?.force && error.code === 'ENOENT')) throw error; } }
export async function unlink(path) { const info = await backend.stat(String(path)); if (info.type !== 'file') throw fail('EISDIR', path, 'is a directory'); await backend.rm(String(path), false); }
export async function rmdir(path) { await backend.rm(String(path), false); }
export async function rename(from, to) { await backend.rename(String(from), String(to)); }
export async function copyFile(from, to, mode) { await backend.copy(String(from), String(to), !!(mode & 1)); }
export async function realpath(path) { await backend.stat(String(path)); return String(path); }
export async function mkdtemp(prefix) { const path = prefix + Math.random().toString(36).slice(2, 8); await backend.mkdir(path, true); return path; }
export default { readFile, writeFile, mkdir, readdir, stat, lstat, access, rm, unlink, rmdir, rename, copyFile, realpath, mkdtemp };
