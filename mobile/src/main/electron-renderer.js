// What preload.cjs sees as "electron" on Android. preload.cjs itself is bundled unchanged, so
// the window.desktop API stays identical to the desktop build.
import { ipcRenderer } from './ipc.js';
export { ipcRenderer };
export const contextBridge = { exposeInMainWorld(name, api) { window[name] = api; } };
// Browser File objects have no path on Android; files picked through the app's own dialogs do.
export const webUtils = { getPathForFile: file => (file && typeof file.path === 'string' ? file.path : '') };
export default { ipcRenderer, contextBridge, webUtils };
