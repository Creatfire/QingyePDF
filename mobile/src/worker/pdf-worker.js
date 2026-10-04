// Web Worker that hosts the PDF backend on Android.
// The desktop build starts backend/worker.py (PyMuPDF) as a child process for every job; here the
// same worker.py runs in Pyodide (CPython + PyMuPDF compiled to WebAssembly) and stays loaded.
// OCR uses the Tesseract WebAssembly core with the same chi_sim / eng models as the desktop.
/* global importScripts, loadPyodide, TesseractCore */
importScripts('./pyodide/pyodide.js');

const here = new URL('./', self.location.href);
const WHEELS = self.QINGYE_WHEELS || [];
let pyodide = null, loading = null, currentJob = 0, tesseract = null;
const post = (id, type, payload = {}) => self.postMessage({ id, type, ...payload });

async function loadEngine(id) {
  post(id, 'progress', { data: { done: 0, total: 1, label: '正在启动本地处理引擎' } });
  const manifest = await (await fetch(new URL('pyodide/wheels/manifest.json', here))).json();
  const py = await loadPyodide({ indexURL: new URL('pyodide/', here).href, stdout: () => {}, stderr: text => { if (text && !/^QINGYE_PROGRESS /.test(text)) console.warn('[backend]', text); } });
  await py.loadPackage(manifest.map(name => new URL('pyodide/wheels/' + name, here).href), { messageCallback: () => {}, errorCallback: text => console.warn('[backend]', text), checkIntegrity: false });
  py.registerJsModule('qingye_js', {
    progress: text => { try { post(currentJob, 'progress', { data: JSON.parse(text) }); } catch {} },
    ocr: (png, language) => recognize(png.toJs ? png.toJs() : png, String(language)),
  });
  py.FS.mkdirTree('/qingye'); py.FS.mkdirTree('/tess');
  for (const name of ['worker.py', 'qy_mobile.py']) py.FS.writeFile('/qingye/' + name, new Uint8Array(await (await fetch(new URL(name, here))).arrayBuffer()));
  // worker.py only checks that the language data exists; recognition itself reads it in Tesseract.
  for (const name of ['chi_sim.traineddata', 'eng.traineddata']) py.FS.writeFile('/tess/' + name, new Uint8Array(1));
  py.runPython("import sys\nsys.path.insert(0, '/qingye')\nimport qy_mobile");
  return py;
}
function engine(id) { return pyodide ? Promise.resolve(pyodide) : (loading ||= loadEngine(id).then(py => (pyodide = py), error => { loading = null; throw error; })); }

// ——— Tesseract ———
async function loadTesseract(id) {
  if (tesseract) return tesseract;
  post(id, 'progress', { data: { done: 0, total: 1, label: '正在加载文字识别模型' } });
  const base = new URL('../../vendor/tesseract/', here);
  const simd = WebAssembly.validate(new Uint8Array([0, 97, 115, 109, 1, 0, 0, 0, 1, 5, 1, 96, 0, 1, 123, 3, 2, 1, 0, 10, 10, 1, 8, 0, 65, 0, 253, 15, 253, 98, 11]));
  const name = simd ? 'tesseract-core-simd-lstm' : 'tesseract-core-lstm';
  importScripts(new URL(name + '.js', base).href);
  const module = await TesseractCore({ locateFile: file => new URL(file.replace(/^.*\//, ''), base).href, print: () => {}, printErr: () => {} });
  for (const language of ['chi_sim', 'eng']) {
    const response = await fetch(new URL(`../../vendor/ocr/${language}.traineddata`, here));
    if (!response.ok) throw new Error('本地 OCR 语言资源缺失。');
    module.FS.writeFile(language + '.traineddata', new Uint8Array(await response.arrayBuffer()));
  }
  const api = new module.TessBaseAPI();
  if (api.Init(null, 'chi_sim+eng') !== 0) throw new Error('本地 OCR 引擎初始化失败。');
  tesseract = { module, api };
  return tesseract;
}
// Called synchronously from Python (Pixmap.pdfocr_tobytes); returns Tesseract's TSV output.
function recognize(png, language) {
  if (!tesseract) throw new Error('本地 OCR 引擎尚未就绪。');
  const { module, api } = tesseract;
  const pointer = module._malloc(png.length); module.HEAPU8.set(png, pointer);
  const pix = module._pixReadMem(pointer, png.length);
  module._free(pointer);
  if (!pix) throw new Error('无法读取待识别的页面图像。');
  try { api.SetImage(pix); api.SetSourceResolution(200); api.Recognize(null); return api.GetTSVText(0) || ''; }
  finally { api.Clear(); if (module._pixDestroy) { const holder = module._malloc(4); module.setValue ? module.setValue(holder, pix, 'i32') : new Uint32Array(module.HEAPU8.buffer, holder, 1).set([pix]); module._pixDestroy(holder); module._free(holder); } }
}

const OCR_ACTIONS = new Set(['ocr', 'ocr-layer', 'scan']);
async function run({ id, request, input, inputName, assets, inputs }) {
  const py = await engine(id);
  if (OCR_ACTIONS.has(request.action) && (request.action !== 'scan' || request.recognize)) await loadTesseract(id);
  const FS = py.FS, job = '/job';
  try { py.runPython("import shutil\nshutil.rmtree('/job', ignore_errors=True)"); } catch {}
  FS.mkdirTree(job);
  const extension = (/\.[A-Za-z0-9]+$/.exec(inputName || '') || ['.pdf'])[0].toLowerCase();
  const inputPath = `${job}/input${extension}`; FS.writeFile(inputPath, input);
  const safe = { ...request, inputs: [], tessdata: '/tess' };
  if (assets[0]) { const assetExtension = (/\.[A-Za-z0-9]+$/.exec(assets[0].name) || [''])[0].toLowerCase(); safe.asset = `${job}/asset${assetExtension}`; FS.writeFile(safe.asset, assets[0].bytes); }
  inputs.forEach((bytes, index) => { const file = `${job}/merge-${index}.pdf`; FS.writeFile(file, bytes); safe.inputs.push(file); });
  currentJob = id;
  const runJob = py.globals.get('qy_mobile').run_job;
  let result;
  try { result = JSON.parse(runJob(JSON.stringify({ request: safe, input: inputPath, output: `${job}/output` }))); }
  finally { runJob.destroy?.(); }
  if (!result.ok) throw new Error(result.error || '处理失败。');
  const files = [];
  for (const name of result.files || []) {
    if (!/^result\.(pdf|zip|txt|html|docx|xlsx|csv|pptx)$/.test(name)) throw new Error('处理引擎返回了非法文件名。');
    files.push({ name, bytes: FS.readFile(`${job}/output/${name}`) });
  }
  try { py.runPython("import shutil, gc\nshutil.rmtree('/job', ignore_errors=True)\ngc.collect()"); } catch {}
  return { data: result.data, note: result.note || '', unchanged: !!result.unchanged, files };
}

// Jobs are serialized: the Python engine and its virtual job folder are single-threaded.
let queue = Promise.resolve();
self.onmessage = event => {
  const message = event.data;
  if (message.type === 'warm') { queue = queue.then(() => engine(0)).catch(() => {}); return; }
  queue = queue.then(async () => {
    try { const data = await run(message); post(message.id, 'result', { data }); }
    catch (error) { post(message.id, 'error', { error: String(error?.message || error).replace(/^PythonError:\s*/, '') }); }
  });
};
