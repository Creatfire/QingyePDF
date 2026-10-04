// Local AI interface (0.9.1): an OpenAPI tool server on 127.0.0.1 so external AI clients (Open WebUI
// "OpenAPI tool servers", agents, scripts, MCP bridges such as mcpo) can read and write the documents
// open in Qingye through the same tools the in-app assistant uses (ui/ai/tools.json).
// Off by default. Loopback only, bearer token required, Host header checked (no DNS rebinding),
// write tools go through the in-app confirmation unless the user allowed edits.
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');

const TOOLS = JSON.parse(fs.readFileSync(path.join(__dirname, 'ui', 'ai', 'tools.json'), 'utf8')).tools;
const MAX_BODY = 4 * 1024 * 1024;

function openApi({ port, version }) {
  const paths = {
    '/v1/documents': { get: { operationId: 'list_documents_get', summary: 'List open documents', description: TOOLS[0].description, responses: { 200: { description: 'Open documents', content: { 'application/json': { schema: { type: 'object' } } } } } } },
  };
  for (const t of TOOLS) paths['/v1/tools/' + t.name] = { post: {
    operationId: t.name, summary: t.name.replace(/_/g, ' '), description: t.description + (t.mutating ? ' (Changes the document; the user may be asked to confirm.)' : ''),
    requestBody: { required: !!t.parameters.required?.length, content: { 'application/json': { schema: t.parameters } } },
    responses: { 200: { description: 'Result', content: { 'application/json': { schema: { type: 'object' } } } }, 400: { description: 'Invalid request' }, 401: { description: 'Missing or wrong token' }, 403: { description: 'Declined by the user' } },
  } };
  return { openapi: '3.1.0', info: { title: 'Qingye PDF document tools', version, description: 'Read and edit the PDF and Markdown documents open in Qingye PDF on this computer. All calls require "Authorization: Bearer <token>" (Settings → AI → Local AI interface).' }, servers: [{ url: `http://127.0.0.1:${port}` }], components: { securitySchemes: { bearer: { type: 'http', scheme: 'bearer' } } }, security: [{ bearer: [] }], paths };
}

function createApiServer({ call, version = '0.0.0', log = () => {} }) {
  let server = null, current = null;
  const send = (res, status, data) => {
    res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'access-control-allow-origin': '*', 'access-control-allow-headers': 'authorization, content-type', 'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-allow-private-network': 'true', 'cache-control': 'no-store' });
    res.end(status === 204 ? undefined : JSON.stringify(data));
  };
  async function handler(req, res) {
    const host = String(req.headers.host || '').toLowerCase();
    if (!new RegExp(`^(127\\.0\\.0\\.1|localhost|\\[::1\\]):${current.port}$`).test(host)) return send(res, 421, { error: 'Host not allowed' });
    if (req.method === 'OPTIONS') return send(res, 204, {});
    const url = new URL(req.url, `http://127.0.0.1:${current.port}`);
    if (req.method === 'GET' && (url.pathname === '/health' || url.pathname === '/v1/health')) return send(res, 200, { ok: true, app: 'Qingye PDF', version });
    if (req.method === 'GET' && (url.pathname === '/openapi.json' || url.pathname === '/v1/openapi.json')) return send(res, 200, openApi({ port: current.port, version }));
    if ((req.headers.authorization || '') !== 'Bearer ' + current.token) return send(res, 401, { error: 'Missing or wrong bearer token (Settings → AI → Local AI interface).' });
    let name, args = {};
    if (req.method === 'GET' && url.pathname === '/v1/documents') name = 'list_documents';
    else if (req.method === 'POST' && url.pathname.startsWith('/v1/tools/')) {
      name = decodeURIComponent(url.pathname.slice(10));
      const chunks = []; let size = 0;
      for await (const chunk of req) { size += chunk.length; if (size > MAX_BODY) return send(res, 413, { error: 'Request body too large' }); chunks.push(chunk); }
      const raw = Buffer.concat(chunks).toString('utf8').trim();
      if (raw) { try { args = JSON.parse(raw); } catch { return send(res, 400, { error: 'Body must be JSON' }); } }
      if (!args || typeof args !== 'object' || Array.isArray(args)) return send(res, 400, { error: 'Body must be a JSON object' });
    } else return send(res, 404, { error: 'Not found. See /openapi.json' });
    if (!TOOLS.some(t => t.name === name)) return send(res, 404, { error: 'Unknown tool: ' + name });
    try { log('api', name); send(res, 200, await call(name, args, { source: 'api', allowEdits: current.allowEdits })); }
    catch (error) { send(res, error.declined ? 403 : error.status || 400, { error: error.message }); }
  }
  async function start({ port, token, allowEdits }) {
    await stop();
    current = { port, token, allowEdits: !!allowEdits };
    server = http.createServer((req, res) => handler(req, res).catch(error => send(res, 500, { error: error.message })));
    await new Promise((resolve, reject) => { server.once('error', reject); server.listen(port, '127.0.0.1', () => { server.off('error', reject); resolve(); }); })
      .catch(error => { server = null; throw new Error(error.code === 'EADDRINUSE' ? `端口 ${port} 已被占用，请换一个端口。` : error.message); });
    return status();
  }
  // Close open connections first: a request waiting for the user's confirmation must not hold up
  // turning the interface off or changing its port.
  async function stop() { if (!server) return; const s = server; server = null; const closed = new Promise(resolve => s.close(() => resolve())); s.closeAllConnections?.(); await closed; }
  const status = () => ({ running: !!server, port: current?.port || 0, url: server ? `http://127.0.0.1:${current.port}` : '', openapi: server ? `http://127.0.0.1:${current.port}/openapi.json` : '' });
  const update = values => { if (current) Object.assign(current, values); };
  return { start, stop, status, update };
}

module.exports = { createApiServer, openApi, TOOLS };
