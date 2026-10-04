import { userError } from './errors.mjs';
import { ANNOTATION_TOOLS, menuItem, menuLabel, menuSep, menuKeys } from './chrome.mjs';
export function createDirectEditing({current,guard,api,applyEdit,navigation,tools,historyStep,status,notesFor,excerpt,region,cite}){
  const $=id=>document.getElementById(id);
  const bar=document.createElement('section');bar.id='directEditor';bar.hidden=true;
  bar.setAttribute('aria-label','页面编辑');bar.innerHTML=`<strong>页面编辑</strong><select id="directKind" aria-label="编辑类型"><option value="watermark">添加文字</option><option value="text">替换区域原文</option><option value="stamp">文字印章</option><option value="image">图片印章</option><option value="watermark-all">文字水印（全部页）</option><option value="shape">图形</option></select><textarea id="directText" aria-label="文字内容" rows="2">新文字</textarea><label>字号 <input id="directSize" type="number" min="6" max="100" value="18"></label><input id="directColor" type="color" value="#b91c1c" aria-label="文字颜色"><label>透明度 <input id="directOpacity" type="range" min="5" max="100" value="100"></label><select id="directShape" aria-label="图形"><option value="rect">矩形</option><option value="ellipse">椭圆</option><option value="line">直线</option></select><button id="directAsset" data-icon="image">选择图片</button><button id="directApply" class="primary" data-icon="check">应用 · 可撤销</button><button id="directClose" data-icon="x">取消编辑</button><span id="directStatus" role="status">拖动框移动，拖动右下角缩放；自动生成实际 PDF 预览。</span>`;
  document.body.append(bar);
  const menu=document.createElement('div');menu.id='pageContextMenu';menu.hidden=true;menu.setAttribute('role','menu');menu.setAttribute('aria-label','页面操作');document.body.append(menu);menuKeys(menu,()=>{hideMenu();current()?.frame.focus();});
  let session,pageView,box,exactCanvas,rect=[.15,.2,.65,.35],timer,ticket=0,jobId,asset,renderTask,previewDocument,applying=false,editorScale=1,openedKind;
  const clamp=(n,a,b)=>Math.max(a,Math.min(b,n));
  function select(id){
    hideMenu();if(!session)return;bar.hidden=session.id!==id;
    if(bar.hidden){clearTimeout(timer);ticket++;if(jobId)api.cancelJob(jobId).catch(()=>{});jobId=null;renderTask?.cancel();previewDocument?.destroy();previewDocument=null;exactCanvas?.remove();exactCanvas=null;box.firstChild.style.visibility='visible';}
    else requestAnimationFrame(()=>{if(session?.id===id&&!bar.hidden)draw();});
  }
  async function discard(id){if(!session||session.id!==id)return true;if(applying||!await api.confirmDiscardEdit(session.name))return false;close();return true;}
  function close(){clearTimeout(timer);ticket++;if(jobId)api.cancelJob(jobId).catch(()=>{});jobId=null;renderTask?.cancel();previewDocument?.destroy();previewDocument=null;box?.remove();exactCanvas?.remove();box=null;exactCanvas=null;bar.hidden=true;session=null;}
  function request(){
    const kind=$('directKind').value,size=$('directSize').valueAsNumber,opacity=$('directOpacity').valueAsNumber/100,color=$('directColor').value;
    if(!Number.isFinite(size)||size<6||size>100)throw new Error('字号应在 6–100 之间，请修改后重试。');
    if(!Number.isFinite(opacity)||opacity<.05||opacity>1)throw new Error('透明度应在 5%–100% 之间。');
    if(!/^#[\da-fA-F]{6}$/.test(color))throw new Error('请选择有效的文字颜色。');
    return {action:kind==='watermark-all'?'watermark':kind,pages:kind==='watermark-all'?'':String(pageView.id),rect:[...rect],text:$('directText').value,size,color,opacity,shape:$('directShape').value,assetToken:asset?.token};
  }
  function draw(){
    if(!box||!session||bar.hidden)return;ticket++;clearTimeout(timer);renderTask?.cancel();if(jobId){api.cancelJob(jobId).catch(()=>{});jobId=null;}
    pageView=session.app.pdfViewer.getPageView(pageView.id-1);if(box.parentNode!==pageView.div)pageView.div.append(box);
    Object.assign(box.style,{left:rect[0]*100+'%',top:rect[1]*100+'%',width:(rect[2]-rect[0])*100+'%',height:(rect[3]-rect[1])*100+'%'});
    box.firstChild.style.visibility='visible';exactCanvas?.remove();exactCanvas=null;
    let r;try{r=request();}catch(error){$('directApply').disabled=true;$('directStatus').textContent=error.message;return;}
    $('directApply').disabled=applying;Object.assign(box.firstChild.style,{fontSize:r.size*pageView.viewport.scale+'px',color:r.color,opacity:r.opacity,border:r.action==='stamp'?'2px solid currentColor':'none'});
    box.firstChild.textContent=r.action==='image'?'图片印章':r.action==='shape'?'图形预览':r.text;timer=setTimeout(()=>guard(preview),650);
  }
  async function preview(){
    clearTimeout(timer);if(!session||bar.hidden||applying)return;const s=session,pv=pageView,myTicket=++ticket;
    if(jobId)api.cancelJob(jobId).catch(()=>{});jobId=crypto.randomUUID();const id=jobId;
    $('directStatus').textContent='正在生成实际 PDF 预览…';
    try{
      const r=request();const result=await api.toolsJob(s.id,await tools.snapshot(s),{...r,pages:String(pv.id),draft:true,jobId:id});if(myTicket!==ticket||session!==s)return;
      const lib=s.frame.contentWindow.pdfjsLib;
      previewDocument?.destroy();const loading=lib.getDocument({data:new Uint8Array(result.bytes),ownerDocument:s.frame.contentDocument,enableScripting:false,isEvalSupported:false,cMapUrl:new URL('../vendor/pdfjs/web/cmaps/',location.href).href,cMapPacked:true,standardFontDataUrl:new URL('../vendor/pdfjs/web/standard_fonts/',location.href).href,wasmUrl:new URL('../vendor/pdfjs/web/wasm/',location.href).href});const doc=await loading.promise;
      if(myTicket!==ticket||session!==s){await loading.destroy();return;}previewDocument=loading;
      const page=await doc.getPage(pv.id),canvas=s.frame.contentDocument.createElement('canvas');canvas.className='directExactPreview';
      const viewport=page.getViewport({scale:pv.viewport.scale,rotation:pv.viewport.rotation});canvas.width=viewport.width;canvas.height=viewport.height;Object.assign(canvas.style,{position:'absolute',inset:'0',width:'100%',height:'100%',pointerEvents:'none',zIndex:'45'});
      renderTask=page.render({canvasContext:canvas.getContext('2d'),viewport});await renderTask.promise;
      if(myTicket!==ticket||session!==s)return;exactCanvas?.remove();exactCanvas=canvas;pv.div.append(canvas);box.firstChild.style.visibility='hidden';$('directStatus').textContent='实际 PDF 预览 · 尚未应用；拖动框或更改文字后自动更新';
    }catch(error){if(myTicket===ticket&&session===s){$('directStatus').textContent='预览未完成：'+userError(error);box.firstChild.style.visibility='visible';}}
    finally{if(jobId===id)jobId=null;}
  }
  async function open(kind='watermark',point){
    if(applying)return false;if(session&&!await api.confirmDiscardEdit(session.name)){$('directKind').value=openedKind;return false;}
    close();const s=current();if(!s?.loaded)return;if(s.view.reflow)throw new Error('请先关闭文字重排，再编辑页面。');
    await s.app.pdfViewer.onePageRendered;await new Promise(resolve=>s.frame.contentWindow.requestAnimationFrame(()=>s.frame.contentWindow.requestAnimationFrame(resolve)));
    const pv=s.app.pdfViewer.getPageView((point?.page||s.app.pdfViewer.currentPageNumber)-1);if(!pv)return;
    // Backend regions follow the PDF page's intrinsic rotation, so reset temporary reading rotation.
    s.app.pdfViewer.pagesRotation=0;session=s;pageView=pv;editorScale=pv.viewport.scale;asset=null;rect=point?[clamp(point.x,0,.7),clamp(point.y,0,.8),clamp(point.x+.3,.3,1),clamp(point.y+.15,.15,1)]:[.15,.2,.65,.35];
    openedKind=kind;$('directKind').value=kind;$('directAsset').hidden=kind!=='image';$('directShape').hidden=kind!=='shape';$('directText').hidden=['image','shape'].includes(kind);$('directText').value=kind==='stamp'?'已审核':kind==='watermark-all'?'水印':'新文字';$('directOpacity').value=kind==='watermark-all'?30:100;bar.hidden=false;
    box=s.frame.contentDocument.createElement('div');box.className='directEditBox';Object.assign(box.style,{position:'absolute',border:'2px dashed #1689cf',zIndex:'46',cursor:'move',touchAction:'none',boxSizing:'border-box'});
    const text=s.frame.contentDocument.createElement('div');Object.assign(text.style,{position:'absolute',inset:'0',overflow:'hidden',whiteSpace:'pre-wrap',fontFamily:'sans-serif',padding:kind==='stamp'?'6px':'0',pointerEvents:'none'});
    const handle=s.frame.contentDocument.createElement('button');handle.setAttribute('aria-label','缩放编辑区域');Object.assign(handle.style,{position:'absolute',right:'-7px',bottom:'-7px',width:'16px',height:'16px',padding:'0',background:'#1689cf',border:'2px solid white',cursor:'nwse-resize'});box.append(text,handle);pv.div.append(box);
    let drag;
    box.onpointerdown=e=>{e.preventDefault();e.stopPropagation();const bounds=pv.div.getBoundingClientRect();drag={x:e.clientX,y:e.clientY,width:bounds.width,height:bounds.height,rect:[...rect],resize:e.target===handle,font:Number($('directSize').value)};box.setPointerCapture(e.pointerId);};
    box.onpointermove=e=>{if(!drag)return;const dx=(e.clientX-drag.x)/drag.width,dy=(e.clientY-drag.y)/drag.height,r=drag.rect;if(drag.resize){rect=[r[0],r[1],clamp(r[2]+dx,r[0]+.02,1),clamp(r[3]+dy,r[1]+.02,1)];if(!['image','shape'].includes($('directKind').value))$('directSize').value=clamp(Math.round(drag.font*(rect[2]-rect[0])/(r[2]-r[0])),6,100);}else{const x=clamp(r[0]+dx,0,1-(r[2]-r[0])),y=clamp(r[1]+dy,0,1-(r[3]-r[1]));rect=[x,y,x+r[2]-r[0],y+r[3]-r[1]];}text.style.visibility='visible';draw();};
    box.onpointerup=box.onpointercancel=()=>{drag=null;};draw();
  }
  async function apply(){if(!session||applying)return;const s=session,r=request();applying=true;$('directApply').disabled=true;clearTimeout(timer);ticket++;if(jobId)await api.cancelJob(jobId);const label={text:'替换原文',stamp:'文字印章',image:'图片印章',watermark:'添加文字 / 水印',shape:'绘制图形'}[r.action]+` · ${r.pages?'第 '+r.pages+' 页':'全部页'} · ${r.text.slice(0,40)}`;
    try{await applyEdit(s,r,label);close();}finally{applying=false;$('directApply').disabled=false;}
  }
  function hideMenu(){menu.hidden=true;}
  function context(s,e){
    const page=e.target.closest('.page');if(!page||e.target.closest('input,textarea,[contenteditable=true]'))return;
    // Touch: a long press on text starts a selection (the selection bar offers the actions); the page menu is for blank areas.
    if(document.documentElement.classList.contains('qyMobile')&&e.target.closest('.textLayer')&&e.target!==e.target.closest('.textLayer'))return;
    e.preventDefault();e.stopPropagation();hideMenu();if(applying)return;
    if(current()!==s)return;const bounds=page.getBoundingClientRect(),point={page:Number(page.dataset.pageNumber),x:(e.clientX-bounds.left)/bounds.width,y:(e.clientY-bounds.top)/bounds.height};s.app.pdfViewer.currentPageNumber=point.page;
    menu.replaceChildren();let choosing=false;
    const run=(action,discard)=>guard(async()=>{if(choosing)return;choosing=true;try{hideMenu();if(discard&&session){if(!await api.confirmDiscardEdit(session.name))return;close();}return await action();}finally{choosing=false;}});
    const item=(label,icon,action,{discard=true,shortcut,className,title,disabled,role,checked}={})=>{const b=menuItem(label,{icon,shortcut,className,title,role,checked});b.onclick=()=>run(action,discard);b.disabled=!!disabled;return b;};
    const doc=s.frame.contentDocument,manager=s.app.pdfViewer._layerProperties.annotationEditorUIManager;
    const selected=s.frame.contentWindow.getSelection()?.toString().trim()||'';
    const quick=document.createElement('div');quick.className='menuQuick';
    quick.append(item('撤销','undo',()=>historyStep(),{title:'撤销 · Ctrl+Z',disabled:document.getElementById('undoButton').disabled}),item('重做','redo',()=>historyStep(true),{title:'重做 · Ctrl+Y',disabled:document.getElementById('redoButton').disabled}));
    for(const [label,mode,icon]of [['旋转页面','rotate','rotate'],['删除页面','delete','trash']])quick.append(item(label,icon,()=>applyEdit(s,{action:'organize',mode,pages:String(point.page),angle:90},label+' · 第 '+point.page+' 页'),{className:mode==='delete'?'danger':'',title:label+' · 第 '+point.page+' 页'}));
    menu.append(quick);
    if(session===s)menu.append(item('继续当前页面编辑','pageedit',()=>{},{discard:false}));
    if(selected){
      const short=selected.length>12?selected.slice(0,12)+'…':selected;
      menu.append(menuLabel('所选文字'),item('复制','copy',()=>{doc.execCommand('copy');},{discard:false,shortcut:'Ctrl+C'}),
        item('高亮所选文字','highlight',()=>manager?.highlightSelection('context_menu'),{discard:false,disabled:!manager}),
        item(`搜索“${short}”`,'search',async()=>{await navigation.search(s,selected);await navigation.show('search');},{discard:false}));
      if(notesFor?.(s))menu.append(item('摘录到笔记','quote',()=>excerpt(s,selected,point.page),{discard:false,shortcut:'Ctrl+Shift+E'}));
    }
    if(notesFor?.(s)&&region)menu.append(...(selected?[]:[menuLabel('笔记模式')]),item('框选区域摘录到笔记','crop',()=>region(s),{discard:false,shortcut:'Ctrl+Shift+U'}));
    const annotate=document.createElement('div');annotate.className='menuGrid';
    for(const [label,id,icon]of ANNOTATION_TOOLS)annotate.append(item(label,icon,()=>doc.getElementById(id)?.click(),{disabled:!doc.getElementById(id)||doc.getElementById(id).disabled}));
    const content=document.createElement('div');content.className='menuGrid';
    for(const [label,kind,icon]of [['添加文字','watermark','text'],['文字印章','stamp','stamp'],['图片印章','image','image'],['全页水印','watermark-all','watermark'],['图形','shape','shape'],['替换原文','text','replace']])content.append(item(label,icon,()=>open(kind,point)));
    menu.append(menuLabel('批注'),annotate,menuLabel('页面内容 · 第 '+point.page+' 页'),content,menuSep());
    const hand=s.app.pdfCursorTools?.activeTool===1;
    menu.append(item('页面排序 / 提取','pages',()=>navigation.show('thumbnails')),item('编辑目录','outline',()=>tools.open('outline')),
      item('将本页加入书签','bookmark',()=>{navigation.addBookmark(s,point.page);status?.('已将第 '+point.page+' 页加入阅读书签');},{discard:false}),
      item('抓手工具','hand',()=>s.app.pdfCursorTools?.switchTool(hand?0:1),{discard:false,role:'menuitemcheckbox',checked:hand}),menuSep(),
      item('打印…','print',()=>s.app.eventBus.dispatch('print',{source:menu}),{discard:false,shortcut:'Ctrl+P'}),
      item('文档属性','info',()=>s.app.eventBus.dispatch('documentproperties',{source:menu}),{discard:false}),
      ...(cite?[item('引用信息 / BibTeX…','quote',()=>cite(s),{discard:false})]:[]));
    const frame=s.frame.getBoundingClientRect();menu.hidden=false;const size=menu.getBoundingClientRect();menu.style.left=clamp(frame.left+e.clientX,8,innerWidth-size.width-8)+'px';menu.style.top=clamp(frame.top+e.clientY,8,innerHeight-size.height-8)+'px';menu.querySelector('.menuItem:not(:disabled)')?.focus();
  }
  function bind(s){$('directButton').disabled=false;s.frame.contentDocument.addEventListener('contextmenu',e=>context(s,e),true);s.frame.contentDocument.addEventListener('pointerdown',hideMenu,true);s.app.eventBus.on('scalechanging',({scale})=>{if(session===s&&s.loaded&&!bar.hidden&&!applying&&Math.abs(scale-editorScale)>.0001){editorScale=scale;draw();}});s.app.eventBus.on('pagerendered',({pageNumber})=>{if(session===s&&s.loaded&&!bar.hidden&&!applying&&pageNumber===pageView.id&&(!box?.isConnected||exactCanvas&&!exactCanvas.isConnected))draw();});s.app.eventBus.on('rotationchanging',()=>{if(session===s&&!bar.hidden&&!applying&&s.app.pdfViewer.pagesRotation!==0)close();});}
  for(const id of ['directText','directSize','directColor','directOpacity','directShape'])$(id).oninput=()=>{if(box)box.firstChild.style.visibility='visible';draw();};
  $('directKind').onchange=()=>guard(()=>open($('directKind').value));$('directAsset').onclick=()=>guard(async()=>{asset=await api.pickAsset('image');draw();});$('directApply').onclick=()=>guard(apply);$('directClose').onclick=close;
  $('directButton').onclick=()=>guard(()=>bar.hidden?open():close());document.addEventListener('pointerdown',e=>{if(!menu.contains(e.target))hideMenu();});document.addEventListener('keydown',e=>{if(e.key==='Escape'){if(!menu.hidden)hideMenu();else if(!bar.hidden&&!document.querySelector('dialog[open]'))close();}});
  return {open,close,select,discard,bind,apply,preview,get request(){return request();},get rect(){return [...rect];}};
}
