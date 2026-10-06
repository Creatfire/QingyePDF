'use strict';
function patchPdfjs(source) {
  const stamp='  serialize(isForCopying = false, context = null) {\n    if (this.isEmpty()) {\n      return null;\n    }\n    if (this.deleted) {\n      return this.serializeDeleted();\n    }\n    const serialized = Object.assign(super.serialize(isForCopying), {\n      bitmapId: this.#bitmapId,';
  if (!source.includes('Qingye: do not serialize a pending image')) {
    if (!source.includes(stamp)) throw new Error('Unsupported PDF.js stamp serialization; review the patch before upgrading.');
    source=source.replace(stamp,stamp.replace('if (this.isEmpty()) {','// Qingye: do not serialize a pending image without bitmap data.\n    if (this.isEmpty() || (!this.annotationElementId && !this.#bitmap)) {'));
  }
  const start='    this.#bitmapPromise = new Promise(resolve => {\n      input.addEventListener("change", async () => {';
  const end='      input.addEventListener("cancel", () => {';
  if (!source.includes('Qingye: a failed image load must release the pending picker')) {
    const at=source.indexOf(start),stop=source.indexOf(end,at);
    if(at<0||stop<0)throw new Error('Unsupported PDF.js image picker; review the patch before upgrading.');
    const block=source.slice(at,stop);
    const fixed=block.replace('async () => {','async () => {\n        // Qingye: a failed image load must release the pending picker.\n        try {').replace('        resolve();\n      }, {','        } catch (error) {\n          warn(`Unable to load image: ${error}`);\n          this.remove();\n        } finally { resolve(); }\n      }, {');
    source=source.slice(0,at)+fixed+source.slice(stop);
  }
  source=source.replaceAll('.then(data => this.#getBitmapFetched(data)).finally(() => this.#getBitmapDone())',
    '.then(data => this.#getBitmapFetched(data)).catch(error => { warn(`Unable to load image: ${error}`); this.remove(); }).finally(() => this.#getBitmapDone())');
  return source;
}
module.exports={patchPdfjs};
