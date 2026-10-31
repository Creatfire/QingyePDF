// LibreOffice on demand (0.21): resume, checksum, cancel, one shared download, the Windows trim, and
// conversions that must not start a download. scripts/check-office-engine.cjs covers the real package.
const assert = require('node:assert/strict');
const { test } = require('node:test');
const fs = require('node:fs/promises');
const fsSync = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const crypto = require('node:crypto');
const engine = require('../office-engine.cjs');
const office = require('../office-convert.cjs');

const sha = bytes => crypto.createHash('sha256').update(bytes).digest('hex');
const temp = () => fs.mkdtemp(path.join(os.tmpdir(), 'qy-engine-test-'));
const body = chunks => new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(x); c.close(); } });
const fast = { retryDelay: 1, attempts: 4 };

test('the pinned packages match the prepare scripts', () => {
  const sh = fsSync.readFileSync(path.join(__dirname, '../scripts/prepare-libreoffice.sh'), 'utf8');
  const ps = fsSync.readFileSync(path.join(__dirname, '../scripts/prepare-libreoffice.ps1'), 'utf8');
  assert.ok(sh.includes(`version=${engine.VERSION}`)); assert.ok(ps.includes(`$version = '${engine.VERSION}'`));
  assert.ok(sh.includes(engine.PACKAGES['darwin-arm64'].sha256)); assert.ok(sh.includes(engine.PACKAGES['darwin-x64'].sha256));
  assert.ok(ps.includes(engine.PACKAGES['win32-x64'].sha256));
  assert.equal(engine.packageFor('linux', 'x64'), null);
  assert.match(engine.packageUrl(engine.PACKAGES['darwin-x64']), /^https:\/\/download\.documentfoundation\.org\/libreoffice\/stable\/[\d.]+\/mac\/x86_64\/LibreOffice_[\d.]+_MacOS_x86-64\.dmg$/);
});

test('a cut-off download resumes with a range request and the result is verified', async () => {
  const dir = await temp(), data = Buffer.from('0123456789'.repeat(100)), target = path.join(dir, 'pkg'), ranges = [];
  let calls = 0;
  const fetch = async (_url, { headers }) => {
    ranges.push(headers.Range || null);
    if (++calls === 1) return { status: 200, body: body([data.subarray(0, 400)]) };          // ends early
    if (calls === 2) throw new Error('reset');
    return { status: 206, body: body([data.subarray(400)]) };
  };
  await engine.download({ url: 'u', target, sha256: sha(data), size: data.length, fetch, ...fast });
  assert.deepEqual(ranges, [null, 'bytes=400-', 'bytes=400-']);
  assert.deepEqual(await fs.readFile(target), data);
  assert.equal(fsSync.existsSync(target + '.part'), false);
  // Present and correct: no second transfer.
  await engine.download({ url: 'u', target, sha256: sha(data), size: data.length, fetch: async () => assert.fail('no fetch'), ...fast });
  await fs.rm(dir, { recursive: true });
});

test('a server that ignores the range starts the file over', async () => {
  const dir = await temp(), data = Buffer.from('abcdefghij'), target = path.join(dir, 'pkg');
  await fs.writeFile(target + '.part', 'abcde');
  await engine.download({ url: 'u', target, sha256: sha(data), size: data.length, fetch: async () => ({ status: 200, body: body([data]) }), ...fast });
  assert.deepEqual(await fs.readFile(target), data);
  await fs.rm(dir, { recursive: true });
});

test('a wrong checksum deletes the file; a failing server reports after its retries', async () => {
  const dir = await temp(), target = path.join(dir, 'pkg');
  await assert.rejects(engine.download({ url: 'u', target, sha256: sha(Buffer.from('other')), size: 3, fetch: async () => ({ status: 200, body: body([Buffer.from('bad')]) }), ...fast }), /SHA-256/);
  assert.equal(fsSync.existsSync(target), false); assert.equal(fsSync.existsSync(target + '.part'), false);
  let tries = 0;
  await assert.rejects(engine.download({ url: 'u', target, sha256: 'x', size: 3, fetch: async () => { tries++; return { status: 503 }; }, ...fast }), /HTTP 503/);
  assert.equal(tries, 4);
  await fs.rm(dir, { recursive: true });
});

