// Diagnostic (not part of CI): CPU profile of one Enter in a 1 MB Markdown document.
// Run: npx electron . --markdown-profile   (writes test-output/enter-profile.json and prints the top functions)
const fs = require('node:fs/promises');
const path = require('node:path');

exports.run = async ({ window, openFiles, output }) => {
  const run = code => window.webContents.executeJavaScript(code, true);
  const sample = await fs.readFile(path.join(__dirname, '../ui/markdown/sample.md'), 'utf8');
  let big = ''; while (big.length < 1024 * 1024) big += sample + '\n\n';
  await fs.mkdir(output, { recursive: true });
  const file = path.join(output, 'profile-big.md'); await fs.writeFile(file, big);
  const opened = await openFiles([file]);
  await run(`qingye.addDocuments(${JSON.stringify(opened)})`);
  const S = `qingye.sessions.get(${JSON.stringify(opened[0].id)})`;
  for (let i = 0; i < 100 && !(await run(`!!${S}?.loaded`)); i++) await new Promise(r => setTimeout(r, 100));
  await run(`(() => { const ed = ${S}.editor, mid = Math.floor(ed.text.length / 2); ed.activateAt(ed.text.indexOf('\\n\\n', mid) - 5); })()`);
  await new Promise(r => setTimeout(r, 1500));
  const dbg = window.webContents.debugger; dbg.attach('1.3');
  await dbg.sendCommand('Profiler.enable'); await dbg.sendCommand('Profiler.setSamplingInterval', { interval: 100 }); await dbg.sendCommand('Profiler.start');
  const timing = await run(`(async () => { const ed = ${S}.editor, t = performance.now(); ed.handleEnter(false, false); const js = performance.now() - t; await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r))); return { js: Math.round(js), total: Math.round(performance.now() - t) }; })()`);
  const { profile } = await dbg.sendCommand('Profiler.stop'); dbg.detach();
  await fs.writeFile(path.join(output, 'enter-profile.json'), JSON.stringify(profile));
  // Self time per function.
  const self = new Map(), byId = new Map(profile.nodes.map(n => [n.id, n]));
  const dt = profile.timeDeltas; profile.samples.forEach((id, i) => { const n = byId.get(id), key = `${n.callFrame.functionName || '(anon)'} ${path.basename(n.callFrame.url || '')}:${n.callFrame.lineNumber + 1}`; self.set(key, (self.get(key) || 0) + (dt[i] || 0)); });
  const top = [...self].sort((a, b) => b[1] - a[1]).slice(0, 25).map(([k, us]) => `${(us / 1000).toFixed(1).padStart(7)} ms  ${k}`);
  console.log('ENTER TIMING', JSON.stringify(timing)); console.log(top.join('\n'));
  return { timing, top };
};
