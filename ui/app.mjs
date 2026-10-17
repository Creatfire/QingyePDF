import { createViews } from './views.mjs';
import { createNavigation } from './navigation.mjs';
import { createTools } from './tools.mjs';
import { createHistory } from './history.mjs';
import { createDirectEditing } from './direct.mjs';
import { userError } from './errors.mjs';
import { createTextSelection } from './selection.mjs';
import { createMarkup } from './markup.mjs';
import { createShapes } from './shapes.mjs';
import { createOfficeProgress } from './office-progress.mjs';
import { createAnnotEdit } from './annot-edit.mjs';
import { createCompareDiff } from './compare-diff.mjs';
import { createChrome } from './chrome.mjs';
import { createMarkdownHost } from './markdown/host.mjs';
import { createSettings } from './settings.mjs';
import { createConverter } from './converter.mjs';
import { createDocTools } from './ai/doc-tools.mjs';
import { createAiPanel } from './ai/panel.mjs';
import * as i18n from './i18n/i18n.mjs';
import { applyWindowStyle } from './window-style.mjs';
import { createReadingHistory } from './reading-history.mjs';
import { createNotesMode } from './notes-mode.mjs';
import { createLibrary } from './library.mjs';
import { createCitations } from './citation.mjs';
import { createRecentList } from './recent-list.mjs';
import { createTheme } from './theme.mjs';
import { createDraftRecovery } from './draft-recovery.mjs';
import { createShortcuts } from './shortcuts.mjs';
import { createCommands } from './commands.mjs';
import { createHistoryUi } from './history-ui.mjs';
// Display language first, so the UI is translated before it is shown.
await i18n.init().catch(console.warn);
window.desktop.setLanguage?.(i18n.current(), i18n.choice() !== 'auto').catch(() => {});
const api = window.desktop;
// Interface style (Windows / MacOS) before anything else is laid out.
const windowStyle = applyWindowStyle(api);
let productVersion='';
api.appVersion().then(version=>{productVersion=version;document.getElementById('versionFooter').textContent=`青页 PDF ${version} · 本地开源工具箱 · 无登录、无订阅、无广告`;}).catch(console.warn);
const $ = id => document.getElementById(id);
const sessions = new Map();
let activeId = null, closingApp = false, compareIds = null, comparingPage = false;
const theme = createTheme({ api, sessions, $ });
const contentDigest=async bytes=>Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new Uint8Array(bytes)))).map(n=>n.toString(16).padStart(2,'0')).join('');
let statusHook = null, ai = null, notes = null, library = null, citations = null;
const status = text => { $('statusText').textContent = text; statusHook?.(text); };
function message(title, detail) {
  $('messageTitle').textContent = title;
  $('messageBody').textContent = String(detail);
  if (!$('messageDialog').open) $('messageDialog').showModal();
}
async function guard(action) { try { return await action(); } catch (error) { console.error(error); const detail=userError(error); status(detail); message('操作未完成', detail); return false; } }
function current() { return sessions.get(activeId); }
// PDF-only modules (views, navigation, tools, page editing, annotations) never see Markdown tabs.
const isMd = s => s?.kind === 'markdown';
const pdfBase = s => 'https://qingye.invalid/'+encodeURIComponent(s.id)+'/'+encodeURIComponent(s.name);
const pdfPasswords = new WeakMap();
function captureReading(){const s=current();if(!s?.loaded)return null;if(isMd(s))return {id:s.id,path:s.path,kind:'markdown',offset:s.editor.currentSelection().from,scrollTop:s.editor.scrollTop,mode:s.editor.sourceMode?'source':s.readonly?'read':'live'};
  const v=s.app.pdfViewer,page=v.currentPageNumber;return {id:s.id,path:s.path,kind:'pdf',page,scrollTop:v.container.scrollTop,zoom:v.currentScaleValue,scale:v.currentScale,pageOffset:v.container.scrollTop-(v.getPageView(page-1)?.div.offsetTop||0)};
}
async function restoreReading(point){const s=sessions.get(point.id)||[...sessions.values()].find(d=>point.path&&d.path===point.path);if(!s?.loaded)throw new Error('原文档已关闭，无法返回阅读位置。');activate(s.id);await new Promise(r=>setTimeout(r,100));
  if(isMd(s)){markdown.setViewMode(s,point.mode||'read');s.editor.scrollToOffset(Math.min(point.offset||0,s.editor.text.length));(s.editor.sourceMode?s.editor.sourceView:s.editor.scroller).scrollTo({top:point.scrollTop||0,behavior:'instant'});}
  else{if(point.page>s.app.pagesCount)throw new Error('原文档页码已变化。');if(s.view.reflow)await views.change('reflow',false,s);const v=s.app.pdfViewer;v.currentScaleValue=point.zoom||v.currentScaleValue;v.currentPageNumber=point.page;
    const top=point.scale&&Math.abs(v.currentScale-point.scale)>.001?(v.getPageView(point.page-1)?.div.offsetTop||0)+(point.pageOffset||0)*v.currentScale/point.scale:point.scrollTop||0;v.container.scrollTo({top,behavior:'instant'});v.update();}
}
async function locatePdfSource({id,page,rect}) {return readingTrail.record(async()=>{
  if(rect&&(!Array.isArray(rect)||rect.length!==4||rect.some(n=>typeof n!=='number'||!Number.isFinite(n)||Math.abs(n)>10000000)))throw new Error('批注区域无效。');
  const s=sessions.get(id);if(!s?.loaded||isMd(s))throw new Error('原 PDF 已关闭，请重新打开后定位。');if(!Number.isInteger(page)||page<1||page>s.app.pagesCount)throw new Error('原文档页码已变化。');
  activate(s.id);if(s.view.reflow)await views.change('reflow',false,s);await new Promise(r=>setTimeout(r,100));
  const doc=s.app.pdfDocument,v=s.app.pdfViewer;v.currentPageNumber=page;const view=v.getPageView(page-1);if(!view.pdfPage)view.setPdfPage(await doc.getPage(page));
  if(!sessions.has(id)||s.app.pdfDocument!==doc)throw new Error('原文档已变化，请重新定位。');
  if(rect){let box;const bus=s.app.eventBus;const paint=()=>{if(s.app.pdfDocument!==doc||!s.loaded)return;const activeView=v.getPageView(page-1),r=[...activeView.viewport.convertToViewportPoint(rect[0],rect[1]),...activeView.viewport.convertToViewportPoint(rect[2],rect[3])];
      box=s.frame.contentDocument.createElement('div');box.className='sourceNoteHighlight';const x=Math.min(r[0],r[2]),y=Math.min(r[1],r[3]);
      box.style.cssText='position:absolute;pointer-events:none;border:2px solid #249d75;background:rgba(36,157,117,.12);z-index:80;left:'+x+'px;top:'+y+'px;width:'+Math.max(2,Math.abs(r[2]-r[0]))+'px;height:'+Math.max(2,Math.abs(r[3]-r[1]))+'px';
      activeView.div.querySelectorAll('.sourceNoteHighlight').forEach(n=>n.remove());activeView.div.append(box);
    };const rendered=event=>{if(event.pageNumber===page)paint();};bus.on('pagerendered',rendered);paint();box?.scrollIntoView({block:'center',inline:'nearest'});setTimeout(()=>{bus.off('pagerendered',rendered);box?.remove();},2600);
  }status('已定位原文批注');
});}
const readingTrail=createReadingHistory({capture:captureReading,restore:restoreReading,onChange:state=>{$('readingBack').disabled=!state.canBack;$('readingForward').disabled=!state.canForward;}});
$('readingBack').onclick=()=>guard(()=>readingTrail.back());$('readingForward').onclick=()=>guard(()=>readingTrail.forward());
// Notes mode: with a PDF beside a Markdown note, the PDF toolbar, navigation panel and page tools
// keep serving that PDF while the note has the focus.
function currentPdf() { const s = current(); if (!isMd(s)) return s; const other = notes?.partner(activeId); return other && !isMd(other) ? other : undefined; }
const pdfSessions = { values: () => [...sessions.values()].filter(s => !isMd(s))[Symbol.iterator](), get: id => { const s = sessions.get(id); return isMd(s) ? undefined : s; }, has: id => !!pdfSessions.get(id) };
const views = createViews({ current: currentPdf, commit, guard, api });
const navigation = createNavigation({ current: currentPdf, guard, views, api, snapshot:s=>tools.snapshot(s), openTools: action => tools.open(action), addDocuments, applyEdit,navigate:action=>readingTrail.record(action),readingTrail,status,isProcessing:()=>tools.isBusy(),notesFor:s=>notes?.notesFor(s)||null,insertNotes:(note,text)=>notes.insertBlock(note,text) });
const tools = createTools({ current: currentPdf, sessions: pdfSessions, guard, commit, api, addDocuments, status, compare, applyEdit, onBusyChange:tabs });
const converter = createConverter({ api, guard, status });
const direct=createDirectEditing({current:currentPdf,guard,api,applyEdit,navigation,tools,historyStep:(redo)=>history.step(redo),status,notesFor:s=>notes?.notesFor(s)||null,excerpt:(s,text,page)=>notes.excerpt(s,text,page,notes.selectionSource(s,page).rect),region:s=>notes.pickRegion(s),cite:s=>citations.open(s)});
const textSelection=createTextSelection({current:currentPdf,api,applyEdit,guard,status,tools});
const shapes=createShapes({current:currentPdf,applyEdit,guard,status});
const officeProgress=createOfficeProgress({api,guard,status});
const annotEdit=createAnnotEdit({current:currentPdf,applyEdit,guard,status,shapes});
const markup=createMarkup({current:currentPdf,applyEdit,guard,status,shapes});
const chrome=createChrome({api,current:currentPdf,guard,navigation,status,shapes});
const markdown=createMarkdownHost({api,guard,status,message,addDocuments,workspace:$('viewers'),navigate:action=>readingTrail.record(action),onPdfLink:locatePdfSource,onChange:(s,{chrome:chromeOnly}={})=>{if(!chromeOnly){syncDirty(s);draft.schedule();}if(s.id===activeId)tabs();}});
statusHook = text => markdown.statusMessage(text);
function bindStorage(s){const storage=s.app.pdfDocument.annotationStorage,modified=storage.onSetModified;storage.onSetModified=()=>{modified?.();queueMicrotask(()=>{syncDirty(s);draft.schedule();});};}
async function replaceDocument(s,bytes){
  const state=viewState(s),previous=await tools.snapshot(s);s.loaded=false;s.app._annotationStorageModified=false;
  try{
    await s.app.close();s.nativeHistory=null;
    const initialized=new Promise(resolve=>s.app.eventBus.on('documentinit',resolve,{once:true}));
    await s.app.open({data:new Uint8Array(bytes),filename:s.name,docBaseUrl:pdfBase(s)});await initialized;await s.app.pdfViewer.firstPagePromise;
    s.imageRects=null;s.imageScan=null;await views.restore(s,state);
    s.app.pdfViewer.pagesRotation=state.rotation||0;s.app.pdfViewer.currentScaleValue=state.zoom||'page-width';s.app.pdfViewer.currentPageNumber=Math.min(state.page,s.app.pagesCount);
    await s.app.pdfViewer.onePageRendered;await new Promise(resolve=>s.frame.contentWindow.requestAnimationFrame(()=>s.frame.contentWindow.requestAnimationFrame(resolve)));
    s.savedHash=editingHash(s);s.pendingInput=false;s.structuralDirty=(await contentDigest(bytes))!==s.savedContentDigest;s.recovered=false;
    s.searchText=new Map();s.pageDraft=null;s.draftHash=null;s.emptyOcrPages=new Set();bindStorage(s);
  }catch(error){await s.app.open({data:new Uint8Array(previous),filename:s.name,docBaseUrl:pdfBase(s)});throw error;}
  finally{s.loaded=true;syncDirty(s);tabs();navigation.sync();draft.schedule();}
}
async function applyEdit(s,request,label,beforeReplace){
  if(!s?.loaded||s.editBusy||s.saving)throw new Error('文档尚未就绪或正在处理。');s.editBusy=true;tabs();
  try{const before=await tools.snapshot(s);status('正在应用修改…');const result=await api.toolsJob(s.id,before,{...request,draft:true});if(result.unchanged){status(result.note);return result;}if(beforeReplace&&!beforeReplace())return {canceled:true};await replaceDocument(s,result.bytes);s.history.push(before,result.bytes,label);history.sync();status(label+' · 可撤销，尚未保存');return result;}
  finally{s.editBusy=false;tabs();draft.schedule();}
}
// Undo / redo and the edit-history dialog (history-ui.mjs).
const history = createHistoryUi({ $, guard, current, isMd, markdown, commit, replaceDocument, syncDirty });
// Draft recovery: unsaved content is checkpointed every few seconds (draft-recovery.mjs).
const draft = createDraftRecovery({ api, sessions, isMd, viewState, syncDirty, commit, editingHash, markdown, status, userError, activeId: () => activeId, isClosing: () => closingApp });
// Home page: the recent list (recent-list.mjs).
const recent = createRecentList({ api, guard, addDocuments, $ });
// Keyboard shortcuts, and the commands the main process pushes into the window.
const shortcuts = createShortcuts({ $, api, guard, sessions, current, activeId: () => activeId, isMd, activate, nextTab, closeTab, open, newMarkdown, reviewSave, historyStep: history.step, readingTrail, notes: () => notes, library: () => library, markdown, navigation, ai: () => ai });
const commands = createCommands({ $, sessions, current, activeId: () => activeId, isMd, open, addDocuments, status, message, officeProgress, reconvertOffice, reviewSave, closeTab, closeApp, nextTab, newMarkdown, markdown, navigation, chrome, windowStyle });
const compareBar = document.createElement('div'); compareBar.id='compareBar';compareBar.hidden=true;
compareBar.innerHTML='<strong>并排比较</strong><label><input id="syncComparePages" type="checkbox" checked>同步页码</label><label><input id="syncCompareZoom" type="checkbox" checked>同步缩放</label><label>右侧页差 <input id="compareOffset" type="number" value="0" min="-100000" max="100000" title="右侧页码 = 左侧页码 + 页差"></label><span id="compareNames"></span><div class="spacer"></div>'
  +'<button id="compareDiffRun" data-icon="compare" title="比较两份文档的文字，左侧标出删除（红），右侧标出新增（绿）">标出差异</button><button id="compareDiffPrev" data-icon="up" title="上一处差异" disabled>上一处</button><button id="compareDiffNext" data-icon="down" title="下一处差异" disabled>下一处</button><span id="compareDiffCount" class="compareDiffCount"></span>'
  +'<button id="endCompare">结束比较</button>';
