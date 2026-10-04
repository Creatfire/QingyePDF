// Mobile counterpart of offline.cjs: the PyMuPDF worker process is replaced by a Web Worker that
// runs the same backend/worker.py in Pyodide (CPython + PyMuPDF as WebAssembly). Same contract: runOffline({bytes, request, ...}) → {data, note, unchanged, files}.
import { pdfBytes } from './core.js';

const actions = new Set(['inspect','notes-export','scan','sharpen','ocr-layer','export','encrypt','decrypt','organize','outline','compress','flatten','ocr','redact','text','stamp','image','page-stamp','number','watermark','shape','annotation','form','crop','import','compare']);
let worker = null, sequence = 0;
const pending = new Map();
function ensureWorker() {
  if (worker) return worker;
  worker = new Worker(new URL('mobile/pdf-worker.js', document.baseURI));
  worker.onmessage = event => {
    const { id, type, data, error } = event.data, job = pending.get(id); if (!job) return;
    if (type === 'progress') { try { job.onProgress?.(data); } catch {} return; }
    pending.delete(id);
    if (type === 'error') job.reject(new Error(error)); else job.resolve(data);
  };
  worker.onerror = event => { const failure = new Error('本地处理引擎异常退出：' + (event.message || '未知错误')); for (const job of pending.values()) job.reject(failure); pending.clear(); worker.terminate(); worker = null; };
  return worker;
}
// A cancelled job cannot be interrupted inside WebAssembly, so the worker is restarted.
function restart() { worker?.terminate(); worker = null; for (const job of pending.values()) job.reject(new Error('任务已取消。')); pending.clear(); }

export async function runOffline({ bytes, request, assets = [], inputs = [], inputName = 'input.pdf', signal, onProgress }) {
  if (!request || !actions.has(request.action)) throw new Error('不支持的本地操作。');
  if (JSON.stringify(request).length > 2_000_000) throw new Error('操作参数过大。');
  if (signal?.aborted) throw new Error('任务已取消。');
  const input = request.action === 'import' ? new Uint8Array(bytes) : new Uint8Array(pdfBytes(bytes));
  const safe = { ...request }; delete safe.asset; delete safe.inputs; delete safe.tessdata;
  const id = ++sequence;
  const result = await new Promise((resolve, reject) => {
    pending.set(id, { resolve, reject, onProgress });
    const abort = () => { if (pending.has(id)) restart(); };
    signal?.addEventListener('abort', abort, { once: true });
    const timer = setTimeout(() => { if (pending.has(id)) { pending.get(id).reject(new Error('本地处理超过 15 分钟，已终止。')); restart(); } }, 15 * 60 * 1000);
    const done = fn => value => { clearTimeout(timer); signal?.removeEventListener('abort', abort); fn(value); };
    pending.set(id, { resolve: done(resolve), reject: done(reject), onProgress });
    // Copies are posted: the renderer keeps using its own buffers.
    ensureWorker().postMessage({ id, request: safe, input, inputName, assets: assets.map(a => ({ name: a.name, bytes: new Uint8Array(a.bytes) })), inputs: inputs.map(b => new Uint8Array(b)) });
  });
  const files = [];
  for (const file of result.files || []) {
    if (!/^result\.(pdf|zip|txt|html|docx|xlsx|csv|pptx)$/.test(file.name)) throw new Error('处理引擎返回了非法文件名。');
    files.push({ name: file.name, bytes: file.bytes });
  }
  return { data: result.data, note: result.note || '', unchanged: !!result.unchanged, files };
}
export default { runOffline };