test('canceling keeps the partial file for the next attempt', async () => {
  const dir = await temp(), target = path.join(dir, 'pkg'), controller = new AbortController();
  const fetch = async (_url, { signal }) => ({ status: 200, body: new ReadableStream({ start(c) { c.enqueue(Buffer.from('abc')); signal.addEventListener('abort', () => c.error(new Error('aborted'))); } }) });
  const running = engine.download({ url: 'u', target, sha256: 'x', size: 10, fetch, signal: controller.signal, onBytes: n => { if (n === 3) controller.abort(); }, ...fast });
  await assert.rejects(running, e => e.code === 'OFFICE_CANCELED');
  assert.equal((await fs.readFile(target + '.part')).toString(), 'abc');
  await fs.rm(dir, { recursive: true });
});

test('not enough disk space stops before the download', async () => {
  const dir = await temp(), pkg = { file: 'p', dir: 'd', sha256: 'x', size: 1000, installed: 1000 };
  await assert.rejects(engine.install({ engineDir: dir, pkg, statfs: async () => ({ bavail: 1, bsize: 1000 }), fetch: async () => assert.fail('no fetch') }), /磁盘空间不足/);
  await fs.rm(dir, { recursive: true });
});

test('several files share one question and one download', async () => {
  let asked = 0, installs = 0, finish; const seen = [];
  const ensure = engine.createInstaller({ engineDir: 'x', pkg: {}, confirm: async () => { asked++; return true; }, installImpl: ({ onProgress }) => { installs++; onProgress({ stage: 'installing' }); return new Promise(r => { finish = r; }); } });
  const a = ensure({ onProgress: p => seen.push(['a', p.stage]) }), b = ensure({ onProgress: p => seen.push(['b', p.stage]) });
  await new Promise(r => setTimeout(r, 5));
  finish('done');
  assert.deepEqual(await Promise.all([a, b]), ['done', 'done']);
  assert.equal(asked, 1); assert.equal(installs, 1);
  assert.deepEqual(seen, [['a', 'installing'], ['b', 'installing']]);
});

test('declining downloads nothing and answers the rest of the batch; later it asks again', async () => {
  let asked = 0;
  const ensure = engine.createInstaller({ engineDir: 'x', pkg: {}, declineMemory: 30, confirm: async () => { asked++; return false; }, installImpl: () => assert.fail('no install') });
  await assert.rejects(ensure(), e => e.code === 'OFFICE_CANCELED');
  await assert.rejects(ensure(), e => e.code === 'OFFICE_CANCELED');
  assert.equal(asked, 1);
  await new Promise(r => setTimeout(r, 40));
  await assert.rejects(ensure(), e => e.code === 'OFFICE_CANCELED');
  assert.equal(asked, 2);
});

test('the download stops only when the last waiter cancels', async () => {
  let installSignal;
  const ensure = engine.createInstaller({ engineDir: 'x', pkg: {}, confirm: async () => true, installImpl: ({ signal }) => { installSignal = signal; return new Promise((_, reject) => signal.addEventListener('abort', () => reject(new Error('stopped')))); } });
  const one = new AbortController(), two = new AbortController();
  const a = ensure({ signal: one.signal }), b = ensure({ signal: two.signal });
  await new Promise(r => setTimeout(r, 5));
  one.abort(); await assert.rejects(a, e => e.code === 'OFFICE_CANCELED');
  assert.equal(installSignal.aborted, false);
  two.abort(); await assert.rejects(b, e => e.code === 'OFFICE_CANCELED');
  assert.equal(installSignal.aborted, true);
});

