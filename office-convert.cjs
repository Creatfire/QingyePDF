// Opens Word / Excel / PowerPoint (and other office formats) as PDF with the bundled LibreOffice
// (MPL-2.0, vendor/libreoffice → resources/libreoffice). The source file is copied into a private
// staging folder and converted headless with an isolated, macro-locked user profile; the original is
// never touched. Results are cached by content digest so reopening an unchanged file is instant.
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');
const { pathToFileURL } = require('node:url');

const OFFICE_EXTENSIONS = new Set(['.doc', '.docx', '.docm', '.dot', '.dotx', '.odt', '.ott', '.rtf', '.wps', '.wpt',
  '.xls', '.xlsx', '.xlsm', '.xlsb', '.xlt', '.xltx', '.ods', '.ots', '.csv', '.et',
  '.ppt', '.pptx', '.pptm', '.pps', '.ppsx', '.pot', '.potx', '.odp', '.otp', '.dps', '.vsd', '.vsdx', '.pub']);
const isOffice = file => typeof file === 'string' && OFFICE_EXTENSIONS.has(path.extname(file).toLowerCase());

function bundledRoot({ packaged, resources } = {}) { return packaged ? path.join(resources, 'libreoffice') : path.join(__dirname, 'vendor', 'libreoffice'); }
function sofficePath(options) {
  const exe = path.join(bundledRoot(options), 'program', process.platform === 'win32' ? 'soffice.com' : 'soffice');
  return fsSync.existsSync(exe) ? exe : null;
}
function engineInfo(options) {
  try { const m = JSON.parse(fsSync.readFileSync(path.join(bundledRoot(options), 'manifest.json'), 'utf8').replace(/^﻿/, '')); return { name: m.name, version: m.version }; } catch { return null; }
}

// User profile: never run document macros, no first-start wizard, no update checks or remote fetches.
const PROFILE_XCU = `<?xml version="1.0" encoding="UTF-8"?>
<oor:items xmlns:oor="http://openoffice.org/2001/registry" xmlns:xs="http://www.w3.org/2001/XMLSchema" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance">
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="MacroSecurityLevel" oor:op="fuse"><value>3</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security/Scripting"><prop oor:name="DisableMacrosExecution" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Setup/Office"><prop oor:name="FirstStartWizardCompleted" oor:op="fuse"><value>true</value></prop></item>
<item oor:path="/org.openoffice.Office.Jobs/Jobs/org.openoffice.Office.Jobs:Job['UpdateCheck']/Arguments"><prop oor:name="AutoCheckEnabled" oor:op="fuse"><value>false</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Misc"><prop oor:name="UseOpenCL" oor:op="fuse"><value>false</value></prop></item>
<item oor:path="/org.openoffice.Office.Common/Security"><prop oor:name="BlockUntrustedRefererLinks" oor:op="fuse"><value>true</value></prop></item>
</oor:items>`;
async function ensureProfile(dir) {
  const user = path.join(dir, 'user');
  await fs.mkdir(user, { recursive: true });
  const file = path.join(user, 'registrymodifications.xcu');
  if (!(await fs.stat(file).catch(() => null))) await fs.writeFile(file, PROFILE_XCU, 'utf8');
}

function abortError() { const e = new Error('已取消打开。'); e.code = 'OFFICE_CANCELED'; return e; }
function run(exe, args, { signal, timeout }) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'pipe', 'pipe'] });
    let stderr = '', failure = null;
    const stop = error => {
      if (failure) return; failure = error;
      if (process.platform === 'win32' && child.pid) spawn('taskkill.exe', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true, stdio: 'ignore' }).on('error', () => child.kill());
      else child.kill('SIGKILL');
    };
    const timer = setTimeout(() => stop(new Error('转换超时：文件可能过大或过于复杂。')), timeout); timer.unref();
    const cancel = () => stop(abortError()); signal?.addEventListener('abort', cancel, { once: true });
    child.stdout.on('data', () => {}); child.stderr.on('data', d => { if (stderr.length < 20000) stderr += d; });
    child.on('error', error => { clearTimeout(timer); reject(failure || error); });
    child.on('close', code => { clearTimeout(timer); signal?.removeEventListener('abort', cancel); if (failure) reject(failure); else resolve({ code, stderr }); });
  });
}

