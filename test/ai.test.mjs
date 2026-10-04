// AI collaboration (0.9.1): import formats, request building, stream parsing, the service with a fake
// network, and the local OpenAPI tool server.
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import fs from 'node:fs/promises';
const require = createRequire(import.meta.url);
const S = require('../ai-service.cjs');
const { createApiServer, openApi, TOOLS } = require('../ai-api-server.cjs');

const sse = chunks => new ReadableStream({ start(c) { for (const x of chunks) c.enqueue(new TextEncoder().encode(x)); c.close(); } });
const response = (status, body, type = 'application/json') => new Response(body, { status, headers: { 'content-type': type } });

test('import: Qingye export, Open WebUI config, plain JSON, env text and bare URL', () => {
  assert.equal(S.parseImport(JSON.stringify({ qingye: 'ai-connections', connections: [{ name: 'A', type: 'openai', baseUrl: 'https://x.test/v1/', apiKey: 'k', models: ['m1'] }] }))[0].baseUrl, 'https://x.test/v1');
  const owui = S.parseImport(JSON.stringify({ openai: { api_base_urls: ['https://api.openai.com/v1', 'https://api.deepseek.com/v1'], api_keys: ['sk-1', 'sk-2'] }, ollama: { base_urls: ['http://localhost:11434'] } }));
  assert.deepEqual(owui.map(c => [c.type, c.apiKey]), [['openai', 'sk-1'], ['openai', 'sk-2'], ['ollama', '']]);
  assert.equal(S.parseImport('{"base_url":"https://api.anthropic.com","api_key":"a"}')[0].type, 'anthropic');
  const env = S.parseImport('export OPENAI_API_KEY="sk-abc"\nOPENAI_BASE_URL=https://gw.test/v1\nANTHROPIC_API_KEY=ak\nOLLAMA_HOST=127.0.0.1:11434');
  assert.deepEqual(env.map(c => c.type), ['openai', 'anthropic', 'ollama']);
  assert.equal(env[0].baseUrl, 'https://gw.test/v1'); assert.equal(env[2].baseUrl, 'http://127.0.0.1:11434');
  assert.equal(S.parseImport('https://my.gateway/v1 sk-123')[0].apiKey, 'sk-123');
  assert.throws(() => S.parseImport('hello'), /没有识别到/);
});

test('requests: OpenAI, Ollama and Anthropic shapes including tool calls', () => {
  const messages = [{ role: 'system', content: 'sys' }, { role: 'user', content: 'hi' }, { role: 'assistant', content: '', toolCalls: [{ id: 't1', name: 'read_document', arguments: { start_page: 1 } }] }, { role: 'tool', toolCallId: 't1', content: '{"text":"x"}' }, { role: 'tool', toolCallId: 't2', content: 'y' }];
  const tools = [TOOLS[1]];
  const o = S.buildRequest({ type: 'openai', baseUrl: 'https://a/v1' }, 'k', { model: 'm', messages, tools, temperature: 0.2 });
  assert.equal(o.url, 'https://a/v1/chat/completions'); assert.equal(o.headers.authorization, 'Bearer k');
  assert.equal(o.body.messages[2].tool_calls[0].function.arguments, '{"start_page":1}'); assert.equal(o.body.messages[3].tool_call_id, 't1');
  assert.equal(o.body.tools[0].function.name, 'read_document');
  const l = S.buildRequest({ type: 'ollama', baseUrl: 'http://127.0.0.1:11434' }, '', { model: 'q', messages });
  assert.equal(l.url, 'http://127.0.0.1:11434/v1/chat/completions'); assert.equal(l.headers.authorization, undefined);
  const a = S.buildRequest({ type: 'anthropic', baseUrl: 'https://api.anthropic.com' }, 'ak', { model: 'c', messages, tools, temperature: 1.5 });
  assert.equal(a.url, 'https://api.anthropic.com/v1/messages'); assert.equal(a.headers['x-api-key'], 'ak');
  assert.equal(a.body.system, 'sys'); assert.equal(a.body.temperature, 1);
  assert.deepEqual(a.body.messages.map(m => m.role), ['user', 'assistant', 'user']);
  assert.equal(a.body.messages[2].content.length, 2, 'consecutive tool results merge into one user turn');
  assert.equal(a.body.tools[0].input_schema.type, 'object');
});

