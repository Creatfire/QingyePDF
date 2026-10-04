// Web Worker that runs the official Pandoc WebAssembly build. One conversion per message; the
// page side (shims/child_process.js) prepares the virtual files and writes results back.
import { ConsoleStdout, Directory, File, OpenFile, PreopenDirectory, WASI } from '@bjorn3/browser_wasi_shim';

let ready = null, files = new Map(), exportsRef = null;

async function load() {
  const args = ['pandoc.wasm', '+RTS', '-H64m', '-RTS'];
  const descriptors = [new OpenFile(new File(new Uint8Array(), { readonly: true })), ConsoleStdout.lineBuffered(() => {}), ConsoleStdout.lineBuffered(() => {}), new PreopenDirectory('/', files)];
  const wasi = new WASI(args, [], descriptors, { debug: false });
  const url = new URL('../../vendor/pandoc/pandoc.wasm', self.location.href);
  const imports = { wasi_snapshot_preview1: wasi.wasiImport };
  let instance;
  try { ({ instance } = await WebAssembly.instantiateStreaming(fetch(url), imports)); }
  catch { ({ instance } = await WebAssembly.instantiate(await (await fetch(url)).arrayBuffer(), imports)); }
  wasi.initialize(instance);
  const x = instance.exports; x.__wasm_call_ctors();
  const view = () => new DataView(x.memory.buffer);
  const argc = x.malloc(4); view().setUint32(argc, args.length, true);
  const argv = x.malloc(4 * (args.length + 1));
  args.forEach((text, index) => { const pointer = x.malloc(text.length + 1); new TextEncoder().encodeInto(text, new Uint8Array(x.memory.buffer, pointer, text.length)); view().setUint8(pointer + text.length, 0); view().setUint32(argv + 4 * index, pointer, true); });
  view().setUint32(argv + 4 * args.length, 0, true);
  const argvPointer = x.malloc(4); view().setUint32(argvPointer, argv, true);
  x.hs_init_with_rtsopts(argc, argvPointer);
  exportsRef = x;
}

function call(name, options) {
  const encoded = new TextEncoder().encode(JSON.stringify(options));
  const pointer = exportsRef.malloc(encoded.length);
  new Uint8Array(exportsRef.memory.buffer, pointer, encoded.length).set(encoded);
  exportsRef[name](pointer, encoded.length);
}
const text = file => new TextDecoder().decode(file?.data || new Uint8Array());

function mount(path, bytes, readonly) {
  const parts = path.split('/').filter(Boolean); let folder = files;
  for (const part of parts.slice(0, -1)) { let next = folder.get(part); if (!(next instanceof Directory)) { next = new Directory(new Map()); folder.set(part, next); } folder = next.contents; }
  const file = new File(bytes, { readonly }); folder.set(parts.at(-1), file); return file;
}
function ensureDirectory(path) { let folder = files; for (const part of path.split('/').filter(Boolean)) { let next = folder.get(part); if (!(next instanceof Directory)) { next = new Directory(new Map()); folder.set(part, next); } folder = next.contents; } }

function run(message) {
  files.clear();
  const output = new File(new Uint8Array(), { readonly: false }), errors = new File(new Uint8Array(), { readonly: false }), warnings = new File(new Uint8Array(), { readonly: false });
  files.set('stdout', output); files.set('stderr', errors);
  if (message.kind === 'query') { call('query', message.options); const failure = text(errors).trim(); if (failure) throw new Error(failure); return { value: JSON.parse(text(output)) }; }
  const stdin = new File(message.stdin || new Uint8Array(), { readonly: true });
  files.set('stdin', stdin); files.set('warnings', warnings);
  const known = new Map();
  for (const item of message.files) known.set(item.path, mount(item.path, item.bytes, true));
  for (const directory of message.directories || []) ensureDirectory(directory);
  call('convert', message.options);
  // Everything the engine created (the output file, a chunked HTML folder, extracted media).
  const created = [];
  const walk = (folder, prefix) => { for (const [name, entry] of folder) { const path = prefix ? prefix + '/' + name : name; if (entry instanceof Directory) walk(entry.contents, path); else if (!prefix && ['stdin', 'stdout', 'stderr', 'warnings'].includes(name)) continue; else if (known.get(path) !== entry) created.push({ path, bytes: entry.data }); } };
  walk(files, '');
  let parsed = []; try { parsed = JSON.parse(text(warnings) || '[]'); } catch {}
  const result = { stdout: output.data, stderr: text(errors), warnings: parsed, created };
  return result;
}

self.onmessage = async event => {
  const message = event.data;
  try {
    await (ready ||= load());
    const result = run(message);
    self.postMessage({ id: message.id, ok: true, result });
  } catch (error) { self.postMessage({ id: message.id, ok: false, error: String(error?.message || error) }); }
  finally { files.clear(); }
};
