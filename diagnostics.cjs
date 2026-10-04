const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');

exports.createDiagnostics = ({ directory, mode, version }) => {
  const testing = mode !== 'reader';
  fs.mkdirSync(directory, { recursive: true });
  if (testing) for (const file of ['editing-result.json', 'integration-result.json', 'integration-error.txt', 'integration-error.json', 'startup-timing.json', 'safety-result.json']) {
    fs.rmSync(path.join(directory, file), { force: true });
  }
  const run = { runId: randomUUID(), mode, version, pid: process.pid, startedAt: new Date().toISOString(), status: 'running', phase: 'startup' };
  const save = () => {
    // Synchronous writes finish before app.exit(), including renderer crashes.
    fs.writeFileSync(path.join(directory, `run-${run.runId}.json`), JSON.stringify(run, null, 2));
    if (testing) fs.writeFileSync(path.join(directory, 'test-run.json'), JSON.stringify(run, null, 2));
  };
  save();
  return {
    get runId() { return run.runId; },
    stage(phase) { run.phase = phase; save(); },
    success() { Object.assign(run, { status: 'passed', exitCode: 0, endedAt: new Date().toISOString() }); save(); },
    failure(phase, error, details = {}) {
      Object.assign(run, { status: 'failed', phase, exitCode: 1, endedAt: new Date().toISOString(), error: { message: error?.message || String(error), stack: error?.stack }, details });
      save();
      if (testing) {
        fs.writeFileSync(path.join(directory, 'integration-error.json'), JSON.stringify(run, null, 2));
        fs.writeFileSync(path.join(directory, 'integration-error.txt'), `${run.runId} · ${phase}\n${run.error.stack || run.error.message}\n${JSON.stringify(details)}`);
      }
    }
  };
};