test('stream parsing: OpenAI text + split tool-call arguments, Anthropic text + tool_use', async () => {
  const deltas = [];
  const o = await S.readStream('openai', sse([
    'data: {"choices":[{"delta":{"content":"Hel"}}]}\n\n', 'data: {"choices":[{"delta":{"content":"lo"}}]}\n',
    '\ndata: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c1","function":{"name":"search_document","arguments":"{\\"que"}}]}}]}\n\n',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"ry\\":\\"青页\\"}"}}]},"finish_reason":"tool_calls"}]}\n\ndata: [DONE]\n\n']), d => deltas.push(d));
  assert.equal(o.content, 'Hello'); assert.deepEqual(deltas.filter(Boolean), ['Hel', 'lo']);
  assert.deepEqual(o.toolCalls, [{ id: 'c1', name: 'search_document', arguments: { query: '青页' } }]); assert.equal(o.finish, 'tool_calls');
  const a = await S.readStream('anthropic', sse([
    'event: message_start\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5}}}\n\n',
    'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"好"}}\n\n',
    'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"tu","name":"get_outline"}}\n\n',
    'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{}"}}\n\n',
    'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":3}}\n\n']));
  assert.equal(a.content, '好'); assert.equal(a.toolCalls[0].name, 'get_outline'); assert.equal(a.finish, 'tool_use'); assert.equal(a.usage.output_tokens, 3);
  await assert.rejects(S.readStream('openai', sse(['data: {"error":{"message":"quota"}}\n\n'])), /quota/);
});

test('service: keys stay in the main process, models, chat, cancel, export without keys', async () => {
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'qy-ai-'));
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url, init });
    if (url.endsWith('/models')) return response(200, JSON.stringify({ data: [{ id: 'b-model' }, { id: 'a-model' }] }));
    if (url.includes('bad')) return response(401, JSON.stringify({ error: { message: 'Incorrect API key' } }));
    if (init.signal) await new Promise(r => setTimeout(r, 5));
    if (init.signal?.aborted) throw new DOMException('aborted', 'AbortError');
    return new Response(sse(['data: {"choices":[{"delta":{"content":"答"}}]}\n\n', 'data: [DONE]\n\n']), { headers: { 'content-type': 'text/event-stream' } });
  };
  const ai = S.createAiService({ folder, fetchImpl, encrypt: s => 'enc:' + Buffer.from(s).toString('base64'), decrypt: s => Buffer.from(s.slice(4), 'base64').toString() });
  const c = await ai.upsert({ name: 'GW', type: 'openai', baseUrl: 'https://gw.test/v1/', apiKey: 'sk-secret-123456' });
  assert.equal(c.hasKey, true); assert.equal(c.keyHint, 'sk-…3456'); assert.equal(JSON.stringify(await ai.state()).includes('sk-secret'), false);
  assert.ok(!(await fs.readFile(path.join(folder, 'ai-config.json'), 'utf8')).includes('sk-secret'), 'key encrypted at rest');
  assert.deepEqual((await ai.listModels(c.id)).models, ['a-model', 'b-model']);
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-secret-123456');
  const deltas = []; const r = await ai.chat('j1', { connectionId: c.id, model: 'a-model', messages: [{ role: 'user', content: '问' }] }, d => deltas.push(d));
  assert.equal(r.content, '答'); assert.equal(r.model, 'a-model'); assert.equal(JSON.parse(calls.at(-1).init.body).stream, true);
  const job = ai.chat('j2', { connectionId: c.id, model: 'a-model', messages: [{ role: 'user', content: '问' }] }); ai.cancel('j2');
  await assert.rejects(job, e => e.canceled === true);
  const bad = await ai.upsert({ name: 'Bad', type: 'openai', baseUrl: 'https://bad.test/v1', apiKey: 'x' });
  await assert.rejects(ai.chat('j3', { connectionId: bad.id, model: 'm', messages: [{ role: 'user', content: 'x' }] }), /API Key 无效.*401.*Incorrect/);
  const exported = await ai.exportConfig(false);
  assert.equal(exported.connections.length, 2); assert.ok(!JSON.stringify(exported).includes('sk-secret'));
  assert.ok(JSON.stringify(await ai.exportConfig(true)).includes('sk-secret'));
  const imported = await ai.importConfig(JSON.stringify(exported));
  assert.equal(imported.connections.length, 2, 're-import updates instead of duplicating');
  await assert.rejects(ai.upsert({ baseUrl: 'ftp://x' }), /http/);
  const srv = await ai.serverConfig({ enabled: true, port: 18000 });
  assert.match(srv.token, /^qy_/); assert.equal(srv.port, 18000);
  await fs.rm(folder, { recursive: true, force: true });
});

