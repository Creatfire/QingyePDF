const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {nativeImage}=require('electron');
exports.run=async({window,app,dialog,openFiles,samplePdf,output})=>{
  await fs.mkdir(output,{recursive:true});
  window.webContents.on('console-message',(_event,...args)=>console.log('RENDERER',typeof args[0]==='object'?args[0].message:args[1]));
  const run=code=>window.webContents.executeJavaScript(code,true).catch(error=>{console.error('FAILED STEP',code.slice(0,850));throw error;});
  const pause=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const until=async(code,label)=>{for(let i=0;i<200;i++){if(await run(code))return;await pause(50);}throw new Error('0.13 regression timed out: '+label);};
  const report={version:app.getVersion(),checks:{}};
  const pdf=path.join(output,'中文原文.pdf'),md=path.join(output,'中文笔记.md'),image=path.join(output,'preview.png');
  const bitmap=Buffer.alloc(32*16*4);for(let i=0;i<bitmap.length;i+=4){bitmap[i+2]=255;bitmap[i+3]=255;}
  const png=nativeImage.createFromBitmap(bitmap,{width:32,height:16}).toPNG();
  await fs.writeFile(pdf,samplePdf('Regression 0.13',true));await fs.writeFile(md,'# 测试笔记\n\n![资源](preview.png)\n');await fs.writeFile(image,png);
  const opened=await openFiles([pdf,md]);
  await run(`qingye.addDocuments(${JSON.stringify(opened.map(d=>({...d,...(d.bytes?{bytes:Array.from(d.bytes)}:{})})))})`);
  const pdfId=opened[0].id,mdId=opened[1].id,P=`qingye.sessions.get(${JSON.stringify(pdfId)})`,M=`qingye.sessions.get(${JSON.stringify(mdId)})`;
  await until(`${P}.loaded&&${M}.loaded`,'documents');
  await run(`qingye.activate(${JSON.stringify(pdfId)})`);
  await run(`${P}.app.pdfViewer.currentScaleValue='page-fit';${P}.app.pdfViewer.scrollPageIntoView({pageNumber:1})`);
  for(const angle of [90,180,270,0]){
    await run(`qingye.views.change('rotate',undefined,${P})`);
    await until(`${P}.app.pdfViewer.getPageView(0).renderingState===3`,'rotated page render');
    await pause(150);
    const state=await run(`(()=>{const v=${P}.app.pdfViewer,p=v.getPageView(0),a=p.canvas.getBoundingClientRect(),b=p.div.getBoundingClientRect();return {angle:v.pagesRotation,overlap:Math.max(0,Math.min(a.right,b.right)-Math.max(a.left,b.left))*Math.max(0,Math.min(a.bottom,b.bottom)-Math.max(a.top,b.top)),pageArea:b.width*b.height};})()`);
    assert.equal(state.angle,angle);assert.ok(state.overlap>state.pageArea*.5,'rotation leaves the canvas in the page');
    const shot=await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true});
    const pixels=shot.toBitmap();let red=0;for(let i=0;i<pixels.length;i+=4)if(pixels[i+2]>160&&pixels[i+1]<100&&pixels[i]<100)red++;
    await fs.writeFile(path.join(output,'rotation-'+angle+'.png'),shot.toPNG());console.log('ROTATION',angle,red,JSON.stringify(state));
    assert.ok(red>500,'the rotated page paints its red image');
  }report.checks.rotation=true;
  await run(`(async()=>{const s=${P};s.app.eventBus.dispatch('switchannotationeditormode',{source:window,mode:3});await new Promise(r=>setTimeout(r,150));s.app.pdfViewer.getPageView(0).annotationEditorLayer.annotationEditorLayer.addNewEditor();})()`);
  await until(`!!${P}.frame.contentDocument.querySelector('.freeTextEditor .internal')`,'FreeText');
  await run(`(()=>{const s=${P},el=s.frame.contentDocument.querySelector('.freeTextEditor .internal');el.textContent='中文文本框测试 ABC-123';el.dispatchEvent(new InputEvent('input',{bubbles:true,inputType:'insertText',data:el.textContent}));qingye.commit(s);qingye.syncDirty(s);})()`);
  const saved=path.join(output,'中文保存目录','中文批注.pdf');await fs.mkdir(path.dirname(saved),{recursive:true});
  const originalPicker=dialog.showSaveDialog;
  try{dialog.showSaveDialog=async()=>({canceled:false,filePath:saved});assert.equal(await run(`qingye.saveSession(${P},true)`),true);}finally{dialog.showSaveDialog=originalPicker;}
  assert.ok((await fs.stat(saved)).size>0);report.checks.unicodeSavePath=true;
  await run(`(()=>{const s=${P},w=s.frame.contentWindow;w.q013OldClick=w.HTMLInputElement.prototype.click;w.HTMLInputElement.prototype.click=function(){if(this.type==='file'){w.q013Picker=this;return;}return w.q013OldClick.call(this);};s.app.eventBus.dispatch('switchannotationeditormode',{source:window,mode:13});})()`);
  await pause(150);
  await run(`${P}.app.pdfViewer.getPageView(0).annotationEditorLayer.annotationEditorLayer.addNewEditor()`);
  await until(`!!${P}.frame.contentWindow.q013Picker`,'image picker');
  assert.ok(await run(`(async()=>{const b=await ${P}.app.pdfDocument.saveDocument();return b.length>0;})()`),'pending image must not prevent serialization');
  await run(`(()=>{const w=${P}.frame.contentWindow,dt=new w.DataTransfer();dt.items.add(new w.File([new Uint8Array(${JSON.stringify(Array.from(png))})],'image.png',{type:'image/png'}));w.q013Picker.files=dt.files;w.q013Picker.dispatchEvent(new w.Event('change'));w.HTMLInputElement.prototype.click=w.q013OldClick;})()`);
  await until(`(()=>{const s=${P},m=s.app.pdfViewer._layerProperties.annotationEditorUIManager;return [...m.getEditors(0)].some(e=>e.serialize()?.bitmapId);})()`,'bitmap loaded');
  await run(`qingye.commit(${P})`);
  assert.equal(await run(`qingye.saveSession(${P},false)`),true);report.checks.pendingAndValidStampSave=true;
  const notes=async()=>run(`(async()=>{const s=${P},r=await desktop.toolsJob(s.id,await qingye.tools.snapshot(s),{action:'inspect',annotations:true});return r.data.notes;})()`);
  const baseline=await notes();
  for(const delayed of [false,true]){
    await run(`qingye.activate(${JSON.stringify(pdfId)})`);
    const comment='QA-013-unique-'+(delayed?'checkpoint':'immediate');
    await run(`window.q013PriorManager=${P}.app.pdfViewer._layerProperties.annotationEditorUIManager;true`);
    await run(`qingye.aiTools.run('annotate_pdf',{document_id:${JSON.stringify(pdfId)},page:1,quote:'Search for: reader',comment:${JSON.stringify(comment)}},{source:'panel',confirmEdits:false})`);
    let after=await notes();assert.equal(after.filter(a=>a.text===comment).length,1,'new AI comment is retained');assert.equal(after.length,baseline.length+1);
    await run('qingye.navigation.show("comments")');assert.ok(await run(`document.body.textContent.includes(${JSON.stringify(comment)})`),'the annotation list shows the unique new comment');await run('qingye.navigation.close()');
    if(delayed){await run('qingye.checkpoint()');await pause(35000);await run(`${P}.app.eventBus.dispatch('editingstateschanged',{source:window.q013PriorManager,details:{hasSomethingToUndo:true,hasSomethingToRedo:false}});true`);assert.ok(await run(`${P}.history.canUndo`),'checkpoint must preserve structural undo after the reported auto-save interval');}
    await run('qingye.historyStep()');after=await notes();assert.equal(after.filter(a=>a.text===comment).length,0);assert.equal(after.length,baseline.length);
  }report.checks.aiCommentAndCheckpointUndo=true;
  await run(`qingye.activate(${JSON.stringify(mdId)})`);
  const paste=await run(`(()=>{const e=${M}.editor,dt=new DataTransfer();dt.setData('text/html','<h3>中文粘贴标题</h3><p><strong>格式中文</strong></p>');dt.setData('text/plain',${JSON.stringify('中文粘贴标题\n格式中文')});return e.smartPasteText(dt);})()`);
  assert.ok(paste.converted);assert.match(paste.text,/中文粘贴标题/);assert.match(paste.text,/格式中文/);
  const corrupt=await run(`(()=>{const e=${M}.editor,dt=new DataTransfer();dt.setData('text/html','<p>错误�内容</p>');dt.setData('text/plain','完整中文');return e.smartPasteText(dt);})()`);
  assert.equal(corrupt.text,'完整中文');report.checks.richAndMalformedPaste=true;
  await run(`qingye.markdown.external(${M},'changed')`);
  const conflict=await run(`(async()=>{try{await qingye.markdown.save(${M},false);return '';}catch(e){return e.message;}})()`);
  // Mark the note dirty before reporting an external conflict.
  if(!conflict){await run(`${M}.editor.replaceAll(${M}.editor.text+${JSON.stringify('\n本地修改')});qingye.markdown.external(${M},'changed')`);}
  const blocked=await run(`(async()=>{try{await qingye.markdown.save(${M},false);return '';}catch(e){return e.message;}})()`);
  assert.match(blocked,/冲突/);report.checks.conflictFeedback=true;
  await run(`(()=>{const s=${M};s.externalConflict=false;return s.editor.options.onOpenLink('file:///Z:/qa-013-missing.pdf#page=1');})()`);
  assert.match(await run("document.getElementById('messageBody').textContent"),/不存在/);await run("document.getElementById('messageDialog').close()");report.checks.deadLinkFeedback=true;
  await fs.rename(image,image+'.removed');
  await run(`qingye.markdown.show(null);qingye.markdown.show(${M})`);
  await until(`!!${M}.editor.doc.querySelector('img.mdImageMissing')`,'missing image refreshed');report.checks.imageRefresh=true;
  await run(`(async()=>{const s=${M},dt=new DataTransfer();dt.items.add(new File([new Uint8Array(${JSON.stringify(Array.from(png))})],'clipboard.png',{type:'image/png'}));s.editor.setSourceMode(true);await s.editor.onPaste({target:s.editor.sourceView,clipboardData:dt,preventDefault(){}});s.editor.setSourceMode(false);})()`);
  assert.match(await run(`${M}.editor.text`),/assets\/image/);
  const beforeDrop=await run(`${M}.editor.text`);
  await run(`(async()=>{const e=${M}.editor,dt=new DataTransfer();dt.items.add(new File([new Uint8Array(${JSON.stringify(Array.from(png))})],'dropped.png',{type:'image/png'}));await e.onDrop({dataTransfer:dt,target:e.doc,clientX:0,clientY:0,preventDefault(){},stopPropagation(){}});})()`);
  assert.notEqual(await run(`${M}.editor.text`),beforeDrop);report.checks.bitmapPasteAndDrop=true;
  const shortcutsBefore=await run('JSON.stringify(qingye.markdown.typora.prefs.get("shortcuts"))');
  await run(`qingye.markdown.typora.H.openPrefs(${M},'keys');true`);
  const conflictHint=await run(`(()=>{const input=[...document.querySelectorAll('.mdKeyRow input')].find(el=>el.getAttribute('aria-label').includes('高亮'));input.dispatchEvent(new KeyboardEvent('keydown',{key:'b',code:'KeyB',ctrlKey:true,bubbles:true}));return document.querySelector('.mdPopHint[role="alert"]')?.textContent||'';})()`);
  assert.match(conflictHint,/使用/);assert.equal(await run('JSON.stringify(qingye.markdown.typora.prefs.get("shortcuts"))'),shortcutsBefore);
  await run("[...document.querySelectorAll('.mdModal button')].find(el=>el.textContent==='完成').click()");report.checks.shortcutConflictBlocked=true;
  let pickerAsked=false,completePicker;
  const exportPath=path.join(output,'late-canceled-export.pdf'),jobId=require('node:crypto').randomUUID();
  try{
    dialog.showSaveDialog=()=>{pickerAsked=true;return new Promise(resolve=>completePicker=resolve);};
    await run(`(async()=>{window.q013Export=desktop.toolsJob(${JSON.stringify(pdfId)},await qingye.tools.snapshot(${P}),{action:'organize',mode:'extract',pages:'2,1',jobId:${JSON.stringify(jobId)}}).then(r=>({ok:true}),e=>({error:e.message}));return true;})()`);
    for(let i=0;i<200&&!pickerAsked;i++)await pause(50);assert.ok(pickerAsked,'export reached the native save picker');
    await run(`desktop.cancelJob(${JSON.stringify(jobId)})`);
    assert.match((await run('window.q013Export')).error,/取消/);completePicker({canceled:false,filePath:exportPath});await pause(100);
    assert.equal(await fs.stat(exportPath).catch(()=>null),null);report.checks.cancelWaitingExport=true;
  }finally{dialog.showSaveDialog=originalPicker;completePicker?.({canceled:true});}
  const source=path.join(output,'remote-link.pdf'),target=path.join(output,'target.pdf');await fs.writeFile(target,samplePdf('RemoteTarget013'));
  {
    await fs.writeFile(source,await fs.readFile(path.join(__dirname,'fixtures','remote-link.pdf')));
    const linked=await openFiles([source]);await run(`qingye.addDocuments(${JSON.stringify(linked.map(d=>({...d,bytes:Array.from(d.bytes)})))})`);
    const L=`qingye.sessions.get(${JSON.stringify(linked[0].id)})`;await until(`${L}.loaded&&!!${L}.frame.contentDocument.querySelector('.linkAnnotation a')`,'GoToR hot area');
    await run(`${L}.frame.contentDocument.querySelector('.linkAnnotation a').click()`);
    await until("[...qingye.sessions.values()].some(s=>s.name==='target.pdf'&&s.loaded&&s.app.pdfViewer.currentPageNumber===2)",'GoToR target page');report.checks.crossPdfLink=true;
  }
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  console.log('FIX013 REPORT',JSON.stringify(report));return report;
};
