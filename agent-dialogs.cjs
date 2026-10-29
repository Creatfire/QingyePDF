'use strict';
// Native dialogs for automated test agents (scripts/agent-session.cjs, docs/testing/MACOS-0.21-TEST.md).
// Only installed when QINGYE_AGENT_DIR is set. A test agent drives the window through the DevTools
// protocol and cannot click a native open / save / message dialog, so these answer from files in
// the agent's own session folder instead, and every dialog is logged to <dir>/dialogs.log:
//   next-open.json    array of absolute paths for the next open dialog (consumed); none → canceled
//   next-answer.json  button index for the next message box (consumed); none → its default button
//   outputs/          where save dialogs write, under the suggested file name
const fs = require('node:fs');
const path = require('node:path');

function install(dialog, dir) {
  const outputs = path.join(dir, 'outputs');
  fs.mkdirSync(outputs, { recursive: true });
  const take = name => {
    const file = path.join(dir, name);
    try { const value = JSON.parse(fs.readFileSync(file, 'utf8')); fs.rmSync(file, { force: true }); return value; } catch { return undefined; }
  };
  const log = entry => fs.appendFileSync(path.join(dir, 'dialogs.log'), JSON.stringify({ time: new Date().toISOString(), ...entry }) + '\n');
  // Electron accepts (options) or (window, options).
  const optionsOf = args => (args.length > 1 ? args[1] : args[0]) || {};
  dialog.showOpenDialog = async (...args) => {
    const options = optionsOf(args), queued = take('next-open.json');
    const filePaths = Array.isArray(queued) ? queued.filter(p => typeof p === 'string' && path.isAbsolute(p)) : [];
    const result = filePaths.length ? { canceled: false, filePaths } : { canceled: true, filePaths: [] };
    log({ type: 'open', title: options.title, properties: options.properties, result });
    return result;
  };
  dialog.showSaveDialog = async (...args) => {
    const options = optionsOf(args);
    const filePath = path.join(outputs, path.basename(options.defaultPath || 'output'));
    log({ type: 'save', title: options.title, defaultPath: options.defaultPath, result: filePath });
    return { canceled: false, filePath };
  };
  dialog.showMessageBox = async (...args) => {
    const options = optionsOf(args), queued = take('next-answer.json');
    const response = Number.isInteger(queued) ? queued : (options.defaultId ?? 0);
    log({ type: 'message', title: options.title, message: options.message, detail: options.detail, buttons: options.buttons, response });
    return { response, checkboxChecked: false };
  };
  dialog.showMessageBoxSync = (...args) => {
    const options = optionsOf(args), queued = take('next-answer.json');
    const response = Number.isInteger(queued) ? queued : (options.defaultId ?? 0);
    log({ type: 'message-sync', title: options.title, message: options.message, buttons: options.buttons, response });
    return response;
  };
  dialog.showErrorBox = (title, content) => log({ type: 'error', title, message: content });
}

module.exports = { install };
