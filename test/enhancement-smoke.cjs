const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const crypto=require('node:crypto');
const {dialog,clipboard,ClipboardItem}=require('electron');

exports.run=async(window,output)=>{
  const run=source=>window.webContents.executeJavaScript(source,true);
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const until=async source=>{for(let i=0;i<600;i++){if(await run(source))return;await wait(50);}throw new Error('Enhancement state timed out: '+source);};
  const mouse=(type,p)=>window.webContents.sendInputEvent({type,...p,button:'left',clickCount:1});
  const click=async id=>{const p=await run(`(()=>{const r=document.getElementById('${id}').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);mouse('mouseDown',p);mouse('mouseUp',p);};
  await run('qingye.direct.close();qingye.navigation.close()');
  const scan=await run(`(async()=>{await qingye.addDocuments(await desktop.example());const s=[...qingye.sessions.values()].at(-1);const stamped=await desktop.toolsJob(s.id,await qingye.tools.snapshot(s),{action:'watermark',pages:'1',rect:[.1,.7,.9,.86],text:'中文文字识别',size:24,color:'#000000',opacity:1});const result=await desktop.toolsJob(s.id,stamped.bytes,{action:'scan',recognize:false,deskew:false,clean:false,gray:false});return Array.from(result.bytes);})()`);
  const file=path.join(output,'scan-selection-source.pdf');await fs.writeFile(file,new Uint8Array(scan));
  const initialHash=crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex');
  const picker=dialog.showOpenDialog;
  try{dialog.showOpenDialog=async()=>({canceled:false,filePaths:[file]});await run('(async()=>qingye.addDocuments(await desktop.open()))()');}finally{dialog.showOpenDialog=picker;}
  assert.equal(await run("(async()=>{const s=[...qingye.sessions.values()].at(-1);return (await(await s.app.pdfDocument.getPage(1)).getTextContent()).items.some(i=>i.str?.trim());})()"),false,'fixture is a real scan without text');
  await run("qingye.tools.open('sharpen')");await run("document.getElementById('toolSharpen').value='standard';document.getElementById('applyToolDraft').onclick()");
  const sharpen=await run("(()=>{const s=[...qingye.sessions.values()].at(-1);return {pages:s.app.pagesCount,dirty:s.dirty,history:s.history.rows.map(r=>r.label)};})()");
  assert.equal(sharpen.pages,2);assert.equal(sharpen.dirty,true);assert.ok(sharpen.history.some(row=>row.includes('锐化')));
  await click('selectTextButton');
  await until("(async()=>{const s=[...qingye.sessions.values()].at(-1);return !qingye.textSelection.isBusy()&&s.loaded&&(await(await s.app.pdfDocument.getPage(1)).getTextContent()).items.some(i=>/reader/i.test(i.str||''));})()");
  await until("[...qingye.sessions.values()].at(-1).frame.contentDocument.querySelector('.textLayer span')");
  const reading=await run("(async()=>{const s=[...qingye.sessions.values()].at(-1),page=await s.app.pdfDocument.getPage(1),text=(await page.getTextContent()).items.map(i=>i.str).join(' ');const span=[...s.frame.contentDocument.querySelectorAll('.textLayer span')].find(el=>/reader/i.test(el.textContent)&&el.getBoundingClientRect().width>0&&el.getBoundingClientRect().height>0);const r=span.getBoundingClientRect(),f=s.frame.getBoundingClientRect();return {text,pages:s.app.pagesCount,history:s.history.rows.length,start:{x:Math.round(f.left+r.left+1),y:Math.round(f.top+r.top+r.height/2)},end:{x:Math.round(f.left+r.right-1),y:Math.round(f.top+r.top+r.height/2)}};})()");
  assert.match(reading.text,/reader/i);assert.match(reading.text.replace(/\s+/g,''),/中文/);
  mouse('mouseDown',reading.start);mouse('mouseMove',reading.end);mouse('mouseUp',reading.end);await wait(150);
  const selected=await run("[...qingye.sessions.values()].at(-1).frame.contentWindow.getSelection().toString()");
  const debug=await run(`(()=>{const s=[...qingye.sessions.values()].at(-1),doc=s.frame.contentDocument,span=[...doc.querySelectorAll('.textLayer span')].find(el=>/reader/i.test(el.textContent)&&el.getBoundingClientRect().width>0&&el.getBoundingClientRect().height>0),f=s.frame.getBoundingClientRect(),r=span.getBoundingClientRect(),hit=doc.elementFromPoint(${reading.start.x}-f.left,${reading.start.y}-f.top),style=s.frame.contentWindow.getComputedStyle(span);return {frame:{x:f.x,y:f.y,width:f.width,height:f.height},span:{x:r.x,y:r.y,width:r.width,height:r.height,text:span.textContent},hit:hit?.outerHTML?.slice(0,500),cursor:s.app.pdfCursorTools.activeTool,mode:s.app.pdfViewer.annotationEditorMode,userSelect:style.userSelect,pointerEvents:style.pointerEvents,selection:doc.getSelection().toString()};})()`);
  await fs.writeFile(path.join(output,'selection-debug.json'),JSON.stringify({reading,selected,debug},null,2));
  await fs.writeFile(path.join(output,'selection-debug.png'),(await window.webContents.capturePage()).toPNG());
  assert.match(selected,/reader/i,'real mouse selects OCR text');
  const previousClipboard=await Promise.all((await clipboard.read()).filter(item=>item.types.length).map(async item=>new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await item.getType(type)]))))));
  let copied;
  try{window.webContents.sendInputEvent({type:'keyDown',keyCode:'C',modifiers:['control']});window.webContents.sendInputEvent({type:'keyUp',keyCode:'C',modifiers:['control']});await wait(100);copied=await clipboard.readText();assert.match(copied,/reader/i,'Ctrl+C copies recognized scan text');}finally{if(previousClipboard.length)await clipboard.write(previousClipboard);else clipboard.clear();}
  await fs.writeFile(path.join(output,'scan-text-selected.png'),(await window.webContents.capturePage()).toPNG());
  await click('selectTextButton');await wait(150);
  assert.equal(await run("[...qingye.sessions.values()].at(-1).history.rows.length"),reading.history,'do not OCR an already selectable page');
  const bytes=await run("(async()=>Array.from(await qingye.tools.snapshot([...qingye.sessions.values()].at(-1))))()");await fs.writeFile(path.join(output,'scan-recognized.pdf'),new Uint8Array(bytes));
  await run("(async()=>{await qingye.historyStep();const s=[...qingye.sessions.values()].at(-1);window.ocrCancelPromise=qingye.textSelection.ensure(s,1,true);})()");
  await until("qingye.textSelection.isBusy()&&!document.getElementById('selectTextButton').disabled");
  await run("document.getElementById('selectTextButton').onclick()");await until('!qingye.textSelection.isBusy()');
  const canceled=await run("(async()=>{const s=[...qingye.sessions.values()].at(-1);return {text:(await(await s.app.pdfDocument.getPage(1)).getTextContent()).items.map(i=>i.str).join(''),history:s.history.rows.filter(r=>r.applied).length};})()");assert.equal(canceled.text.trim(),'');
  assert.equal(crypto.createHash('sha256').update(await fs.readFile(file)).digest('hex'),initialHash,'selection OCR never overwrites the source');
  await click('selectTextButton');await until("(async()=>{const s=[...qingye.sessions.values()].at(-1);return !qingye.textSelection.isBusy()&&(await(await s.app.pdfDocument.getPage(1)).getTextContent()).items.some(i=>/reader/i.test(i.str||''));})()");
  const result={sharpen,recognizedText:reading.text,selectedText:selected,copiedText:copied,cancellationPreservesNoText:true,sourceUnchanged:true,noDuplicateLayer:true};
  await fs.writeFile(path.join(output,'enhancement-result.json'),JSON.stringify(result,null,2));
  return result;
};

