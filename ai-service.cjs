// AI collaboration (0.9.1): model connections, streaming chat and tool calling.
// Runs in the main process so API keys never reach the renderer and requests are made only to
// endpoints the user configured. Three wire protocols cover most services:
//   openai    – OpenAI-compatible /chat/completions (OpenAI, DeepSeek, Qwen, Kimi, GLM, SiliconFlow,
//               OpenRouter, Groq, LM Studio, vLLM, one-api / new-api gateways …)
//   ollama    – local Ollama (model list from /api/tags, chat through its OpenAI-compatible /v1)
//   anthropic – Anthropic Messages API
// Feature set studied from Open WebUI (multiple OpenAI-compatible / Ollama connections, model
// picker, streaming, regenerate, prompts, document context, OpenAPI tool servers); independently
// implemented, no Open WebUI code is included.
const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID, randomBytes } = require('node:crypto');

const PRESETS = [
  { id: 'openai', name: 'OpenAI', type: 'openai', baseUrl: 'https://api.openai.com/v1', needsKey: true },
  { id: 'deepseek', name: 'DeepSeek', type: 'openai', baseUrl: 'https://api.deepseek.com/v1', needsKey: true },
  { id: 'qwen', name: '通义千问（阿里云百炼）', type: 'openai', baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', needsKey: true },
  { id: 'moonshot', name: 'Kimi（Moonshot）', type: 'openai', baseUrl: 'https://api.moonshot.cn/v1', needsKey: true },
  { id: 'zhipu', name: '智谱 GLM', type: 'openai', baseUrl: 'https://open.bigmodel.cn/api/paas/v4', needsKey: true },
  { id: 'siliconflow', name: 'SiliconFlow', type: 'openai', baseUrl: 'https://api.siliconflow.cn/v1', needsKey: true },
  { id: 'openrouter', name: 'OpenRouter', type: 'openai', baseUrl: 'https://openrouter.ai/api/v1', needsKey: true },
  { id: 'anthropic', name: 'Anthropic Claude', type: 'anthropic', baseUrl: 'https://api.anthropic.com', needsKey: true },
  { id: 'ollama', name: 'Ollama（本机）', type: 'ollama', baseUrl: 'http://127.0.0.1:11434', needsKey: false },
  { id: 'lmstudio', name: 'LM Studio（本机）', type: 'openai', baseUrl: 'http://127.0.0.1:1234/v1', needsKey: false },
  { id: 'custom', name: '自定义 OpenAI 兼容接口', type: 'openai', baseUrl: '', needsKey: false },
];
const TYPES = ['openai', 'ollama', 'anthropic'];
const DEFAULTS = { connectionId: '', model: '', temperature: 0.7, maxTokens: 4096, systemPrompt: '', contextChars: 12000, tools: true, confirmEdits: true };
const SERVER_DEFAULTS = { enabled: false, port: 17654, token: '', allowEdits: false };

// ——— helpers ———
const trimUrl = url => String(url || '').trim().replace(/\/+$/, '');
// Anthropic and Ollama paths are added below; tolerate addresses pasted with a trailing /v1.
const rootUrl = conn => (conn.type === 'anthropic' || conn.type === 'ollama' ? conn.baseUrl.replace(/\/v1$/, '') : conn.baseUrl);
const str = (v, max = 4000) => (typeof v === 'string' ? v : v == null ? '' : String(v)).slice(0, max);
function validUrl(url) {
  let u; try { u = new URL(url); } catch { throw new Error('接口地址无效：' + url); }
  if (!/^https?:$/.test(u.protocol)) throw new Error('接口地址必须以 http:// 或 https:// 开头。');
  return trimUrl(u.href);
}
function friendlyHttpError(status, body) {
  let detail = '';
  try { const j = JSON.parse(body); detail = j.error?.message || j.error?.type || j.message || j.detail || ''; if (typeof detail !== 'string') detail = JSON.stringify(detail); } catch { detail = String(body || '').slice(0, 300); }
  const hint = status === 401 || status === 403 ? 'API Key 无效或没有权限' : status === 404 ? '接口地址或模型不存在' : status === 429 ? '请求过于频繁或额度不足' : status >= 500 ? '服务端错误' : '请求失败';
  const error = new Error(`${hint}（HTTP ${status}）${detail ? '：' + detail.slice(0, 300) : ''}`); error.status = status; return error;
}

// Server-sent events: yields the data payload of each event ("[DONE]" included).
async function* sseEvents(body) {
  const reader = body.getReader(), decoder = new TextDecoder();
  let buffer = '';
  try { for (;;) {
    const { value, done } = await reader.read();
    if (value) buffer += decoder.decode(value, { stream: true });
    let cut;
    while ((cut = buffer.search(/\r?\n\r?\n/)) >= 0) {
      const block = buffer.slice(0, cut); buffer = buffer.slice(cut).replace(/^\r?\n\r?\n/, '');
      const data = block.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).replace(/^ /, '')).join('\n');
      if (data) yield data;
    }
    if (done) { const data = buffer.split(/\r?\n/).filter(l => l.startsWith('data:')).map(l => l.slice(5).trim()).join('\n'); if (data) yield data; return; }
  } } finally { reader.cancel().catch(() => {}); }
}