$('workspace').append(compareBar);
$('endCompare').onclick=endCompare;
// 0.19: text differences drawn on both pages, stepped through from the bar (compare-diff.mjs).
const compareDiff=createCompareDiff({sessions});
const diffButtons=on=>{$('compareDiffPrev').disabled=$('compareDiffNext').disabled=!on;};
$('compareDiffRun').onclick=()=>guard(async()=>{if(!compareIds)return;$('compareDiffRun').disabled=true;try{const offset=Number($('compareOffset').value)||0;const r=await compareDiff.compute(compareIds[0],compareIds[1],offset,(p,n)=>{$('compareDiffCount').textContent=`正在比较 ${p} / ${n} 页…`;});$('compareDiffCount').textContent=r.hunks?`共 ${r.hunks} 处差异`+(r.truncated?'（只比较前 300 页）':''):'文字没有差异';diffButtons(r.hunks>0);status(r.hunks?`找到 ${r.hunks} 处文字差异：左侧红色为删除，右侧绿色为新增。`:'两份文档的文字相同（不比较图片和版式）。');}finally{$('compareDiffRun').disabled=false;}});
for(const [id,dir] of [['compareDiffPrev',-1],['compareDiffNext',1]])$(id).onclick=()=>{comparingPage=true;try{const r=compareDiff.step(dir);if(r){$('compareDiffCount').textContent=`第 ${r.index} / ${r.total} 处`;status(`第 ${r.index} / ${r.total} 处差异`+(r.removed?` · 删除：${r.removed.slice(0,40)}`:'')+(r.added?` · 新增：${r.added.slice(0,40)}`:''));}}finally{comparingPage=false;}};
function endCompare() {
  const saved=[...sessions.values()].filter(s=>s.compareView);
  compareIds=null;compareDiff.clear();diffButtons(false);$('compareDiffCount').textContent='';activate(activeId);
  for(const s of saved){const v=s.app.pdfViewer;v.scrollMode=s.compareView.scrollMode;v.spreadMode=s.compareView.spreadMode;v.currentScaleValue=s.compareView.zoom;delete s.compareView;}
}
async function compare(left,right) {
  if(left===right||!pdfSessions.get(left)?.loaded||!pdfSessions.get(right)?.loaded)throw new Error('请打开两个不同的 PDF。');
  if(compareIds)endCompare();
  notes?.end();
  for(const id of [left,right]){const s=sessions.get(id);if(s.view.reflow)await views.change('reflow',false,s);const v=s.app.pdfViewer;s.compareView={scrollMode:v.scrollMode,spreadMode:v.spreadMode,zoom:String(v.currentScaleValue)};}
  compareIds=[left,right];activate(left);
  $('compareOffset').value=0;
  // With continuous page-width layout, both short pages may fit in one half-window;
  // PDF.js then selects the first visible page, defeating page synchronization.
  comparingPage=true;
  try{for(const id of compareIds){const v=sessions.get(id).app.pdfViewer;v.scrollMode=3;v.spreadMode=0;v.currentScaleValue='page-fit';v.update();}}
  finally{comparingPage=false;}
}
function viewState(s) {
  if (isMd(s)) return s.editor ? markdown.state(s) : s.state;
  const v = s.app?.pdfViewer;
  return v ? { page: v.currentPageNumber, zoom: String(v.currentScaleValue), rotation: v.pagesRotation, scrollTop: s.app.appConfig.mainContainer.querySelector('#viewerContainer')?.scrollTop || 0, ...views.state(s), ...s.compareView, bookmarks:s.bookmarks||s.state?.bookmarks||[] } : s.state;
}
function tabs() {
  $('tabs').replaceChildren();
  const home = document.createElement('button');
  home.className = `tab${activeId === null ? ' active' : ''}`; home.dataset.icon = 'home';
  home.textContent = '首页'; home.onclick = () => activate(null);
  if (activeId === null) home.setAttribute('aria-current', 'page');
  $('tabs').append(home);
  for (const s of sessions.values()) {
    const pane = notes?.ids()?.indexOf(s.id) ?? -1;
    const tab = document.createElement('div'); tab.className = `tab${s.id === activeId ? ' active' : ''}${s.dirty ? ' dirty' : ''}${pane >= 0 ? ' inSplit' : ''}`; if (pane >= 0) tab.dataset.pane = pane ? 'right' : 'left';
    tab.addEventListener('contextmenu', event => { if (!notes) return; event.preventDefault(); notes.tabMenu(s.id, event.clientX, event.clientY); });
    const title = document.createElement('button'); title.className = 'tabTitle'; title.dataset.icon = isMd(s) ? 'markdown' : 'file';
    const text = document.createElement('span'); text.className = 'tabText'; text.textContent = s.name; title.append(text);
    title.title = (s.path || s.name) + (s.dirty ? '（有未保存修改）' : ''); title.setAttribute('aria-label', s.name + (s.dirty ? '，有未保存修改' : '')); title.onclick = () => activate(s.id);
    if (s.id === activeId) title.setAttribute('aria-current', 'page');
    const close = document.createElement('button'); close.className = 'close'; close.dataset.icon = 'x'; close.title = '关闭文档 · Ctrl+W'; close.setAttribute('aria-label', `关闭 ${s.name}`); close.onclick = () => guard(() => closeTab(s.id));
    tab.addEventListener('auxclick', event => { if (event.button === 1) { event.preventDefault(); guard(() => closeTab(s.id)); } });
    tab.append(title, close); $('tabs').append(tab);
  }
  $('tabs').querySelector('.tab.active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  $('saveButton').disabled = $('saveAsButton').disabled = !current()?.loaded || !!current()?.saving || !!current()?.editBusy || tools.isBusy();
  $('saveButton').title=$('saveAsButton').title=tools.isBusy()?'本地处理正在进行，完成后可保存。':'';
  views.sync();
  $('directButton').disabled=!currentPdf()?.loaded;
  history.sync();
  textSelection.sync();
  $('searchButton').disabled = $('outlineButton').disabled = !current()?.loaded;
  chrome.sync();
  const md = isMd(current()) && current().loaded ? current() : null;
  if (md) markdown.syncChrome(md);
  $('statusDetail').textContent = currentPdf() ? (currentPdf().path || currentPdf().name) : '';
}
function resizePdf(s) {
  const viewer=s.app?.pdfViewer;if(!s.loaded||!viewer)return;
  const page=viewer.currentPageNumber;
  // oxlint-disable-next-line no-self-assign -- 重新赋同一个值让 PDF.js 按新宽度重算缩放（惯用触发方式）。
  viewer.currentScaleValue=viewer.currentScaleValue;
  // ResizeObserver and tab activation may run after a newer citation navigation. The cached
  // PDF.js scale location can still be on the old page until its scroll event has been handled.
  if(viewer.currentPageNumber!==page||(viewer._location&&viewer._location.pageNumber!==page))viewer.currentPageNumber=page;
  viewer.update();
}
function activate(id, { keepFocus = false } = {}) {
  if(compareIds&&(!compareIds.includes(id)||compareIds.some(key=>!sessions.has(key))))endCompare();
  notes?.place(id);
  const shown = compareIds ? null : notes?.shown(id) || null;
  const previous = current();
  if (previous?.loaded) api.remember(previous.id, viewState(previous)).catch(console.warn);
  activeId = id;
  document.body.classList.toggle('comparing',!!compareIds);compareBar.hidden=!compareIds;
  if(compareIds)$('compareNames').textContent=compareIds.map(key=>sessions.get(key).name).join(' ↔ ');
  $('home').hidden = id !== null;
  // Each document kind gets its own chrome: home has no toolbar, PDF gets the PDF toolbar,
  // Markdown gets its own menu bar and status bar inside the tab.
  document.body.dataset.mode = id === null ? 'home' : (shown ? shown.every(key => isMd(sessions.get(key))) : isMd(sessions.get(id))) ? 'md' : 'pdf';
  for (const s of sessions.values()) {
    s.panel.classList.toggle('compareLeft',compareIds?.[0]===s.id);s.panel.classList.toggle('compareRight',compareIds?.[1]===s.id);
    s.panel.hidden=compareIds?!compareIds.includes(s.id):shown?!shown.includes(s.id):s.id!==id;
    if(isMd(s))continue;
    if(!s.panel.hidden)requestAnimationFrame(()=>resizePdf(s));
    if(s.id===id&&!keepFocus)s.frame.focus();
  }
  notes?.layout(id);
  markdown.show(isMd(current())&&current().loaded?current():null,{focus:!keepFocus});markdown.closeMenu();
  direct.select(currentPdf()?.id??id);
  navigation.sync();
  tabs();
  status(id === null ? '准备就绪' : isMd(current()) ? (current().dirty ? '有未保存的修改' : 'Markdown 文档') : current()?.loaded ? (current().dirty ? '有未保存的批注' : '文档已打开') : '正在打开文档…');
  if (id === null) recent.refresh();
  ai?.sync();
}
function editingHash(s) { return JSON.stringify([...(s.app.pdfDocument.annotationStorage.serializable.map || [])].sort(([a], [b]) => a.localeCompare(b))); }
function sameEdits(left, right) {
  if (left === right) return true;
  const equal = (a, b) => {
    if (a === b) return true;
    // PDF.js's canvas/SVG rescaling can shift serialized coordinates by floating-point noise.
    if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) < 0.001;
    if (!a || !b || typeof a !== 'object' || typeof b !== 'object') return false;
    const keys = Object.keys(a);
    // Ink's rect includes PDF.js's zoom-dependent SVG margin. The serialized paths
    // contain the actual PDF coordinates, so they detect moves/resizes independently.
    const inkBounds = a.annotationType === 15 && b.annotationType === 15 && a.paths && b.paths;
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && (inkBounds && key === 'rect' || equal(a[key], b[key])));
  };
  return equal(JSON.parse(left), JSON.parse(right));
}
function syncDirty(s) {
  if (!s.loaded || s.saving) return;
  if (isMd(s)) { const dirty = markdown.isDirty(s); if (dirty !== s.dirty) { s.dirty = dirty; tabs(); if (s.id === activeId) status(dirty ? '有未保存的修改' : '已保存'); } return; }
  const dirty = !!s.recovered || !!s.structuralDirty || s.pendingInput || !sameEdits(editingHash(s), s.savedHash);
  if (dirty !== s.dirty) { s.dirty = dirty; tabs(); if (s.id === activeId) status(dirty ? '有未保存的批注' : '文档已保存'); }
}
function commit(s) {
  if (isMd(s) || !s?.app) return;
  const manager = s.app.pdfViewer._layerProperties.annotationEditorUIManager;
  manager?.endCurrentEditing();
  // Commit editors even when focus moved to the app toolbar or a different tab.
  // ponytail: O(pages * editors); replace with a direct editor collection if large annotation sets need it.
  if (manager) for (let page = 0; page < s.app.pagesCount; page++) for (const editor of manager.getEditors(page)) if (!editor.isEmpty()) editor.commit();
  s.frame.contentDocument.activeElement?.blur();
  s.pendingInput = false;
  syncDirty(s);
}
document.addEventListener('webviewerloaded', event => {
  const child = event.detail.source;
  const options = child.PDFViewerApplicationOptions;
  options.setAll({ defaultUrl: '', disablePreferences: true, enableScripting: false, isEvalSupported: false,
    localeProperties: { lang: ({ 'zh-CN': 'zh-CN', 'zh-TW': 'zh-TW', en: 'en-US', ja: 'ja', ko: 'ko' })[i18n.current()] || 'zh-CN' }, enablePermissions: true, enableComment: true,
    enableSignatureEditor: true, enableAltText: false, enableGuessAltText: false,
    enableAltTextModelDownload: false, enableNewAltTextWhenAddingImage: false,
    enableSplitMerge: false, enableMerge: false, disableHistory: true, defaultZoomValue: 'page-width',
    externalLinkTarget: 2, viewOnLoad: 1, sidebarViewOnLoad: 0,
  });
});
async function addDocument(info) {
  if (sessions.has(info.id)) { activate(info.id); return; }
  if (info.kind === 'markdown') {
    if (typeof info.text !== 'string') return;
    const placeholder = { ...info, kind: 'markdown', loaded: false, dirty: false, panel: document.createElement('div') };
    sessions.set(info.id, placeholder);
    try {
      const s = await markdown.create(info);
      sessions.set(s.id, s); s.dirty = markdown.isDirty(s);
      // Notes mode: clicking or tabbing into the other pane makes it the current document.
      for (const type of ['pointerdown', 'focusin']) s.panel.addEventListener(type, () => { if (notes?.has(s.id) && activeId !== s.id) activate(s.id, { keepFocus: true }); }, true);
      activate(s.id); status(info.recovered ? `已恢复 ${s.name} 的未保存内容` : `已打开 ${s.name}`);
    } catch (error) { sessions.delete(info.id); await api.closeDocument(info.id, info.state).catch(() => {}); activate(null); throw error; }
    return;
  }
  const panel = document.createElement('div'); panel.className = 'viewerPanel';
  const frame = document.createElement('iframe'); frame.title = info.name;
  frame.src = '../vendor/pdfjs/web/viewer.html?file=';
  panel.append(frame); $('viewers').append(panel);
  const s = { ...info, bytes: null, frame, panel, dirty: false, loaded: false, pendingInput: false, saving: false };
  sessions.set(s.id, s); activate(s.id);
  try {
    await new Promise((resolve, reject) => { frame.onload = resolve; frame.onerror = () => reject(new Error('阅读器加载失败。')); });
    s.app = frame.contentWindow.PDFViewerApplication;
    if (!s.app) throw new Error('阅读引擎未初始化。');
    await s.app.initializedPromise;
    const childDoc = frame.contentDocument;
    const rememberPassword=()=>{pdfPasswords.set(s,childDoc.getElementById('password')?.value||'');};
    childDoc.addEventListener('click',event=>{if(event.target.closest?.('#passwordSubmit'))rememberPassword();},true);
    childDoc.addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.id==='password')rememberPassword();},true);
    childDoc.addEventListener('click',event=>{
      const link=event.target.closest?.('a[href]');if(!link)return;
      let url;try{url=new URL(link.href);}catch{return;}
      if(url.hostname!=='qingye.invalid')return;
      event.preventDefault();event.stopImmediatePropagation();
      guard(()=>readingTrail.record(async()=>{
        const prefix='/'+encodeURIComponent(s.id)+'/';
        if(!url.pathname.startsWith(prefix))throw new Error('无法解析此跨文档链接，请手动打开目标文件。');
        const result=await api.markdownOpenLink(s.id,url.pathname.slice(prefix.length)+url.hash);
        if(result.opened?.length)await addDocuments(result.opened);
        const target=result.opened?.length?sessions.get(result.opened[0].id):s;
        if(target&&!isMd(target)&&result.anchor)target.app.pdfLinkService.setHash(result.anchor);
      }));
    },true);
    childDoc.documentElement.style.colorScheme = document.body.classList.contains('dark') ? 'dark' : 'light';
    // Route every PDF.js save entry to the same native save path, with no fallback to original bytes.
    s.app.save = s.app.download = s.app.downloadOrSave = () => guard(() => saveSession(s, false));
    childDoc.addEventListener('keydown', event => shortcuts.handle(event, s), true);
    childDoc.addEventListener('pointerdown',()=>{if(compareIds&&activeId!==s.id)activate(s.id);else if(notes?.has(s.id)&&activeId!==s.id)activate(s.id,{keepFocus:true});},true);
    childDoc.addEventListener('drop', event => { event.preventDefault(); event.stopImmediatePropagation(); guard(() => dropFiles(event.dataTransfer.files)); }, true);
    childDoc.addEventListener('dragover', event => event.preventDefault(), true);
    childDoc.addEventListener('input', event => {
      if (event.target.closest('.annotationEditorLayer, .annotationLayer, #commentManagerDialog')) { s.pendingInput = true; syncDirty(s);draft.schedule(); }
    }, true);
    childDoc.addEventListener('pointerup', () => setTimeout(() => syncDirty(s), 100), true);
    const initialized = new Promise(resolve => s.app.eventBus.on('documentinit', resolve, { once: true }));
    const textReady = new Promise(resolve => s.app.eventBus.on('textlayerrendered', event => { if (event.pageNumber === 1) resolve(); }));
    await s.app.open({ data: new Uint8Array(info.bytes), filename: info.name, docBaseUrl:pdfBase(s) });
    await initialized;
    // PDF.js measures minimum font size from the DOM. Keep a new frame visible through that measurement.
    await Promise.race([textReady, new Promise(resolve => setTimeout(resolve, 3000))]);
    await s.app.pdfViewer.firstPagePromise;
    const state = info.state || {};
    await views.restore(s, state);
    s.app.pdfViewer.pagesRotation = state.rotation || 0;
    s.app.pdfViewer.currentScaleValue = state.zoom || settings.values.pdfZoom || 'page-width';
    const resume = settings.values.pdfResume !== false;
    s.app.pdfViewer.currentPageNumber = Math.max(1, Math.min(s.app.pagesCount, resume && state.page || 1));
    if (resume && state.scrollTop) s.app.appConfig.mainContainer.querySelector('#viewerContainer').scrollTop = state.scrollTop;
    s.loaded = true;
    navigation.bind(s);
    let measuredWidth = -1, resizeFrame;
    s.resizeObserver = new frame.contentWindow.ResizeObserver(entries => {
      const width = Math.round(entries[0].contentRect.width);
      if (width === measuredWidth || width === 0) return;
      measuredWidth = width;
      frame.contentWindow.cancelAnimationFrame(resizeFrame);
      resizeFrame = frame.contentWindow.requestAnimationFrame(() => {
        const v = s.app.pdfViewer;
        if (!s.panel.hidden && !s.saving && ['page-width', 'page-fit', 'auto'].includes(v.currentScaleValue)) resizePdf(s);
      });
    });
    s.resizeObserver.observe(childDoc.getElementById('viewerContainer'));
    s.savedHash = editingHash(s);
    s.history=createHistory();s.savedContentDigest=await contentDigest(info.bytes);
    bindStorage(s);direct.bind(s);textSelection.bind(s);markup.bind(s);shapes.bind(s);annotEdit.bind(s);compareDiff.bind(s);
    s.app.eventBus.on('scalechanging',e=>{if(compareIds?.includes(s.id)&&s.id===activeId&&!comparingPage&&$('syncCompareZoom').checked){const other=sessions.get(compareIds.find(id=>id!==s.id));if(other?.loaded){comparingPage=true;try{other.app.pdfViewer.currentScaleValue=String(e.presetValue||e.scale);}finally{comparingPage=false;}}}});chrome.attachPager(s);
    s.app.eventBus.on('editingstateschanged', ({source,details}) => { if(!s.loaded||(source&&source!==s.app.pdfViewer._layerProperties.annotationEditorUIManager))return;s.nativeHistory={...details};if(details?.hasSomethingToUndo&&!details.hasSomethingToRedo)s.history?.discardRedo();s.pendingInput = false; syncDirty(s);history.sync(); });
    s.app.eventBus.on('pagechanging', () => {
      if (s.id === activeId) status(`第 ${s.app.pdfViewer.currentPageNumber} / ${s.app.pagesCount} 页${s.dirty ? ' · 有未保存批注' : ''}`);
      notes?.pageChanged(s, s.app.pdfViewer.currentPageNumber);
      if(compareIds?.includes(s.id)&&s.id===activeId&&!comparingPage&&$('syncComparePages').checked&&!compareDiff.active()){
        const other=sessions.get(compareIds.find(id=>id!==s.id));if(other?.loaded){comparingPage=true;try{const offset=(Number($('compareOffset').value)||0)*(s.id===compareIds[0]?1:-1);other.app.pdfViewer.currentPageNumber=Math.max(1,Math.min(other.app.pagesCount,s.app.pdfViewer.currentPageNumber+offset));}finally{comparingPage=false;}}
      }
    });
    frame.focus(); tabs(); status(`已打开 ${s.name}`);
  } catch (error) {
    sessions.delete(s.id); panel.remove(); await api.closeDocument(s.id, s.state).catch(() => {}); activate(null); throw error;
  }
}
async function addDocuments(items) { for (const info of items) { await addDocument(info); if (info.officeJob) officeProgress.opened(info.officeJob); }const selected=items.find(i=>i.wasActive);if(selected)activate(selected.id); await recent.refresh(); }
async function open() { await addDocuments(await api.open()); }
// The Word / Excel / PowerPoint original changed: convert again into the same tab (undoable).
async function reconvertOffice(id) {
  const s = sessions.get(id); if (!s?.loaded) return;
  if (s.editBusy || s.saving) throw new Error('文档正在处理，请稍后再重新转换。');
  // PDF.js only renders a visible tab, so the document is replaced in the foreground.
  if (activeId !== id) activate(id);
  s.editBusy = true; tabs();
  try {
    const before = await tools.snapshot(s), result = await api.officeReconvert(id);
    if (!result?.bytes) { status('已取消重新转换'); return; }
    await replaceDocument(s, result.bytes); s.history.push(before, result.bytes, '重新转换 ' + s.name); history.sync();
    status('已按更新后的原文件重新转换 · 可撤销');
  } finally { s.editBusy = false; tabs(); draft.schedule(); }
}
async function dropFiles(files) { await addDocuments(await api.dropped(Array.from(files))); }
// Home page: the recent list (recent-list.mjs).
async function saveSession(s, saveAs) {
  if (isMd(s)) {
    if (!s.loaded || s.saving) return false;
    status('正在保存…');
    const saved = await markdown.save(s, saveAs);
    if (!saved) { status('已取消保存'); return false; }
    syncDirty(s); tabs(); status('已保存到 ' + s.path); await recent.refresh(); await draft.checkpoint(); return true;
  }
  if(tools.isBusy()){status('本地处理正在进行，请等待完成后保存。');return false;}
  if (!s?.loaded || s.saving || s.editBusy) return false;
  commit(s);
  s.saving = true; tabs(); s.frame.inert = true;
  const cover = document.createElement('div'); cover.className = 'busyCover'; cover.textContent = '正在保存…'; s.panel.append(cover); status('正在保存…');
  try {
    const doc = s.app.pdfDocument;
    const bytes = doc.annotationStorage.size > 0 ? await doc.saveDocument() : await doc.getData();
    const embedFonts=[...(doc.annotationStorage.serializable.map||[])].some(([,entry])=>entry.annotationType===3&&/[^\u0000-\u00ff]/.test(String(entry.value||'')));
    const result = await api.save(s.id, bytes, saveAs, embedFonts, pdfPasswords.get(s));
    if (!result) { status('已取消保存'); return false; }
    Object.assign(s, result); s.savedHash = editingHash(s); s.pendingInput = false; s.dirty = false;s.recovered=false;s.structuralDirty=false;s.savedContentDigest=await contentDigest(bytes);s.draftHash=null;
    s.app._annotationStorageModified = false;
    status('已保存到 ' + s.path); await recent.refresh(); return true;
  } finally { s.frame.inert = false; cover.remove(); s.saving = false; tabs();await draft.checkpoint(); }
}
async function closeTab(id) {
  const target = sessions.get(id);
  if (isMd(target)) {
    if (!target.loaded || target.saving) return false;
    syncDirty(target);
    if (target.dirty) {
      const choice = await api.closeChoice(target.name);
      if (choice === 'cancel') return false;
      if (choice === 'save' && !await saveSession(target, false)) return false;
    }
    await api.closeDocument(target.id, viewState(target));
    const mdPartner = notes?.partner(id)?.id; notes?.closed(id);
    markdown.destroy(target); sessions.delete(id);
    if (mdPartner) activate(mdPartner); else if (activeId === id) activate([...sessions.keys()].at(-1) || null); else tabs();
    return true;
  }
  if(tools.isBusy()){status('本地处理正在进行，请完成后关闭文档。');return false;}
  const s = sessions.get(id); if (!s || s.saving || s.editBusy) return false;
  if(!await direct.discard(id))return false;
  if (s.loaded) commit(s);
  if (s.dirty) {
    const choice = await api.closeChoice(s.name);
    if (choice === 'cancel') return false;
    if (choice === 'save' && !await saveSession(s, false)) return false;
  }
  await api.closeDocument(s.id, viewState(s));
  // Do not run PDF.js's default auto-download on close; the native prompt handled it.
  s.app && (s.app._annotationStorageModified = false);
  await s.app?.close();
  s.resizeObserver?.disconnect();
  const pdfPartner = notes?.partner(id)?.id; notes?.closed(id);
  s.panel.remove(); sessions.delete(s.id);
  if (pdfPartner) activate(pdfPartner); else if (activeId === id) activate([...sessions.keys()].at(-1) || null); else tabs();
  return true;
}
async function closeApp() {
  if (closingApp) return false;
  closingApp = true;
  const last=[...sessions.values()].filter(s=>s.loaded).map(s=>({id:s.id})),selected=activeId;
  try { for (const id of [...sessions.keys()]) if (!await closeTab(id)) return false;await api.finishSession(last,selected); api.finishClose(); return true; }
  finally { closingApp = false; }
}
// Settings → Interface style → "Restart now": the usual close flow (unsaved documents are asked about),
// then the main process starts Qingye again and the new instance reopens these tabs.
async function restartApp() {
  await api.relaunchOnClose?.(true);
  let closed = false;
  try { closed = await closeApp(); } finally { if (!closed) await api.relaunchOnClose?.(false).catch(() => {}); }
  return closed;
}
function nextTab(direction = 1) {
  const ids = [...sessions.keys()]; if (!ids.length) return;
  const index = ids.indexOf(activeId); activate(ids[(index + direction + ids.length) % ids.length]);
}
// Keyboard shortcuts (shortcuts.mjs) and main-process commands (commands.mjs) are wired above.
$('openButton').onclick = $('welcomeOpen').onclick = () => guard(open);
$('exampleButton').onclick = () => guard(async () => addDocuments(await api.example()));
function newMarkdown() { return guard(async () => addDocuments(await api.newMarkdown())); }
$('newMarkdownButton').onclick = () => newMarkdown();
$('convertButton').onclick = $('homeConvertButton').onclick = () => guard(() => converter.open());
$('markdownExampleButton').onclick = () => guard(async () => addDocuments(await api.markdownExample()));
window.addEventListener('focus', () => { if ([...sessions.values()].some(isMd)) api.checkMarkdown().catch(() => {}); });
function reviewSave(s,saveAs){if(isMd(s))return guard(()=>saveSession(s,saveAs));if(tools.isBusy()){status('本地处理正在进行，请等待完成后保存。');return false;}return s?.dirty&&s.history?.rows.some(r=>r.applied)?history.show(()=>saveSession(s,saveAs)):guard(()=>saveSession(s,saveAs));}
$('saveButton').onclick = () => reviewSave(current(),false);
$('saveAsButton').onclick = () => reviewSave(current(),true);
$('homeButton').onclick = () => activate(null);
for (const button of document.querySelectorAll('[data-home-action]')) button.onclick = () => {
  const action = button.dataset.homeAction;
  if (action === 'tools') $('toolsButton').click();
  else if (action === 'help') $('helpButton').click();
  else if (action === 'recent') $('recentHeading').scrollIntoView({block:'start', behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  else $('home').scrollTo({top:0, behavior:matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
};
for (const button of document.querySelectorAll('[data-tool]')) button.onclick = () => guard(async () => {
  if (!currentPdf()?.loaded) { await open(); if (!currentPdf()?.loaded) return; }
  await tools.open(button.dataset.tool);
});
let dragDepth = 0;
document.addEventListener('dragenter', event => { if (event.dataTransfer.types.includes('Files')) { dragDepth++; document.body.classList.add('fileDragging'); } });
document.addEventListener('dragleave', () => { if (--dragDepth <= 0) { dragDepth=0; document.body.classList.remove('fileDragging'); } });
for (const name of ['drop','dragend']) document.addEventListener(name, () => { dragDepth=0; document.body.classList.remove('fileDragging'); });
window.addEventListener('blur', () => { dragDepth=0; document.body.classList.remove('fileDragging'); });
// Only offer "restore" when the last session actually left tabs behind.
const restoreButton=document.createElement('button');restoreButton.id='restoreButton';restoreButton.className='actionTile';restoreButton.innerHTML='<span class="tileGlyph" data-icon="history" aria-hidden="true"></span><span class="tileText"><strong>恢复上次标签</strong><small></small></span>';restoreButton.hidden=true;restoreButton.onclick=()=>guard(async()=>{await addDocuments(await api.restoreSession());restoreButton.hidden=true;});document.querySelector('.homeActions').append(restoreButton);
(api.lastSessionCount?.()??Promise.resolve(1)).then(n=>{restoreButton.hidden=!n;if(n){restoreButton.title=`重新打开上次关闭时的 ${n} 个标签`;restoreButton.querySelector('small').textContent=`上次关闭时的 ${n} 个标签`;}}).catch(()=>{restoreButton.hidden=false;restoreButton.querySelector('small').textContent='重新打开上次关闭时的标签';});
const recoveryBox=document.createElement('section');recoveryBox.id='recoveryBox';document.getElementById('home').prepend(recoveryBox);
api.recoveryList().then(items=>{for(const item of items){const row=document.createElement('div');row.className='recoveryRow';const label=document.createElement('span');label.textContent=`发现未正常关闭的会话：${item.names.join('、')}（${item.drafts} 份草稿）`;row.append(label);for(const [text,action] of [['恢复',async()=>{await addDocuments(await api.restoreSession(item.token));row.remove();}],['删除备份',async()=>{await api.discardRecovery(item.token);row.remove();}]]){const b=document.createElement('button');b.textContent=text;b.onclick=()=>guard(action);row.append(b);}recoveryBox.append(row);}}).catch(console.warn);
const settings = createSettings({ api, guard, status, markdown, refreshRecent: recent.refresh, version: () => productVersion, windowStyle: windowStyle.info, restart: restartApp,
  theme: {
    mode: theme.mode, set: theme.setMode,
  } });
$('settingsButton').onclick = () => settings.open();
// AI collaboration (0.9.1): the panel on the right, and the bridge that serves the local AI interface.
// Notes mode (0.10.0): two documents side by side. Desktop only.
// Reference details of a PDF: DOI / title / authors, BibTeX, the reference library (0.11.0).
citations = createCitations({ api, guard, status, notesFor: s => notes?.notesFor(s) || null, insertNotes: (note, text) => notes.insertBlock(note, text) });
notes = createNotesMode({ sessions, isMd, activeId: () => activeId, activate, endCompare: () => { if (compareIds) endCompare(); }, api, guard, status, markdown, addDocuments,
  inspect: async s => (await api.toolsJob(s.id, await tools.snapshot(s), { action: 'inspect', annotations: true })).data.notes || [],
  orientation: () => document.documentElement.classList.contains('qyMobile') && innerWidth <= 760 && innerHeight > innerWidth ? 'rows' : 'columns',
  save: note => saveSession(note, false), imageOptions: () => markdown.typora?.imageOptions?.() || {}, cite: s => citations.open(s),
  onChange: (_what, ids) => requestAnimationFrame(() => { for (const key of ids || []) { const s = sessions.get(key); if (s && !isMd(s)) resizePdf(s); } }) });
{
  const button = document.createElement('button'); button.id = 'notesButton'; button.className = 'iconOnly'; button.dataset.icon = 'double'; button.setAttribute('aria-pressed', 'false');
  button.title = '笔记模式：左右双开 · Ctrl+\\'; button.setAttribute('aria-label', '笔记模式'); button.onclick = () => notes.toggle(button, true);
  document.querySelector('.titlebarTools').prepend(button);
}
// Library search (0.11.0): every PDF and Markdown document in the recent list. Desktop only.
if (api.libraryStatus) {
  library = createLibrary({ api, guard, status, sessions, isMd, addDocuments, activate, userError,
    searchPdf: async (s, page, term) => { if (s.view.reflow) await views.change('reflow', false, s); s.app.pdfViewer.currentPageNumber = Math.min(page, s.app.pagesCount); await navigation.search(s, term); } });
  const button = document.createElement('button'); button.id = 'libraryButton'; button.className = 'iconOnly'; button.dataset.icon = 'search';
  button.title = '全库搜索：所有打开过的 PDF 和笔记 · Ctrl+Shift+F'; button.setAttribute('aria-label', '全库搜索'); button.onclick = () => guard(() => library.open());
  document.querySelector('.titlebarTools').prepend(button);
  $('recentSearch').addEventListener('keydown', event => { if (event.key === 'Enter' && $('recentSearch').value.trim()) { event.preventDefault(); guard(() => library.open($('recentSearch').value.trim())); } });
  $('recentSearch').title = '按 Enter 在所有文档的内容里搜索';
}
const aiTools = createDocTools({ sessions, current, activate, markdown, addDocuments, api, views,navigate:action=>readingTrail.record(action), applyEdit, notes });
ai = createAiPanel({ api, guard, status, tools: aiTools, current, openSettings: pane => settings.open(pane), partner: () => notes?.partner(activeId) || null });
window.addEventListener('qingye:ai-config', () => ai.refresh().catch(console.warn));
window.addEventListener('qingye:ai-toggle', () => ai.toggle());
$('aiButton').onclick = () => ai.toggle();
api.onAiBridge?.((id, name, args, meta) => {
  aiTools.run(name, args, { ...meta, source: 'api' })
    .then(value => api.aiBridgeReply(id, true, value), error => api.aiBridgeReply(id, false, { message: userError(error), declined: !!error.declined, status: error.status }))
    .catch(console.warn);
});
$('helpButton').onclick = () => isMd(current()) ? markdown.command(current(), 'helpQuickStart') : message('欢迎使用青页 PDF', '打开：Ctrl+O；搜索：Ctrl+F；切换标签：Ctrl+Tab\n保存：Ctrl+S；另存为：Ctrl+Shift+S；全屏：F11\n\n打开 PDF 后顶部显示 PDF 工具栏：“搜索”“大纲”打开统一导航侧栏（搜索、目录、书签、页面、批注）；“批注”提供高亮、绘制、文本框、签名与评论；“视图”提供页面排列、颜色和阅读裁剪。左下角浮动面板用于翻页与缩放（Ctrl+G 跳转页码）。在页面上单击右键可快速使用批注、页面编辑与页面管理。\n\nMarkdown 文档使用独立的界面：顶部是菜单栏与“阅读 / 编辑 / 源码”切换，底部是字数与光标位置。Ctrl+N 新建，Ctrl+Shift+P 命令面板，Ctrl+P 快速打开。\n\n页面编辑的未应用内容在切到首页或其他标签时保留，回到原文档可继续编辑；关闭文档或切换编辑工具时可以选择继续编辑或明确放弃。工具箱任务期间保存入口暂时禁用，完成后可再保存。\n\n“工具箱”提供本地转换、页面管理、压缩、OCR、原文替换、涂黑、印章、水印、加密、并排比较等功能。应用到当前文档后可撤销，保存才写盘；处理并导出副本不直接覆盖源文件。\n\n文字替换和 Office 转换有版式限制；永久涂黑会删除内容，阅读裁剪与 CropBox 不会删除内容。可视签名和印章不是证书数字签名。完整范围请查看随附使用说明和功能对照。\n\n青页 PDF '+productVersion+' 按 AGPL-3.0 开源，无账号、无会员次数配额。');
document.addEventListener('keydown', shortcuts.handle, true);
document.addEventListener('dragover', event => event.preventDefault());
document.addEventListener('drop', event => { event.preventDefault(); guard(() => dropFiles(event.dataTransfer.files)); });
api.onCommand((command, data) => guard(() => commands.run(command, data)));
setInterval(() => { for (const s of sessions.values()) { try { syncDirty(s); } catch (error) { console.warn(error); } } }, 1000);
setInterval(() => { const s = current(); if (s?.loaded) api.remember(s.id, viewState(s)).catch(console.warn); }, 10000);
setInterval(draft.checkpoint,15000);
theme.apply();
activate(null);
// Settings → "restore last tabs on start": only when nothing was opened from the command line.
// A restart from Settings → Interface style reopens the tabs it closed.
if (settings.values.restoreOnStart || windowStyle.info.relaunched) setTimeout(() => guard(async () => { if (sessions.size) return; if (await api.lastSessionCount?.()) { await addDocuments(await api.restoreSession()); restoreButton.hidden = true; } }), 700);
// Used by the bundled integration runner; no filesystem access is exposed here.
window.qingye = { shapes, markup, annotEdit, compareDiff, notes, library, citations, ai, aiTools, converter, settings, i18n, newMarkdown, open, chrome, markdown, addDocuments, sessions, activate, saveSession, closeTab, syncDirty, commit, sameEdits, views, viewState, navigation, tools, compare, checkpoint: draft.checkpoint, direct, textSelection, applyEdit, historyStep: history.step, replaceDocument,readingTrail,locatePdfSource };
api.ready();
