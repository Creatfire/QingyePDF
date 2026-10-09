import { t, tf } from './i18n/i18n.mjs';
export function createConverter({ api, guard, status }) {
  const dialog = document.createElement('dialog'); dialog.id = 'converterDialog'; dialog.setAttribute('aria-labelledby', 'converterTitle');
  dialog.innerHTML = `<header class="convertHeading"><div><h2 id="converterTitle">文档转换中心</h2><p id="convertEngine"></p></div><button id="convertClose" aria-label="关闭文档转换中心">×</button></header>
    <div class="convertBody">
      <section class="convertStep"><h3 class="stepTitle"><i>1</i>选择文档</h3><p class="convertIntro">选择本地文档，转换为 Word、电子书、标记文本或 PDF。</p>
        <div class="convertFiles"><button id="convertPickInputs">选择输入文档…</button><span id="convertInputSummary">尚未选择输入文件</span></div><ul id="convertFiles" translate="no"></ul><label class="convertMode">转换方式<select id="convertMode"><option value="merge">合并为一个文档</option><option value="batch">每个文件分别转换</option></select></label><p id="convertModeHint" class="convertHint"></p></section>
      <section class="convertStep"><h3 class="stepTitle"><i>2</i>目标格式</h3>
        <div class="formatCards" role="group" aria-label="常用格式"><button type="button" class="formatCard" data-format="docx" aria-pressed="false"><b>Word</b><small>.docx</small></button><button type="button" class="formatCard" data-format="pdf-chromium" aria-pressed="false"><b>PDF</b><small>内置排版</small></button><button type="button" class="formatCard" data-format="epub3" aria-pressed="false"><b>EPUB</b><small>电子书</small></button><button type="button" class="formatCard" data-format="html5" aria-pressed="false"><b>网页</b><small>.html</small></button><button type="button" class="formatCard" data-format="gfm" aria-pressed="false"><b>Markdown</b><small>GitHub 风格</small></button><button type="button" class="formatCard" data-format="pptx" aria-pressed="false"><b>PowerPoint</b><small>.pptx</small></button><button type="button" class="formatCard" data-format="odt" aria-pressed="false"><b>OpenDocument</b><small>.odt</small></button><button type="button" class="formatCard" data-format="latex" aria-pressed="false"><b>LaTeX</b><small>.tex</small></button></div>
        <div class="convertGrid"><label>输入格式<select id="convertFrom"><option value="auto">自动识别</option></select></label><label>其他格式<select id="convertTo"></select></label>
        <label class="convertWide">读取扩展<input id="convertExtensions" placeholder="例如 +smart-raw_html；留空使用默认扩展" spellcheck="false"><button id="convertShowExtensions" type="button">查看可用扩展</button></label></div>
      <div class="convertPresets"><label>导出预设<select id="convertPreset"><option value="">选择预设…</option></select></label><input id="convertPresetName" aria-label="预设名称" placeholder="自定义预设名称" maxlength="50"><button id="convertSavePreset">保存预设</button><button id="convertDeletePreset" disabled>删除预设</button></div></section>
      <section class="convertStep"><h3 class="stepTitle"><i>3</i>选项与输出</h3>
        <div class="convertChecks"><label><input id="convertStandalone" type="checkbox" checked>完整文档</label><label><input id="convertToc" type="checkbox">生成目录</label><label><input id="convertNumbers" type="checkbox">章节编号</label><label><input id="convertCiteproc" type="checkbox">排版引用与参考文献</label></div><fieldset class="convertPdfOptions"><legend>内置 PDF 排版</legend><label>纸张<select id="convertPaper"><option>A4</option><option>A3</option><option>A5</option><option>Letter</option><option>Legal</option></select></label><label>页边距（毫米）<input id="convertMargin" type="number" min="0" max="60" value="16"></label><label><input id="convertLandscape" type="checkbox">横向</label><small>Word / ODT 的页边距由参考文档决定；外部 PDF 排版使用引擎参数。</small></fieldset><div class="convertFiles"><button id="convertPickOutput">选择输出文件…</button><span id="convertOutput" translate="no"></span></div><details id="convertAdvanced"><summary>高级选项、模板与过滤器</summary><div class="convertOptionFiles">
        <button data-convert-flag="--bibliography">参考文献文件…</button><button data-convert-flag="--csl">引用样式 CSL…</button><button data-convert-flag="--template">文档模板…</button><button data-convert-flag="--reference-doc">参考 Word / ODT…</button><button data-convert-flag="--lua-filter">Lua 过滤器…</button><button data-convert-flag="--defaults">Defaults 配置…</button><button data-convert-flag="--metadata-file">元数据文件…</button><button data-convert-flag="--css">样式表…</button></div>
        <label>附加参数（JSON 字符串数组）<textarea id="convertArgs" rows="4" spellcheck="false" placeholder='["--metadata=title:文档标题", "--wrap=none"]'>[]</textarea></label>
        <p class="convertHint">选项文件会添加到参数数组。自定义读写器可在此指定；Lua 过滤器会运行所选脚本。</p><button id="convertHelp">查看引擎参数说明</button></details><p id="convertPdfHint" class="convertHint"></p><p class="convertHint">转换由本机引擎完成。文档中的网络资源及网络参数可能产生下载请求，不使用云端转换服务。</p></section>
      <ul id="convertResults" aria-live="polite"></ul><pre id="convertLog" aria-live="polite" tabindex="0"></pre></div>
    <footer class="convertFooter"><span id="convertStatus" role="status">准备就绪</span><button id="convertRetry" hidden>重试失败项</button><button id="convertReveal" hidden>在文件夹中显示</button><button id="convertCancel" hidden>取消转换</button><button id="convertStart" class="primary">开始转换</button></footer>`;
  document.body.append(dialog); const $ = id => dialog.querySelector('#' + id);
  let inputs = [], output = null, info = null, job = null, results = [], presets=[];
  const config=()=>({from:$('convertFrom').value,to:$('convertTo').value,extensions:$('convertExtensions').value.trim(),extraArgs:JSON.parse($('convertArgs').value||'[]'),standalone:$('convertStandalone').checked,toc:$('convertToc').checked,numberSections:$('convertNumbers').checked,citeproc:$('convertCiteproc').checked,pdfOptions:{pageSize:$('convertPaper').value,marginMm:Number($('convertMargin').value),landscape:$('convertLandscape').checked}});
  function pdfControls(){syncCards();for(const el of dialog.querySelectorAll('.convertPdfOptions input,.convertPdfOptions select'))el.disabled=!!job||$('convertTo').value!=='pdf-chromium';$('convertDeletePreset').disabled=!!job||!$('convertPreset').value||$('convertPreset').value.startsWith('builtin-');}
  async function refreshPresets(selected=''){
    presets=await api.converterPresets();$('convertPreset').replaceChildren(new Option(t('选择预设…'),''),...presets.map(p=>new Option(p.id.startsWith('builtin-')?t(p.name):p.name,p.id)));$('convertPreset').value=selected;pdfControls();
  }
  $('convertPreset').onchange=()=>guard(async()=>{const p=presets.find(p=>p.id===$('convertPreset').value);if(!p)return;
    if(![...$('convertFrom').options].some(o=>o.value===p.from)||![...$('convertTo').options].some(o=>o.value===p.to))throw new Error('预设格式不受当前引擎支持。');
    $('convertFrom').value=p.from;$('convertTo').value=p.to;$('convertExtensions').value=p.extensions||'';$('convertArgs').value=JSON.stringify(p.extraArgs||[],null,2);
    for(const [id,key]of [['convertStandalone','standalone'],['convertToc','toc'],['convertNumbers','numberSections'],['convertCiteproc','citeproc']])$(id).checked=!!p[key];
    $('convertPaper').value=p.pdfOptions?.pageSize||'A4';$('convertMargin').value=p.pdfOptions?.marginMm??16;$('convertLandscape').checked=!!p.pdfOptions?.landscape;$('convertPresetName').value=p.id.startsWith('builtin-')?'':p.name;outputChanged();
  });
  $('convertSavePreset').onclick=()=>guard(async()=>{const saved=await api.converterSavePreset({...config(),name:$('convertPresetName').value});await refreshPresets(saved.id);status('导出预设已保存');});
  $('convertDeletePreset').onclick=()=>guard(async()=>{const id=$('convertPreset').value;if(!id||id.startsWith('builtin-'))return;await api.converterDeletePreset(id);await refreshPresets();$('convertPresetName').value='';status('导出预设已删除');});
  const batch = () => $('convertMode').value === 'batch';
  function drawResults() {
    const labels = { pending: '等待转换', running: '正在转换文档…', success: '转换完成', failed: '转换失败', canceled: '转换已取消' };
    $('convertResults').replaceChildren(...results.map(item => {
      const li = document.createElement('li'); li.dataset.state = item.status;
      const name = document.createElement('b'); name.textContent = inputs.find(f => f.path === item.input)?.name || item.input;
      const detail = document.createElement('span'); detail.textContent = t(labels[item.status]) + (item.path ? ' · ' + item.path : '') + (item.error ? ' · ' + item.error : '');
      li.append(name, detail); return li;
    }));
    $('convertRetry').hidden = !!job || !results.some(i => i.status === 'failed');
  }
  const log = text => { $('convertLog').textContent = text; };
  const setBusy = busy => {
    for (const el of dialog.querySelectorAll('input,select,textarea,button')) el.disabled = busy;
    $('convertCancel').disabled = false; $('convertHelp').disabled = false; $('convertCancel').hidden = !busy;
    pdfControls();
  };
  const appendArgs = (flag, file) => { const args = JSON.parse($('convertArgs').value || '[]'); if (!Array.isArray(args) || args.some(s => typeof s !== 'string')) throw new Error('高级参数必须是字符串组成的 JSON 数组。'); args.push(flag, file); $('convertArgs').value = JSON.stringify(args, null, 2); if (flag === '--bibliography' || flag === '--csl') $('convertCiteproc').checked = true; };
  function outputChanged() {
    output = null; $('convertOutput').textContent = ''; $('convertReveal').hidden = true;
    results = []; drawResults();
    $('convertPickOutput').textContent = t(batch() ? '选择输出文件夹…' : '选择输出文件…');
    $('convertModeHint').textContent = t(batch() ? '每个输入生成独立文件。同名输出自动加数字后缀，已有文件不会被覆盖。取消保留已完成文件。' : '多个输入文件会合并为一个输出文档。');
    $('convertPdfHint').textContent = $('convertTo').value === 'pdf-chromium' ? 'PDF 使用青页内置排版，无需安装 TeX。与 LaTeX 排版的分页和样式可能不同。' : $('convertTo').value === 'pdf' ? 'Pandoc PDF 需要外部排版器。请在高级参数指定已安装的 --pdf-engine；未安装时会显示引擎错误。' : $('convertTo').value === 'chunkedhtml' ? '分章节 HTML 导出为 ZIP，内含完整输出目录。' : $('convertTo').value === 'custom' ? '请在高级参数通过 --to 指定 Lua 写出器或 Defaults 配置。' : '';
    pdfControls();
  }
  async function open() {
    if (dialog.open) return; dialog.showModal(); $('convertStatus').textContent = '正在读取引擎信息…';
    try {
      info ||= await api.converterInfo();
      if ($('convertFrom').options.length === 1) {
        for (const f of info.readers) $('convertFrom').add(new Option(f, f));
        for (const f of info.writers) $('convertTo').add(new Option(f, f));
        $('convertTo').add(new Option('PDF · 青页内置排版', 'pdf-chromium')); $('convertTo').add(new Option('PDF · Pandoc 外部排版', 'pdf')); $('convertTo').add(new Option('由高级参数指定写出器', 'custom')); $('convertTo').value = 'html5';
      }
      $('convertEngine').textContent = tf('内置 {version} · {readers} 种输入 · {writers} 种输出', { version: info.version, readers: info.readers.length, writers: info.writers.length });
      $('convertStatus').textContent = '准备就绪';
      await refreshPresets($('convertPreset').value);
      if (!$('convertModeHint').textContent) outputChanged();
    } catch (error) { log(error.message); $('convertStatus').textContent = '转换引擎不可用'; }
  }
  $('convertClose').onclick = () => dialog.close();
  let keepCanceledDialog = false, escapeHeld = false;
  const cancelJob = () => { if (job) api.converterCancel(job).catch(console.warn); };
  document.addEventListener('keydown', event => {
    if (!dialog.open || event.key !== 'Escape' || (!job && !escapeHeld)) return;
    event.preventDefault(); event.stopImmediatePropagation(); escapeHeld = true; cancelJob();
  }, true);
  document.addEventListener('keyup', event => {
    if (event.key !== 'Escape' || !escapeHeld) return;
    event.preventDefault(); event.stopImmediatePropagation(); escapeHeld = false;
  }, true);
  dialog.addEventListener('cancel', event => {
    if (!job) return;
    event.preventDefault(); keepCanceledDialog = !event.cancelable; cancelJob();
  });
  // Some Chromium dialog cancel events cannot be canceled. Preserve the result view in that case.
  dialog.addEventListener('close', () => { if (keepCanceledDialog) { keepCanceledDialog = false; if (!dialog.open) dialog.showModal(); } });
  $('convertPickInputs').onclick = () => guard(async () => {
    const chosen = await api.converterPickInputs(); if (!chosen) return; inputs = chosen;
    $('convertFiles').replaceChildren(...inputs.map(f => { const li = document.createElement('li'); li.textContent = f.path; return li; }));
    $('convertInputSummary').textContent = tf('已选择 {count} 个输入文件', { count: inputs.length }); outputChanged();
  });
  // 0.15.0: common targets as cards; the select keeps every writer the engine offers.
  function syncCards() { for (const card of dialog.querySelectorAll('.formatCard')) { const has = [...$('convertTo').options].some(o => o.value === card.dataset.format); card.disabled = !has || !!job; card.setAttribute('aria-pressed', String(card.dataset.format === $('convertTo').value)); } }
  for (const card of dialog.querySelectorAll('.formatCard')) card.onclick = () => { $('convertTo').value = card.dataset.format; $('convertTo').dispatchEvent(new Event('change')); };
  $('convertTo').onchange = () => { outputChanged(); syncCards(); };
  dialog.addEventListener('focusin', syncCards);
  $('convertMode').onchange = outputChanged;
  $('convertPickOutput').onclick = () => guard(async () => { const selected = batch() ? await api.converterPickDirectory() : await api.converterPickOutput($('convertTo').value, inputs[0]?.token); if (selected) { output = selected; $('convertOutput').textContent = selected.path; $('convertReveal').hidden = true; } });
  $('convertShowExtensions').onclick = () => guard(async () => { if ($('convertFrom').value === 'auto') { log('请先选择输入格式。'); return; } log(await api.converterExtensions($('convertFrom').value)); });
  for (const button of dialog.querySelectorAll('[data-convert-flag]')) button.onclick = () => guard(async () => { const selected = await api.converterPickOption(button.dataset.convertFlag); if (selected) appendArgs(selected.flag, selected.path); });
  $('convertHelp').onclick = () => log(info?.help || '转换引擎不可用');
  $('convertReveal').onclick = () => guard(() => api.converterReveal(output.token));
  $('convertCancel').onclick = () => { if (job) api.converterCancel(job).then(() => { $('convertStatus').textContent = '正在取消转换…'; }).catch(console.warn); };
  async function start(retry = false) {
    if (job) return;
    if (!inputs.length || !output) { log(t(batch() ? '请先选择输入文档和输出文件夹。' : '请先选择输入文档和输出文件。')); return; }
    const selectedInputs = retry ? inputs.filter(f => results.some(r => r.input === f.path && r.status === 'failed')) : inputs;
    if (!selectedInputs.length) return;
    let extraArgs; try { extraArgs = JSON.parse($('convertArgs').value || '[]'); if (!Array.isArray(extraArgs) || extraArgs.some(s => typeof s !== 'string')) throw new Error('高级参数必须是字符串组成的 JSON 数组。'); }
    catch (error) { log(error.message); return; }
    const extensions = $('convertExtensions').value.trim(); if (extensions && !/^(?:[+-][a-z\d_]+)+$/i.test(extensions)) { log('读取扩展应使用 +名称 或 -名称。'); return; }
    if (extensions && $('convertFrom').value === 'auto') { log('请先选择输入格式。'); return; }
    job = crypto.randomUUID(); setBusy(true); log(''); $('convertReveal').hidden = true; $('convertStatus').textContent = '正在转换文档…';
    if (batch()) { if (!retry) results = inputs.map(f => ({ input: f.path, status: 'pending' })); drawResults(); }
    try {
      const result = await api.converterRun({ jobId: job, mode: batch() ? 'batch' : 'merge', inputs: selectedInputs.map(f => f.token), output: output.token, from: $('convertFrom').value === 'auto' ? 'auto' : $('convertFrom').value + extensions, to: $('convertTo').value, extraArgs, standalone: $('convertStandalone').checked, toc: $('convertToc').checked, numberSections: $('convertNumbers').checked, citeproc: $('convertCiteproc').checked,pdfOptions:config().pdfOptions });
      if (batch()) {
        for (const item of result.items) { const i = results.findIndex(r => r.input === item.input); if (i >= 0) results[i] = item; }
        $('convertStatus').textContent = tf('已完成 {success} 项 · 失败 {failed} 项 · 已取消 {canceled} 项', { success: results.filter(i => i.status === 'success').length, failed: results.filter(i => i.status === 'failed').length, canceled: results.filter(i => i.status === 'canceled').length });
      } else { $('convertStatus').textContent = '转换完成'; log(result.path + '\n' + (result.warnings || '')); }
      $('convertReveal').hidden = false; status(batch() && result.canceled ? '转换已取消' : batch() && result.failed ? '部分转换失败，请查看结果' : '文档转换完成');
    } catch (error) { const canceled = /已取消文档转换/.test(error.message); $('convertStatus').textContent = canceled ? '转换已取消' : '转换失败'; log(error.message); }
    finally { job = null; setBusy(false); drawResults(); }
  }
  $('convertStart').onclick = () => start(); $('convertRetry').onclick = () => start(true);
  api.onCommand((name, data) => {
    if (data?.jobId !== job) return;
    if (name === 'converter-progress') $('convertStatus').textContent = data.text;
    if (name === 'converter-item') { const i = results.findIndex(r => r.input === data.item.input); if (i >= 0) results[i] = data.item; drawResults(); }
  });
  return { open, dialog };
}
