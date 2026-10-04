const fs = require('node:fs/promises');
const path = require('node:path');
const { createHash, randomUUID } = require('node:crypto');

const digest = bytes => createHash('sha256').update(bytes).digest('hex');
async function fingerprint(file) {
  try { return digest(await fs.readFile(file)); }
  catch (error) { if (error.code === 'ENOENT') return null; throw error; }
}
function pdfBytes(value) {
  if (!(value instanceof Uint8Array)) throw new Error('无效的 PDF 数据。');
  const bytes = Buffer.from(value);
  if (!bytes.subarray(0, 1024).includes(Buffer.from('%PDF-'))) throw new Error('文件不是有效的 PDF。');
  return bytes;
}
async function atomicWrite(file, bytes, expectedDigest, { exclusive = false } = {}) {
  const io = name => process.platform === 'win32' ? path.toNamespacedPath(name) : name;
  const verify = async () => {
    if (exclusive) {
      try { await fs.lstat(io(file)); } catch (error) { if (error.code === 'ENOENT') return; throw error; }
      throw Object.assign(new Error('输出文件已存在。'), { code: 'EEXIST' });
    }
    if (await fingerprint(file) !== expectedDigest) {
      throw new Error('文件已被其他程序修改，请使用“另存为”保存副本。');
    }
  };
  await verify();
  const temporary = path.join(path.dirname(file), `.qy-${randomUUID()}.tmp`);
  let handle;
  try {
    handle = await fs.open(io(temporary), 'wx');
    await handle.writeFile(bytes);
    await handle.sync();
    await handle.close();
    handle = null;
    await verify();
    if (exclusive) await fs.link(io(temporary), io(file));
    else await fs.rename(io(temporary), io(file));
  } finally {
    await handle?.close();
    await fs.unlink(io(temporary)).catch(error => { if (error.code !== 'ENOENT') throw error; });
  }
  return digest(bytes);
}

// Small self-contained fixture: text, two pages, outline and a highlight annotation.
function samplePdf(label = 'Qingye PDF', image = false) {
  const escape = text => text.replace(/[\\()]/g, '\\$&');
  const stream1 = `BT /F1 26 Tf 72 740 Td (${escape(label)}) Tj 0 -48 Td /F1 13 Tf (An open-source home for your documents.) Tj 0 -32 Td (Search for: reader. Add a highlight, text or ink.) Tj 0 -26 Td (Save a copy and reopen it to check your annotations.) Tj ET${image?'\nq 120 0 0 90 300 400 cm /Im1 Do Q':''}`;
  const stream2 = 'BT /F1 26 Tf 72 740 Td (Chapter 2) Tj 0 -48 Td /F1 14 Tf (Every tab keeps its own reader state.) Tj ET';
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R /Outlines 8 0 R /PageMode /UseOutlines >>',
    '<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 6 0 R /Annots [11 0 R] >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R >> >> /Contents 7 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(stream1)} >>\nstream\n${stream1}\nendstream`,
    `<< /Length ${Buffer.byteLength(stream2)} >>\nstream\n${stream2}\nendstream`,
    '<< /Type /Outlines /First 9 0 R /Last 10 0 R /Count 2 >>',
    '<< /Title (Getting started) /Parent 8 0 R /Next 10 0 R /Dest [3 0 R /Fit] >>',
    '<< /Title (Chapter 2) /Parent 8 0 R /Prev 9 0 R /Dest [4 0 R /Fit] >>',
    '<< /Type /Annot /Subtype /Highlight /Rect [72 650 230 670] /QuadPoints [72 670 230 670 72 650 230 650] /C [1 0.92 0.4] /F 4 /Contents (Sample highlight) >>',
  ];
  if(image){objects[2]=objects[2].replace('/Resources <<','/Resources << /XObject << /Im1 12 0 R >>');objects.push('<< /Type /XObject /Subtype /Image /Width 2 /Height 2 /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /ASCIIHexDecode /Length 25 >>\nstream\nFF0000FF0000FF0000FF0000>\nendstream');}
  let content = '%PDF-1.7\n';
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(Buffer.byteLength(content));
    content += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = Buffer.byteLength(content);
  content += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  content += offsets.slice(1).map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  content += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(content);
}
module.exports = { digest, fingerprint, pdfBytes, atomicWrite, samplePdf };
