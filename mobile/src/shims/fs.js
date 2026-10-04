// node:fs (synchronous API). Only constants and a no-op watcher exist on the phone; the modules
// that need real synchronous disk access on the desktop are replaced by mobile versions.
import promises from './fs-promises.js';
export const constants = { COPYFILE_EXCL: 1 };
export function watch() { return { on() {}, close() {} }; }
const unsupported = name => () => { throw new Error(`fs.${name} is not available on Android.`); };
export const readFileSync = unsupported('readFileSync'), writeFileSync = unsupported('writeFileSync'), mkdirSync = unsupported('mkdirSync'), rmSync = unsupported('rmSync');
export { promises };
export default { constants, watch, readFileSync, writeFileSync, mkdirSync, rmSync, promises };