test('local API: loopback host check, bearer token, OpenAPI document, tool calls and declines', async () => {
  const seen = [];
  const api = createApiServer({ version: '9.9.9', call: async (name, args, meta) => { seen.push([name, args, meta.source]); if (name === 'insert_markdown') throw Object.assign(new Error('用户拒绝'), { declined: true }); return { ok: true, name }; } });
  const port = 18000 + Math.floor(Math.random() * 2000);
  await api.start({ port, token: 'tok', allowEdits: false });
  const base = `http://127.0.0.1:${port}`;
  try {
    assert.equal((await (await fetch(base + '/health')).json()).version, '9.9.9');
    const spec = await (await fetch(base + '/openapi.json')).json();
    assert.equal(spec.openapi, '3.1.0'); assert.ok(spec.paths['/v1/tools/read_document'].post.operationId === 'read_document');
    assert.equal(Object.keys(spec.paths).length, TOOLS.length + 1);
    assert.equal((await fetch(base + '/v1/documents')).status, 401);
    const auth = { authorization: 'Bearer tok', 'content-type': 'application/json' };
    assert.deepEqual(await (await fetch(base + '/v1/documents', { headers: auth })).json(), { ok: true, name: 'list_documents' });
    assert.equal((await fetch(base + '/v1/tools/search_document', { method: 'POST', headers: auth, body: '{"query":"a"}' })).status, 200);
    assert.equal((await fetch(base + '/v1/tools/insert_markdown', { method: 'POST', headers: auth, body: '{"text":"a"}' })).status, 403);
    assert.equal((await fetch(base + '/v1/tools/rm_rf', { method: 'POST', headers: auth, body: '{}' })).status, 404);
    assert.equal((await fetch(base + '/v1/tools/get_outline', { method: 'POST', headers: auth, body: '[1]' })).status, 400);
    const rebinding = await new Promise(resolve => require('node:http').get({ host: '127.0.0.1', port, path: '/health', headers: { host: 'evil.example:' + port } }, res => resolve(res.statusCode)));
    assert.equal(rebinding, 421);
    assert.deepEqual(seen.map(s => s[0]), ['list_documents', 'search_document', 'insert_markdown']);
    assert.equal(openApi({ port: 1, version: 'x' }).servers[0].url, 'http://127.0.0.1:1');
  } finally { await api.stop(); }
  assert.equal(api.status().running, false);
});

test('IPC wiring: handlers, local interface start/stop and the renderer bridge round trip', async () => {
  const { register } = require('../ai-ipc.cjs');
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'qy-ipc-'));
  const handlers = new Map(), sent = [], quit = [];
  const win = { isDestroyed: () => false, webContents: { send: (channel, ...args) => sent.push([channel, ...args]) } };
  const app = { getPath: () => folder, getVersion: () => '0.9.1-test', on: (name, fn) => name === 'before-quit' && quit.push(fn) };
  register({ handle: (name, fn) => handlers.set(name, fn), getWindow: () => win, app, dialog: {}, session: { fromPartition: () => ({}) }, safeStorage: { isEncryptionAvailable: () => false }, ipcMain: {}, testMode: false });
  for (const name of ['ai-state', 'ai-upsert', 'ai-remove', 'ai-defaults', 'ai-prompts', 'ai-models', 'ai-chat', 'ai-cancel', 'ai-import-text', 'ai-import-file', 'ai-export', 'ai-server', 'ai-bridge-reply']) assert.ok(handlers.has(name), name);
  const state = await handlers.get('ai-state')();
  assert.equal(state.encrypted, false); assert.equal(state.serverStatus.running, false);
  const imported = await handlers.get('ai-import-text')('OPENAI_API_KEY=sk-plain-000111\nOPENAI_BASE_URL=https://gw.test/v1');
  assert.equal(imported.added, 1); assert.equal(JSON.stringify(await handlers.get('ai-state')()).includes('sk-plain'), false);
  const port = 20000 + Math.floor(Math.random() * 2000);
  const srv = await handlers.get('ai-server')({ enabled: true, port });
  assert.equal(srv.running, true); assert.match(srv.token, /^qy_/);
  try {
    const call = fetch(`http://127.0.0.1:${port}/v1/tools/get_outline`, { method: 'POST', headers: { authorization: 'Bearer ' + srv.token }, body: '{}' });
    for (let i = 0; i < 50 && !sent.some(s => s[0] === 'ai-bridge'); i++) await new Promise(r => setTimeout(r, 10));
    const [, id, name, args, meta] = sent.find(s => s[0] === 'ai-bridge');
    assert.deepEqual([name, args, meta.source, meta.allowEdits], ['get_outline', {}, 'api', false]);
    assert.equal(await handlers.get('ai-bridge-reply')(id, true, { headings: [] }), true);
    const res = await call; assert.equal(res.status, 200); assert.deepEqual(await res.json(), { headings: [] });
    const declined = fetch(`http://127.0.0.1:${port}/v1/tools/insert_markdown`, { method: 'POST', headers: { authorization: 'Bearer ' + srv.token }, body: '{"text":"x"}' });
    for (let i = 0; i < 50 && sent.filter(s => s[0] === 'ai-bridge').length < 2; i++) await new Promise(r => setTimeout(r, 10));
    await handlers.get('ai-bridge-reply')(sent.filter(s => s[0] === 'ai-bridge')[1][1], false, { message: 'no', declined: true });
    assert.equal((await declined).status, 403);
    assert.equal(await handlers.get('ai-bridge-reply')('unknown', true, {}), false);
  } finally {
    assert.equal((await handlers.get('ai-server')({ enabled: false })).running, false);
    for (const fn of quit) fn();
    await fs.rm(folder, { recursive: true, force: true });
  }
});

