// Settings → "AI 协作" (0.9.1): model connections (presets, import, export), chat defaults,
// "/" prompt presets and the local AI interface for external tools.
import { t, tf } from '../i18n/i18n.mjs';
import { DEFAULT_PROMPTS } from './panel.mjs';

const TYPE_LABEL = { openai: 'OpenAI 兼容', anthropic: 'Anthropic', ollama: 'Ollama' };
const changed = () => window.dispatchEvent(new Event('qingye:ai-config'));
const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };

export function mountAiSettings(root, { api, guard, status }) {
  root.innerHTML = `
    <h3>模型连接</h3>
    <p class="settingsNote">填写服务地址和 API Key，或从 Open WebUI 的连接配置、.env 文件、导出的 JSON 中导入。API Key 由系统加密保存在本机，界面中只显示末尾几位。</p>
    <div class="aiConnList"></div>
    <div class="aiFormHost"></div>
    <div class="settingsActions">
      <button type="button" class="primary aiAdd" data-icon="plus">添加连接</button>
      <button type="button" class="aiImportFile" data-icon="open">从文件导入…</button>
      <button type="button" class="aiImportPaste" data-icon="paste">粘贴导入</button>
      <button type="button" class="aiExport" data-icon="saveas">导出…</button>
    </div>
    <div class="aiPasteBox" hidden>
      <textarea class="aiPaste" spellcheck="false"></textarea>
      <div class="settingsActions"><button type="button" class="primary aiPasteOk" data-icon="check">导入</button><button type="button" class="aiPasteCancel">取消</button></div>
    </div>
    <p class="settingsNote aiEncrypt"></p>

    <h3>对话</h3>
    <label class="settingRow check"><span><b>允许 AI 使用文档工具</b><small>让模型按需读取页面、搜索、查看目录和选中内容。模型不支持工具调用时会自动改为只发送文档开头部分。</small></span><input class="aiDefTools" type="checkbox" role="switch"></label>
    <label class="settingRow check"><span><b>AI 修改文档前先确认</b><small>AI 写入 Markdown 前显示将要写入的内容，由你决定是否允许。</small></span><input class="aiDefConfirm" type="checkbox" role="switch"></label>
    <label class="settingRow"><span><b>温度</b><small>越低越稳定，越高越有创意（0–2）。</small></span><input class="aiDefTemp" type="number" min="0" max="2" step="0.1" style="width:90px"></label>
    <label class="settingRow"><span><b>最大输出长度</b><small>单次回答的最大 token 数。</small></span><input class="aiDefTokens" type="number" min="64" max="64000" step="256" style="width:110px"></label>
    <label class="settingRow"><span><b>文档摘录上限</b><small>不使用工具时随问题发送的文档字符数。</small></span><input class="aiDefContext" type="number" min="1000" max="200000" step="1000" style="width:110px"></label>
    <label class="settingRow" style="align-items:flex-start"><span><b>自定义系统提示词</b><small>附加在每次对话开头，例如回答风格、术语要求。</small></span><textarea class="aiDefSystem" rows="3" style="width:260px"></textarea></label>

    <h3>提示词预设</h3>
    <p class="settingsNote">在输入框中键入 “/” 调出。命令只能包含字母、数字、汉字和连字符。</p>
    <div class="aiPromptList"></div>
    <div class="settingsActions"><button type="button" class="aiPromptAdd" data-icon="plus">添加预设</button><button type="button" class="aiPromptReset" data-icon="undo">恢复默认</button></div>

    <h3>本地 AI 接口</h3>
    <p class="settingsNote">为外部 AI 工具开放一组文档接口（OpenAPI 3.1），例如 Open WebUI 的“工具服务器”、自动化脚本或智能体。接口只监听本机 127.0.0.1，每次请求都必须携带令牌。</p>
    <label class="settingRow check"><span><b>启用本地 AI 接口</b><small class="aiServerState"></small></span><input class="aiSrvEnabled" type="checkbox" role="switch"></label>
    <label class="settingRow"><span><b>端口</b><small>1024–65535，修改后立即生效。</small></span><input class="aiSrvPort" type="number" min="1024" max="65535" style="width:110px"></label>
    <div class="settingRow"><span><b>访问令牌</b><small>外部程序以 Bearer 方式随请求发送。</small></span><span class="aiTokenRow"><input class="aiSrvToken" type="password" readonly aria-label="访问令牌"><button type="button" class="iconOnly aiSrvShow" data-icon="view" title="显示令牌" aria-label="显示令牌"></button><button type="button" class="iconOnly aiSrvCopy" data-icon="copy" title="复制令牌" aria-label="复制令牌"></button><button type="button" class="iconOnly aiSrvRegen" data-icon="refresh" title="重新生成令牌" aria-label="重新生成令牌"></button></span></div>
    <label class="settingRow check"><span><b>允许外部程序直接修改文档</b><small>关闭时（推荐），外部程序每次写入都会在青页中弹出确认。</small></span><input class="aiSrvEdits" type="checkbox" role="switch"></label>
    <div class="aiCode aiSrvHelp"></div>`;
  const $ = s => root.querySelector(s);
  let state = null, editing = null;

  // ——— connections ———
  function renderConnections() {
    const list = $('.aiConnList');
    if (!state.connections.length) { list.replaceChildren(el('div', 'aiConnEmpty', t('还没有模型连接。'))); return; }
    list.replaceChildren(...state.connections.map(c => {
      const row = el('div', 'aiConn' + (c.enabled ? '' : ' isDisabled'));
      const name = el('div', 'aiConnName', c.name); name.append(el('small', '', t(TYPE_LABEL[c.type] || c.type)));
      if (state.defaults.connectionId === c.id) name.append(el('small', '', t('默认')));
      const meta = el('div', 'aiConnMeta', [c.baseUrl, c.models.length ? tf('{count} 个模型', { count: c.models.length }) : t('未获取模型'), c.hasKey ? 'Key ' + c.keyHint : t('无 Key')].join(' · '));
      meta.title = c.models.join('\n');
      const buttons = el('div', 'aiConnButtons');
      const b = (icon, title, fn) => { const x = el('button', 'iconOnly'); x.type = 'button'; x.dataset.icon = icon; x.title = t(title); x.setAttribute('aria-label', t(title)); x.onclick = () => guard(fn); buttons.append(x); return x; };
      b('refresh', '获取模型列表', async () => { status(t('正在获取模型列表…')); try { const v = await api.aiModels(c.id); status(tf('已获取 {count} 个模型', { count: v.models.length })); } finally { await refresh(); } });
      b('pen', '编辑', async () => { editing = c; renderForm(); });
      b('trash', '删除', async () => { await api.aiRemove(c.id); await refresh(); });
      row.append(name, buttons, meta);
      if (c.error) row.append(el('div', 'aiConnError', c.error));
      return row;
    }));
  }
  function renderForm() {
    const host = $('.aiFormHost'); host.replaceChildren();
    if (!editing) return;
    const c = editing.id ? editing : { name: '', type: 'openai', baseUrl: '', enabled: true };
    const form = el('form', 'aiForm'); form.noValidate = true;
    form.innerHTML = `
      <div class="aiPresetsRow"></div>
      <label for="aiFName">名称</label><input id="aiFName" class="aiFName" placeholder="例如 DeepSeek">
      <label for="aiFType">接口类型</label><select id="aiFType" class="aiFType"><option value="openai">OpenAI 兼容</option><option value="anthropic">Anthropic</option><option value="ollama">Ollama</option></select>
      <label for="aiFUrl">接口地址</label><input id="aiFUrl" class="aiFUrl" placeholder="https://api.example.com/v1" spellcheck="false">
      <label for="aiFKey">API Key</label><input id="aiFKey" class="aiFKey" type="password" autocomplete="off" spellcheck="false">
      <label for="aiFModels">模型</label><input id="aiFModels" class="aiFModels" placeholder="留空则自动获取；多个用逗号分隔" spellcheck="false">
      <small>服务不提供模型列表时，可以手动填写模型名。</small>
      <label for="aiFEnabled">启用</label><span><input id="aiFEnabled" class="aiFEnabled" type="checkbox" role="switch"></span>
      <div class="aiFormActions"><button type="button" class="aiFCancel">取消</button><button type="submit" class="primary" data-icon="check">保存</button></div>`;
    const f = s => form.querySelector(s);
    if (!editing.id) for (const p of state.presets) {
      const x = el('button', '', t(p.name)); x.type = 'button';
      x.onclick = () => { f('.aiFName').value = p.id === 'custom' ? '' : t(p.name); f('.aiFType').value = p.type; f('.aiFUrl').value = p.baseUrl; f('.aiFKey').placeholder = p.needsKey ? t('必填') : t('本机服务通常不需要'); f('.aiFUrl').focus(); };
      f('.aiPresetsRow').append(x);
    } else f('.aiPresetsRow').remove();
    f('.aiFName').value = c.name; f('.aiFType').value = c.type; f('.aiFUrl').value = c.baseUrl; f('.aiFEnabled').checked = c.enabled !== false;
    f('.aiFKey').placeholder = c.hasKey ? tf('已保存 {hint}，留空保持不变', { hint: c.keyHint }) : t('本机服务可以留空');
    f('.aiFModels').value = (c.models || []).join(', ');
    f('.aiFCancel').onclick = () => { editing = null; renderForm(); };
    form.onsubmit = e => { e.preventDefault(); guard(async () => {
      const models = f('.aiFModels').value.split(/[,，\n]/).map(x => x.trim()).filter(Boolean);
      const saved = await api.aiUpsert({ id: c.id, name: f('.aiFName').value, type: f('.aiFType').value, baseUrl: f('.aiFUrl').value.trim(), apiKey: f('.aiFKey').value, enabled: f('.aiFEnabled').checked, ...(models.length ? { models } : {}) });
      editing = null; renderForm(); status(t('AI 连接已保存'));
      if (!models.length) { try { await api.aiModels(saved.id); } catch (error) { console.warn(error); } }
      await refresh();
    }); };
    host.append(form); f(editing.id ? '.aiFName' : '.aiPresetsRow button')?.focus();
  }
  $('.aiAdd').onclick = () => { editing = {}; renderForm(); };
  $('.aiImportFile').onclick = () => guard(async () => { const r = await api.aiImportFile(); if (r) { status(tf('已导入 {count} 个 AI 连接', { count: r.added })); await refresh(); } });
  $('.aiImportPaste').onclick = () => { $('.aiPasteBox').hidden = false; $('.aiPaste').focus(); };
  $('.aiPasteCancel').onclick = () => { $('.aiPasteBox').hidden = true; $('.aiPaste').value = ''; };
  $('.aiPasteOk').onclick = () => guard(async () => { const r = await api.aiImportText($('.aiPaste').value); $('.aiPasteBox').hidden = true; $('.aiPaste').value = ''; status(tf('已导入 {count} 个 AI 连接', { count: r.added })); await refresh(); });
  $('.aiExport').onclick = () => guard(async () => {
    const withKeys = window.confirm(t('导出文件是否包含 API Key？\n\n选择“确定”会以明文写入 Key，请妥善保管该文件；选择“取消”只导出地址和模型。'));
    const r = await api.aiExport(withKeys); if (r) status(tf('已导出到 {path}', { path: r.path }));
  });

  // ——— defaults ———
  const setDefaults = values => guard(async () => { state.defaults = await api.aiDefaults(values); changed(); });
  $('.aiDefTools').onchange = e => setDefaults({ tools: e.target.checked });
  $('.aiDefConfirm').onchange = e => setDefaults({ confirmEdits: e.target.checked });
  // An emptied number field keeps the saved value instead of becoming 0.
  const numberSetting = (sel, key) => { $(sel).onchange = e => { if (e.target.value.trim() === '' || !Number.isFinite(Number(e.target.value))) { e.target.value = state.defaults[key]; return; } setDefaults({ [key]: Number(e.target.value) }); }; };
  numberSetting('.aiDefTemp', 'temperature'); numberSetting('.aiDefTokens', 'maxTokens'); numberSetting('.aiDefContext', 'contextChars');
  $('.aiDefSystem').onchange = e => setDefaults({ systemPrompt: e.target.value });

  // ——— prompts ———
  let prompts = [];
  const savePrompts = () => guard(async () => { state.prompts = await api.aiPrompts(prompts.filter(p => p.title && p.text)); changed(); });
  function renderPrompts() {
    $('.aiPromptList').replaceChildren(...prompts.map((p, i) => {
      const row = el('div', 'aiPromptRow');
      const input = (key, ph) => { const x = el('input'); x.value = p[key] || ''; x.placeholder = t(ph); x.setAttribute('aria-label', t(ph)); x.onchange = () => { p[key] = x.value; savePrompts(); }; return x; };
      const del = el('button', 'iconOnly'); del.type = 'button'; del.dataset.icon = 'trash'; del.title = t('删除'); del.setAttribute('aria-label', t('删除'));
      del.onclick = () => { prompts.splice(i, 1); renderPrompts(); savePrompts(); };
      row.append(input('command', '命令'), input('title', '标题'), input('text', '提示词内容'), del); return row;
    }));
  }
  $('.aiPromptAdd').onclick = () => { prompts.push({ command: 'new' + (prompts.length + 1), title: '', text: '' }); renderPrompts(); $('.aiPromptList').lastChild?.querySelector('input:nth-child(2)')?.focus(); };
  $('.aiPromptReset').onclick = () => guard(async () => { state.prompts = await api.aiPrompts(null); prompts = DEFAULT_PROMPTS.map(p => ({ ...p, title: t(p.title), text: t(p.text) })); renderPrompts(); changed(); });

  // ——— local interface ———
  const server = values => guard(async () => { const s = await api.aiServer(values); renderServer(s); });
  function renderServer(s) {
    $('.aiSrvEnabled').checked = !!s.enabled; $('.aiSrvPort').value = s.port; $('.aiSrvToken').value = s.token || ''; $('.aiSrvEdits').checked = !!s.allowEdits;
    const st = $('.aiServerState');
    st.classList.toggle('isRunning', !!s.running);
    st.textContent = s.error ? s.error : s.running ? tf('运行中：{url}', { url: s.url }) : s.enabled ? t('未运行') : t('已关闭');
    const base = `http://127.0.0.1:${s.port}`;
    $('.aiSrvHelp').textContent = [
      t('Open WebUI：设置 → 工具 → 添加连接（OpenAPI）'),
      `  URL: ${base}    ${t('认证')}: Bearer ${t('令牌')}`,
      `OpenAPI: ${base}/openapi.json`,
      '',
      t('命令行示例：'),
      `curl -H "Authorization: Bearer <token>" ${base}/v1/documents`,
      `curl -H "Authorization: Bearer <token>" -H "Content-Type: application/json" -d "{\\"query\\":\\"…\\"}" ${base}/v1/tools/search_document`,
    ].join('\n');
  }
  $('.aiSrvEnabled').onchange = e => server({ enabled: e.target.checked });
  $('.aiSrvPort').onchange = e => server({ port: Number(e.target.value) });
  $('.aiSrvEdits').onchange = e => server({ allowEdits: e.target.checked });
  $('.aiSrvRegen').onclick = () => server({ regenerateToken: true });
  $('.aiSrvShow').onclick = () => { const x = $('.aiSrvToken'); x.type = x.type === 'password' ? 'text' : 'password'; };
  $('.aiSrvCopy').onclick = () => guard(async () => { await navigator.clipboard.writeText($('.aiSrvToken').value); status(t('令牌已复制')); });

  async function refresh() {
    $('.aiPaste').placeholder = t('粘贴 JSON、.env 内容（OPENAI_API_KEY=…、OPENAI_BASE_URL=…）或“地址 空格 Key”');
    state = await api.aiState();
    if (!state) throw new Error(t('无法读取 AI 设置。'));
    renderConnections();
    $('.aiEncrypt').textContent = state.encrypted ? t('API Key 使用系统凭据加密保存。') : t('当前系统不支持加密存储，API Key 以明文保存在本机配置文件中。');
    const d = state.defaults;
    $('.aiDefTools').checked = d.tools !== false; $('.aiDefConfirm').checked = d.confirmEdits !== false;
    $('.aiDefTemp').value = d.temperature; $('.aiDefTokens').value = d.maxTokens; $('.aiDefContext').value = d.contextChars; $('.aiDefSystem').value = d.systemPrompt || '';
    prompts = (state.prompts?.length ? state.prompts : DEFAULT_PROMPTS.map(p => ({ ...p, title: t(p.title), text: t(p.text) }))).map(p => ({ ...p }));
    renderPrompts();
    renderServer({ ...state.server, ...state.serverStatus });
    changed();
  }
  return { refresh };
}
