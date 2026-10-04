// Mobile counterpart of core.cjs. Same contract: content digests guard against overwriting a
// file that changed underneath us, and writes go through a temporary file plus rename.
import { Buffer } from 'buffer';
import fs from '../shims/fs-promises.js';
import path from 'path';
import { createHash, randomUUID } from '../shims/crypto.js';
import desktopCore from '../../../core.cjs';

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function fingerprint(file) {
  try { return digest(await fs.readFile(file)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function pdfBytes(value) {
  if (!(value instanceof Uint8Array)) throw new Error('无效的 PDF 数据。');
  const bytes = Buffer.from(value.buffer, value.byteOffset, value.byteLength);
  if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('文件不是有效的 PDF。');
  return bytes;
}
async function atomicWrite(file, bytes, expectedDigest, { exclusive = false } = {}) {
  const verify = async () => {
    if (exclusive) { if (await fs.stat(file).then(() => true, error => { if (error.code === 'ENOENT') return false; throw error; })) throw Object.assign(new Error('输出文件已存在。'), { code: 'EEXIST' }); return; }
    if (await fingerprint(file) !== expectedDigest) throw new Error('文件已被其他程序修改，请使用“另存为”保存副本。');
  };
  await verify();
  const temporary = path.join(path.dirname(file), `.qy-${randomUUID()}.tmp`);
  try {
    await fs.writeFile(temporary, bytes);
    await verify();
    await fs.rename(temporary, file);
  } finally { await fs.rm(temporary, { force: true }).catch(() => {}); }
  return digest(bytes);
}
const samplePdf = desktopCore.samplePdf;
export { digest, fingerprint, pdfBytes, atomicWrite, samplePdf };
export default { digest, fingerprint, pdfBytes, atomicWrite, samplePdf };
