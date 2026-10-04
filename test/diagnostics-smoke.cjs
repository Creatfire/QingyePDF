// Run only in an isolated Electron test process:
// electron test/diagnostics-smoke.cjs --edit-smoke --fault=renderer
const { app, BrowserWindow } = require('electron');
require('../main.cjs');
const fault = process.argv.find(arg => arg.startsWith('--fault='))?.slice(8) || 'renderer';
app.whenReady().then(() => {
  const poll = setInterval(() => {
    const window = BrowserWindow.getAllWindows()[0];
    if (!window) return;
    clearInterval(poll);
    window.webContents.once('did-finish-load', () => {
      if (fault === 'renderer') window.webContents.forcefullyCrashRenderer();
      else if (fault === 'exception') setImmediate(() => { throw new Error('Q04 injected main exception'); });
      else if (fault === 'rejection') Promise.reject(new Error('Q04 injected rejection'));
      else throw new Error('Unknown diagnostic fault');
    });
  }, 10);
});
