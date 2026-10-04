// AI collaboration panel (0.9.1): a chat docked on the right of PDF and Markdown documents.
// Ideas taken from Open WebUI's chat (model picker, streaming, stop/regenerate, "/" prompt presets,
// tool calls shown inline, chat history), rebuilt for a document-centred desktop app. The model
// reads the open document through the tools in ui/ai/tools.json; API keys never reach this page.
import { t, tf, onChange as onLanguage } from '../i18n/i18n.mjs';
import { userError } from '../errors.mjs';
import { findReference } from './references.mjs';
import { lineDiff } from './diff.mjs';

const CHATS_KEY = 'qingye.ai.chats', WIDTH_KEY = 'qingye.ai.width', OPEN_KEY = 'qingye.ai.open';
const MAX_ROUNDS = 6, MAX_CHATS = 60, TOOL_RESULT_CHARS = 24000;
export const DEFAULT_PROMPTS = [
  { id: 'summary', command: 'summary', title: '总结文档', text: '用要点总结当前文档的主要内容，并注明对应的页码或章节。' },
  { id: 'explain', command: 'explain', title: '解释选中内容', text: '解释我选中的内容，必要时结合上下文。' },
  { id: 'translate', command: 'translate', title: '翻译选中内容', text: '把选中的内容翻译成中文；如果原文是中文，就翻译成英文。保留原有格式。' },
  { id: 'polish', command: 'polish', title: '润色选中内容', text: '润色选中的文字，使表达更清晰流畅，保持原意，只输出修改后的版本。' },
  { id: 'outline', command: 'outline', title: '整理大纲', text: '把当前文档整理成一份层级清晰的 Markdown 大纲。' },
  { id: 'quiz', command: 'quiz', title: '出几道题', text: '根据文档内容出 5 道理解题，并在最后附上答案。' },
  { id: 'continue', command: 'continue', title: '续写', text: '根据上下文续写当前 Markdown 文档的下一段，风格保持一致。' },
];
const SUGGEST = { pdf: ['summary', 'outline', 'explain', 'quiz'], md: ['polish', 'continue', 'outline', 'translate'] };

const readJson = (key, fallback) => { try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch { return fallback; } };
const writeJson = (key, value) => { try { localStorage.setItem(key, JSON.stringify(value)); } catch {} };
const uid = () => Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
const iconButton = (icon, title, cls = '') => { const b = el('button', 'iconOnly ' + cls); b.type = 'button'; b.dataset.icon = icon; b.title = title; b.setAttribute('aria-label', title); return b; };

