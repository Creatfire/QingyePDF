// LibreOffice is no longer in the installer (0.21): the first Office conversion asks, then downloads
// the pinned official package from The Document Foundation into the user-data folder. The transfer
// resumes after a cut-off (mirrors do cut long downloads), the SHA-256 is checked before anything is
// unpacked, and the finished folder is moved into place in one rename, so a half-installed engine is
// never run. Keep VERSION and the checksums in step with scripts/prepare-libreoffice.{sh,ps1}.
'use strict';
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const crypto = require('node:crypto');
const { spawn } = require('node:child_process');

const VERSION = '26.2.6';
const BASE = `https://download.documentfoundation.org/libreoffice/stable/${VERSION}/`;
const PACKAGES = {
  'darwin-arm64': { file: `LibreOffice_${VERSION}_MacOS_aarch64.dmg`, dir: 'mac/aarch64', sha256: '94bb3248df074c225490a8a6d1d9dc87c7d6783dbb7a8e9f0d0c3d94348552af', size: 297798926, installed: 800 * 1024 * 1024 },
  'darwin-x64': { file: `LibreOffice_${VERSION}_MacOS_x86-64.dmg`, dir: 'mac/x86_64', sha256: '135b8a95b8133396d54bf8e726dbc0066145efa0d785963fc3d4592acbfcfe5b', size: 308308875, installed: 800 * 1024 * 1024 },
  'win32-x64': { file: `LibreOffice_${VERSION}_Win_x86-64.msi`, dir: 'win/x86_64', sha256: 'f9877032fd908beb9c0ddf06df4af5c2e85f419c42e14876c4cce5aae5fb2660', size: 373252096, installed: 640 * 1024 * 1024 },
};
const packageFor = (platform = process.platform, arch = process.arch) => PACKAGES[`${platform}-${arch}`] || null;
const packageUrl = pkg => BASE + pkg.dir + '/' + pkg.file;
const installDir = engineDir => path.join(engineDir, VERSION);
const MB = bytes => Math.round(bytes / (1024 * 1024));

function canceled() { const e = new Error('已取消。'); e.code = 'OFFICE_CANCELED'; return e; }
const isCanceled = (error, signal) => signal?.aborted || error?.code === 'OFFICE_CANCELED';

async function sha256Of(file) {
  const hash = crypto.createHash('sha256');
  for await (const chunk of fsSync.createReadStream(file)) hash.update(chunk);
  return hash.digest('hex');
}

// One attempt: appends to `part` from where it stopped. A server that ignores the range answers 200
// and the file starts over. No data for `stall` ms counts as a cut-off.
async function transfer({ url, part, size, fetch, signal, stall, onBytes }) {
  let have = (await fs.stat(part).catch(() => null))?.size || 0;
  if (have > size) { await fs.rm(part, { force: true }); have = 0; }
  if (have === size) return;
  const attempt = new AbortController(), stop = () => attempt.abort();
  signal?.addEventListener('abort', stop, { once: true });
  let timer = setTimeout(stop, stall);
  const alive = () => { clearTimeout(timer); timer = setTimeout(stop, stall); };
  let out = null;
  try {
    const response = await fetch(url, { headers: have ? { Range: `bytes=${have}-` } : {}, signal: attempt.signal });
    if (response.status === 416) { await fs.rm(part, { force: true }); throw new Error('HTTP 416'); }
    if (response.status !== 200 && response.status !== 206) throw new Error(`HTTP ${response.status}`);
    if (response.status === 200) have = 0;
    out = await fs.open(part, have ? 'a' : 'w');
    onBytes(have);
    const reader = response.body.getReader();
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      alive();
      await out.write(value);
      have += value.length;
      onBytes(have);
    }
    if (have < size) throw new Error('连接提前结束');
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', stop);
    await out?.close();
  }
}

/** Downloads to `target`. A cut-off retries from where it stopped; the partial file survives a cancel. */
async function download({ url, target, sha256, size, fetch, signal, onBytes = () => {}, attempts = 8, retryDelay = 2000, stall = 60000 }) {
  if ((await fs.stat(target).catch(() => null))?.size === size && await sha256Of(target) === sha256) return target;
  const part = target + '.part';
  let failure = null;
  for (let n = 0; n < attempts; n++) {
    if (signal?.aborted) throw canceled();
    try { await transfer({ url, part, size, fetch, signal, stall, onBytes }); failure = null; break; }
    catch (error) {
      if (isCanceled(error, signal)) throw canceled();
      failure = error;
      await new Promise(resolve => setTimeout(resolve, retryDelay));
    }
  }
  if (failure) throw new Error(`下载转换引擎失败（${failure.message}）。请检查网络后重试，已下载的部分会保留。`);
  if (await sha256Of(part) !== sha256) { await fs.rm(part, { force: true }); throw new Error('下载的转换引擎未通过 SHA-256 校验，已删除，请重试。'); }
  await fs.rename(part, target);
  return target;
}