test('the Windows trim keeps what headless conversion needs', async () => {
  const dir = await temp(), from = path.join(dir, 'image'), result = path.join(dir, 'result');
  const files = ['help/x', 'System/x', 'update-settings.ini', 'a.msi', 'readme.txt', 'System64/msvcp140.dll', 'Fonts/Carlito.ttf', 'program/soffice.com', 'program/resource/en-US/a', 'program/resource/de/a', 'program/resource/zh-CN/a',
    'share/extensions/dict-en/a', 'share/extensions/dict-de/a', 'share/extensions/other/a', 'share/registry/Langpack-de.xcd', 'share/registry/Langpack-zh-CN.xcd', 'share/registry/main.xcd', 'share/registry/res/fcfg_langpack_de.xcd', 'share/registry/res/fcfg_langpack_en-US.xcd', 'share/config/images_colibre.zip', 'share/config/images_sifr.zip'];
  for (const f of files) { await fs.mkdir(path.dirname(path.join(from, f)), { recursive: true }); await fs.writeFile(path.join(from, f), 'x'); }
  await engine.trimWindowsImage(from, result);
  const exists = f => fsSync.existsSync(path.join(result, f));
  for (const f of ['readme.txt', 'program/soffice.com', 'program/msvcp140.dll', 'share/fonts/truetype/Carlito.ttf', 'program/resource/en-US/a', 'program/resource/zh-CN/a', 'share/extensions/dict-en/a', 'share/extensions/other/a', 'share/registry/Langpack-zh-CN.xcd', 'share/registry/main.xcd', 'share/registry/res/fcfg_langpack_en-US.xcd', 'share/config/images_colibre.zip']) assert.ok(exists(f), 'kept ' + f);
  for (const f of ['help', 'System', 'System64', 'Fonts', 'update-settings.ini', 'a.msi', 'program/resource/de', 'share/extensions/dict-de', 'share/registry/Langpack-de.xcd', 'share/registry/res/fcfg_langpack_de.xcd', 'share/config/images_sifr.zip']) assert.ok(!exists(f), 'removed ' + f);
  await fs.rm(dir, { recursive: true });
});

test('an installed engine is found; a cached or damaged file never starts a download', async () => {
  const dir = await temp(), saved = process.env.QINGYE_LIBREOFFICE_DIR;
  process.env.QINGYE_LIBREOFFICE_DIR = path.join(dir, 'none');
  try {
    const engineDir = path.join(dir, 'engine'), exe = engine.executableIn(engine.installDir(engineDir));
    const resources = path.join(dir, 'resources');           // packaged, nothing in the app bundle
    const base = { packaged: true, resources, engineDir, profileDir: path.join(dir, 'p'), cacheDir: path.join(dir, 'c') };
    assert.equal(office.sofficePath(base), null);
    const noDownload = async () => assert.fail('must not download');
    const docx = path.join(dir, 'a.docx'), content = Buffer.from('PK\x03\x04word', 'binary');
    await fs.writeFile(docx, content);
    await fs.mkdir(base.cacheDir); await fs.writeFile(path.join(base.cacheDir, sha(content) + '.pdf'), '%PDF-cached');
    assert.equal((await office.toPdf(docx, { ...base, ensureEngine: noDownload })).cached, true);
    const broken = path.join(dir, 'b.docx'); await fs.writeFile(broken, 'not a zip');
    await assert.rejects(office.toPdf(broken, { ...base, ensureEngine: noDownload }), /已损坏/);
    // A new file asks; declining surfaces as a cancel, and without an installer the error is readable.
    const fresh = path.join(dir, 'c.csv'); await fs.writeFile(fresh, 'a,b\n');
    let asked = 0;
    await assert.rejects(office.toPdf(fresh, { ...base, ensureEngine: async () => { asked++; const e = new Error('x'); e.code = 'OFFICE_CANCELED'; throw e; } }), e => e.code === 'OFFICE_CANCELED');
    assert.equal(asked, 1);
    await assert.rejects(office.toPdf(fresh, base), /尚未安装/);
    await fs.mkdir(path.dirname(exe), { recursive: true }); await fs.writeFile(exe, '');
    assert.equal(office.sofficePath(base), exe);
  } finally {
    if (saved === undefined) delete process.env.QINGYE_LIBREOFFICE_DIR; else process.env.QINGYE_LIBREOFFICE_DIR = saved;
    await fs.rm(dir, { recursive: true });
  }
});