// ——— request builders (pure, unit tested) ———
function toOpenAIMessages(messages) {
  return messages.map(m => {
    if (m.role === 'tool') return { role: 'tool', tool_call_id: m.toolCallId, content: str(m.content, 200000) };
    if (m.role === 'assistant' && m.toolCalls?.length) return { role: 'assistant', content: m.content || null, tool_calls: m.toolCalls.map(c => ({ id: c.id, type: 'function', function: { name: c.name, arguments: typeof c.arguments === 'string' ? c.arguments : JSON.stringify(c.arguments || {}) } })) };
    return { role: m.role, content: str(m.content, 400000) };
  });
}
function toAnthropic(messages) {
  const system = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
  const out = [];
  for (const m of messages) {
    if (m.role === 'system') continue;
    if (m.role === 'tool') {
      const block = { type: 'tool_result', tool_use_id: m.toolCallId, content: str(m.content, 200000) };
      const last = out.at(-1);
      if (last?.role === 'user' && Array.isArray(last.content) && last.content.every(b => b.type === 'tool_result')) last.content.push(block); else out.push({ role: 'user', content: [block] });
      continue;
    }
    if (m.role === 'assistant' && m.toolCalls?.length) {
      const content = []; if (m.content) content.push({ type: 'text', text: m.content });
      for (const c of m.toolCalls) content.push({ type: 'tool_use', id: c.id, name: c.name, input: typeof c.arguments === 'string' ? safeJson(c.arguments) : c.arguments || {} });
      out.push({ role: 'assistant', content }); continue;
    }
    const last = out.at(-1);
    if (last && last.role === m.role && typeof last.content === 'string') last.content += '\n\n' + m.content; // Anthropic requires alternating roles
    else out.push({ role: m.role, content: str(m.content, 400000) });
  }
  return { system, messages: out };
}
const safeJson = text => { try { return JSON.parse(text || '{}'); } catch { return {}; } };
const openAITools = tools => tools.map(t => ({ type: 'function', function: { name: t.name, description: t.description, parameters: t.parameters } }));
const anthropicTools = tools => tools.map(t => ({ name: t.name, description: t.description, input_schema: t.parameters }));

function buildRequest(conn, key, { model, messages, tools = [], temperature, maxTokens, stream = true, toolChoice }) {
  const t = Number.isFinite(temperature) ? Math.max(0, Math.min(2, temperature)) : undefined;
  if (conn.type === 'anthropic') {
    const { system, messages: msgs } = toAnthropic(messages);
    const body = { model, max_tokens: Math.max(16, Math.min(64000, maxTokens || 4096)), messages: msgs, stream };
    if (system) body.system = system; if (t !== undefined) body.temperature = Math.min(1, t); if (tools.length) { body.tools = anthropicTools(tools); if (toolChoice === 'none') body.tool_choice = { type: 'none' }; }
    return { url: rootUrl(conn) + '/v1/messages', headers: { 'content-type': 'application/json', 'x-api-key': key || '', 'anthropic-version': '2023-06-01' }, body };
  }
  const base = conn.type === 'ollama' ? rootUrl(conn) + '/v1' : conn.baseUrl;
  const body = { model, messages: toOpenAIMessages(messages), stream };
  if (t !== undefined) body.temperature = t; if (maxTokens) body.max_tokens = maxTokens; if (tools.length) { body.tools = openAITools(tools); if (toolChoice === 'none') body.tool_choice = 'none'; }
  const headers = { 'content-type': 'application/json' }; if (key) headers.authorization = 'Bearer ' + key;
  if (conn.baseUrl.includes('openrouter.ai')) { headers['HTTP-Referer'] = 'https://github.com/qingye-pdf'; headers['X-Title'] = 'Qingye PDF'; }
  return { url: base + '/chat/completions', headers, body };
}