// One conversion at a time: a LibreOffice user profile cannot be shared by concurrent instances.
let queue = Promise.resolve();
function serial(task) { const next = queue.then(task, task); queue = next.catch(() => {}); return next; }

/**
 * Converts `file` to PDF bytes. options: { packaged, resources, profileDir, cacheDir, signal,
 * timeout, onProgress }. Throws a readable error if LibreOffice is missing or the file cannot be read.
 */
async function toPdf(file, { packaged = false, resources = '', profileDir, cacheDir, signal, timeout = 180000, onProgress = () => {} } = {}) {
  const exe = sofficePath({ packaged, resources });
  if (!exe) throw new Error('内置的 LibreOffice 转换引擎缺失，请重新安装青页。');
  const source = await fs.readFile(file);
  if (source.length > 512 * 1024 * 1024) throw new Error('文件超过 512 MB，无法转换。');
  const digest = crypto.createHash('sha256').update(source).digest('hex');
  const cached = cacheDir && path.join(cacheDir, digest + '.pdf');
  if (cached) { const hit = await fs.readFile(cached).catch(() => null); if (hit?.length) return { bytes: hit, cached: true, digest }; }
  return serial(async () => {
    if (signal?.aborted) throw abortError();
    onProgress(`正在以 PDF 形式打开 ${path.basename(file)}…`);
    await ensureProfile(profileDir);
    const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'qy-office-'));
    try {
      // ASCII name in a short folder: avoids path-length and code-page issues in the converter.
      const input = path.join(stage, 'input' + path.extname(file).toLowerCase());
      await fs.writeFile(input, source);
      const args = ['--headless', '--invisible', '--norestore', '--nologo', '--nodefault', '--nolockcheck', '--nofirststartwizard',
        `-env:UserInstallation=${pathToFileURL(profileDir).href}`, '--convert-to', 'pdf', '--outdir', stage, input];
      const result = await run(exe, args, { signal, timeout });
      const out = path.join(stage, 'input.pdf');
      const bytes = await fs.readFile(out).catch(() => null);
      if (!bytes?.length || bytes.subarray(0, 4).toString() !== '%PDF') throw new Error('LibreOffice 无法转换此文件' + (result.stderr.trim() ? '：' + result.stderr.trim().split(/\r?\n/).at(-1).slice(0, 300) : '（文件可能已损坏、受密码保护或格式不受支持）。'));
      if (cached) { await fs.mkdir(cacheDir, { recursive: true }); await fs.writeFile(cached, bytes).catch(() => {}); await trimCache(cacheDir); }
      return { bytes, cached: false, digest };
    } finally {
      const actual = path.resolve(stage);
      if (path.dirname(actual) === path.resolve(os.tmpdir()) && path.basename(actual).startsWith('qy-office-')) await fs.rm(actual, { recursive: true, force: true });
    }
  });
}

// Keeps the conversion cache under ~1 GB, oldest first.
async function trimCache(dir, limit = 1024 * 1024 * 1024) {
  const files = await Promise.all((await fs.readdir(dir).catch(() => [])).filter(n => /^[\da-f]{64}\.pdf$/.test(n)).map(async name => ({ name, stat: await fs.stat(path.join(dir, name)) })));
  let total = files.reduce((n, f) => n + f.stat.size, 0);
  for (const f of files.sort((a, b) => a.stat.mtimeMs - b.stat.mtimeMs)) { if (total <= limit) break; await fs.rm(path.join(dir, f.name), { force: true }); total -= f.stat.size; }
}

module.exports = { OFFICE_EXTENSIONS, isOffice, sofficePath, engineInfo, toPdf, trimCache, PROFILE_XCU };