function run(exe, args, { windowsVerbatimArguments = false } = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(exe, args, { windowsHide: true, stdio: ['ignore', 'ignore', 'pipe'], windowsVerbatimArguments });
    let stderr = ''; child.stderr.on('data', d => { if (stderr.length < 4000) stderr += d; });
    child.on('error', reject);
    child.on('close', code => resolve({ code, stderr: stderr.trim() }));
  });
}

// The mount point stays in the system temp folder: hdiutil refuses one on some external volumes
// ("Permission denied"), and the user-data folder can be on one.
async function unpackMac(image, result) {
  const mount = await fs.mkdtemp(path.join(os.tmpdir(), 'qy-lo-mount-'));
  try {
    const attached = await run('hdiutil', ['attach', image, '-nobrowse', '-readonly', '-mountpoint', mount]);
    if (attached.code !== 0) throw new Error('无法打开下载的转换引擎：' + (attached.stderr.split(/\r?\n/).at(-1) || `hdiutil ${attached.code}`));
    try {
      await fs.mkdir(result, { recursive: true });
      const copied = await run('ditto', [path.join(mount, 'LibreOffice.app'), path.join(result, 'LibreOffice.app')]);
      if (copied.code !== 0) throw new Error('无法安装转换引擎：' + (copied.stderr || `ditto ${copied.code}`));
    } finally { await run('hdiutil', ['detach', mount, '-quiet', '-force']).catch(() => {}); }
  } finally { await fs.rm(mount, { recursive: true, force: true }).catch(() => {}); }
}

// What scripts/prepare-libreoffice.ps1 does after msiexec /a: the MSVC runtime goes next to soffice,
// the fonts Windows would have received go to share/fonts, and only Chinese and English resources are
// kept (from ~1.5 GB to ~0.6 GB). `from` is the folder that holds program/.
const KEEP_LANGUAGES = new Set(['en-US', 'en', 'zh-CN', 'zh-TW']);
async function trimWindowsImage(from, result) {
  const list = async dir => fs.readdir(dir, { withFileTypes: true }).catch(() => []);
  await fs.mkdir(result, { recursive: true });
  for (const entry of await list(from)) {
    if (['help', 'System', 'update-settings.ini'].includes(entry.name) || path.extname(entry.name).toLowerCase() === '.msi') continue;
    await fs.rename(path.join(from, entry.name), path.join(result, entry.name));
  }
  const program = path.join(result, 'program'), share = path.join(result, 'share'), fonts = path.join(share, 'fonts', 'truetype');
  for (const entry of await list(path.join(result, 'System64'))) if (entry.isFile()) await fs.rename(path.join(result, 'System64', entry.name), path.join(program, entry.name));
  await fs.rm(path.join(result, 'System64'), { recursive: true, force: true });
  await fs.mkdir(fonts, { recursive: true });
  for (const entry of await list(path.join(result, 'Fonts'))) if (entry.isFile()) await fs.rename(path.join(result, 'Fonts', entry.name), path.join(fonts, entry.name));
  await fs.rm(path.join(result, 'Fonts'), { recursive: true, force: true });
  const remove = (dir, name) => fs.rm(path.join(dir, name), { recursive: true, force: true });
  for (const entry of await list(path.join(program, 'resource'))) if (entry.isDirectory() && !KEEP_LANGUAGES.has(entry.name)) await remove(path.join(program, 'resource'), entry.name);
  for (const entry of await list(path.join(share, 'extensions'))) if (entry.isDirectory() && entry.name.startsWith('dict-') && entry.name !== 'dict-en') await remove(path.join(share, 'extensions'), entry.name);
  for (const entry of await list(path.join(share, 'registry'))) { const m = /^Langpack-(.+)\.xcd$/.exec(entry.name); if (m && !KEEP_LANGUAGES.has(m[1])) await remove(path.join(share, 'registry'), entry.name); }
  for (const entry of await list(path.join(share, 'registry', 'res'))) { const m = /_([A-Za-z-]+)\.[^.]+$/.exec(entry.name); if (entry.isFile() && m && !KEEP_LANGUAGES.has(m[1])) await remove(path.join(share, 'registry', 'res'), entry.name); }
  for (const entry of await list(path.join(share, 'config'))) if (/^images_.*\.zip$/.test(entry.name) && !['images_colibre.zip', 'images_colibre_svg.zip'].includes(entry.name)) await remove(path.join(share, 'config'), entry.name);
}

async function findProgramParent(dir, depth = 4) {
  if (fsSync.existsSync(path.join(dir, 'program', 'soffice.com'))) return dir;
  if (!depth) return null;
  for (const entry of await fs.readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const found = await findProgramParent(path.join(dir, entry.name), depth - 1);
    if (found) return found;
  }
  return null;
}

// An administrative install only unpacks the files: nothing is registered on the system.
async function unpackWindows(msi, result) {
  const image = result + '-image';
  await fs.mkdir(image, { recursive: true });
  try {
    const done = await run('msiexec.exe', ['/a', `"${msi}"`, '/qn', `TARGETDIR="${image}"`], { windowsVerbatimArguments: true });
    if (done.code === 1618) throw new Error('另一个安装程序正在运行，请等它结束后重试。');
    if (done.code !== 0) throw new Error(`无法解压转换引擎（msiexec 退出码 ${done.code}）。`);
    const from = await findProgramParent(image);
    if (!from) throw new Error('解压后的转换引擎不完整。');
    await trimWindowsImage(from, result);
  } finally { await fs.rm(image, { recursive: true, force: true }).catch(() => {}); }
}