// Accumulate a streamed reply into { content, toolCalls, finish, usage }.
async function readStream(type, body, onDelta) {
  let content = '', finish = '', usage = null, lastKey = null;
  const calls = new Map(), indexKey = new Map(), byId = new Map();
  for await (const data of sseEvents(body)) {
    if (data === '[DONE]') break;
    const ev = safeJson(data);
    if (ev.error) throw new Error(typeof ev.error === 'string' ? ev.error : ev.error.message || JSON.stringify(ev.error));
    if (type === 'anthropic') {
      if (ev.type === 'content_block_start' && ev.content_block?.type === 'tool_use') calls.set(ev.index, { id: ev.content_block.id, name: ev.content_block.name, arguments: '' });
      else if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta') { content += ev.delta.text; onDelta?.(ev.delta.text); }
      else if (ev.type === 'content_block_delta' && ev.delta?.type === 'input_json_delta') { const c = calls.get(ev.index); if (c) c.arguments += ev.delta.partial_json || ''; }
      else if (ev.type === 'message_delta') { finish = ev.delta?.stop_reason || finish; if (ev.usage) usage = { ...usage, ...ev.usage }; }
      else if (ev.type === 'message_start' && ev.message?.usage) usage = { ...ev.message.usage };
      continue;
    }
    const choice = ev.choices?.[0]; if (ev.usage) usage = ev.usage;
    if (!choice) continue;
    const d = choice.delta || choice.message || {};
    const text = d.content ?? '';
    if (text) { content += text; onDelta?.(text); }
    const reasoning = d.reasoning_content || d.reasoning; if (reasoning) onDelta?.('', reasoning);
    for (const tc of d.tool_calls || []) {
      // Providers differ: most send index + id once then argument fragments; some repeat index 0 for
      // parallel calls (a new id starts a new call), omit index (continue the last call) or repeat the name.
      let key = tc.index != null ? indexKey.get(tc.index) ?? tc.index : tc.id ? byId.get(tc.id) ?? tc.id : lastKey ?? 0;
      const existing = calls.get(key);
      if (existing && tc.id && existing.id && tc.id !== existing.id) { key = byId.get(tc.id) ?? 'call#' + calls.size; if (tc.index != null) indexKey.set(tc.index, key); }
      if (tc.id) byId.set(tc.id, key);
      const c = calls.get(key) || { id: '', name: '', arguments: '' };
      if (tc.id) c.id = tc.id;
      const name = tc.function?.name; if (name && !c.name.endsWith(name)) c.name = name.startsWith(c.name) ? name : c.name + name;
      if (tc.function?.arguments) c.arguments += typeof tc.function.arguments === 'string' ? tc.function.arguments : JSON.stringify(tc.function.arguments);
      calls.set(key, c); lastKey = key;
    }
    if (choice.finish_reason) finish = choice.finish_reason;
  }
  const toolCalls = [...calls.values()].filter(c => c.name).map(c => ({ id: c.id || 'call_' + randomUUID().slice(0, 8), name: c.name, arguments: safeJson(c.arguments) }));
  return { content, toolCalls, finish, usage };
}

