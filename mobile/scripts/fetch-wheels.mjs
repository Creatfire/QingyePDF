// Downloads the Python wheels of the PDF backend (the same pinned versions as
// backend/requirements-lock.txt where a WebAssembly build exists) into vendor-mobile/wheels and
// verifies them against the committed SHA256SUMS. Files that are present and correct are kept.
//   PyMuPDF and the pure-Python Office writers come from PyPI (QINGYE_PYPI_SIMPLE overrides the
//   index, e.g. https://mirrors.aliyun.com/pypi/simple); lxml and Pillow are Pyodide's builds.
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const mobile = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..'), folder = path.join(mobile, 'vendor-mobile/wheels');
const pyodideVersion = JSON.parse(await fs.readFile(path.join(mobile, 'node_modules/pyodide/package.json'), 'utf8')).version;
const pyodideBase = (process.env.QINGYE_PYODIDE_CDN || 'https://cdn.jsdelivr.net/pyodide').replace(/\/$/, '') + `/v${pyodideVersion}/full/`;
const simple = (process.env.QINGYE_PYPI_SIMPLE || 'https://pypi.org/simple').replace(/\/$/, '');
const sums = (await fs.readFile(path.join(folder, 'SHA256SUMS'), 'utf8')).trim().split('\n').map(line => line.trim().split(/\s+/));
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const project = file => file.split('-')[0].toLowerCase().replace(/_/g, '-');
const fromPyodide = file => /^(lxml|pillow)-/i.test(file);

async function download(url) {
  const response = await fetch(url, { redirect: 'follow' });
  if (!response.ok) throw new Error(`${response.status} ${response.statusText}: ${url}`);
  return Buffer.from(await response.arrayBuffer());
}
async function pypiUrl(file) {
  const page = (await download(`${simple}/${project(file)}/`)).toString('utf8');
  const escaped = file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = new RegExp(`href="([^"]*/${escaped})(#[^"]*)?"`, 'i').exec(page) || new RegExp(`href="([^"]*${escaped})(#[^"]*)?"`, 'i').exec(page);
  if (!match) throw new Error(`${file} is not listed at ${simple}/${project(file)}/`);
  return new URL(match[1].replace(/&amp;/g, '&'), `${simple}/${project(file)}/`).href;
}
let fetched = 0;
for (const [sum, file] of sums) {
  const target = path.join(folder, file);
  const existing = await fs.readFile(target).catch(() => null);
  if (existing && sha(existing) === sum) continue;
  const url = fromPyodide(file) ? pyodideBase + file : await pypiUrl(file);
  process.stdout.write(`fetching ${file} … `);
  const bytes = await download(url);
  if (sha(bytes) !== sum) throw new Error(`Checksum mismatch for ${file} from ${url}`);
  await fs.writeFile(target, bytes); fetched++; console.log(`${(bytes.length / 1048576).toFixed(1)} MB`);
}
console.log(fetched ? `wheels: ${fetched} downloaded, ${sums.length} verified` : `wheels: ${sums.length} present and verified`);