function unpack(file, result, platform = process.platform) {
  return platform === 'darwin' ? unpackMac(file, result) : unpackWindows(file, result);
}
const executableIn = (root, platform = process.platform) => platform === 'darwin' ? path.join(root, 'LibreOffice.app', 'Contents', 'MacOS', 'soffice') : path.join(root, 'program', platform === 'win32' ? 'soffice.com' : 'soffice');

/** Downloads, checks and unpacks the engine into engineDir/<version>. */
async function install({ engineDir, fetch, signal, onProgress = () => {}, pkg = packageFor(), platform = process.platform, statfs = fs.statfs }) {
  if (!pkg) throw new Error('这个系统没有可用的转换引擎。');
  await fs.mkdir(engineDir, { recursive: true });
  const disk = await statfs(engineDir).catch(() => null);
  if (disk && Number(disk.bavail) * Number(disk.bsize) < pkg.size + pkg.installed) throw new Error(`磁盘空间不足：转换引擎需要约 ${MB(pkg.size + pkg.installed)} MB。`);
  // Left by an install that was interrupted (the download itself keeps its .part file).
  for (const name of await fs.readdir(engineDir)) if (name.startsWith('stage-')) await fs.rm(path.join(engineDir, name), { recursive: true, force: true });
  let last = 0;
  const onBytes = bytes => { const now = Date.now(); if (now - last < 500 && bytes < pkg.size) return; last = now; onProgress({ stage: 'downloading', received: bytes, total: pkg.size }); };
  const file = await download({ url: packageUrl(pkg), target: path.join(engineDir, pkg.file), sha256: pkg.sha256, size: pkg.size, fetch, signal, onBytes });
  if (signal?.aborted) throw canceled();
  onProgress({ stage: 'installing' });
  const stage = path.join(engineDir, 'stage-' + crypto.randomUUID().slice(0, 8)), dest = installDir(engineDir);
  try {
    await unpack(file, stage, platform);
    if (!fsSync.existsSync(executableIn(stage, platform))) throw new Error('解压后的转换引擎不完整。');
    await fs.writeFile(path.join(stage, 'manifest.json'), JSON.stringify({ name: 'LibreOffice', version: VERSION, source: packageUrl(pkg), sha256: pkg.sha256, license: 'MPL-2.0 (with LGPLv3+ and third-party components; see readmes and LICENSE.html)', modified: false }) + '\n');
    await fs.rm(dest, { recursive: true, force: true });
    await fs.rename(stage, dest);
  } finally { await fs.rm(stage, { recursive: true, force: true }).catch(() => {}); }
  // The package is not needed again; other versions are what an upgrade leaves behind.
  for (const name of await fs.readdir(engineDir)) if (name !== VERSION) await fs.rm(path.join(engineDir, name), { recursive: true, force: true }).catch(() => {});
  return dest;
}

/**
 * One download however many files are waiting for it: the question is asked once, every waiter sees
 * the progress, and the download stops only when the last waiter has canceled. Declining also answers
 * the rest of a batch that opens right after it.
 */
function createInstaller({ engineDir, fetch, confirm, pkg = packageFor(), installImpl = install, declineMemory = 2000 }) {
  let active = null, declinedAt = 0;
  async function begin() {
    if (Date.now() - declinedAt < declineMemory) throw canceled();
    if (!await confirm(pkg)) { declinedAt = Date.now(); throw canceled(); }
    // Everyone waiting canceled while the question was open.
    if (!active.waiters.size) throw canceled();
    active.asked = true;
    return installImpl({ engineDir, fetch, pkg, signal: active.controller.signal, onProgress: p => { active.lastProgress = p; for (const w of active.waiters) w.onProgress?.(p); } });
  }
  return function ensure({ signal, onProgress } = {}) {
    if (signal?.aborted) return Promise.reject(canceled());
    if (!active) {
      active = { controller: new AbortController(), waiters: new Set(), asked: false, lastProgress: null };
      const current = active;
      current.promise = begin().finally(() => { active = null; });
      current.promise.catch(() => {});
    }
    const current = active, waiter = { onProgress };
    current.waiters.add(waiter);
    if (current.lastProgress) onProgress?.(current.lastProgress);
    return new Promise((resolve, reject) => {
      const cancel = () => {
        current.waiters.delete(waiter);
        // While the question is open it keeps its answer; only a running download can be stopped.
        if (!current.waiters.size && current.asked) current.controller.abort();
        reject(canceled());
      };
      signal?.addEventListener('abort', cancel, { once: true });
      current.promise.then(resolve, reject).finally(() => { current.waiters.delete(waiter); signal?.removeEventListener('abort', cancel); });
    });
  };
}

module.exports = { VERSION, PACKAGES, packageFor, packageUrl, installDir, executableIn, download, install, trimWindowsImage, createInstaller, MB };