// ——— import: Qingye export, Open WebUI config, plain JSON objects, env-style text ———
function parseImport(text) {
  const src = String(text || '').trim(); if (!src) throw new Error('没有可导入的内容。');
  const found = [];
  const add = (c, name) => { const baseUrl = trimUrl(c.baseUrl || c.base_url || c.api_base || c.apiBase || c.url || c.endpoint || ''); if (!baseUrl) return; found.push({ name: str(c.name || name || '', 80), type: TYPES.includes(c.type) ? c.type : guessType(baseUrl), baseUrl, apiKey: str(c.apiKey || c.api_key || c.key || c.token || '', 500), models: Array.isArray(c.models) ? c.models.map(m => str(m?.id || m, 200)).filter(Boolean).slice(0, 500) : c.model ? [str(c.model, 200)] : [] }); };
  let data = null; try { data = JSON.parse(src); } catch {}
  if (data && typeof data === 'object') {
    if (Array.isArray(data)) data.forEach(c => c && add(c));
    else if (Array.isArray(data.connections)) data.connections.forEach(c => c && add(c));
    else if (data.openai || data.ollama) { // Open WebUI config export
      const o = data.openai || {}, urls = o.api_base_urls || o.OPENAI_API_BASE_URLS || [], keys = o.api_keys || o.OPENAI_API_KEYS || [];
      urls.forEach((u, i) => add({ baseUrl: u, apiKey: keys[i] || '', type: 'openai' }, 'Open WebUI ' + (i + 1)));
      (data.ollama?.base_urls || data.ollama?.OLLAMA_BASE_URLS || []).forEach((u, i) => add({ baseUrl: u, type: 'ollama' }, 'Ollama ' + (i + 1)));
    } else add(data);
  } else {
    const env = Object.fromEntries(src.split(/\r?\n/).map(l => l.replace(/^\s*(export|set)\s+/i, '').match(/^\s*([A-Z0-9_]+)\s*[=:]\s*"?([^"\s]+)"?/)).filter(Boolean).map(m => [m[1], m[2]]));
    if (env.OPENAI_API_KEY || env.OPENAI_BASE_URL || env.OPENAI_API_BASE) add({ baseUrl: env.OPENAI_BASE_URL || env.OPENAI_API_BASE || 'https://api.openai.com/v1', apiKey: env.OPENAI_API_KEY || '', type: 'openai', model: env.OPENAI_MODEL }, 'OpenAI');
    if (env.DEEPSEEK_API_KEY) add({ baseUrl: 'https://api.deepseek.com/v1', apiKey: env.DEEPSEEK_API_KEY, type: 'openai' }, 'DeepSeek');
    if (env.ANTHROPIC_API_KEY) add({ baseUrl: env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com', apiKey: env.ANTHROPIC_API_KEY, type: 'anthropic', model: env.ANTHROPIC_MODEL }, 'Anthropic');
    if (env.OLLAMA_HOST || env.OLLAMA_BASE_URL) add({ baseUrl: /^https?:/.test(env.OLLAMA_BASE_URL || env.OLLAMA_HOST) ? env.OLLAMA_BASE_URL || env.OLLAMA_HOST : 'http://' + (env.OLLAMA_HOST || '127.0.0.1:11434'), type: 'ollama' }, 'Ollama');
    const bare = src.match(/^(https?:\/\/\S+)(?:\s+(\S+))?$/); if (!found.length && bare) add({ baseUrl: bare[1], apiKey: bare[2] || '' });
  }
  if (!found.length) throw new Error('没有识别到 API 配置。支持青页导出的 JSON、Open WebUI 的配置导出、{"base_url","api_key"} 形式的 JSON，以及 OPENAI_API_KEY / OPENAI_BASE_URL 等环境变量写法。');
  return found.slice(0, 50);
}
function guessType(url) { return /anthropic\.com/.test(url) ? 'anthropic' : /:11434\b/.test(url) ? 'ollama' : 'openai'; }

// ——— service ———
function createAiService({ folder, fetchImpl = globalThis.fetch, encrypt = s => 'plain:' + s, decrypt = s => s.startsWith('plain:') ? s.slice(6) : '' }) {
  const file = path.join(folder, 'ai-config.json');
  let config = null;
  const jobs = new Map(), canceledEarly = new Set();
  let loading = null;
  function load() { return config ? Promise.resolve(config) : (loading ||= read()); }
  async function read() {
    let data; try { data = JSON.parse(await fs.readFile(file, 'utf8')); } catch { data = null; }
    config = data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    config.connections = Array.isArray(config.connections) ? config.connections : [];
    config.defaults = { ...DEFAULTS, ...(config.defaults || {}) };
    config.server = { ...SERVER_DEFAULTS, ...(config.server || {}) };
    config.prompts = Array.isArray(config.prompts) ? config.prompts : null;
    return config;
  }
  // Saves are serialized (settings, model lists and the interface can change at the same time);
  // each writes a unique temporary file and renames it into place.
  let saving = Promise.resolve();
  function save() {
    const run = async () => { await fs.mkdir(folder, { recursive: true }); const tmp = `${file}.${process.pid}.${randomUUID()}.tmp`; await fs.writeFile(tmp, JSON.stringify(config, null, 2)); await fs.rename(tmp, file); };
    const next = saving.then(run, run); saving = next.catch(() => {}); return next;
  }
  const keyOf = c => (c.key ? decrypt(c.key) : '');
  const view = c => ({ id: c.id, name: c.name, type: c.type, baseUrl: c.baseUrl, hasKey: !!c.key, keyHint: c.key ? mask(keyOf(c)) : '', models: c.models || [], enabled: c.enabled !== false, updated: c.updated || 0, error: c.error || '' });
  const mask = k => (k.length > 10 ? k.slice(0, 3) + '…' + k.slice(-4) : k ? '••••' : '');
  function findConn(id) { const c = config.connections.find(x => x.id === id); if (!c) throw new Error('AI 连接不存在，请在设置中重新选择。'); return c; }

  async function state() {
    await load();
    return { connections: config.connections.map(view), defaults: config.defaults, server: { ...config.server, token: config.server.token ? config.server.token : '' }, prompts: config.prompts, presets: PRESETS };
  }
  async function upsert(input) {
    await load();
    const type = TYPES.includes(input.type) ? input.type : 'openai';
    const baseUrl = validUrl(input.baseUrl || PRESETS.find(p => p.type === type)?.baseUrl);
    let c = input.id ? config.connections.find(x => x.id === input.id) : null;
    if (!c) { c = { id: randomUUID(), created: Date.now() }; config.connections.push(c); }
    // A saved key never follows a connection to a different server.
    if (c.key && (c.type !== type || new URL(c.baseUrl).origin !== new URL(baseUrl).origin)) delete c.key;
    Object.assign(c, { name: str(input.name, 80).trim() || new URL(baseUrl).host, type, baseUrl, enabled: input.enabled !== false, updated: Date.now() });
    if (typeof input.apiKey === 'string' && input.apiKey !== '') c.key = encrypt(input.apiKey.trim());
    if (input.clearKey) delete c.key;
    if (Array.isArray(input.models)) c.models = input.models.map(m => str(m, 200)).filter(Boolean).slice(0, 500);
    if (!config.defaults.connectionId) config.defaults.connectionId = c.id;
    await save(); return view(c);
  }
  async function remove(id) { await load(); config.connections = config.connections.filter(c => c.id !== id); if (config.defaults.connectionId === id) { config.defaults.connectionId = config.connections[0]?.id || ''; config.defaults.model = ''; } await save(); return true; }
  async function setDefaults(values) {
    await load(); const d = config.defaults;
    if (typeof values.connectionId === 'string') d.connectionId = values.connectionId;
    if (typeof values.model === 'string') d.model = str(values.model, 200);
    if (Number.isFinite(values.temperature)) d.temperature = Math.max(0, Math.min(2, values.temperature));
    if (Number.isFinite(values.maxTokens)) d.maxTokens = Math.max(64, Math.min(64000, Math.round(values.maxTokens)));
    if (Number.isFinite(values.contextChars)) d.contextChars = Math.max(1000, Math.min(200000, Math.round(values.contextChars)));
    if (typeof values.systemPrompt === 'string') d.systemPrompt = str(values.systemPrompt, 8000);
    if (typeof values.tools === 'boolean') d.tools = values.tools;
    if (typeof values.confirmEdits === 'boolean') d.confirmEdits = values.confirmEdits;
    await save(); return d;
  }
  async function setPrompts(prompts) { await load(); config.prompts = Array.isArray(prompts) ? prompts.slice(0, 100).map(p => ({ id: str(p.id || randomUUID(), 64), title: str(p.title, 60), command: str(p.command, 40).replace(/[^\w一-鿿-]/g, ''), text: str(p.text, 4000) })).filter(p => p.title && p.text) : null; await save(); return config.prompts; }

  async function listModels(id) {
    await load(); const c = findConn(id), key = keyOf(c);
    const url = c.type === 'ollama' ? rootUrl(c) + '/api/tags' : c.type === 'anthropic' ? rootUrl(c) + '/v1/models?limit=100' : c.baseUrl + '/models';
    const headers = c.type === 'anthropic' ? { 'x-api-key': key, 'anthropic-version': '2023-06-01' } : key ? { authorization: 'Bearer ' + key } : {};
    let response;
    try { response = await fetchImpl(url, { headers, signal: AbortSignal.timeout(20000) }); }
    catch (error) { c.error = '无法连接：' + (error.cause?.code || error.message); await save(); throw new Error(c.error); }
    const body = await response.text();
    if (!response.ok) { const e = friendlyHttpError(response.status, body); c.error = e.message; await save(); throw e; }
    const data = safeJson(body);
    const models = (c.type === 'ollama' ? (data.models || []).map(m => m.name || m.model) : (data.data || data.models || []).map(m => m.id || m.name)).filter(Boolean).sort();
    c.models = models.slice(0, 500); c.error = ''; c.updated = Date.now(); await save();
    return view(c);
  }

  // One model turn. Streams text through onDelta; returns the final message (with tool calls, if any).
  async function chat(jobId, { connectionId, model, messages, tools, temperature, maxTokens, toolChoice }, onDelta) {
    await load();
    const c = findConn(connectionId || config.defaults.connectionId);
    const m = model || config.defaults.model || c.models?.[0];
    if (!m) throw new Error('请先选择模型（设置 → AI 协作 → 获取模型列表）。');
    if (!Array.isArray(messages) || !messages.length) throw new Error('没有消息。');
    const req = buildRequest(c, keyOf(c), { model: m, messages, tools: Array.isArray(tools) ? tools : [], temperature: temperature ?? config.defaults.temperature, maxTokens: maxTokens ?? config.defaults.maxTokens, toolChoice: toolChoice === 'none' ? 'none' : undefined });
    const controller = new AbortController(); jobs.set(jobId, controller);
    if (canceledEarly.delete(jobId)) controller.abort();
    try {
      let response;
      try { response = await fetchImpl(req.url, { method: 'POST', headers: req.headers, body: JSON.stringify(req.body), signal: controller.signal }); }
      catch (error) { if (controller.signal.aborted) throw Object.assign(new Error('已停止'), { canceled: true }); throw new Error('无法连接到 ' + new URL(req.url).host + '：' + (error.cause?.code || error.message)); }
      if (!response.ok) throw friendlyHttpError(response.status, await response.text());
      if (!/event-stream/.test(response.headers.get('content-type') || '')) { // some gateways ignore stream:true or mislabel the stream
        const raw = await response.text();
        if (/^\s*(data|event):/.test(raw)) return { ...(await readStream(c.type, new Response(raw).body, onDelta)), model: m };
        const data = safeJson(raw);
        if (c.type === 'anthropic') { const text = (data.content || []).filter(b => b.type === 'text').map(b => b.text).join(''); onDelta?.(text); return { content: text, toolCalls: (data.content || []).filter(b => b.type === 'tool_use').map(b => ({ id: b.id, name: b.name, arguments: b.input || {} })), finish: data.stop_reason, usage: data.usage, model: m }; }
        const msg = data.choices?.[0]?.message || {}; onDelta?.(msg.content || '');
        return { content: msg.content || '', toolCalls: (msg.tool_calls || []).map(t => ({ id: t.id, name: t.function?.name, arguments: safeJson(t.function?.arguments) })), finish: data.choices?.[0]?.finish_reason, usage: data.usage, model: m };
      }
      try { return { ...(await readStream(c.type, response.body, onDelta)), model: m }; }
      catch (error) { if (controller.signal.aborted) throw Object.assign(new Error('已停止'), { canceled: true }); throw error; }
    } finally { jobs.delete(jobId); }
  }
  const cancel = jobId => { const c = jobs.get(jobId); if (c) c.abort(); else { canceledEarly.add(jobId); setTimeout(() => canceledEarly.delete(jobId), 60000).unref?.(); } return true; };

  function exportConfig(includeKeys) {
    return { qingye: 'ai-connections', version: 1, exported: new Date().toISOString(), connections: config.connections.map(c => ({ name: c.name, type: c.type, baseUrl: c.baseUrl, models: c.models || [], ...(includeKeys && c.key ? { apiKey: keyOf(c) } : {}) })), defaults: { ...config.defaults, connectionId: undefined } };
  }
  async function importConfig(text) {
    await load(); const list = parseImport(text); const added = [];
    for (const item of list) {
      const same = config.connections.find(c => c.baseUrl === item.baseUrl && c.type === item.type);
      added.push(await upsert({ ...item, id: same?.id, name: item.name || same?.name }));
    }
    return { added: added.length, connections: config.connections.map(view) };
  }

  async function serverConfig(values) {
    await load(); const s = config.server;
    if (values) {
      if (typeof values.enabled === 'boolean') s.enabled = values.enabled;
      if (Number.isInteger(values.port) && values.port >= 1024 && values.port <= 65535) s.port = values.port;
      if (typeof values.allowEdits === 'boolean') s.allowEdits = values.allowEdits;
      if (values.regenerateToken) s.token = '';
    }
    if (!s.token) s.token = 'qy_' + randomBytes(24).toString('base64url');
    await save(); return { ...s };
  }
  return { load, state, upsert, remove, setDefaults, setPrompts, listModels, chat, cancel, exportConfig: async k => { await load(); return exportConfig(k); }, importConfig, serverConfig, PRESETS };
}

module.exports = { createAiService, parseImport, buildRequest, readStream, sseEvents, toAnthropic, toOpenAIMessages, PRESETS, friendlyHttpError };
