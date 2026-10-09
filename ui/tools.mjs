import { createOutlineEditor } from './outline.mjs';
import { userError } from './errors.mjs';
import { toolCatalog, categoryOf, toolKey } from './tool-catalog.mjs';
export function createTools({ current, sessions, guard, commit, api, addDocuments, status, compare, applyEdit, onBusyChange=()=>{}, openConverter=()=>{} }) {
  const $=id=>document.getElementById(id);
  const dialog=document.createElement('dialog');dialog.id='toolsDialog';dialog.setAttribute('closedby','any');
  dialog.setAttribute('aria-labelledby','toolsTitle');
  dialog.innerHTML=`<header class="toolsHeading"><div><h2 id="toolsTitle" data-icon="tools">本地 PDF 工具箱</h2><span id="toolDocument"></span></div><div class="toolsQuick"><button id="compareTool" data-icon="compare" title="与另一个已打开文档并排阅读">并排比较</button><button id="newWindowTool" data-icon="window" title="在新窗口中打开当前文档">新窗口</button></div><button id="closeTools" data-icon="x" title="关闭 · Esc" aria-label="关闭工具箱"></button></header>
    <label class="toolActionLabel">操作 <select id="toolAction">
      <optgroup label="转换与处理"><option value="export">PDF 转换 / 导出</option><option value="import">Office / 图片转 PDF</option><option value="organize">合并、拆分与页面管理</option><option value="compress">压缩 PDF</option><option value="ocr">中英文 OCR</option><option value="compare">导出文字差异报告</option></optgroup>
      <optgroup label="编辑与印章"><option value="text">替换区域内原文</option><option value="redact">永久涂黑 / 删除敏感内容</option><option value="stamp">文字印章</option><option value="image">图片印章</option><option value="page-stamp">PDF 页面印章</option><option value="watermark">文字水印</option><option value="number">页码 / 页眉页脚</option><option value="shape">矩形、椭圆与直线</option><option value="annotation">下划线 / 删除线 / 高亮</option><option value="form">创建表单字段</option><option value="crop">修改 PDF 裁剪区域</option><option value="flatten">扁平化批注与表单</option><option value="outline">编辑 PDF 大纲</option></optgroup>
      <optgroup label="安全"><option value="encrypt">密码加密与权限</option><option value="decrypt">移除密码（需管理密码）</option></optgroup><optgroup label="扫描件"><option value="sharpen">PDF 图像锐化</option><option value="scan">扫描件纠偏与背景清理</option></optgroup>
    </select></label>
    <p id="toolHint" class="toolHint"></p>
    <div class="toolsColumns"><div id="toolFields">
      <label data-for="export organize compress ocr scan compare text redact stamp image page-stamp watermark number shape annotation form crop">页码范围 <input id="toolPages" placeholder="留空表示全部；例如 1-3,5"></label>
      <label data-for="export">导出格式 <select id="toolFormat"><option value="docx">Word DOCX · 可编辑文本与图片</option><option value="xlsx">Excel XLSX · 表格 / 逐行文本</option><option value="pptx">PowerPoint PPTX · 每页图像</option><option value="png">PNG 图像 ZIP</option><option value="jpg">JPEG 图像 ZIP</option><option value="svg">SVG 页面 ZIP</option><option value="html">HTML</option><option value="txt">纯文本 TXT</option><option value="csv">CSV 表格 / 文本</option></select></label>
      <label data-for="export compress">图像 DPI <input id="toolDpi" type="number" min="36" max="300" value="144"></label>
      <label data-for="organize">页面操作 <select id="toolPageMode"><option value="extract">提取指定页面</option><option value="reorder">按所填页码重排 / 复制页面</option><option value="delete">删除指定页面</option><option value="rotate">永久旋转指定页面</option><option value="blank">插入空白页</option><option value="split">每页拆成独立 PDF（ZIP）</option><option value="merge">合并其他已打开的 PDF</option></select></label>
      <label data-for="organize">旋转角度 <select id="toolAngle"><option value="90">顺时针 90°</option><option value="180">180°</option><option value="270">顺时针 270°</option></select></label>
      <label data-for="organize">空白页插入位置 <input id="toolPosition" type="number" min="0" value="0" title="0 表示文档开头；1 表示第 1 页之后"></label>
      <label data-for="organize compare page-stamp">合并 / 比较 / 印章来源 <select id="toolOther" multiple aria-label="其他已打开文档"></select></label>
      <label data-for="page-stamp">来源 PDF 的页码 <input id="toolStampPage" type="number" min="1" value="1"></label>
      <div data-for="compare"><label><input id="compareVisual" type="checkbox">标记图像差异（96 DPI，一次最多 200 页）</label><label>对比文档页差 <input id="toolCompareOffset" type="number" value="0"></label></div>
      <label data-for="compress" class="toolCheck"><input id="toolLossy" type="checkbox">降低图像分辨率与质量（有损压缩）</label>
      <label data-for="compress">JPEG 质量 10–100 <input id="toolQuality" type="number" min="10" max="100" value="65"></label>
      <label data-for="ocr" class="toolCheck"><input id="toolForceOcr" type="checkbox">对已有文字的页面也重新 OCR</label>
      <label data-for="sharpen">锐化程度 <select id="toolSharpen"><option value="mild">轻度</option><option value="standard" selected>标准</option><option value="strong">较强</option></select></label>
      <div data-for="scan"><label>顺时针旋转 <select id="scanAngle"><option value="0">不旋转</option><option value="90">90°</option><option value="180">180°</option><option value="270">270°</option></select></label><label><input id="scanDeskew" type="checkbox" checked>自动纠正轻微倾斜（±5°）</label><label><input id="scanClean" type="checkbox" checked>清理浅色背景</label><label><input id="scanGray" type="checkbox">转换为灰度</label><label><input id="scanRecognize" type="checkbox" checked>重新识别中英文文字</label></div>
      <label data-for="text stamp watermark number annotation form">文字 <textarea id="toolText" rows="3" placeholder="印章文字、替换文本、批注内容或字段名称"></textarea></label>
      <label data-for="text stamp watermark number">字号 pt <input id="toolSize" type="number" min="6" max="100" value="18"></label>
      <label data-for="text stamp watermark number shape annotation">颜色 <input id="toolColor" type="color" value="#b91c1c"></label>
      <label data-for="stamp watermark number">透明度 0.05–1 <input id="toolOpacity" type="number" min="0.05" max="1" step="0.05" value="1"></label>
      <label data-for="shape">图形 <select id="toolShape"><option value="rect">矩形</option><option value="ellipse">椭圆</option><option value="line">直线</option></select></label>
      <label data-for="shape" class="toolCheck"><input id="toolFill" type="checkbox">填充图形</label>
      <label data-for="annotation">批注类型 <select id="toolAnnotation"><option value="underline">下划线</option><option value="strikeout">删除线</option><option value="highlight">高亮</option></select></label>
      <label data-for="form">字段类型 <select id="toolFieldType"><option value="text">文本输入框</option><option value="checkbox">复选框</option></select></label>
      <div data-for="image import"><button id="pickToolAsset" data-icon="open">选择文件…</button><span id="toolAssetName"></span></div>
    <label data-for="image" class="toolCheck"><input id="toolKeepRatio" type="checkbox" checked>保持图片比例（框内居中，不拉伸）</label>
      <div data-for="stamp image"><label>常用印章 <select id="stampLibrary"><option value="">选择已保存印章</option></select></label><div class="navigationOptions"><button id="saveStamp">保存到印章库</button><button id="removeStamp">删除选中印章</button><button id="dateStamp">今日日期章</button></div></div>
      <label data-for="encrypt">打开密码 <input id="toolUserPassword" type="password" autocomplete="new-password"></label>
      <label data-for="encrypt">管理密码（必填）<input id="toolOwnerPassword" type="password" autocomplete="new-password"></label>
      <div data-for="encrypt" class="navigationOptions"><label><input id="toolAllowPrint" type="checkbox" checked>允许打印</label><label><input id="toolAllowCopy" type="checkbox" checked>允许复制</label><label><input id="toolAllowEdit" type="checkbox" checked>允许编辑</label></div>
      <label>源 PDF 密码（如有）<input id="toolPassword" type="password" autocomplete="off" placeholder="移除限制需填写管理密码"></label>
      <div data-for="outline"><button id="readOutline">重新读取文档目录</button><div id="outlineEditor"></div><details><summary>按文本批量填写</summary><label>每行：层级 | 页码 | 标题<textarea id="toolOutline" rows="6" spellcheck="false"></textarea></label><button id="importOutlineText">导入到目录草稿</button></details></div>
      <label data-for="export compress ocr scan sharpen flatten encrypt decrypt stamp watermark number" class="toolCheck"><input id="toolBatch" type="checkbox">批量处理全部已打开文档</label>
    </div><section id="toolPreviewSection"><label>预览页码 <input id="toolPreviewPage" type="number" min="1" value="1"><button id="refreshToolPreview">刷新</button></label><p class="toolHint">按原 PDF 方向预览。拖动框选区域；相同相对位置应用到指定页。</p><div id="toolCanvasWrap"><canvas id="toolCanvas"></canvas><div id="toolSelection"></div></div><div id="regionFields"><label>左 % <input id="regionLeft" type="number" min="0" max="100"></label><label>上 % <input id="regionTop" type="number" min="0" max="100"></label><label>右 % <input id="regionRight" type="number" min="0" max="100"></label><label>下 % <input id="regionBottom" type="number" min="0" max="100"></label></div><div data-for="text"><button id="readTextBlocks">读取本页原文块</button><select id="toolBlocks" aria-label="原文块"><option value="">选择原文区域</option></select></div></section></div>
    <p id="toolChangeSummary" class="toolHint"></p><footer class="toolsFooter"><div><progress id="jobProgress" max="1" value="0" hidden></progress><span id="toolProgress" role="status"></span></div><div class="spacer"></div><button id="retryTools" hidden>重试失败项</button><button id="cancelTools" hidden>取消任务</button><button id="applyToolDraft" data-icon="check">应用到当前文档 · 可撤销</button><button id="executeTool" class="primary" data-icon="drop">处理并导出副本</button></footer>`;
  document.body.append(dialog);
  function setBusy(value){busy=value;dialog.closedBy=value?'none':'any';onBusyChange();drawCards();if(value)status('本地处理正在进行，完成后可保存。');}
  const regions=new Set(['text','redact','stamp','image','page-stamp','watermark','number','shape','annotation','form','crop']);
  const hints={
    export:'完全本地转换。DOCX 导出可编辑文字与图片；XLSX 识别表格；PPTX 为页面图像。复杂版式和公式不保证保真。',
    import:'现代 Office、图片、文本、HTML、EPUB、XPS、CBZ、SVG 转 PDF。Office 使用内容重排，原分页与复杂版式可能变化。',
    organize:'页码可重复或倒序，例如 3,1-2,2。合并按列表中选中的文档顺序追加；原文件保留。',
    compress:'清理未使用对象并压缩流、字体。可选图像降采样；无法变小时保留原始数据。',
    ocr:'本地中英文 OCR，识别页生成 200 DPI 图像与可搜索文字层。扫描质量影响准确率，请复核识别结果。',
    scan:'按 200 DPI 重新生成所选页面，可纠正 ±5° 文本页倾斜、清理浅色背景、手动旋转，并重新 OCR。原页面对象和批注将变为图像外观；照片、彩色图表请关闭背景清理。',
    sharpen:'增强整份 PDF 内嵌图像的边缘，保留文字、页面和批注；不恢复已丢失的细节。较强锐化可能带来光晕或噪点，建议先用标准档检查输出。',
    text:'删除框选区域内的原文字，再写入替换文本。不是 Word 式段落编辑；字体和布局可能变化。',
    redact:'删除框选区域内文字、图像及相交图形，同时清理元数据、附件、脚本，并扁平化批注与表单。导出后请检查区域和相邻内容。',
    stamp:'在框选区域写入带边框的文字印章，不是证书数字签名。',
    image:'将本地图片作为印章写入框选区域，默认保持图片比例、在框内居中，不是证书数字签名。',
    'page-stamp':'将另一个已打开 PDF 的指定页面缩放到框选区域，作为矢量页面印章。',
    number:'使用 {page} 与 {total} 作为页码占位符，框选页眉或页脚区域。',
    watermark:'在所选页面的框选区域写入文字水印，可调整透明度。',
    shape:'在框选区域绘制图形；直线连接区域的左上与右下。',
    annotation:'对框选区域添加可被其他阅读器识别的标准 PDF 批注。',
    form:'在框选区域创建可填写的文本或复选框字段，字段名按页码区分。',
    crop:'将框选区域设为 PDF 页面的 CropBox。区域外内容仍在文件中；删除敏感内容请用永久涂黑。',
    flatten:'将批注、可视签名和表单外观写入页面，不再作为可编辑批注或字段。',
    outline:'直接修改章节标题和页码。选择左侧把手可调整层级、绑定当前页或删除分支；拖动把手移动整个分支。自动识别结果可编辑，导出副本后生效。',
    encrypt:'使用 AES-256。打开密码可留空；管理密码必须填写且与打开密码不同。权限限制依赖阅读器遵守。',
    decrypt:'输入该 PDF 的管理密码后导出不加密副本；不会尝试破解密码。',
    compare:'导出逐页文字或图像差异 HTML。页差用于对齐不同封面页；图像比较按左上角对齐，字体抗锯齿与排版移动也会产生差异。',
  };
  let toolSession,asset,blocks=[],rect=[.15,.15,.75,.3],previewTask,previewTicket=0,busy=false,canceled=false,activeJob,failed=[],retryState;
  // 0.15.0: categories and tool cards come from tool-catalog.mjs (shared with the toolbar menu and the home page).
  // The <select id="toolAction"> stays as the single source of the current action; the cards only set it.
  const categories=document.createElement('nav');categories.className='toolCategories';categories.setAttribute('aria-label','工具分类');dialog.querySelector('.toolsHeading').after(categories);
  const cards=document.createElement('div');cards.className='toolCards';cards.setAttribute('role','group');cards.setAttribute('aria-label','工具');dialog.querySelector('.toolActionLabel').after(cards);
  let shownCategory=toolCatalog[0];
  for(const c of toolCatalog){const b=document.createElement('button');b.type='button';b.dataset.category=c.id;b.dataset.icon=c.icon;b.innerHTML='<span class="catText"><b></b><small></small></span>';b.querySelector('b').textContent=c.label;b.querySelector('small').textContent=c.note;
    b.onclick=()=>guard(async()=>{const first=c.tools.find(t=>t.action&&(t.action==='import'||toolSession));shownCategory=c;if(first)await pick(first);else drawCards();});categories.append(b);}
  const pageMode=()=>$('toolPageMode').value;
  function drawCards(){
    const a=action(),current=toolKey({action:a,mode:a==='organize'?pageMode():undefined});
    for(const b of categories.children)b.setAttribute('aria-pressed',String(b.dataset.category===shownCategory.id));
    cards.replaceChildren(...shownCategory.tools.map(t=>{const b=document.createElement('button');b.type='button';b.className='toolCard';b.dataset.icon=t.icon;b.dataset.toolKey=toolKey(t);
      const label=document.createElement('span');label.textContent=t.label;b.append(label);
      b.setAttribute('aria-pressed',String(toolKey(t)===current));b.disabled=!!busy||(!!t.action&&t.action!=='import'&&!toolSession)||(!!t.compareView&&!toolSession);
      b.onclick=()=>guard(()=>pick(t));return b;}));
  }
  async function pick(t){
    if(t.converter){dialog.close();openConverter();return;}
    if(t.compareView){$('compareTool').click();return;}
    $('toolAction').value=t.action;await changed();
    if(t.mode){$('toolPageMode').value=t.mode;$('toolPageMode').dispatchEvent(new Event('change',{bubbles:true}));drawCards();}
  }
  $('toolPageMode').addEventListener('change',()=>drawCards());
  api.onJobProgress((id,data)=>{if(id!==activeJob)return;$('jobProgress').max=Math.max(1,data.total);$('jobProgress').value=data.done;$('toolProgress').textContent=`${data.label||'处理中'} · ${data.done} / ${data.total}`;});
  const action=()=>$('toolAction').value;
  async function snapshot(s){commit(s);return s.app.pdfDocument.annotationStorage.size?await s.app.pdfDocument.saveDocument():await s.app.pdfDocument.getData();}
  async function inspect(s=toolSession){return api.toolsJob(s.id,await snapshot(s),{action:'inspect',page:Number($('toolPreviewPage').value)||1,password:$('toolPassword').value});}
  function selection(){
    const box=$('toolSelection');Object.assign(box.style,{left:rect[0]*100+'%',top:rect[1]*100+'%',width:(rect[2]-rect[0])*100+'%',height:(rect[3]-rect[1])*100+'%'});
    ['regionLeft','regionTop','regionRight','regionBottom'].forEach((id,i)=>{$(id).value=Math.round(rect[i]*1000)/10;});
  }
  // Resize the selection to the picked picture's aspect ratio, contain-fitted
  // inside the current box on the actual first-page geometry, centered.
  async function fitRectToAsset(){
    if(action()!=='image'||!asset?.width||!asset?.height||!toolSession)return;
    const viewport=(await toolSession.app.pdfDocument.getPage(1)).getViewport({scale:1});
    const [x0,y0,x1,y1]=rect,boxW=(x1-x0)*viewport.width,boxH=(y1-y0)*viewport.height,ratio=asset.width/asset.height;
    let w=boxW,h=boxH;if(boxW/boxH>ratio)w=boxH*ratio;else h=boxW/ratio;
    const cx=(x0+x1)/2,cy=(y0+y1)/2;
    rect=[Math.max(0,cx-w/2/viewport.width),Math.max(0,cy-h/2/viewport.height),Math.min(1,cx+w/2/viewport.width),Math.min(1,cy+h/2/viewport.height)];
    selection();updateSummary();
  }
  async function preview(){
    if(!regions.has(action())||!toolSession)return;
    const myTicket=++previewTicket;previewTask?.cancel();
    const pageNumber=Math.max(1,Math.min(toolSession.app.pagesCount,Number($('toolPreviewPage').value)||1));$('toolPreviewPage').value=pageNumber;
    const page=await toolSession.app.pdfDocument.getPage(pageNumber);if(myTicket!==previewTicket)return;
    const original=page.getViewport({scale:1});const viewport=page.getViewport({scale:Math.min(500/original.width,340/original.height)});
    const canvas=$('toolCanvas');canvas.width=viewport.width;canvas.height=viewport.height;$('toolCanvasWrap').style.width=viewport.width+'px';
    previewTask=page.render({canvasContext:canvas.getContext('2d'),viewport});
    try{await previewTask.promise;}catch(e){if(e.name!=='RenderingCancelledException')throw e;}
    selection();
  }
  const outlineEditor=createOutlineEditor({container:$('outlineEditor'),currentPage:()=>toolSession.app.pdfViewer.currentPageNumber,pageCount:()=>toolSession.app.pagesCount,guard,generate:async()=>{const r=await api.toolsJob(toolSession.id,await snapshot(toolSession),{action:'inspect',headings:true,password:$('toolPassword').value});return r.data.headings;}});
  async function populateOutline(){const result=await inspect();outlineEditor.set(result.data.toc);$('toolOutline').value=result.data.toc.map(([level,title,page])=>`${level} | ${page} | ${title}`).join('\n');}
  async function changed(){
    const a=action();$('toolHint').textContent=hints[a];$('applyToolDraft').hidden=!['organize','outline','text','stamp','image','watermark','shape','annotation','crop','sharpen'].includes(a);
    if(!shownCategory.tools.some(t=>t.action===a))shownCategory=categoryOf(a,a==='organize'?pageMode():undefined);
    for(const element of dialog.querySelectorAll('[data-for]'))element.hidden=!element.dataset.for.split(' ').includes(a);
    $('toolPreviewSection').hidden=!regions.has(a);$('executeTool').disabled=a!=='import'&&!toolSession;
    $('toolPages').value=regions.has(a)?String(toolSession?.app.pdfViewer.currentPageNumber||1):'';
    if(a==='number')$('toolText').value='{page} / {total}';else if(a==='stamp')$('toolText').value='已审核';else if(a==='watermark')$('toolText').value='水印';else if(a==='form')$('toolText').value='字段';else $('toolText').value='';
    if(a==='number')rect=[.4,.92,.65,.98];else if(a==='watermark')rect=[.2,.4,.8,.55];else rect=[.15,.15,.75,.3];
    $('toolOther').replaceChildren();for(const s of sessions.values())if(s!==toolSession&&s.loaded){const o=document.createElement('option');o.value=s.id;o.textContent=s.name;$('toolOther').append(o);}
    if(a==='outline'&&toolSession)await populateOutline();
    if(['stamp','image'].includes(a))await refreshStamps();
    if(a==='image')await fitRectToAsset();
    if(regions.has(a))await preview();updateSummary();drawCards();
  }
  async function open(next='export',{mode,category}={}){
    if(busy)return;toolSession=current()?.loaded?current():null;
    $('toolDocument').textContent=toolSession?.name||'请先打开 PDF，或选择文件转换为 PDF';
    $('toolAction').value=toolSession?next:'import';$('toolProgress').textContent='';$('toolBatch').checked=false;failed=[];retryState=null;$('retryTools').hidden=true;
    $('toolPreviewPage').value=toolSession?.app.pdfViewer.currentPageNumber||1;
    $('toolPassword').value='';$('toolUserPassword').value='';$('toolOwnerPassword').value='';
    $('compareTool').disabled=$('newWindowTool').disabled=!toolSession;
    shownCategory=toolCatalog.find(c=>c.id===category)||categoryOf(toolSession?next:'import',mode);
    dialog.style.setProperty('--tools-top', Math.max(56, Math.ceil($('pdfToolbar').getBoundingClientRect().bottom) + 8) + 'px');
    if(!dialog.open)dialog.showModal();await changed();
    if(mode&&toolSession&&$('toolAction').value==='organize'){$('toolPageMode').value=mode;$('toolPageMode').dispatchEvent(new Event('change',{bubbles:true}));}
    drawCards();
  }
  function request(){
    const a=action();
    const r={action:a,pages:$('toolPages').value,password:$('toolPassword').value,rect:[...rect],format:$('toolFormat').value,dpi:Number($('toolDpi').value),mode:$('toolPageMode').value,angle:Number($('toolAngle').value),position:Number($('toolPosition').value),lossy:$('toolLossy').checked,quality:Number($('toolQuality').value),force:$('toolForceOcr').checked,text:$('toolText').value,size:Number($('toolSize').value),color:$('toolColor').value,opacity:Number($('toolOpacity').value),shape:$('toolShape').value,fill:$('toolFill').checked,annotation:$('toolAnnotation').value,fieldType:$('toolFieldType').value,userPassword:$('toolUserPassword').value,ownerPassword:$('toolOwnerPassword').value,print:$('toolAllowPrint').checked,copy:$('toolAllowCopy').checked,edit:$('toolAllowEdit').checked,assetToken:asset?.token,keepRatio:$('toolKeepRatio').checked};
    if(a==='page-stamp')r.stampPage=Number($('toolStampPage').value);
    if(a==='scan')Object.assign(r,{angle:Number($('scanAngle').value),deskew:$('scanDeskew').checked,clean:$('scanClean').checked,gray:$('scanGray').checked,recognize:$('scanRecognize').checked});
    if(a==='sharpen')Object.assign(r,{pages:'',strength:$('toolSharpen').value});
    if(a==='compare')Object.assign(r,{visual:$('compareVisual').checked,offset:Number($('toolCompareOffset').value)});
    if(a==='outline')r.toc=outlineEditor.get();
    return r;
  }
  function updateSummary(){try{const r=request();$('toolChangeSummary').textContent='修改预览：'+$('toolAction').selectedOptions[0].textContent+' · 页码：'+(r.pages||'全部')+(r.text?' · 文字：'+r.text.slice(0,70):'')+(r.toc?' · '+r.toc.length+' 个章节':'')+'。处理并导出副本不会覆盖源文件。';}catch{}}
  dialog.addEventListener('input',updateSummary);dialog.addEventListener('change',updateSummary);
  async function execute(retry=false){
    if(busy)return;
    const r=retry?retryState.request:request();if(r.action!=='import'&&!toolSession)throw new Error('请先打开 PDF。');
    if(['image','import'].includes(r.action)&&!asset)throw new Error('请先选择文件。');
    const selected=Array.from($('toolOther').selectedOptions).map(o=>sessions.get(o.value)).filter(Boolean);
    if(['compare','page-stamp'].includes(r.action)&&selected.length!==1)throw new Error('此操作需要选择一个其他文档。');
    if(r.action==='organize'&&r.mode==='merge'&&!selected.length)throw new Error('请选择至少一个待合并文档。');
    const batch=$('toolBatch').checked&&!$('toolBatch').closest('[data-for]').hidden;
    const token=retry?retryState.token:batch?await api.batchFolder():null;if(batch&&!token)return;
    setBusy(true);dialog.classList.add('toolBusy');$('executeTool').disabled=true;$('closeTools').disabled=true;
    canceled=false;$('cancelTools').hidden=false;$('jobProgress').hidden=false;$('retryTools').hidden=true;
    const targets=retry?failed.map(id=>sessions.get(id)).filter(s=>s?.loaded):batch?[...sessions.values()].filter(s=>s.loaded):[toolSession];failed=[];retryState={request:r,token};
    try{
      const reports=[];
      for(let n=0;n<targets.length;n++){
        if(canceled)break;
        const s=targets[n];$('toolProgress').textContent=`正在处理 ${n+1} / ${targets.length}：${s?.name||asset.name}`;
        activeJob=crypto.randomUUID();const job={...r,batchToken:token,jobId:activeJob};
        if((r.action==='organize'&&r.mode==='merge')||['compare','page-stamp'].includes(r.action)){job.mergeInputs=[];for(const other of selected)job.mergeInputs.push({id:other.id,bytes:await snapshot(other)});}
        let result;try{result=await api.toolsJob(s?.id,s?await snapshot(s):null,job);}catch(error){if(canceled)break;if(!batch&&!retry)throw error;failed.push(s.id);reports.push(`${s.name}：失败 · ${userError(error)}`);continue;}
        if(result.canceled){$('toolProgress').textContent='已取消导出';return;}
        if(result.unchanged){reports.push(result.note);continue;}
        if(result.opened?.length)await addDocuments(result.opened);
        reports.push(result.path||'已生成结果');if(result.note)reports.push(result.note);
      }
      $('toolProgress').textContent=(canceled?'已取消任务；已输出的副本保留。\n':'')+reports.join('\n');status(canceled?'任务已取消':failed.length?'部分任务失败，可重试':'本地处理完成');
      $('toolPassword').value='';$('toolUserPassword').value='';$('toolOwnerPassword').value='';
    }finally{setBusy(false);activeJob=null;dialog.classList.remove('toolBusy');$('executeTool').disabled=false;$('closeTools').disabled=false;$('cancelTools').hidden=true;$('jobProgress').hidden=true;$('retryTools').hidden=!failed.length;}
  }
  $('applyToolDraft').onclick=()=>guard(async()=>{if(busy||!toolSession)return;const r=request();if(r.action==='organize'&&r.mode==='merge'){r.mergeInputs=[];for(const option of $('toolOther').selectedOptions){const other=sessions.get(option.value);r.mergeInputs.push({id:other.id,bytes:await snapshot(other)});}}setBusy(true);$('applyToolDraft').disabled=true;try{await applyEdit(toolSession,r,$('toolAction').selectedOptions[0].textContent+' · '+(r.pages||'全部页')+(r.action==='outline'?' · '+r.toc.length+' 个章节':''));dialog.close();}finally{setBusy(false);$('applyToolDraft').disabled=false;}});
  const close=()=>{if(!busy)dialog.close();};
  $('toolsButton').onclick=()=>guard(()=>dialog.open?close():open());$('toolAction').onchange=()=>guard(changed);
  $('executeTool').onclick=()=>guard(execute);$('closeTools').onclick=close;dialog.addEventListener('cancel',e=>{if(busy)e.preventDefault();});
  $('cancelTools').onclick=()=>{canceled=true;if(activeJob)api.cancelJob(activeJob).catch(console.warn);$('toolProgress').textContent='正在取消…';};$('retryTools').onclick=()=>guard(()=>execute(true));
  $('pickToolAsset').onclick=()=>guard(async()=>{const picked=await api.pickAsset(action()==='import'?'import':'image');if(picked){asset=picked;$('toolAssetName').textContent=picked.name;if(action()==='image')await fitRectToAsset();}});
  async function refreshStamps(){const list=await api.stampLibrary('list');$('stampLibrary').replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent='选择已保存印章';$('stampLibrary').append(empty);for(const stamp of list){const o=document.createElement('option');o.value=stamp.id;o.textContent=stamp.name;$('stampLibrary').append(o);}}
  $('saveStamp').onclick=()=>guard(async()=>{const r=request();await api.stampLibrary('add',{...r,kind:action()==='image'?'image':'stamp',name:action()==='image'?asset?.name:r.text.slice(0,30)||'文字印章',width:asset?.width,height:asset?.height});await refreshStamps();$('toolProgress').textContent='已保存到本机印章库';});
  $('removeStamp').onclick=()=>guard(async()=>{if(!$('stampLibrary').value)return;await api.stampLibrary('remove',$('stampLibrary').value);await refreshStamps();});
  $('stampLibrary').onchange=()=>guard(async()=>{if(!$('stampLibrary').value)return;const stamp=await api.stampLibrary('load',$('stampLibrary').value);$('toolAction').value=stamp.kind;await changed();if(stamp.asset){asset=stamp.asset;$('toolAssetName').textContent=asset.name;await fitRectToAsset();}else for(const [key,id]of [['text','toolText'],['size','toolSize'],['color','toolColor'],['opacity','toolOpacity']])$(id).value=stamp.settings[key];});
  $('dateStamp').onclick=()=>guard(async()=>{$('toolAction').value='stamp';await changed();const now=new Date();$('toolText').value=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;});
  $('readOutline').onclick=()=>guard(populateOutline);$('importOutlineText').onclick=()=>guard(()=>{outlineEditor.set($('toolOutline').value.split('\n').filter(x=>x.trim()).map(line=>{const [level,page,...title]=line.split('|');if(!title.length)throw new Error('目录格式：层级 | 页码 | 标题');return[Number(level.trim()),title.join('|').trim(),Number(page.trim())];}));});
  $('refreshToolPreview').onclick=()=>guard(preview);$('toolPreviewPage').onchange=()=>guard(preview);
  $('readTextBlocks').onclick=()=>guard(async()=>{const result=await inspect();blocks=result.data.blocks;$('toolBlocks').replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent='选择原文区域';$('toolBlocks').append(empty);blocks.forEach((b,i)=>{const o=document.createElement('option');o.value=i;o.textContent=b.text.replace(/\s+/g,' ').slice(0,80);$('toolBlocks').append(o);});});
  $('toolBlocks').onchange=()=>{if($('toolBlocks').value==='')return;const b=blocks[Number($('toolBlocks').value)];rect=b.rect.map(x=>Math.max(0,Math.min(1,x)));$('toolText').value=b.text;selection();};
  for(const id of ['regionLeft','regionTop','regionRight','regionBottom'])$(id).onchange=()=>{rect=['regionLeft','regionTop','regionRight','regionBottom'].map(id=>Number($(id).value)/100);selection();};
  const wrap=$('toolCanvasWrap');let start;
  const point=e=>{const box=wrap.getBoundingClientRect();return[Math.max(0,Math.min(1,(e.clientX-box.left)/box.width)),Math.max(0,Math.min(1,(e.clientY-box.top)/box.height))];};
  wrap.onpointerdown=e=>{start=point(e);wrap.setPointerCapture(e.pointerId);e.preventDefault();};
  wrap.onpointermove=e=>{if(!start)return;const end=point(e);rect=[Math.min(start[0],end[0]),Math.min(start[1],end[1]),Math.max(start[0],end[0]),Math.max(start[1],end[1])];selection();};
  wrap.onpointerup=()=>{start=null;};wrap.onpointercancel=()=>{start=null;};
  $('newWindowTool').onclick=()=>guard(async()=>{if(toolSession.dirty)throw new Error('请先保存当前批注，再在新窗口中打开。');await api.newWindow(toolSession.id);});
  $('compareTool').onclick=()=>guard(async()=>{const picked=$('toolOther').selectedOptions[0]?.value;const other=sessions.get(picked)||[...sessions.values()].find(s=>s!==toolSession&&s.loaded);if(!other)throw new Error('请先打开另一个 PDF 文档。');dialog.close();return compare(toolSession.id,other.id);});
  return {open,execute,snapshot,outlineEditor,isBusy:()=>busy};
}
