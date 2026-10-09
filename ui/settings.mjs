// Application settings (0.8.2): the gear button left of Help in the title bar.
// Sections: general (language, theme, startup), PDF, Markdown, file associations, data, about.
import { LANGUAGES, choice as languageChoice, setLanguage, current as currentLanguage, t } from './i18n/i18n.mjs';
import { THEMES } from './markdown/themes.mjs';
import { mountAiSettings } from './ai/settings-ai.mjs';
import { HOME_LAYOUTS } from './home/layouts.mjs';
import { SKINS } from './skins.mjs';

const KEY = 'qingye.settings';
export const DEFAULTS = { restoreOnStart: false, pdfZoom: 'page-width', pdfResume: true, confirmRecentClear: true };
export function readSettings() { try { return { ...DEFAULTS, ...JSON.parse(localStorage.getItem(KEY) || '{}') }; } catch { return { ...DEFAULTS }; } }
function writeSettings(values) { try { localStorage.setItem(KEY, JSON.stringify(values)); } catch {} }

export function createSettings({ api, guard, status, message, markdown, theme, version, refreshRecent, windowStyle = { style: 'windows', vibrancy: false, saved: { style: 'windows', vibrancy: false } }, restart, homeLayout = { get: () => 'classic', set: async () => {} }, skin = { get: () => 'classic', set: () => {} } }) {
  const values = readSettings();
  const set = (name, value) => { values[name] = value; writeSettings(values); };
  const dialog = document.createElement('dialog');
  dialog.id = 'settingsDialog'; dialog.setAttribute('aria-labelledby', 'settingsTitle');
  dialog.innerHTML = `
    <header class="settingsHeader"><h2 id="settingsTitle" data-icon="settings">设置</h2><button class="settingsClose" data-icon="x" title="关闭" aria-label="关闭"></button></header>
    <div class="settingsBody">
      <nav class="settingsNav" role="tablist" aria-label="设置分类">
        <button role="tab" data-pane="general" data-icon="globe">常规</button>
        <button role="tab" data-pane="pdf" data-icon="file">PDF</button>
        <button role="tab" data-pane="markdown" data-icon="markdown">Markdown</button>
        <button role="tab" data-pane="ai" data-icon="sparkle">AI 协作</button>
        <button role="tab" data-pane="files" data-icon="open">默认打开方式</button>
        <button role="tab" data-pane="data" data-icon="shield">数据与隐私</button>
        <button role="tab" data-pane="about" data-icon="info">关于</button>
      </nav>
      <div class="settingsPanes">
        <section class="settingsPane" data-pane="general">
          <h3>界面</h3>
          <label class="settingRow"><span><b>显示语言</b><small>菜单、按钮和提示使用的语言；文档内容不受影响。</small></span><select id="setLanguage"></select></label>
          <label class="settingRow"><span><b>界面主题</b><small>标题栏右侧的月亮/太阳按钮可随时切换。</small></span><select id="setTheme"><option value="system">跟随系统</option><option value="light">浅色</option><option value="dark">深色</option></select></label>
          <div class="settingRow styleHeading"><span><b>界面风格</b><small>窗口按钮的位置与样式。切换后重启青页生效。</small></span></div>
          <div class="styleChoices" role="radiogroup" aria-label="界面风格">
            <button type="button" role="radio" data-style="windows"><span class="stylePreview isWindows" aria-hidden="true"><i class="spBar"><i class="spTab"></i><i class="spCaps"><i></i><i></i><i></i></i></i><i class="spBody"><i></i><i></i><i></i></i></span><span class="styleText"><b>Windows</b><small>右上角原生窗口按钮，紧凑直角</small></span></button>
            <button type="button" role="radio" data-style="macos"><span class="stylePreview isMacos" aria-hidden="true"><i class="spBar"><i class="spLights"><i></i><i></i><i></i></i><i class="spTab"></i></i><i class="spBody"><i></i><i></i><i></i></i></span><span class="styleText"><b>MacOS</b><small>左上角红绿灯、统一标题栏</small></span></button>
          </div>
          <label class="settingRow check" id="setVibrancyRow"><span><b>窗口毛玻璃</b><small id="setVibrancyNote">标题栏与首页透出模糊的桌面背景（Windows 11 亚克力材质）。</small></span><input id="setVibrancy" type="checkbox" role="switch"></label>
          <div class="styleRestart" role="status" hidden><span>新的界面风格将在重启青页后生效。</span><button type="button" id="styleRestartNow" class="primary" data-icon="refresh">立即重启</button></div>
          <div class="settingRow styleHeading"><span><b>界面皮肤</b><small>整个界面（标题栏、标签页、工具栏、侧栏、对话框）的外观，与首页样式互不绑定；阅读区不受影响。立即生效。</small></span></div>
          <div class="skinChoices" role="radiogroup" aria-label="界面皮肤">${SKINS.map(k => `<button type="button" role="radio" data-skin="${k.id}"><span class="skinPreview sk-${k.id}" aria-hidden="true"><i class="spB"></i><i class="spT"></i><i class="spC"></i></span><span class="styleText"><b>${k.label}</b><small>${k.note}</small></span></button>`).join('')}</div>
          <h3>首页</h3>
          <div class="settingRow styleHeading"><span><b>首页样式</b><small>没有打开文档时看到的页面。立即生效，数据只在本机。</small></span></div>
          <div class="homeChoices" role="radiogroup" aria-label="首页样式">${HOME_LAYOUTS.map(l => `<button type="button" role="radio" data-home="${l.id}"><span class="homePreview hp-${l.id}" aria-hidden="true">${'<i></i>'.repeat(7)}</span><span class="styleText"><b>${l.label}</b><small>${l.note}</small></span></button>`).join('')}</div>
          <h3>启动</h3>
          <label class="settingRow check"><span><b>启动时自动恢复上次的标签</b><small>关闭时仍在打开的文档会在下次启动时重新打开。</small></span><input id="setRestore" type="checkbox" role="switch"></label>
        </section>
        <section class="settingsPane" data-pane="pdf" hidden>
          <h3>阅读</h3>
          <label class="settingRow"><span><b>默认缩放</b><small>第一次打开某个 PDF 时使用；之后按文件记忆。</small></span><select id="setPdfZoom"><option value="page-width">适合宽度</option><option value="page-fit">适合页面</option><option value="auto">自动缩放</option><option value="1">100%</option></select></label>
          <label class="settingRow check"><span><b>回到上次阅读的位置</b><small>重新打开 PDF 时跳到上次的页码和滚动位置。</small></span><input id="setPdfResume" type="checkbox" role="switch"></label>
          <p class="settingsNote">页面排列、阅读配色、裁剪等视图设置在 PDF 工具栏的“视图”中，按文件分别记忆。</p>
        </section>
        <section class="settingsPane" data-pane="markdown" hidden>
          <h3>Markdown</h3>
          <label class="settingRow check"><span><b>打开已有文件时先进入阅读模式</b><small>双击正文或按 E 开始编辑。</small></span><input id="setMdRead" type="checkbox" role="switch"></label>
          <label class="settingRow check"><span><b>自动保存</b><small>已保存过的文件按间隔自动保存。</small></span><input id="setMdAutoSave" type="checkbox" role="switch"></label>
          <label class="settingRow"><span><b>文档主题</b><small>Markdown 正文的排版风格。</small></span><select id="setMdTheme"></select></label>
          <div class="settingsActions"><button id="setMdMore" data-icon="markdown">更多 Markdown 偏好设置…</button></div>
        </section>
        <section class="settingsPane" data-pane="ai" hidden></section>
        <section class="settingsPane" data-pane="files" hidden>
          <h3>用青页打开 PDF 和 Markdown</h3>
          <p class="settingsNote">把青页注册为 PDF 与 Markdown 文件的打开程序，双击文件即可在青页中打开。Windows 10/11 不允许程序直接更改默认应用：注册后请在弹出的系统窗口中选择“青页 PDF”并确认“始终使用”。</p>
          <div class="assocRows"></div>
          <div class="settingsActions">
            <button id="assocRegister" class="primary" data-icon="check">注册为打开方式</button>
            <button id="assocSystem" data-icon="external">打开 Windows 默认应用设置</button>
            <button id="assocRemove" data-icon="trash">取消注册</button>
          </div>
          <p class="settingsNote assocPath"></p>
        </section>
        <section class="settingsPane" data-pane="data" hidden>
          <h3>本机数据</h3>
          <p class="settingsNote">除非你启用 AI 协作并主动发送消息，青页不联网、不上传文档。阅读位置、最近文件、草稿备份和偏好设置只保存在这台电脑上。</p>
          <div class="settingRow"><span><b>最近打开</b><small>清除首页“最近打开”列表，不会删除任何文件。</small></span><button id="setClearRecent" data-icon="trash">清除列表</button></div>
          <div class="settingRow"><span><b>数据文件夹</b><small>阅读记录、草稿与 Markdown 版本历史所在位置。</small></span><button id="setDataFolder" data-icon="open">打开文件夹</button></div>
        </section>
        <section class="settingsPane" data-pane="about" hidden>
          <div class="aboutCard"><span class="aboutMark">青</span><div><b>青页 PDF</b><span id="aboutVersion"></span></div></div>
          <p class="settingsNote">本地、开源的 PDF 阅读器与 Markdown 编辑器。无账号、无会员、无广告。按 AGPL-3.0 许可证开源，第三方组件及其许可证见随附的 THIRD_PARTY_NOTICES。</p>
          <div class="settingsActions"><button id="aboutPdfSample" data-icon="file">PDF 使用示例</button><button id="aboutMdSample" data-icon="markdown">Markdown 示例</button></div>
        </section>
      </div>
    </div>`;
  document.body.append(dialog);
  const $ = sel => dialog.querySelector(sel);

  // ——— Tabs ———
  function show(pane) {
    for (const b of dialog.querySelectorAll('.settingsNav button')) b.setAttribute('aria-selected', String(b.dataset.pane === pane));
    for (const p of dialog.querySelectorAll('.settingsPane')) p.hidden = p.dataset.pane !== pane;
    if (pane === 'files') guard(refreshAssociations);
    if (pane === 'ai') guard(aiPane.refresh);
  }
  for (const b of dialog.querySelectorAll('.settingsNav button')) b.onclick = () => show(b.dataset.pane);
  $('.settingsClose').onclick = () => dialog.close();
  dialog.addEventListener('click', e => { if (e.target === dialog) dialog.close(); });

  const aiPane = mountAiSettings($('.settingsPane[data-pane="ai"]'), { api, guard, status });

  // ——— General ———
  const lang = $('#setLanguage');
  for (const [code, name] of LANGUAGES) { const o = new Option(name, code); if (code !== 'auto') o.setAttribute('translate', 'no'); lang.append(o); }
  lang.onchange = () => guard(async () => { const code = await setLanguage(lang.value); await api.setLanguage?.(code, lang.value !== 'auto'); status(t('界面语言已切换')); });
  $('#setTheme').onchange = e => theme.set(e.target.value);
  $('#setRestore').onchange = e => set('restoreOnStart', e.target.checked);

  // ——— Interface style (0.9.2) ———
  let chosenStyle = { ...windowStyle.saved };
  const styleButtons = [...dialog.querySelectorAll('.styleChoices [role="radio"]')];
  const vibrancyInput = $('#setVibrancy');
  function syncStyle() {
    for (const b of styleButtons) { const on = b.dataset.style === chosenStyle.style; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; }
    const mac = chosenStyle.style === 'macos';
    $('#setVibrancyRow').hidden = !mac || api.platform === 'darwin';
    vibrancyInput.checked = mac && chosenStyle.vibrancy && !!windowStyle.acrylicSupported;
    vibrancyInput.disabled = !windowStyle.acrylicSupported;
    $('#setVibrancyNote').textContent = windowStyle.acrylicSupported ? '标题栏与首页透出模糊的桌面背景（Windows 11 亚克力材质）。' : '需要 Windows 11 22H2 或更高版本；当前系统不显示桌面背景。';
    const effectiveVibrancy = value => !!value && !!windowStyle.acrylicSupported;
    $('.styleRestart').hidden = chosenStyle.style === windowStyle.style && (!mac || effectiveVibrancy(chosenStyle.vibrancy) === !!windowStyle.vibrancy);
  }
  async function saveStyle(next) {
    chosenStyle = { ...chosenStyle, ...next }; syncStyle();
    await api.setWindowStyle?.(chosenStyle);
    status(t($('.styleRestart').hidden ? '已恢复当前界面风格' : '界面风格已保存，重启青页后生效'));
  }
  for (const b of styleButtons) {
    b.onclick = () => guard(() => saveStyle({ style: b.dataset.style }));
    b.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const next = styleButtons[(styleButtons.indexOf(b) + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + styleButtons.length) % styleButtons.length];
      next.focus(); next.click();
    };
  }
  const skinButtons = [...dialog.querySelectorAll('.skinChoices [role="radio"]')];
  const syncSkin = () => { const id = skin.get(); for (const b of skinButtons) { const on = b.dataset.skin === id; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; } };
  for (const b of skinButtons) {
    b.onclick = () => { skin.set(b.dataset.skin); syncSkin(); status(t('界面皮肤已切换')); };
    b.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const next = skinButtons[(skinButtons.indexOf(b) + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + skinButtons.length) % skinButtons.length];
      next.focus(); next.click();
    };
  }
  const homeButtons = [...dialog.querySelectorAll('.homeChoices [role="radio"]')];
  const syncHome = () => { const id = homeLayout.get(); for (const b of homeButtons) { const on = b.dataset.home === id; b.setAttribute('aria-checked', String(on)); b.tabIndex = on ? 0 : -1; } };
  for (const b of homeButtons) {
    b.onclick = () => guard(async () => { await homeLayout.set(b.dataset.home); syncHome(); status(t('首页样式已切换')); });
    b.onkeydown = event => {
      if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
      event.preventDefault();
      const next = homeButtons[(homeButtons.indexOf(b) + (event.key === 'ArrowLeft' || event.key === 'ArrowUp' ? -1 : 1) + homeButtons.length) % homeButtons.length];
      next.focus(); next.click();
    };
  }
  vibrancyInput.onchange = () => guard(() => saveStyle({ vibrancy: vibrancyInput.checked }));
  $('#styleRestartNow').onclick = () => guard(async () => { dialog.close(); if (restart) await restart(); });

  // ——— PDF ———
  $('#setPdfZoom').onchange = e => set('pdfZoom', e.target.value);
  $('#setPdfResume').onchange = e => set('pdfResume', e.target.checked);

  // ——— Markdown ———
  const mdPrefs = () => markdown.typora.prefs;
  const mdTheme = $('#setMdTheme');
  for (const [id, name] of THEMES) mdTheme.append(new Option(name, id));
  $('#setMdRead').onchange = e => mdPrefs().set('openInReadMode', e.target.checked);
  $('#setMdAutoSave').onchange = e => mdPrefs().set('autoSave', e.target.checked);
  mdTheme.onchange = () => mdPrefs().set('theme', mdTheme.value);
  $('#setMdMore').onclick = () => { dialog.close(); markdown.typora.H.openPrefs(null); };

  // ——— File associations ———
  const KINDS = [['pdf', 'PDF 文档', '.pdf'], ['md', 'Markdown 文档', '.md、.markdown']];
  async function refreshAssociations() {
    const rows = $('.assocRows');
    let info;
    try { info = await api.assocStatus(); } catch (error) { info = { supported: false, reason: error.message, types: {} }; }
    info ||= { supported: false, reason: '无法读取文件关联状态。', types: {} };
    rows.replaceChildren(...KINDS.map(([kind, label, exts]) => {
      const st = info.types?.[kind] || {};
      const row = document.createElement('div'); row.className = 'assocRow';
      const name = document.createElement('span'); name.className = 'assocName';
      const b = document.createElement('b'); b.textContent = label; const small = document.createElement('small'); small.textContent = exts; name.append(b, small);
      const state = document.createElement('span'); state.className = 'assocState' + (st.isDefault ? ' isDefault' : '');
      state.textContent = !info.supported ? '不可用' : st.isDefault ? '青页是默认程序' : st.current ? `当前默认：${st.current}` : '未设置默认程序';
      if (st.current && !st.isDefault) state.setAttribute('data-app', st.current);
      const choose = document.createElement('button'); choose.textContent = '选择默认程序…'; choose.disabled = !info.supported || !st.registered;
      choose.title = st.registered ? '打开 Windows 的“选择打开方式”窗口，选中青页 PDF 并勾选“始终使用”' : '请先注册为打开方式';
      choose.onclick = () => guard(async () => { await api.assocChoose(kind); status(t('请在 Windows 窗口中选择“青页 PDF”')); setTimeout(() => guard(refreshAssociations), 4000); });
      row.append(name, state, choose); return row;
    }));
    for (const id of ['#assocRegister', '#assocSystem', '#assocRemove']) $(id).disabled = !info.supported;
    const anyRegistered = Object.values(info.types || {}).some(x => x.registered), stale = Object.values(info.types || {}).some(x => x.stale);
    $('#assocRegister').textContent = stale ? '重新注册（程序位置已变化）' : anyRegistered ? '重新注册' : '注册为打开方式';
    $('#assocRemove').disabled = !info.supported || !anyRegistered;
    $('.assocPath').textContent = !info.supported ? info.reason : `注册的程序位置：${info.exe}。移动 exe 后需要重新注册。`;
  }
  $('#assocRegister').onclick = () => guard(async () => { await api.assocRegister(['pdf', 'md']); await refreshAssociations(); status(t('已注册为 PDF 与 Markdown 的打开方式')); await api.assocOpenSettings(); });
  $('#assocSystem').onclick = () => guard(() => api.assocOpenSettings());
  $('#assocRemove').onclick = () => guard(async () => { await api.assocUnregister(); await refreshAssociations(); status(t('已取消注册')); });

  // ——— Data ———
  $('#setClearRecent').onclick = () => guard(async () => { await api.recentClear(); await refreshRecent(); status(t('已清除最近打开列表')); });
  $('#setDataFolder').onclick = () => guard(() => api.openDataFolder());

  // ——— About ———
  $('#aboutPdfSample').onclick = () => { dialog.close(); document.getElementById('exampleButton').click(); };
  $('#aboutMdSample').onclick = () => { dialog.close(); document.getElementById('markdownExampleButton').click(); };

  function sync() {
    lang.value = languageChoice();
    $('#setTheme').value = theme.mode();
    $('#setRestore').checked = !!values.restoreOnStart;
    syncStyle(); syncHome(); syncSkin();
    $('#setPdfZoom').value = values.pdfZoom; $('#setPdfResume').checked = !!values.pdfResume;
    $('#setMdRead').checked = !!mdPrefs().get('openInReadMode'); $('#setMdAutoSave').checked = !!mdPrefs().get('autoSave');
    mdTheme.value = THEMES.some(([id]) => id === mdPrefs().get('theme')) ? mdPrefs().get('theme') : 'qingye';
    $('#aboutVersion').textContent = `${t('版本')} ${version()}`;
  }
  function open(pane = 'general') { sync(); show(pane); if (!dialog.open) dialog.showModal(); }
  return { open, values, dialog, language: currentLanguage };
}
