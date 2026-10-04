const assert=require('node:assert/strict');const fs=require('node:fs/promises');const path=require('node:path');
exports.run=async(window,output)=>{
  const run=source=>window.webContents.executeJavaScript(source,true);
  await run('(async()=>qingye.addDocuments(await desktop.example()))()');
  const state=await run(`(async()=>{
    const s=[...qingye.sessions.values()].at(-1);qingye.activate(s.id);qingye.navigation.close();
    document.getElementById('searchButton').click();const searchOpen=!document.getElementById('navigationPanel').hidden;document.getElementById('searchButton').click();const searchClosed=document.getElementById('navigationPanel').hidden;
    document.getElementById('outlineButton').click();document.getElementById('outlineButton').click();const outlineClosed=document.getElementById('navigationPanel').hidden;
    document.getElementById('viewButton').click();const viewOpen=document.getElementById('viewPanel').matches(':popover-open');document.getElementById('viewButton').click();const viewClosed=!document.getElementById('viewPanel').matches(':popover-open');
    await qingye.navigation.show('thumbnails');s.pageOrganizer.move(2,1);s.pageOrganizer.undo();const pageUndo=s.pageOrganizer.order.join(',')==='1,2';s.pageOrganizer.redo();const pageRedo=s.pageOrganizer.order.join(',')==='2,1';qingye.navigation.close();
    await qingye.tools.open('outline');const e=qingye.tools.outlineEditor;e.set([[1,'A',1],[2,'B',2],[1,'C',2]]);e.move(2,0);e.undo();const outlineUndo=e.get()[0][1]==='A';e.redo();const outlineRedo=e.get()[0][1]==='C';document.getElementById('closeTools').click();
    await qingye.applyEdit(s,{action:'organize',mode:'delete',pages:'2'},'删除第 2 页');const deleted=s.app.pagesCount===1;await qingye.historyStep();const undone=s.app.pagesCount===2;await qingye.historyStep(true);const redone=s.app.pagesCount===1;await qingye.historyStep();
    await qingye.applyEdit(s,{action:'outline',toc:[[1,'Edited outline',1]]},'修改目录');const editedOutline=(await s.app.pdfDocument.getOutline())[0].title==='Edited outline';await qingye.historyStep();const restoredOutline=(await s.app.pdfDocument.getOutline())[0].title==='Getting started';
    await qingye.direct.open('stamp');document.getElementById('directText').value='LIVE-STAMP';document.getElementById('directText').dispatchEvent(new Event('input',{bubbles:true}));await qingye.direct.preview();const exactPreview=!!s.frame.contentDocument.querySelector('.directExactPreview');
    const box=s.frame.contentDocument.querySelector('.directEditBox'),r=box.getBoundingClientRect(),f=s.frame.getBoundingClientRect();
    return {searchOpen,searchClosed,outlineClosed,viewOpen,viewClosed,pageUndo,pageRedo,outlineUndo,outlineRedo,deleted,undone,redone,editedOutline,restoredOutline,exactPreview,point:{x:Math.round(f.left+r.left+20),y:Math.round(f.top+r.top+15)},rect:qingye.direct.rect};
  })()`);
  for(const [key,value]of Object.entries(state))if(typeof value==='boolean')assert.equal(value,true,key);
  const fixes=await run(`(async()=>{
    const s=[...qingye.sessions.values()].at(-1),viewer=s.app.pdfViewer,originalScale=viewer.currentScaleValue,originalRect=qingye.direct.rect;
    const before=await s.app.pdfDocument.getData();let zooms=0;
    for(const scale of ['page-fit','page-width',.75,1.25]){
      const rendered=new Promise((resolve,reject)=>{const onPage=({pageNumber})=>{if(pageNumber===1){clearTimeout(timer);s.app.eventBus.off('pagerendered',onPage);resolve();}};const timer=setTimeout(()=>{s.app.eventBus.off('pagerendered',onPage);reject(new Error('Zoom render timed out'));},15000);s.app.eventBus.on('pagerendered',onPage);});
      viewer.currentScaleValue=scale;await rendered;await new Promise(r=>requestAnimationFrame(()=>requestAnimationFrame(r)));await qingye.direct.preview();
      const box=s.frame.contentDocument.querySelector('.directEditBox');if(!box?.isConnected||!box.querySelector('button')||!s.frame.contentDocument.querySelector('.directExactPreview'))throw new Error('Q01: editor/preview missing after zoom');zooms++;
    }
    viewer.currentScaleValue=originalScale;await new Promise(r=>setTimeout(r,250));await qingye.direct.preview();
    const rectPreserved=JSON.stringify(qingye.direct.rect)===JSON.stringify(originalRect);
    const pv=viewer.getPageView(0);pv.div.dispatchEvent(new s.frame.contentWindow.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:200}));
    const menuPreservesDraft=!document.getElementById('directEditor').hidden&&qingye.direct.request.text==='LIVE-STAMP'&&!!s.frame.contentDocument.querySelector('.directEditBox');
    document.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true}));
    const escapePreservesDraft=document.getElementById('pageContextMenu').hidden&&!document.getElementById('directEditor').hidden;
    const size=document.getElementById('directSize');let rejected=0;
    for(const value of ['1824','','0','5','101','not-a-number']){size.value=value;size.dispatchEvent(new Event('input',{bubbles:true}));if(!document.getElementById('directApply').disabled)throw new Error('Q03: invalid size enables apply');try{await qingye.direct.apply();throw new Error('Invalid size accepted');}catch(error){if(!error.message.includes('字号应在'))throw error;rejected++;}}
    size.value='24';size.dispatchEvent(new Event('input',{bubbles:true}));await qingye.direct.preview();
    const parameterRecovery=!document.getElementById('directApply').disabled&&!!s.frame.contentDocument.querySelector('.directExactPreview')&&qingye.direct.request.size===24;
    const after=await s.app.pdfDocument.getData();const sourceUnchanged=before.length===after.length&&before.every((n,i)=>n===after[i]);
    return {zooms,rectPreserved,menuPreservesDraft,escapePreservesDraft,rejected,parameterRecovery,sourceUnchanged};
  })()`);
  assert.equal(fixes.zooms,4);assert.equal(fixes.rejected,6);
  for(const key of ['rectPreserved','menuPreservesDraft','escapePreservesDraft','parameterRecovery','sourceUnchanged'])assert.equal(fixes[key],true,key);
  // Exercise the native confirmation IPC with deterministic choices; the popup
  // itself is stubbed so unattended smoke tests never require desktop input.
  const dialog=require('electron').dialog,showMessageBox=dialog.showMessageBox;
  try{
    dialog.showMessageBox=async(_window,options)=>{assert.equal(options.defaultId,0);assert.equal(options.cancelId,0);return {response:0};};
    fixes.cancelKeepsDraft=await run("(async()=>{document.getElementById('directKind').value='image';const result=await qingye.direct.open('image');return result===false&&qingye.direct.request.action==='stamp'&&qingye.direct.request.text==='LIVE-STAMP'&&!document.getElementById('directEditor').hidden;})()");
    dialog.showMessageBox=async()=>({response:1});
    fixes.confirmSwitchesTool=await run("(async()=>{const s=[...qingye.sessions.values()].at(-1);s.app.pdfViewer.getPageView(0).div.dispatchEvent(new s.frame.contentWindow.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:200}));await [...document.querySelectorAll('#pageContextMenu button')].find(b=>b.textContent.includes('图片印章')).onclick();const changed=qingye.direct.request.action==='image';await qingye.direct.open('stamp');document.getElementById('directText').value='LIVE-STAMP';document.getElementById('directText').dispatchEvent(new Event('input',{bubbles:true}));await qingye.direct.preview();return changed;})()");
  }finally{dialog.showMessageBox=showMessageBox;}
  assert.equal(fixes.cancelKeepsDraft,true);assert.equal(fixes.confirmSwitchesTool,true);
  await fs.writeFile(path.join(output,'q01-q03-fixed.png'),(await window.webContents.capturePage()).toPNG());
  const refreshed=await run("(()=>{const s=[...qingye.sessions.values()].at(-1),r=s.frame.contentDocument.querySelector('.directEditBox').getBoundingClientRect(),f=s.frame.getBoundingClientRect();return {point:{x:Math.round(f.left+r.left+20),y:Math.round(f.top+r.top+15)},rect:qingye.direct.rect};})()");
  state.point=refreshed.point;state.rect=refreshed.rect;
  const mouse=(type,x,y,button)=>window.webContents.sendInputEvent({type,x,y,...(button?{button,clickCount:1}:{})});
  const p=state.point;mouse('mouseMove',p.x,p.y);mouse('mouseDown',p.x,p.y,'left');mouse('mouseMove',p.x+45,p.y+25);mouse('mouseUp',p.x+45,p.y+25,'left');
  await new Promise(r=>setTimeout(r,150));
  const dragged=await run(`(()=>{const s=[...qingye.sessions.values()].at(-1),rect=qingye.direct.rect;const r=s.frame.contentDocument.querySelector('.directEditBox button').getBoundingClientRect(),f=s.frame.getBoundingClientRect();return {rect,point:{x:Math.round(f.left+r.left+r.width/2),y:Math.round(f.top+r.top+r.height/2)}};})()`);
  assert.ok(dragged.rect[0]>state.rect[0]+.01,'actual pointer drag moves the stamp');
  mouse('mouseMove',dragged.point.x,dragged.point.y);mouse('mouseDown',dragged.point.x,dragged.point.y,'left');mouse('mouseMove',dragged.point.x+40,dragged.point.y+30);mouse('mouseUp',dragged.point.x+40,dragged.point.y+30,'left');
  // Native mouse events are queued separately from executeJavaScript; let the
  // renderer process the resize before reading coordinates or applying changes.
  await new Promise(r=>setTimeout(r,250));
  const result=await run(`(async()=>{const s=[...qingye.sessions.values()].at(-1),rect=qingye.direct.rect;await qingye.direct.preview();await qingye.direct.apply();const text=(await(await s.app.pdfDocument.getPage(1)).getTextContent()).items.map(i=>i.str).join('');const stampApplied=text.includes('LIVE-STAMP');await qingye.historyStep();const after=(await(await s.app.pdfDocument.getPage(1)).getTextContent()).items.map(i=>i.str).join('');const stampUndone=!after.includes('LIVE-STAMP');await qingye.historyStep(true);document.getElementById('historyButton').click();const historyVisible=document.getElementById('historyDialog').textContent.includes('文字印章');document.getElementById('historyDialog').close();const pv=s.app.pdfViewer.getPageView(0);pv.div.dispatchEvent(new s.frame.contentWindow.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:200}));const contextMenu=!document.getElementById('pageContextMenu').hidden;const actions=[...document.querySelectorAll('#pageContextMenu button')].map(b=>b.textContent);return {rect,stampApplied,stampUndone,historyVisible,contextMenu,actions};})()`);
  assert.ok(result.rect[2]-result.rect[0]>dragged.rect[2]-dragged.rect[0]+.01,'actual pointer resize enlarges the stamp');
  for(const key of ['stampApplied','stampUndone','historyVisible','contextMenu'])assert.equal(result[key],true,key);
  const ink=await run("(async()=>{const s=[...qingye.sessions.values()].at(-1);[...document.querySelectorAll('#pageContextMenu button')].find(b=>b.textContent.includes('自由绘制')).click();await new Promise(r=>setTimeout(r,100));return s.frame.contentDocument.getElementById('editorInkButton').getAttribute('aria-expanded')==='true';})()");assert.equal(ink,true,'context menu activates the actual ink tool');
  await run("(()=>{const s=[...qingye.sessions.values()].at(-1);s.frame.contentDocument.getElementById('editorInkButton').click();const pv=s.app.pdfViewer.getPageView(0);pv.div.dispatchEvent(new s.frame.contentWindow.MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:100,clientY:200}));})()");
  await fs.writeFile(path.join(output,'page-context.png'),(await window.webContents.capturePage()).toPNG());
  await run("(async()=>{document.getElementById('pageContextMenu').hidden=true;await qingye.direct.open('watermark-all');await new Promise(r=>setTimeout(r,300));await qingye.direct.preview();await new Promise(r=>setTimeout(r,100));})()");
  await fs.writeFile(path.join(output,'direct-editing.png'),(await window.webContents.capturePage()).toPNG());await run('qingye.direct.close()');
  const usabilityFixes=await require('./usability-smoke.cjs').run(window,output);
  const enhancements=await require('./enhancement-smoke.cjs').run(window,output);
  return {state,fixes,dragged,result,usabilityFixes,enhancements};
};
