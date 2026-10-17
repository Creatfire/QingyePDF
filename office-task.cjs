// Word / Excel / PowerPoint and other office files open as an unsaved PDF converted by the bundled
// LibreOffice; the original file is never modified and Save asks where to write the PDF.
// Each conversion is a job the renderer shows as a progress card (stage, elapsed time, cancel).
'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, createHash } = require('node:crypto');

/**
 * @param ctx app, T, command, documents, metadata, documentById, preferences, persist, key,
 *   watchFile(id, file, onChange), officeConvert, quiet (automated runs skip warm-up).
 */
function createOfficeTasks(ctx) {
  const { app, T, command, documents, metadata, documentById, preferences, persist, key, watchFile, officeConvert, quiet } = ctx;
  const jobs = new Map();
  const options = () => ({ packaged: app.isPackaged, resources: process.resourcesPath, profileDir: path.join(app.getPath('userData'), 'libreoffice-profile'), cacheDir: path.join(app.getPath('userData'), 'office-cache') });
  const progress = data => command('office-progress', data);

  function newJob(file) {
    const job = { id: randomUUID(), file, name: path.basename(file), controller: new AbortController(), started: Date.now() };
    jobs.set(job.id, job); progress({ id: job.id, name: job.name, stage: 'waiting', text: T('等待打开') });
    return job;
  }
  function remember(file) {
    preferences.recent = [{ path: file, name: path.basename(file), kind: 'office', state: {}, opened: Date.now() }, ...preferences.recent.filter(r => key(r.path) !== key(file))].slice(0, 30);
  }
  async function open(file, job = newJob(file)) {
    try {
      const existing = [...documents.values()].find(r => r.source && key(r.source) === key(file));
      if (existing) { progress({ id: job.id, stage: 'done', text: T('已打开') }); return metadata(existing); }
      const result = await officeConvert.toPdf(file, { ...options(), signal: job.controller.signal, onProgress: p => progress({ id: job.id, name: job.name, ...p }) });
      const record = { id: randomUUID(), name: path.parse(file).name + '.pdf', path: null, hash: null, source: file, sourceDigest: result.digest, state: {} };
      documents.set(record.id, record); remember(file); watchSource(record);
      if (!preferences.officeUsed) { preferences.officeUsed = true; persist().catch(() => {}); }
      const seconds = result.cached ? 0 : Math.max(1, Math.round((Date.now() - job.started) / 1000));
      progress({ id: job.id, stage: 'loading', text: T('正在载入 PDF…') });
      command('status', T('已将 {name} 以 PDF 形式打开（{seconds} 秒）；原文件未改动，保存时另存为 PDF。').replace('{name}', job.name).replace('{seconds}', String(seconds)));
      return { ...metadata(record), bytes: result.bytes, officeJob: job.id, converted: { from: job.name, engine: officeConvert.engineInfo(options()) } };
    } catch (error) {
      progress({ id: job.id, stage: error.code === 'OFFICE_CANCELED' ? 'canceled' : 'error', text: error.code === 'OFFICE_CANCELED' ? T('已取消') : error.message });
      throw error;
    } finally { jobs.delete(job.id); }
  }
  // The Word / Excel / PowerPoint original changed after it was opened: offer to convert it again.
  function watchSource(record) {
    watchFile(record.id, record.source, async () => {
      if (!documents.has(record.id)) return;
      const raw = await fs.readFile(record.source).catch(() => null);
      const now = raw ? createHash('sha256').update(raw).digest('hex') : 'deleted';
      if (now !== record.sourceDigest && record.notified !== now) { record.notified = now; command('office-source-changed', { id: record.id, name: path.basename(record.source), deleted: !raw }); }
    });
  }
  // Idle warm-up once the user has opened an Office file before (first real conversion ~2 s, not ~7 s).
  function scheduleWarmup() {
    if (!preferences.officeUsed || quiet) return;
    setTimeout(() => { officeConvert.prewarm(options()).catch(() => {}); }, 15000).unref?.();
  }
  function register(handle) {
    handle('office-cancel', id => { const job = jobs.get(id); if (job) job.controller.abort(); return !!job; });
    // Convert the original again after it changed; the renderer replaces the tab's document.
    handle('office-reconvert', async id => {
      const record = documentById(id); if (!record.source) throw new Error('这个标签不是由 Office 文件转换而来。');
      const job = newJob(record.source);
      try {
        const result = await officeConvert.toPdf(record.source, { ...options(), signal: job.controller.signal, onProgress: p => progress({ id: job.id, name: job.name, ...p }) });
        record.sourceDigest = result.digest; record.notified = null;
        progress({ id: job.id, stage: 'done', text: T('已重新转换') });
        return { bytes: result.bytes };
      } catch (error) { progress({ id: job.id, stage: error.code === 'OFFICE_CANCELED' ? 'canceled' : 'error', text: error.message }); if (error.code === 'OFFICE_CANCELED') return null; throw error; }
      finally { jobs.delete(job.id); }
    });
  }
  return { options, newJob, open, scheduleWarmup, register, jobs };
}

module.exports = { createOfficeTasks };