test('provider quirks: parallel calls sharing index 0, missing index, repeated names, mislabelled SSE, /v1 suffixes', async () => {
  const chunk = o => `data: ${JSON.stringify({ choices: [{ delta: { tool_calls: [o] } }] })}\n\n`;
  const gemini = await S.readStream('openai', sse([chunk({ index: 0, id: 'a', function: { name: 'get_outline', arguments: '{}' } }), chunk({ index: 0, id: 'b', function: { name: 'search_document', arguments: '{"query":"x"}' } }), 'data: [DONE]\n\n']));
  assert.deepEqual(gemini.toolCalls.map(c => [c.id, c.name, c.arguments]), [['a', 'get_outline', {}], ['b', 'search_document', { query: 'x' }]]);
  const noIndex = await S.readStream('openai', sse([chunk({ id: 'c', function: { name: 'go_to', arguments: '{"pa' } }), chunk({ function: { arguments: 'ge":2}' } }), 'data: [DONE]\n\n']));
  assert.deepEqual(noIndex.toolCalls, [{ id: 'c', name: 'go_to', arguments: { page: 2 } }]);
  const repeated = await S.readStream('openai', sse([chunk({ index: 0, id: 'd', function: { name: 'read_document', arguments: '{' } }), chunk({ index: 0, function: { name: 'read_document', arguments: '}' } })]));
  assert.equal(repeated.toolCalls[0].name, 'read_document');
  assert.equal(S.buildRequest({ type: 'anthropic', baseUrl: 'https://api.anthropic.com/v1' }, 'k', { model: 'c', messages: [{ role: 'user', content: 'x' }] }).url, 'https://api.anthropic.com/v1/messages');
  assert.equal(S.buildRequest({ type: 'ollama', baseUrl: 'http://127.0.0.1:11434/v1' }, '', { model: 'q', messages: [{ role: 'user', content: 'x' }] }).url, 'http://127.0.0.1:11434/v1/chat/completions');
  const none = S.buildRequest({ type: 'openai', baseUrl: 'https://a/v1' }, 'k', { model: 'm', messages: [{ role: 'user', content: 'x' }], tools: [TOOLS[0]], toolChoice: 'none' });
  assert.equal(none.body.tool_choice, 'none');
  const folder = await fs.mkdtemp(path.join(os.tmpdir(), 'qy-ai-'));
  const ai = S.createAiService({ folder, fetchImpl: async () => new Response('data: {"choices":[{"delta":{"content":"ok"}}]}\n\ndata: [DONE]\n\n', { headers: { 'content-type': 'text/plain' } }), encrypt: x => 'plain:' + x, decrypt: x => x.slice(6) });
  const c = await ai.upsert({ name: 'A', type: 'openai', baseUrl: 'https://one.test/v1', apiKey: 'sk-one-1234567' });
  assert.equal((await ai.chat('x', { connectionId: c.id, model: 'm', messages: [{ role: 'user', content: 'q' }] })).content, 'ok');
  assert.equal((await ai.upsert({ id: c.id, name: 'A', type: 'openai', baseUrl: 'https://one.test/v2' })).hasKey, true, 'same server keeps the key');
  assert.equal((await ai.upsert({ id: c.id, name: 'A', type: 'openai', baseUrl: 'https://other.test/v1' })).hasKey, false, 'another server drops the key');
  await fs.rm(folder, { recursive: true, force: true });
});
