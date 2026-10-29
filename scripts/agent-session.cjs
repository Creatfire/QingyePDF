#!/usr/bin/env node
// One isolated Qingye instance per test agent, driven through the Chrome DevTools protocol, so
// several agents can test on the same Mac at once without sharing a profile, a mouse or a keyboard.
// Key and mouse events go to that agent's window only; native dialogs are answered from files in
// the session folder (agent-dialogs.cjs). See docs/testing/MACOS-0.21-TEST.md.
//
//   node scripts/agent-session.cjs start  --name A2 --port 9302 [--packaged] [file …]
//   node scripts/agent-session.cjs open   --name A2 file …          open documents in the running window
//   node scripts/agent-session.cjs eval   --name A2 "<js expression>"   prints the JSON result
//   node scripts/agent-session.cjs click  --name A2 "<css selector>" [--right] [--double]
//   node scripts/agent-session.cjs key    --name A2 Meta+Shift+P      (Escape, Enter, Tab, ArrowDown, F11 …)
//   node scripts/agent-session.cjs type   --name A2 "text"
//   node scripts/agent-session.cjs shot   --name A2 out.png
//   node scripts/agent-session.cjs queue-open   --name A2 file …   files for the next native open dialog
//   node scripts/agent-session.cjs queue-answer --name A2 <button index>   for the next message box
//   node scripts/agent-session.cjs stop   --name A2
// Native menu-bar accelerators (⌘P from the macOS menu, ⌘Q) are not reached by these key events;
// shortcuts the window itself handles are.
'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');

const root = path.resolve(__dirname, '..');
const [command, ...rest] = process.argv.slice(2);
const flags = {}, positional = [];
for (let i = 0; i < rest.length; i++) {
  const a = rest[i];
  if (a === '--packaged' || a === '--right' || a === '--double') flags[a.slice(2)] = true;
  else if (a.startsWith('--')) flags[a.slice(2)] = rest[++i];
  else positional.push(a);
}
const fail = message => { console.error(message); process.exit(1); };
if (!flags.name || !/^[A-Za-z0-9_-]{1,32}$/.test(flags.name)) fail('--name is required (letters, digits, - or _).');
const dir = path.join(root, 'test-output', 'agents', flags.name);
const sessionFile = path.join(dir, 'session.json');
const session = () => { try { return JSON.parse(fs.readFileSync(sessionFile, 'utf8')); } catch { fail(`No running session "${flags.name}". Start it first.`); } };
const wait = ms => new Promise(r => setTimeout(r, ms));

function executable(packaged) {
  if (!packaged) return { file: require(path.join(root, 'node_modules', 'electron')), pre: [root] };
  const candidates = process.platform === 'darwin'
    ? ['mac-arm64', 'mac'].map(d => path.join(root, 'dist', d, 'QingyePDF.app', 'Contents', 'MacOS', 'QingyePDF'))
    : [path.join(root, 'dist', 'win-unpacked', 'QingyePDF.exe')];
  const file = candidates.find(f => fs.existsSync(f));
  if (!file) fail('Packaged app not found under dist/. Build it first.');
  return { file, pre: [] };
}
const absolute = files => files.map(f => path.resolve(f));
function launch(s, files) {
  const { file, pre } = executable(s.packaged);
  const log = fs.openSync(path.join(dir, 'app.log'), 'a');
  // An ad-hoc signed test build asking for the "Safe Storage" keychain item would put a system
  // password prompt on the shared screen for every instance; test sessions use a mock keychain.
  const keychain = process.platform === 'darwin' ? ['--use-mock-keychain'] : [];
  const child = spawn(file, [...pre, `--remote-debugging-port=${s.port}`, ...keychain, ...absolute(files)], {
    cwd: root, detached: true, stdio: ['ignore', log, log],
    env: { ...process.env, QINGYE_PROFILE_DIR: path.join(dir, 'profile'), QINGYE_AGENT_DIR: dir },
  });
  child.unref();
  return child.pid;
}