export function createAiPanel({ api, guard, status, tools, current, openSettings, partner = () => null }) {
  let state = null, chats = readJson(CHATS_KEY, []), chat = null, job = null, busy = false, toolDefs = [], runCanceled = false;
  const noTools = new Set(); // connection|model pairs that rejected function calling
  const parser = import('../markdown/parser.mjs');
  const definitionsReady = fetch(new URL('./tools.json', import.meta.url)).then(r => r.json()).then(j => { toolDefs = j.tools.map(({ name, description, parameters }) => ({ name, description, parameters })); }).catch(console.warn);

  // ——— DOM ———
  const panel = el('aside'); panel.id = 'aiPanel'; panel.setAttribute('aria-label', 'AI 协作');
  panel.innerHTML = `
    <div class="aiResize" role="separator" aria-orientation="vertical" aria-label="调整 AI 面板宽度" tabindex="0"></div>
    <header class="aiHead">
      <span class="aiTitle" data-icon="sparkle">AI 协作</span>
      <select class="aiModel" aria-label="模型" title="选择模型"></select>
      <span class="spacer"></span>
    </header>
    <div class="aiHistory" hidden><div class="aiHistoryHead"><b>历史对话</b><button type="button" class="linkButton aiClearHistory">全部清除</button></div><ul class="aiHistoryList"></ul></div>
    <div class="aiLog" role="log" aria-live="polite"></div>
    <div class="aiEmpty"></div>
    <footer class="aiComposer">
      <div class="aiPresetMenu" role="listbox" hidden></div>
      <div class="aiContext"><button type="button" class="aiContextChip" aria-pressed="true"></button><span class="aiContextChip aiContextPair" hidden></span><span class="aiToolsNote"></span></div>
      <div class="aiInputRow">
        <textarea class="aiInput" rows="1" aria-label="输入消息"></textarea>
        <button type="button" class="aiSend primary iconOnly" data-icon="send" title="发送 · Enter" aria-label="发送"></button>
      </div>
      <p class="aiDisclaimer">Enter 发送 · Shift+Enter 换行 · AI 的回答可能出错，请核对重要信息。</p>
    </footer>`;
  const $ = s => panel.querySelector(s);
  const head = $('.aiHead'), log = $('.aiLog'), empty = $('.aiEmpty'), input = $('.aiInput'), sendButton = $('.aiSend'), modelSelect = $('.aiModel');
  // The translator skips <textarea>, so its placeholder is set here and on language changes.
  const placeholder = () => { input.placeholder = t('问问这份文档，或输入 / 选择预设'); };
  const contextChip = $('.aiContextChip'), toolsNote = $('.aiToolsNote'), presetMenu = $('.aiPresetMenu'), historyBox = $('.aiHistory');
  const newButton = iconButton('plus', '新对话'), historyButton = iconButton('history', '历史对话'), settingsButton = iconButton('settings', 'AI 设置'), closeButton = iconButton('x', '关闭 AI 面板 · Ctrl+Shift+A');
  head.append(newButton, historyButton, settingsButton, closeButton);
  document.getElementById('workspace').append(panel);
  placeholder();
  onLanguage(() => { placeholder(); if (isOpen()) { renderAll(); syncContext(); } });

  const confirmDialog = el('dialog'); confirmDialog.id = 'aiConfirm'; confirmDialog.setAttribute('aria-labelledby', 'aiConfirmTitle');
  confirmDialog.innerHTML = `<h2 id="aiConfirmTitle"></h2><p class="aiConfirmMeta"></p><div class="aiConfirmPreview"></div><p class="aiConfirmNote">修改不会自动保存，可以用 Ctrl+Z 撤销。</p><div class="cropActions"><span class="aiConfirmSource"></span><div class="spacer"></div><button type="button" value="no" class="aiConfirmNo">拒绝</button><button type="button" value="yes" class="primary aiConfirmYes">接受修改</button></div>`;
  document.body.append(confirmDialog);
  let confirmQueue = Promise.resolve(), apiWaiting = 0;
  const API_CONFIRM_MS = 170000; // shorter than the bridge timeout in ai-ipc.cjs (180 s)
  function confirm({ title, doc, action, preview, before = '', after = preview || '', source }) {
    // External programs cannot pile up dialogs, and an answer after the caller gave up is never applied.
    if (source === 'api' && apiWaiting >= 3) return Promise.resolve(false);
    const deadline = source === 'api' ? Date.now() + API_CONFIRM_MS : Infinity;
    if (source === 'api') apiWaiting++;
    const ask = () => new Promise(resolve => {
      if (Date.now() >= deadline) { resolve(false); return; }
      confirmDialog.querySelector('h2').textContent = t(title);
      confirmDialog.querySelector('.aiConfirmMeta').textContent = `${t(action)} · ${doc}`;
      const view=confirmDialog.querySelector('.aiConfirmPreview');view.replaceChildren();
      const left=el('section','aiDiffColumn'),right=el('section','aiDiffColumn');left.append(el('b','',t('原文')));right.append(el('b','',t('修改后')));
      const old=String(before),updated=String(after),ops=lineDiff(old.slice(0,30000),updated.slice(0,30000));
      const oldText=el('pre'),newText=el('pre');
      for(const op of ops){if(op.type!=='added')oldText.append(el('span','aiDiffLine '+(op.type==='removed'?'aiDiffRemoved':''),op.text+'\n'));if(op.type!=='removed')newText.append(el('span','aiDiffLine '+(op.type==='added'?'aiDiffAdded':''),op.text+'\n'));}
      left.append(oldText);right.append(newText);view.append(left,right);
      if(old.length>30000||updated.length>30000)view.append(el('p','',t('预览已截断，请确认完整内容后再接受修改。')));
      confirmDialog.querySelector('.aiConfirmSource').textContent = source === 'api' ? t('来自：本地 AI 接口（外部程序）') : t('来自：AI 协作面板');
      const timer = deadline < Infinity ? setTimeout(() => done(false), deadline - Date.now()) : 0;
      const done = ok => { clearTimeout(timer); if (confirmDialog.open) confirmDialog.close(); resolve(ok && Date.now() < deadline); };
      confirmDialog.querySelector('.aiConfirmYes').onclick = () => done(true);
      confirmDialog.querySelector('.aiConfirmNo').onclick = () => done(false);
      confirmDialog.oncancel = e => { e.preventDefault(); done(false); };
      confirmDialog.showModal(); confirmDialog.querySelector('.aiConfirmNo').focus();
    });
    const result = confirmQueue.then(ask).finally(() => { if (source === 'api') apiWaiting--; }); confirmQueue = result.catch(() => {}); return result;
  }
  tools.setConfirm?.(confirm);

  // ——— open / close / width ———
  const isOpen = () => document.body.classList.contains('aiOpen');
  const setWidth = w => { w = Math.max(300, Math.min(760, Math.round(w) || 380)); document.body.style.setProperty('--ai-w', w + 'px'); return w; };
  setWidth(readJson(WIDTH_KEY, 380));
  function setOpen(open, { focus = true } = {}) {
    document.body.classList.toggle('aiOpen', open); writeJson(OPEN_KEY, open);
    syncButtons(); window.dispatchEvent(new Event('resize'));
    if (open) { refresh().catch(console.warn); syncContext(); if (focus) requestAnimationFrame(() => input.focus()); }
  }
  const toggle = () => setOpen(!isOpen());
  function syncButtons() {
    for (const b of document.querySelectorAll('.aiToggle')) b.setAttribute('aria-pressed', String(isOpen()));
  }
  const resize = $('.aiResize');
  resize.addEventListener('pointerdown', e => {
    e.preventDefault(); resize.setPointerCapture(e.pointerId); document.body.classList.add('aiResizing');
    const right = panel.getBoundingClientRect().right;
    const move = ev => setWidth(right - ev.clientX);
    const up = () => { resize.removeEventListener('pointermove', move); document.body.classList.remove('aiResizing'); writeJson(WIDTH_KEY, parseInt(getComputedStyle(document.body).getPropertyValue('--ai-w'))); window.dispatchEvent(new Event('resize')); };
    resize.addEventListener('pointermove', move); resize.addEventListener('pointerup', up, { once: true });
  });
  resize.addEventListener('keydown', e => { if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return; e.preventDefault(); const w = setWidth(panel.offsetWidth + (e.key === 'ArrowLeft' ? 24 : -24)); writeJson(WIDTH_KEY, w); });
  closeButton.onclick = () => setOpen(false);
  settingsButton.onclick = () => openSettings('ai');

  // ——— connections and models ———
  const pairKey = (c, m) => c + '\u0001' + m;
  async function refresh() {
    try { state = await api.aiState(); } catch (error) { console.warn('AI state:', error); state = null; }
    state ||= { connections: [], defaults: {}, prompts: null };
    const d = state.defaults, active = state.connections.filter(c => c.enabled);
    modelSelect.replaceChildren();
    for (const c of active) {
      const group = document.createElement('optgroup'); group.label = c.name;
      const models = [...c.models]; if (d.connectionId === c.id && d.model && !models.includes(d.model)) models.unshift(d.model);
      if (!models.length) { const o = new Option(tf('{name}：请在设置中获取模型', { name: c.name }), ''); o.disabled = true; group.append(o); }
      for (const m of models) group.append(new Option(m, pairKey(c.id, m)));
      modelSelect.append(group);
    }
    const want = pairKey(d.connectionId, d.model);
    if ([...modelSelect.options].some(o => o.value === want)) modelSelect.value = want;
    else { const first = [...modelSelect.options].find(o => o.value); if (first) modelSelect.value = first.value; }
    modelSelect.hidden = !active.length;
    renderAll();
  }
  modelSelect.onchange = () => guard(async () => { const [connectionId, model] = modelSelect.value.split('\u0001'); state.defaults = await api.aiDefaults({ connectionId, model }); });
  const selected = () => { const [connectionId, model] = (modelSelect.value || '').split('\u0001'); return connectionId && model ? { connectionId, model } : null; };
  const prompts = () => (state?.prompts?.length ? state.prompts : DEFAULT_PROMPTS);

  // ——— document context ———
  let includeSelection = true, lastSelection = '';
  async function syncContext() {
    const s = current();
    contextChip.hidden = !s?.loaded;
    // Notes mode: the document in the other pane is part of the conversation too.
    const beside = s?.loaded ? partner() : null, pairChip = $('.aiContextPair');
    pairChip.hidden = !beside?.loaded; if (beside?.loaded) { pairChip.textContent = beside.name; pairChip.dataset.icon = tools.isMd(beside) ? 'markdown' : 'file'; pairChip.title = t('笔记模式：AI 可以同时读取另一侧的文档'); }
    if (!s?.loaded) { lastSelection = ''; return; }
    let selection = '';
    try { selection = (await tools.run('get_selection', {}, { source: 'panel' })).selection || ''; } catch {}
    lastSelection = selection.trim();
    const kind = tools.isMd(s) ? 'Markdown' : 'PDF';
    contextChip.textContent = lastSelection ? tf('{name} · 已选 {count} 字', { name: s.name, count: lastSelection.length }) : `${s.name} · ${kind}`;
    contextChip.dataset.icon = tools.isMd(s) ? 'markdown' : 'file';
    contextChip.setAttribute('aria-pressed', String(!!lastSelection && includeSelection));
    contextChip.disabled = !lastSelection;
    contextChip.title = lastSelection ? (includeSelection ? t('发送时附带选中内容（单击取消）') : t('不附带选中内容（单击附带）')) : t('AI 可以通过工具读取当前文档');
    const sel = selected();
    toolsNote.textContent = sel && (noTools.has(pairKey(sel.connectionId, sel.model)) || state?.defaults?.tools === false) ? t('文档工具已关闭：只发送文档开头的部分内容') : '';
  }
  contextChip.onclick = () => { includeSelection = !includeSelection; syncContext(); };
  input.addEventListener('focus', syncContext);
  panel.addEventListener('pointerenter', syncContext);

  // ——— chats ———
  const saveChats = () => { chats = chats.filter(c => c.messages.length).sort((a, b) => b.updated - a.updated).slice(0, MAX_CHATS); writeJson(CHATS_KEY, chats); };
  function newChat() { if (busy) stop(); chat = null; historyBox.hidden = true; renderAll(); input.focus(); }
  newButton.onclick = newChat;
  historyButton.onclick = () => { historyBox.hidden = !historyBox.hidden; historyButton.setAttribute('aria-pressed', String(!historyBox.hidden)); if (!historyBox.hidden) renderHistory(); };
  $('.aiClearHistory').onclick = () => { chats = []; saveChats(); chat = null; renderHistory(); renderAll(); };
  function renderHistory() {
    const list = $('.aiHistoryList');
    list.replaceChildren(...(chats.length ? chats.map(c => {
      const li = el('li'); const open = el('button', 'aiHistoryItem'); open.type = 'button';
      open.append(el('span', 'aiHistoryTitle', c.title || t('新对话')), el('small', '', `${c.doc ? c.doc + ' · ' : ''}${new Date(c.updated).toLocaleString()}`));
      open.onclick = () => { if (busy) stop(); chat = c; historyBox.hidden = true; historyButton.setAttribute('aria-pressed', 'false'); renderAll(); };
      const del = iconButton('trash', '删除这条对话'); del.onclick = () => { chats = chats.filter(x => x !== c); if (chat === c) chat = null; saveChats(); renderHistory(); renderAll(); };
      li.append(open, del); return li;
    }) : [el('li', 'aiHistoryEmpty', t('还没有历史对话'))]));
  }

  // ——— rendering ———
  const nodes = new WeakMap(); // message → { node, body } (kept out of saved history)
  let md = null; parser.then(m => { md = m; if (chat) renderAll(); }).catch(console.warn);
  function markdownInto(node, text) {
    if (!md) { node.textContent = text; return; }
    node.replaceChildren(md.sanitize(md.renderDocumentHtml(text)));
    for (const a of node.querySelectorAll('a[href]')) {
      const href = a.getAttribute('href');
      if (href.startsWith('#qingye-ref-')) {
        a.classList.add('aiCitation');
        if (!findReference(href, chat?.messages || [])) { a.removeAttribute('href'); a.title = t('未找到对应的原文引用'); }
      } else { a.target = '_blank'; a.rel = 'noreferrer'; }
    }
  }
  log.addEventListener('click', event => {
    const anchor = event.target.closest('a.aiCitation'); if (!anchor) return;
    event.preventDefault(); event.stopPropagation();
    const ref = findReference(anchor.getAttribute('href'), chat?.messages || []);
    if (ref) guard(async () => { await tools.followReference(ref); status(tf('已定位原文：{name}', { name: ref.name })); });
  });
  function renderEmpty() {
    const hasConn = !!state?.connections?.some(c => c.enabled), s = current();
    empty.hidden = !!chat?.messages.length; log.hidden = !empty.hidden;
    if (empty.hidden) return;
    empty.replaceChildren();
    const mark = el('div', 'aiEmptyMark'); mark.dataset.icon = 'sparkle'; empty.append(mark);
    if (!hasConn) {
      empty.append(el('h3', '', t('连接一个 AI 模型')), el('p', '', t('支持 OpenAI 兼容接口（DeepSeek、通义千问、Kimi、智谱、硅基流动、OpenRouter 等）、Anthropic 以及本机的 Ollama / LM Studio。也可以直接导入 Open WebUI 的连接配置或 .env 文件。')));
      const row = el('div', 'aiEmptyActions');
      const add = el('button', 'primary', t('添加连接')); add.type = 'button'; add.dataset.icon = 'plus'; add.onclick = () => openSettings('ai');
      const imp = el('button', '', t('导入配置…')); imp.type = 'button'; imp.dataset.icon = 'open'; imp.onclick = () => guard(async () => { const r = await api.aiImportFile(); if (r) { status(tf('已导入 {count} 个 AI 连接', { count: r.added ?? 0 })); await refresh(); } });
      row.append(add, imp); empty.append(row);
      empty.append(el('p', 'aiPrivacy', t('只有在你发送消息时，才会把问题和必要的文档片段发送到你配置的服务；API Key 加密保存在本机。')));
      return;
    }
    empty.append(el('h3', '', s?.loaded ? tf('和「{name}」一起工作', { name: s.name }) : t('打开一个文档开始协作')));
    const list = el('div', 'aiSuggestions');
    const ids = SUGGEST[tools.isMd(s) ? 'md' : 'pdf'];
    for (const p of prompts().filter(p => ids.includes(p.id)).concat(prompts().filter(p => !DEFAULT_PROMPTS.some(d => d.id === p.id))).slice(0, 6)) {
      const b = el('button', 'aiSuggestion'); b.type = 'button'; b.append(el('b', '', t(p.title)), el('small', '', t(p.text)));
      b.onclick = () => send(t(p.text)); list.append(b);
    }
    empty.append(list);
  }
  function renderAll() {
    renderEmpty();
    log.replaceChildren();
    if (!chat) return;
    const results = new Map(chat.messages.filter(m => m.role === 'tool').map(m => [m.toolCallId, m]));
    chat.messages.forEach((m, i) => {
      if (m.role === 'user') log.append(userNode(m));
      else if (m.role === 'assistant') log.append(assistantNode(m, results, i === lastAssistantIndex()));
    });
    if (chat.error) { const e = el('div', 'aiError', chat.error); const retry = el('button', 'linkButton', t('重试')); retry.type = 'button'; retry.onclick = () => regenerate(); e.append(retry); log.append(e); }
    log.scrollTop = log.scrollHeight;
  }
  const lastAssistantIndex = () => { for (let i = chat.messages.length - 1; i >= 0; i--) if (chat.messages[i].role === 'assistant') return i; return -1; };
  function userNode(m) {
    const node = el('div', 'aiMsg aiUser'); const bubble = el('div', 'aiBubble', m.content); node.append(bubble);
    if (m.context) { const c = el('div', 'aiMsgContext', m.context); node.prepend(c); }
    return node;
  }
  function assistantNode(m, results, last) {
    const node = el('div', 'aiMsg aiAssistant');
    if (m.reasoning) { const d = el('details', 'aiReasoning'); d.append(el('summary', '', t('思考过程')), el('div', '', m.reasoning)); node.append(d); }
    for (const call of m.toolCalls || []) node.append(toolChip(call, results.get(call.id)));
    const body = el('div', 'aiBubble mdBody'); markdownInto(body, m.content || ''); if (m.content) node.append(body);
    if (last && !busy && m.content) node.append(actions(m));
    nodes.set(m, { node, body }); return node;
  }
  function toolChip(call, result) {
    const chip = el('div', 'aiTool' + (!result ? ' isRunning' : result.ok === false ? ' isFailed' : ''));
    chip.dataset.icon = !result ? 'tools' : result.ok === false ? 'x' : 'check';
    chip.append(el('span', '', tools.describe(call.name, call.arguments)));
    if (result?.summary) chip.append(el('small', '', Array.isArray(result.summary) ? tf(...result.summary) : result.summary));
    if (result?.references?.length) {
      const details = el('details', 'aiSources'); details.append(el('summary', '', t('查看读取位置')));
      for (const ref of result.references) {
        const a = el('a', 'aiCitation', ref.name + ' · ' + (ref.page ? tf('第 {page} 页', { page: ref.page }) : tf('第 {line} 行', { line: ref.line })));
        a.href = ref.href; a.title = ref.quote; details.append(a);
      }
      if (result.truncated) details.append(el('small', '', t('内容已截断，回答可能未覆盖全文')));
      chip.append(details);
    }
    chip.title = call.name + ' ' + JSON.stringify(call.arguments || {});
    return chip;
  }
  function actions(m) {
    const bar = el('div', 'aiActions'), s = current();
    const add = (icon, label, fn) => { const b = el('button', '', t(label)); b.type = 'button'; b.dataset.icon = icon; b.onclick = () => guard(fn); bar.append(b); return b; };
    add('copy', '复制', async () => { await navigator.clipboard.writeText(m.content); status(t('已复制到剪贴板')); });
    if (tools.isMd(s) && s.loaded) add('replace', '预览并插入文档', async () => {
      const sel = s.editor.currentSelection(), replace = sel.to > sel.from;
      await tools.run('insert_markdown', { document_id: s.id, text: m.content, position: replace ? 'replace_selection' : 'cursor' }, { source: 'panel', confirmEdits: true });
      status(replace ? t('已替换选中内容（Ctrl+Z 可撤销）') : t('已插入到光标处（Ctrl+Z 可撤销）'));
    }).title = t('插入到光标处；有选中内容时替换选中内容');
    add('newdoc', '新建 Markdown', async () => { await tools.run('create_markdown', { content: m.content }, { source: 'panel' }); });
    add('refresh', '重新生成', () => regenerate());
    if (m.model) bar.append(el('small', 'aiModelTag', m.model));
    return bar;
  }
  let frame = 0;
  function renderStreaming(m) {
    if (frame) return;
    frame = requestAnimationFrame(() => {
      frame = 0; const n = nodes.get(m); if (!n) return;
      const nearBottom = log.scrollHeight - log.scrollTop - log.clientHeight < 80;
      if (m.content && !n.body.isConnected) n.node.append(n.body);
      markdownInto(n.body, m.content + ' ▍');
      if (m.reasoning) { let d = n.node.querySelector('.aiReasoning'); if (!d) { d = el('details', 'aiReasoning'); d.open = true; d.append(el('summary', '', t('思考过程')), el('div')); n.node.prepend(d); } d.lastChild.textContent = m.reasoning; }
      if (nearBottom) log.scrollTop = log.scrollHeight;
    });
  }

  // ——— sending ———
  api.onAiEvent?.((id, data) => {
    if (!job || id !== job.id || !job.message) return;
    if (data.delta) job.message.content += data.delta;
    if (data.reasoning) job.message.reasoning = (job.message.reasoning || '') + data.reasoning;
    renderStreaming(job.message);
  });
  function systemPrompt(s, useTools) {
    const lines = [
      'You are the AI collaboration assistant inside Qingye PDF, a local desktop PDF reader and Markdown editor.',
      'Reply in the language the user writes in. Use Markdown for formatting.',
      'Document tool results include references with href fields. Cite evidence using Markdown links, e.g. [Page 2](the exact href returned by a tool). Only use references you actually received; never invent a reference or claim to have read omitted/truncated content.',
      useTools
        ? 'Use the provided tools to read the documents the user has open instead of guessing their content; cite page numbers (PDF) or headings (Markdown) when you use them. Only change a document (insert_markdown, create_markdown, annotate_pdf) when the user asks you to write into it or mark it up; otherwise answer in the chat.'
        : 'You cannot call tools in this conversation; work from the document excerpt provided.',
    ];
    if (s?.loaded) lines.push(`The active document is "${s.name}" (${tools.isMd(s) ? 'Markdown' : 'PDF, ' + s.app.pagesCount + ' pages'}, id ${s.id}).`);
    else lines.push('No document is open right now.');
    const beside = s?.loaded ? partner() : null;
    if (beside?.loaded) lines.push(`Notes mode is on: "${beside.name}" (${tools.isMd(beside) ? 'Markdown' : 'PDF, ' + beside.app.pagesCount + ' pages'}, id ${beside.id}) is open beside it and the user sees both at once. Pass document_id to read or change either one` + (useTools ? '; write notes into the Markdown document with insert_markdown and mark passages of the PDF with annotate_pdf.' : '.'));
    if (state?.defaults?.systemPrompt) lines.push('', state.defaults.systemPrompt);
    return lines.join('\n');
  }
  async function excerpt(s) {
    const max = Math.max(1000, state?.defaults?.contextChars || 12000);
    try {
      const r = await tools.run('read_document', { document_id: s.id, max_chars: max, end_page: tools.isMd(s) ? undefined : Math.min(s.app.pagesCount, 30) }, { source: 'panel' });
      const text = r.text ?? r.pages.map(p => `[Page ${p.page}]\n${p.text}`).join('\n\n');
      if (chat && r.references?.length) { const user = chat.messages.findLast(m => m.role === 'user'); if (user) user.references = r.references; }
      return `<document name="${s.name}"${r.truncated ? ' truncated="true"' : ''}>\n${text}\nReferences: ${JSON.stringify(r.references || [])}\n</document>`;
    } catch { return ''; }
  }
  // Only complete tool exchanges go on the wire: a call without its result (stopped, or the round
  // limit was hit) or tool history sent to a request without tools is rejected by most APIs.
  function wire(messages, withTools) {
    const answered = new Set(messages.filter(m => m.role === 'tool').map(m => m.toolCallId));
    const out = [];
    for (const m of messages) {
      if (m.role === 'user') out.push({ role: 'user', content: m.wire || m.content });
      else if (m.role === 'assistant') {
        const calls = withTools ? (m.toolCalls || []).filter(c => answered.has(c.id)) : [];
        if (m.content || calls.length) out.push({ role: 'assistant', content: m.content || '', ...(calls.length ? { toolCalls: calls } : {}) });
      } else if (withTools && out.some(x => x.toolCalls?.some(c => c.id === m.toolCallId))) out.push({ role: 'tool', toolCallId: m.toolCallId, name: m.name, content: m.content });
    }
    return out;
  }
  async function send(text) {
    text = String(text ?? input.value).trim();
    if (!text || busy) return;
    const sel = selected(); if (!sel) { openSettings('ai'); return; }
    const s = current();
    await syncContext();
    const selection = includeSelection && lastSelection ? lastSelection.slice(0, 20000) : '';
    const message = { role: 'user', content: text, wire: text, documentId: s?.loaded ? s.id : null, documentPath: s?.loaded ? s.path || null : null };
    if (selection) { message.wire = `${text}\n\n<selection document="${s.name}">\n${selection}\n</selection>`; message.context = tf('附带选中内容 · {count} 字', { count: selection.length }); }
    if (!chat) { chat = { id: uid(), title: text.slice(0, 40), doc: s?.loaded ? s.name : '', created: Date.now(), updated: Date.now(), messages: [] }; chats.unshift(chat); }
    chat.error = ''; chat.messages.push(message); chat.updated = Date.now();
    input.value = ''; autosize(); presetMenu.hidden = true; saveChats();
    await run(sel);
  }
  async function regenerate() {
    if (busy || !chat) return;
    while (chat.messages.length && chat.messages.at(-1).role !== 'user') chat.messages.pop();
    if (!chat.messages.length) return;
    chat.error = ''; const sel = selected(); if (!sel) return openSettings('ai');
    await run(sel);
  }
  async function run(sel) {
    const userMessage = chat.messages.findLast(m => m.role === 'user');
    let defaultDocumentId = Object.hasOwn(userMessage || {}, 'documentId') ? userMessage.documentId : current()?.id || null;
    let s = null; try { if (defaultDocumentId) { s = tools.resolve(defaultDocumentId, userMessage?.documentPath); defaultDocumentId = s.id; } } catch {}
    busy = true; runCanceled = false; setBusy(true); renderAll();
    await Promise.all([definitionsReady, parser]);
    const d = state.defaults, key = pairKey(sel.connectionId, sel.model);
    let useTools = d.tools !== false && !noTools.has(key) && toolDefs.length > 0;
    const thisChat = chat;
    try {
      for (let round = 0; round <= MAX_ROUNDS && !runCanceled; round++) {
        const system = systemPrompt(s, useTools) + (!useTools && s?.loaded ? '\n\n' + await excerpt(s) + (partner()?.loaded ? '\n\n' + await excerpt(partner()) : '') : '') + (useTools && round === MAX_ROUNDS ? '\n\nYou have used all tool calls for this turn. Answer now with what you have; do not call tools.' : '');
        const message = { role: 'assistant', content: '', model: sel.model };
        job = { id: uid(), message, chat: thisChat };
        thisChat.messages.push(message); if (chat === thisChat) { renderAll(); }
        let result;
        try {
          result = await api.aiChat(job.id, { ...sel, messages: [{ role: 'system', content: system }, ...wire(thisChat.messages.slice(0, -1), useTools)], tools: useTools ? toolDefs : undefined, toolChoice: useTools && round === MAX_ROUNDS ? 'none' : undefined, temperature: d.temperature, maxTokens: d.maxTokens });
        } catch (error) {
          if (job?.canceled) { if (!message.content) thisChat.messages.pop(); throw error; }
          thisChat.messages.pop();
          // Some models or gateways reject function calling: fall back to sending an excerpt.
          if (useTools && round === 0 && /tool|function/i.test(userError(error)) && /HTTP 4\d\d/.test(userError(error))) { noTools.add(key); useTools = false; round--; continue; }
          throw error;
        }
        message.content = result.content || message.content; if (result.model) message.model = result.model;
        if (result.toolCalls?.length) message.toolCalls = result.toolCalls;
        thisChat.updated = Date.now(); saveChats();
        if (result.toolCalls?.length && round === MAX_ROUNDS) { delete message.toolCalls; thisChat.error = t('已达到本轮工具调用次数上限，可以继续提问让 AI 接着完成。'); }
        if (!message.toolCalls?.length || runCanceled) break;
        for (const call of result.toolCalls) {
          if (runCanceled) break;
          if (chat === thisChat) renderAll();
          let content, ok = true, summary = '', references = [], truncated = false;
          try {
            const args = { ...call.arguments };
            if (call.name === 'read_document') args.max_chars = Math.min(16000, Number(args.max_chars) || 12000);
            const value = await tools.run(call.name, args, { source: 'panel', confirmEdits: d.confirmEdits !== false, defaultDocumentId });
            references = value.references || []; truncated = !!value.truncated;
            content = JSON.stringify(value); summary = summarize(call.name, value);
          } catch (error) { ok = false; content = JSON.stringify({ error: userError(error), declined: !!error.declined }); summary = userError(error); }
          if (content.length > TOOL_RESULT_CHARS) {
            content = JSON.stringify({ truncated: true, note: 'Result shortened. Read a smaller range for full details.', references: references.slice(0, 12), excerpt: content.slice(0, 12000) }); truncated = true;
          }
          thisChat.messages.push({ role: 'tool', toolCallId: call.id, name: call.name, content, ok, summary, references, truncated });
        }
        saveChats();
      }
    } catch (error) {
      if (!job?.canceled) thisChat.error = userError(error);
    } finally {
      const last = thisChat.messages.at(-1); if (last?.role === 'assistant' && !last.content && !last.toolCalls?.length) thisChat.messages.pop();
      job = null; busy = false; setBusy(false); saveChats(); if (chat === thisChat) renderAll(); syncContext();
    }
  }
  // Stored as a template + values so the chip follows the display language.
  function summarize(name, v) {
    if (name === 'read_document') return v.pages ? ['{count} 页', { count: v.pages.length }] : ['{count} 字', { count: (v.text || '').length }];
    if (name === 'search_document') return ['{count} 处匹配', { count: v.matches.length }];
    if (name === 'list_documents') return ['{count} 个文档', { count: v.documents.length }];
    if (name === 'get_outline') return ['{count} 项', { count: (v.headings || v.outline || []).length }];
    if (name === 'get_selection') return v.selection ? ['{count} 字', { count: v.selection.length }] : ['没有选中内容', {}];
    return '';
  }
  function stop() { if (!busy) return; runCanceled = true; if (job) { job.canceled = true; api.aiCancel(job.id).catch(() => {}); } }
  function setBusy(on) {
    sendButton.dataset.icon = on ? 'stop' : 'send';
    sendButton.title = on ? t('停止生成') : t('发送 · Enter'); sendButton.setAttribute('aria-label', sendButton.title);
    sendButton.classList.toggle('isStop', on); panel.classList.toggle('isBusy', on);
  }
  sendButton.onclick = () => busy ? stop() : guard(() => send());

  // ——— composer: autosize, Enter to send, "/" presets ———
  function autosize() { input.style.height = 'auto'; input.style.height = Math.min(220, input.scrollHeight + 2) + 'px'; }
  let presetIndex = 0, presetItems = [];
  function updatePresets() {
    const m = /^\/(\S*)$/.exec(input.value);
    if (!m) { presetMenu.hidden = true; return; }
    const q = m[1].toLowerCase();
    presetItems = prompts().filter(p => !q || p.command.toLowerCase().includes(q) || t(p.title).toLowerCase().includes(q));
    presetIndex = Math.min(presetIndex, Math.max(0, presetItems.length - 1));
    presetMenu.replaceChildren(...presetItems.map((p, i) => {
      const b = el('button', 'aiPreset'); b.type = 'button'; b.setAttribute('role', 'option'); b.setAttribute('aria-selected', String(i === presetIndex));
      b.append(el('code', '', '/' + p.command), el('b', '', t(p.title)), el('small', '', t(p.text)));
      b.onmousedown = e => { e.preventDefault(); pickPreset(p); }; return b;
    }));
    presetMenu.hidden = !presetItems.length;
  }
  function pickPreset(p) { input.value = t(p.text); presetMenu.hidden = true; autosize(); input.focus(); }
  input.addEventListener('input', () => { autosize(); presetIndex = 0; updatePresets(); });
  input.addEventListener('keydown', e => {
    if (!presetMenu.hidden && presetItems.length) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); presetIndex = (presetIndex + (e.key === 'ArrowDown' ? 1 : -1) + presetItems.length) % presetItems.length; updatePresets(); return; }
      if (e.key === 'Enter' || e.key === 'Tab') { e.preventDefault(); pickPreset(presetItems[presetIndex]); return; }
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); presetMenu.hidden = true; return; }
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (!busy) guard(() => send()); }
    if (e.key === 'Escape' && busy) { e.preventDefault(); e.stopPropagation(); stop(); }
  });
  panel.addEventListener('keydown', e => { if (e.key === 'Escape' && !busy && e.target !== input) { e.stopPropagation(); setOpen(false); } });

  // ——— follow the active document ———
  function sync() {
    syncButtons();
    if (isOpen() && document.body.dataset.mode !== 'home') { syncContext(); if (!chat?.messages.length) renderEmpty(); }
  }
  if (readJson(OPEN_KEY, false)) document.body.classList.add('aiOpen');
  refresh().catch(console.warn);
  return { panel, toggle, setOpen, isOpen, refresh, send, stop, newChat, sync, confirm, ready: Promise.all([definitionsReady, parser]), get busy() { return busy; }, get chat() { return chat; } };
}
