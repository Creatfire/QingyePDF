// IPC wiring for AI collaboration (0.9.1): settings, streaming chat, import/export, and the bridge that
// lets the local API server run document tools inside the renderer.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { createAiService } = require('./ai-service.cjs');
const { createApiServer } = require('./ai-api-server.cjs');
const { T } = require('./i18n-main.cjs');

function register({ handle, getWindow, app, dialog, session, safeStorage, ipcMain, testMode }) {
  const canEncrypt = () => { try { return !!safeStorage?.isEncryptionAvailable(); } catch { return false; } };
  // Requests go through a dedicated session: the app's default session blocks all web traffic,
  // and Chromium's network stack honours the system proxy.
  let ses = null; try { ses = session.fromPartition('qingye-ai'); } catch {}
  const fetchImpl = ses?.fetch ? (url, init) => ses.fetch(url, init) : globalThis.fetch;
  const ai = createAiService({
    folder: app.getPath('userData'), fetchImpl,
    encrypt: text => canEncrypt() ? 'enc:' + safeStorage.encryptString(text).toString('base64') : 'plain:' + text,
    decrypt: value => { try { return value.startsWith('enc:') ? safeStorage.decryptString(Buffer.from(value.slice(4), 'base64')) : value.startsWith('plain:') ? value.slice(6) : ''; } catch { return ''; } },
  });

  // ——— bridge: main → renderer tool calls ———
  const pending = new Map();
  function call(name, args, meta) {
    const win = getWindow(); if (!win || win.isDestroyed()) return Promise.reject(new Error('青页窗口未就绪。'));
    const id = randomUUID();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => { pending.delete(id); reject(new Error('青页没有及时响应（可能在等待用户确认）。')); }, 180000);
      pending.set(id, { resolve, reject, timer });
      win.webContents.send('ai-bridge', id, name, args, meta);
    });
  }
  handle('ai-bridge-reply', (id, ok, value) => {
    const p = pending.get(id); if (!p) return false; pending.delete(id); clearTimeout(p.timer);
    if (ok) p.resolve(value); else p.reject(Object.assign(new Error(String(value?.message || value || '失败')), { declined: !!value?.declined, status: value?.status }));
    return true;
  });
  const server = createApiServer({ call, version: app.getVersion() });
  async function applyServer() {
    const cfg = await ai.serverConfig();
    if (cfg.enabled && !testMode) { try { await server.start(cfg); } catch (error) { return { ...cfg, ...server.status(), error: error.message }; } }
    else { await server.stop(); for (const [id, p] of pending) { pending.delete(id); clearTimeout(p.timer); p.reject(new Error('本地 AI 接口已关闭。')); } }
    return { ...cfg, ...server.status() };
  }

  handle('ai-state', async () => ({ ...(await ai.state()), encrypted: canEncrypt(), serverStatus: server.status() }));
  handle('ai-upsert', input => ai.upsert(input && typeof input === 'object' ? input : {}));
  handle('ai-remove', id => ai.remove(String(id)));
  handle('ai-defaults', values => ai.setDefaults(values && typeof values === 'object' ? values : {}));
  handle('ai-prompts', prompts => ai.setPrompts(prompts));
  handle('ai-models', id => ai.listModels(String(id)));
  handle('ai-chat', async (jobId, request) => {
    const win = getWindow();
    return ai.chat(String(jobId), request || {}, (delta, reasoning) => { if (win && !win.isDestroyed()) win.webContents.send('ai-event', jobId, { delta, reasoning }); });
  });
  handle('ai-cancel', jobId => ai.cancel(String(jobId)));
  handle('ai-import-text', text => ai.importConfig(String(text || '')));
  handle('ai-import-file', async () => {
    const r = await dialog.showOpenDialog(getWindow(), { title: T('导入 AI 连接'), filters: [{ name: 'JSON / TXT / ENV', extensions: ['json', 'txt', 'env', 'conf'] }, { name: T('所有文件'), extensions: ['*'] }], properties: ['openFile'] });
    if (r.canceled) return null;
    const stat = await fs.stat(r.filePaths[0]); if (stat.size > 2 * 1024 * 1024) throw new Error('文件过大。');
    return ai.importConfig(await fs.readFile(r.filePaths[0], 'utf8'));
  });
  handle('ai-export', async includeKeys => {
    const r = await dialog.showSaveDialog(getWindow(), { title: T('导出 AI 连接'), defaultPath: path.join(app.getPath('documents'), 'qingye-ai-connections.json'), filters: [{ name: 'JSON', extensions: ['json'] }] });
    if (r.canceled) return null;
    await fs.writeFile(r.filePath, JSON.stringify(await ai.exportConfig(!!includeKeys), null, 2)); return { path: r.filePath };
  });
  handle('ai-server', async values => { await ai.serverConfig(values && typeof values === 'object' ? values : {}); const status = await applyServer(); server.update({ allowEdits: status.allowEdits }); return status; });
  app.on('before-quit', () => { server.stop().catch(() => {}); });
  applyServer().catch(error => console.warn('AI interface:', error.message));
  return { ai, server };
}
module.exports = { register };