// ——— DevTools protocol ———
async function target(port) {
  const list = await (await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(5000) })).json();
  const page = list.find(t => t.type === 'page' && t.url.startsWith('qingye://app/ui/index.html'));
  if (!page) throw new Error('Qingye window not found on port ' + port);
  return page.webSocketDebuggerUrl;
}
async function cdp(port) {
  const ws = new WebSocket(await target(port));
  await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = () => reject(new Error('DevTools connection failed')); });
  let id = 0; const pending = new Map();
  ws.onmessage = event => { const m = JSON.parse(event.data); if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.reject(new Error(m.error.message)) : p.resolve(m.result); } };
  const send = (method, params = {}) => new Promise((resolve, reject) => { const n = ++id; pending.set(n, { resolve, reject }); ws.send(JSON.stringify({ id: n, method, params })); });
  return { send, close: () => ws.close() };
}
async function evaluate(c, expression) {
  const r = await c.send('Runtime.evaluate', { expression, awaitPromise: true, returnByValue: true, userGesture: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
  return r.result.value;
}
const MOD = { Alt: 1, Ctrl: 2, Control: 2, Meta: 4, Cmd: 4, Shift: 8 };
const SPECIAL = { Escape: 27, Enter: 13, Tab: 9, Backspace: 8, Delete: 46, Space: 32, ArrowLeft: 37, ArrowUp: 38, ArrowRight: 39, ArrowDown: 40, Home: 36, End: 35, PageUp: 33, PageDown: 34 };
function keyEvent(combo) {
  const parts = combo.split('+'), name = parts.pop();
  let modifiers = 0; for (const p of parts) { if (!(p in MOD)) fail('Unknown modifier ' + p); modifiers |= MOD[p]; }
  if (/^F\d{1,2}$/.test(name)) return { modifiers, key: name, code: name, windowsVirtualKeyCode: 111 + Number(name.slice(1)) };
  if (name in SPECIAL) return { modifiers, key: name === 'Space' ? ' ' : name, code: name, windowsVirtualKeyCode: SPECIAL[name] };
  if (/^[A-Za-z]$/.test(name)) { const up = name.toUpperCase(); return { modifiers, key: modifiers & 8 ? up : name.toLowerCase(), code: 'Key' + up, windowsVirtualKeyCode: up.charCodeAt(0) }; }
  if (/^\d$/.test(name)) return { modifiers, key: name, code: 'Digit' + name, windowsVirtualKeyCode: name.charCodeAt(0) };
  if (name === '\\' || name === 'Backslash') return { modifiers, key: '\\', code: 'Backslash', windowsVirtualKeyCode: 220 };
  fail('Unsupported key ' + name);
}

(async () => {
  if (command === 'start') {
    const port = Number(flags.port);
    if (!Number.isInteger(port) || port < 1024 || port > 65535) fail('--port is required (1024–65535).');
    if (fs.existsSync(sessionFile)) fail(`Session "${flags.name}" already exists; stop it first.`);
    fs.mkdirSync(dir, { recursive: true });
    const s = { name: flags.name, port, packaged: !!flags.packaged };
    s.pid = launch(s, positional);
    fs.writeFileSync(sessionFile, JSON.stringify(s, null, 2));
    for (let n = 0; n < 120; n++) {
      try { const c = await cdp(port); const ready = await evaluate(c, '!!window.qingye && document.readyState === "complete"'); c.close(); if (ready) { console.log(JSON.stringify({ started: s.name, port, pid: s.pid, dir })); return; } } catch {}
      await wait(500);
    }
    fail('The window did not become ready in 60 s; see ' + path.join(dir, 'app.log'));
  }
  const s = session();
  if (command === 'open') { launch(s, positional); console.log(JSON.stringify({ opened: absolute(positional) })); return; }
  if (command === 'queue-open') { fs.writeFileSync(path.join(dir, 'next-open.json'), JSON.stringify(absolute(positional))); console.log('queued'); return; }
  if (command === 'queue-answer') { fs.writeFileSync(path.join(dir, 'next-answer.json'), JSON.stringify(Number(positional[0]))); console.log('queued'); return; }
  if (command === 'stop') {
    try { process.kill(s.pid, 'SIGTERM'); } catch {}
    for (let n = 0; n < 20; n++) { try { process.kill(s.pid, 0); await wait(250); } catch { break; } }
    try { process.kill(s.pid, 'SIGKILL'); } catch {}
    fs.rmSync(sessionFile, { force: true }); console.log(JSON.stringify({ stopped: s.name })); return;
  }
  const c = await cdp(s.port);
  try {
    if (command === 'eval') console.log(JSON.stringify(await evaluate(c, positional.join(' ')), null, 1));
    else if (command === 'shot') {
      const out = path.resolve(positional[0] || path.join(dir, `shot-${Date.now()}.png`));
      const { data } = await c.send('Page.captureScreenshot', { format: 'png' });
      fs.mkdirSync(path.dirname(out), { recursive: true }); fs.writeFileSync(out, Buffer.from(data, 'base64')); console.log(out);
    } else if (command === 'key') {
      const e = keyEvent(positional[0] || fail('Which key?'));
      await c.send('Input.dispatchKeyEvent', { type: 'rawKeyDown', ...e });
      await c.send('Input.dispatchKeyEvent', { type: 'keyUp', ...e });
      console.log('pressed ' + positional[0]);
    } else if (command === 'type') {
      await c.send('Input.insertText', { text: positional.join(' ') }); console.log('typed');
    } else if (command === 'click') {
      const selector = positional[0] || fail('Which element?');
      const box = await evaluate(c, `(() => { const el = document.querySelector(${JSON.stringify(selector)}); if (!el) return null; el.scrollIntoView({ block: 'nearest' }); const r = el.getBoundingClientRect(); return r.width && r.height ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : 'hidden'; })()`);
      if (!box) fail('No element matches ' + selector);
      if (box === 'hidden') fail('Element is not visible: ' + selector);
      // buttons (the pressed-button mask) is what makes Chromium fire contextmenu for a right click.
      const button = flags.right ? 'right' : 'left', buttons = flags.right ? 2 : 1, clickCount = flags.double ? 2 : 1;
      await c.send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: box.x, y: box.y });
      for (let n = 1; n <= clickCount; n++) {
        await c.send('Input.dispatchMouseEvent', { type: 'mousePressed', x: box.x, y: box.y, button, buttons, clickCount: n });
        await c.send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: box.x, y: box.y, button, clickCount: n });
      }
      console.log(JSON.stringify({ clicked: selector, at: box }));
    } else fail('Unknown command ' + command);
  } finally { c.close(); }
})().catch(error => fail(error.message));
