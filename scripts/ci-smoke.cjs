// Runs the Electron smoke suites one after another, each in its own clean smoke root, and
// fails if any suite does not finish with status "passed". Used by CI and by local release checks.
// Usage: node scripts/ci-smoke.cjs [--packaged] [--only smoke,features] [--report file.json]
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const args = process.argv.slice(2);
const packaged = args.includes('--packaged');
const option = name => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const only = option('--only')?.split(',').map(s => s.trim()).filter(Boolean);
const reportFile = path.resolve(root, option('--report') || 'test-output/ci-smoke.json');

const SUITES = [
  { name: 'smoke', flag: '--smoke-test' },
  { name: 'markdown', flag: '--markdown-smoke' },
  { name: 'conversion', flag: '--conversion-smoke' },
  { name: 'safety', flag: '--safety-smoke' },
  { name: 'basic', flag: '--basic-smoke' },
  { name: 'features', flag: '--features-smoke', env: { QINGYE_094_SCAN_FIXTURE: path.join(root, 'test', 'fixtures', 'mixed-scan.pdf') } },
  { name: 'notes', flag: '--notes-smoke' },
  { name: 'links', flag: '--links-smoke' },
];
const PACKAGED_SUITES = ['smoke', 'basic', 'features', 'notes', 'links'];

function executable() {
  // require('electron') resolves to the executable of the installed Electron on every platform
  // (electron.exe, Electron.app/Contents/MacOS/Electron, electron).
  if (!packaged) return { file: require('electron'), pre: ['.'] };
  const exe = path.join(root, 'dist', 'win-unpacked', 'QingyePDF.exe');
  if (!fs.existsSync(exe)) throw new Error('Packaged app not found: ' + exe);
  return { file: exe, pre: [] };
}

function run(suite, timeoutMs = 10 * 60 * 1000) {
  const smokeRoot = path.join(root, 'test-output', 'ci', (packaged ? 'packaged-' : '') + suite.name);
  fs.rmSync(smokeRoot, { recursive: true, force: true });
  fs.mkdirSync(smokeRoot, { recursive: true });
  const { file, pre } = executable();
  const env = { ...process.env, QINGYE_SMOKE_ROOT: smokeRoot, ...(suite.env || {}) };
  if (suite.env?.QINGYE_094_SCAN_FIXTURE && !fs.existsSync(suite.env.QINGYE_094_SCAN_FIXTURE)) delete env.QINGYE_094_SCAN_FIXTURE;
  const started = Date.now();
  return new Promise(resolve => {
    const log = fs.createWriteStream(path.join(smokeRoot, 'console.log'));
    const child = spawn(file, [...pre, suite.flag], { cwd: root, env, windowsHide: true });
    child.stdout.pipe(log, { end: false }); child.stderr.pipe(log, { end: false });
    const timer = setTimeout(() => { log.write('\n[ci-smoke] timeout, killing\n'); child.kill(); }, timeoutMs);
    child.on('exit', code => {
      clearTimeout(timer); log.end();
      let status = null, detail = null;
      try { const r = JSON.parse(fs.readFileSync(path.join(smokeRoot, 'test-output', 'test-run.json'), 'utf8')); status = r.status; detail = r.error || r.phase; } catch {}
      let report = null;
      for (const f of ['report.json', 'features-report.json']) { try { report = JSON.parse(fs.readFileSync(path.join(smokeRoot, 'test-output', f), 'utf8')); break; } catch {} }
      const passed = code === 0 && (status === null || status === 'passed') && (!report || Object.values(report).every(v => v !== false));
      resolve({ suite: suite.name, exitCode: code, status, detail, report, passed, seconds: Math.round((Date.now() - started) / 1000) });
    });
  });
}

(async () => {
  let suites = SUITES.filter(s => !packaged || PACKAGED_SUITES.includes(s.name));
  if (only) suites = suites.filter(s => only.includes(s.name));
  const results = [];
  for (const suite of suites) {
    const r = await run(suite);
    results.push(r);
    console.log(`${r.passed ? 'PASS' : 'FAIL'} ${r.suite} exit=${r.exitCode} status=${r.status} ${r.seconds}s${r.passed ? '' : ' ' + JSON.stringify(r.detail || r.report)}`);
  }
  fs.mkdirSync(path.dirname(reportFile), { recursive: true });
  fs.writeFileSync(reportFile, JSON.stringify({ packaged, results }, null, 2));
  process.exitCode = results.every(r => r.passed) ? 0 : 1;
})();
