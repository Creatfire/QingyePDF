const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const engine = require('./pandoc-engine.cjs');
const { T } = require('./i18n-main.cjs');
const { builtinPresets,validatePreset,validatePdfOptions } = require('./converter-presets.cjs');
function register(ctx) {
  const { app, handle, getWindow, dialog, shell, documents, key, command } = ctx;
  const selections = new Map(), jobs = new Map(), targets = new Set();
  let shuttingDown = false;
  const preferences=ctx.preferences||{},persist=ctx.persist|| (async()=>{});
  handle('converter-presets',()=>[...builtinPresets,...(Array.isArray(preferences.converterPresets)?preferences.converterPresets:[])]);
  handle('converter-save-preset',async value=>{
    const preset=validatePreset(value);const info=await engine.describe();
    if(!['auto',...info.readers].includes(preset.from)||![...info.writers,'pdf-chromium','pdf','custom'].includes(preset.to))throw new Error('预设格式不受当前引擎支持。');
    const items=Array.isArray(preferences.converterPresets)?preferences.converterPresets:[];
    const existing=items.find(p=>p.name===preset.name);
    if(!existing&&items.length>=30)throw new Error('最多保存 30 个自定义预设。');
    const saved={...preset,id:existing?.id||randomUUID()};preferences.converterPresets=[...items.filter(p=>p.id!==saved.id),saved];await persist();return saved;
  });
  handle('converter-delete-preset',async id=>{preferences.converterPresets=(preferences.converterPresets||[]).filter(p=>p.id!==id);await persist();return true;});
  const select = (file, kind) => { const token = randomUUID(); selections.set(token, { file, kind }); return { token, path: file, name: path.basename(file) }; };
  const lookup = (token, kind) => { const value = selections.get(token); if (!value || value.kind !== kind) throw new Error('文件选择已失效，请重新选择。'); return value.file; };
  handle('converter-info', () => engine.describe());
  handle('converter-extensions', async format => {
    const info = await engine.describe(); if (typeof format !== 'string' || !info.readers.includes(format.split(/[+-]/)[0])) throw new Error('输入格式无效。');
    return (await engine.run(info.path, ['--list-extensions=' + format], { timeout: 15000 })).stdout.toString('utf8');
  });
  handle('converter-pick-inputs', async () => {
    const chosen = await dialog.showOpenDialog(getWindow(), { title: T('选择转换文档'), properties: ['openFile', 'multiSelections'] });
    if (chosen.canceled) return null; if (chosen.filePaths.length > 100) throw new Error('一次最多选择 100 个输入文件。');
    return chosen.filePaths.map(file => select(file, 'input'));
  });
  handle('converter-pick-output', async (to, first) => {
    const info = await engine.describe(); if (typeof to !== 'string' || (!info.writers.includes(to) && !['pdf-chromium', 'pdf', 'custom'].includes(to))) throw new Error('输出格式无效。');
    const file = first ? lookup(first, 'input') : null, ext = engine.extension(to);
    const result = await dialog.showSaveDialog(getWindow(), { title: T('选择转换输出'), defaultPath: path.join(file ? path.dirname(file) : app.getPath('documents'), (file ? path.parse(file).name : 'converted') + '-converted.' + ext), filters: [{ name: ext.toUpperCase(), extensions: [ext] }, { name: T('所有文件'), extensions: ['*'] }] });
    return result.canceled ? null : select(result.filePath, 'output');
  });
  handle('converter-pick-directory', async () => {
    const chosen = await dialog.showOpenDialog(getWindow(), { title: T('选择输出文件夹'), properties: ['openDirectory', 'createDirectory'] });
    return chosen.canceled ? null : select(chosen.filePaths[0], 'directory');
  });
  handle('converter-pick-option', async flag => {
    if (!['--bibliography', '--csl', '--template', '--reference-doc', '--lua-filter', '--filter', '--defaults', '--metadata-file', '--css'].includes(flag)) throw new Error('文件选项无效。');
    const result = await dialog.showOpenDialog(getWindow(), { title: T('选择选项文件'), properties: ['openFile'] });
    if (result.canceled) return null; return { flag, path: result.filePaths[0] };
  });
  handle('converter-run', async config => {
    if (shuttingDown) throw new Error('程序正在关闭，不能开始新的转换。');
    if (!config || typeof config !== 'object' || typeof config.jobId !== 'string' || !/^[a-zA-Z\d-]{1,80}$/.test(config.jobId) || !Array.isArray(config.inputs)) throw new Error('转换任务无效。');
    if (config.mode && !['merge', 'batch'].includes(config.mode)) throw new Error('转换模式无效。');
    const batch = config.mode === 'batch', target = lookup(config.output, batch ? 'directory' : 'output'), inputs = config.inputs.map(token => lookup(token, 'input'));
    const identity = key(target); if (targets.has(identity) || jobs.has(config.jobId)) throw new Error('该输出已有转换任务。');
    const validateTarget = async file => {
      const realTarget = await fs.realpath(file).catch(error => { if (error.code !== 'ENOENT') throw error; return file; });
      for (const record of documents.values()) if (record.path) { const real = await fs.realpath(record.path).catch(() => record.path); if (key(real) === key(realTarget)) throw new Error('输出不能覆盖当前已打开的文档。'); }
    };
    if (!batch) await validateTarget(target);
    if (shuttingDown) throw new Error('程序正在关闭，不能开始新的转换。');
    const controller = new AbortController(); let complete;
    controller.done = new Promise(resolve => { complete = resolve; }); jobs.set(config.jobId, controller); targets.add(identity);
    try {
      const pdf=validatePdfOptions(config.pdfOptions);const margin=pdf.marginMm/25.4;
      const options = { inputs, target, directory: target, validateTarget, from: config.from || 'auto', to: config.to, standalone: config.standalone !== false, toc: config.toc === true, numberSections: config.numberSections === true, citeproc: config.citeproc === true, extraArgs: config.extraArgs || [], signal: controller.signal,
        renderPdf: html => ctx.renderHtml(html, { signal: controller.signal }, view => view.webContents.printToPDF({ pageSize:pdf.pageSize,landscape:pdf.landscape, printBackground: true, margins: { top:margin,bottom:margin,left:margin,right:margin } })),
        onProgress: text => command('converter-progress', { jobId: config.jobId, text }),
        onItem: item => command('converter-item', { jobId: config.jobId, item }) };
      return batch ? await engine.convertBatch(options) : await engine.convertFile(options);
    } finally { jobs.delete(config.jobId); targets.delete(identity); complete(); }
  });
  handle('converter-cancel', id => { const job = jobs.get(id); if (job) job.abort(); return !!job; });
  handle('converter-reveal', token => { const selected = selections.get(token); if (!selected || !['output', 'directory'].includes(selected.kind)) throw new Error('文件选择已失效，请重新选择。'); shell.showItemInFolder(selected.file); return true; });
  app.on('will-quit', () => { for (const job of jobs.values()) job.abort(); });
  return { async shutdown() {
    shuttingDown = true;
    const running = [...jobs.values()]; for (const job of running) job.abort();
    await Promise.all(running.map(job => job.done));
  }, get busy() { return jobs.size > 0; } };
}
module.exports = { register };
