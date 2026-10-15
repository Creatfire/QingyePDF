// node:zlib on Android. Only pandoc-markdown.cjs uses it: readZip unpacks the deflated entries of
// Pandoc's default reference.docx to build the themed Word export template. The WebView has no
// synchronous inflate, and the mobile bundle never builds a themed reference document, so the shim
// only has to make the bundle resolve; a stray call reports clearly instead of failing obscurely.
export function inflateRawSync() { throw new Error('安卓版不支持读取该压缩文档。'); }
export default { inflateRawSync };
