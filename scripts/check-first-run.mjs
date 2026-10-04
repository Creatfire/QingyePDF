// Verifies the one-time first-run dialog through the real renderer via CDP.
// Usage: node scripts/check-first-run.mjs  (expects the app on --remote-debugging-port=9223)
const port = process.argv[2] || '9223';
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
for (let attempt = 0; attempt < 40; attempt++) {
  try {
    const targets = await (await fetch(`http://127.0.0.1:${port}/json/list`)).json();
    const page = targets.find(t => t.type === 'page' && t.url.includes('ui/index.html'));
    if (page) {
      const ws = new WebSocket(page.webSocketDebuggerUrl);
      const reply = await new Promise((resolve, reject) => {
        const timer = setTimeout(() => reject(new Error('CDP timeout')), 10000);
        ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: "JSON.stringify({open: document.getElementById('messageDialog').open, title: document.getElementById('messageTitle').textContent, status: document.getElementById('statusText').textContent, hasUnsavedHint: document.getElementById('messageBody').textContent.includes('解压')})", returnByValue: true } }));
        ws.onmessage = event => { clearTimeout(timer); resolve(JSON.parse(event.data).result?.result?.value); ws.close(); };
        ws.onerror = error => { clearTimeout(timer); reject(error); };
      });
      console.log(reply || 'null');
      process.exit(reply ? 0 : 1);
    }
  } catch { /* app not ready yet */ }
  await wait(500);
}
console.log('page target not found');
process.exit(1);
