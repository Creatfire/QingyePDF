const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const {Menu,clipboard,ClipboardItem,dialog}=require('electron');

exports.run=async(window,output)=>{
  const run=source=>window.webContents.executeJavaScript(source,true);
  const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
  const mouse=(type,p,button='left')=>window.webContents.sendInputEvent({type,...p,button,clickCount:1});
  const click=async p=>{mouse('mouseDown',p);mouse('mouseUp',p);await wait(80);};
  const key=async keyCode=>{window.webContents.sendInputEvent({type:'keyDown',keyCode});if(keyCode==='Return'||keyCode==='Space')window.webContents.sendInputEvent({type:'char',keyCode:keyCode==='Return'?'\r':' '});window.webContents.sendInputEvent({type:'keyUp',keyCode});await wait(80);};
  const point=async id=>run(`(()=>{const r=document.getElementById('${id}').getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
  const fixes={toolboxCycles:0,enterCycles:0,spaceCycles:0,viewMouseCycles:0};
  await run("qingye.navigation.close();qingye.direct.close();document.getElementById('viewPanel').hidePopover()");
  const version=await run('desktop.appVersion()');
  await click(await point('helpButton'));
  fixes.versionMatches=await run(`document.getElementById('versionFooter').textContent.includes(${JSON.stringify(version)})&&document.getElementById('messageBody').textContent.includes('青页 PDF '+${JSON.stringify(version)}+' 按')`);
  assert.equal(fixes.versionMatches,true,'help and footer use runtime version');
  await run("document.getElementById('messageDialog').close()");
  fixes.draftSwitchCycles=0;
  const originalMessage=dialog.showMessageBox;
  try{
    for(let cycle=0;cycle<3;cycle++){
      const expected=await run(`(async()=>{await qingye.addDocuments(await desktop.example());const s=[...qingye.sessions.values()].at(-1);window.zcodeDraftId=s.id;window.zcodeOtherId=[...qingye.sessions.values()].find(other=>other.id!==s.id&&other.loaded).id;await qingye.direct.open('stamp');document.getElementById('directText').value='ZCode未应用草稿-${cycle}';document.getElementById('directSize').value='28';document.getElementById('directColor').value='#123456';document.getElementById('directOpacity').value='71';document.getElementById('directText').dispatchEvent(new Event('input'));await qingye.direct.preview();return qingye.direct.request;})()`);
      const tabPoint=async which=>run(`(()=>{const index=[...qingye.sessions.keys()].indexOf(window.${which});const r=[...document.querySelectorAll('.tabTitle')][index].getBoundingClientRect();return {x:Math.round(r.left+r.width/2),y:Math.round(r.top+r.height/2)};})()`);
      await click(await point('homeButton'));await key('Escape');
      assert.equal(await run("!document.getElementById('home').hidden&&document.getElementById('directEditor').hidden"),true);
      await click(await tabPoint('zcodeDraftId'));await wait(150);
      assert.deepEqual(await run('qingye.direct.request'),expected,'home round trip retains all draft parameters');
      assert.equal(await run("!document.getElementById('directEditor').hidden&&!![...qingye.sessions.values()].find(s=>s.id===zcodeDraftId).frame.contentDocument.querySelector('.directEditBox')"),true);
      await click(await tabPoint('zcodeOtherId'));
      assert.equal(await run("document.getElementById('directEditor').hidden&&!([...qingye.sessions.values()].find(s=>s.id===zcodeOtherId).frame.contentDocument.querySelector('.directEditBox'))"),true,'draft does not appear in another document');
      await click(await tabPoint('zcodeDraftId'));await wait(150);assert.deepEqual(await run('qingye.direct.request'),expected);
      dialog.showMessageBox=async(_window,options)=>{assert.equal(options.defaultId,0);return {response:0};};
      assert.equal(await run('qingye.closeTab(zcodeDraftId)'),false,'cancel keeps draft document open');
      assert.deepEqual(await run('qingye.direct.request'),expected);
      dialog.showMessageBox=async()=>({response:1});
      assert.equal(await run('qingye.closeTab(zcodeDraftId)'),true,'explicit discard allows document close');
      assert.equal(await run("document.getElementById('directEditor').hidden&&!qingye.sessions.has(zcodeDraftId)"),true);
      fixes.draftSwitchCycles++;
    }
  }finally{dialog.showMessageBox=originalMessage;}
  const toolboxPoint=await point('toolsButton');
  for(let i=0;i<3;i++){
    await click(toolboxPoint);assert.equal(await run("document.getElementById('toolsDialog').open"),true,'native toolbox open');
    assert.equal(await run("document.getElementById('toolsDialog').closedBy==='any'"),true,'dialog light dismiss supported');
    await click(toolboxPoint);assert.equal(await run("document.getElementById('toolsDialog').open"),false,'native toolbox second click closes');fixes.toolboxCycles++;
  }
  await run("(async()=>{await qingye.tools.open('ocr');document.getElementById('toolForceOcr').checked=true;})()");
  const busyStarted=await run("(()=>{window.q05BusyTask=qingye.tools.execute();return qingye.tools.isBusy();})()");assert.equal(busyStarted,true);
  fixes.saveButtonsProtected=await run("document.getElementById('saveButton').disabled&&document.getElementById('saveAsButton').disabled&&document.getElementById('saveButton').title.includes('本地处理正在进行')");assert.equal(fixes.saveButtonsProtected,true);
  fixes.directSaveRejected=await run("(async()=>{const s=[...qingye.sessions.values()].find(s=>!s.panel.hidden);const result=await qingye.saveSession(s,false);return result===false&&!s.saving&&document.getElementById('statusText').textContent.includes('本地处理正在进行');})()");assert.equal(fixes.directSaveRejected,true);
  window.webContents.sendInputEvent({type:'keyDown',keyCode:'S',modifiers:['control']});window.webContents.sendInputEvent({type:'keyUp',keyCode:'S',modifiers:['control']});await wait(30);
  fixes.shortcutSaveRejected=await run("document.getElementById('statusText').textContent.includes('本地处理正在进行')&&!document.getElementById('historyDialog').open");assert.equal(fixes.shortcutSaveRejected,true);
  await click(toolboxPoint);await key('Escape');
  const busyState=await run("({open:document.getElementById('toolsDialog').open,busy:qingye.tools.isBusy(),progress:document.getElementById('toolProgress').textContent})");fixes.busyProtected=busyState.open&&busyState.busy;assert.equal(fixes.busyProtected,true,JSON.stringify(busyState));
  await run('q05BusyTask');await run("document.getElementById('closeTools').click()");
  fixes.saveButtonsRestored=await run("!document.getElementById('saveButton').disabled&&!document.getElementById('saveAsButton').disabled");assert.equal(fixes.saveButtonsRestored,true);
  for(const [keyCode,name]of [['Return','enterCycles'],['Space','spaceCycles']]){
    await run("document.getElementById('viewButton').focus()");
    for(let i=0;i<3;i++){
      await key(keyCode);assert.equal(await run("document.getElementById('viewPanel').matches(':popover-open')"),true,'keyboard opens view');
      await key(keyCode);assert.equal(await run("document.getElementById('viewPanel').matches(':popover-open')"),false,'keyboard second activation closes view');fixes[name]++;
    }
  }
  const viewPoint=await point('viewButton');
  for(let i=0;i<3;i++){await click(viewPoint);assert.equal(await run("document.getElementById('viewPanel').matches(':popover-open')"),true);await click(viewPoint);assert.equal(await run("document.getElementById('viewPanel').matches(':popover-open')"),false);fixes.viewMouseCycles++;}
  await run("qingye.direct.open('stamp')");
  const originalPopup=Menu.prototype.popup;
  const savedClipboard=await Promise.all((await clipboard.read()).map(async item=>new ClipboardItem(Object.fromEntries(await Promise.all(item.types.map(async type=>[type,await item.getType(type)]))))));
  let captured;
  try{
    // Verify actual context-menu events and role actions without opening a
    // native OS popup during unattended/offscreen runs.
    Menu.prototype.popup=function(options){captured={menu:this,options};};
    for(const scope of ['host','reader']){
      await clipboard.writeText('Q07-粘贴-'+scope);captured=null;
      const p=await run(`(()=>{const s=[...qingye.sessions.values()].at(-1);if('${scope}'==='reader'&&!s.frame.contentDocument.getElementById('q07ReaderInput')){const probe=s.frame.contentDocument.createElement('input');probe.id='q07ReaderInput';Object.assign(probe.style,{position:'fixed',left:'40px',top:'40px',width:'220px',zIndex:'99999'});s.frame.contentDocument.body.append(probe);}const doc='${scope}'==='reader'?s.frame.contentDocument:document,el=doc.getElementById('${scope}'==='reader'?'q07ReaderInput':'directText');el.value='Q07-复制-${scope}';el.focus();el.select();const r=el.getBoundingClientRect(),f='${scope}'==='reader'?s.frame.getBoundingClientRect():{left:0,top:0};return {x:Math.round(f.left+r.left+r.width/2),y:Math.round(f.top+r.top+r.height/2)};})()`);
      mouse('mouseDown',p,'right');mouse('mouseUp',p,'right');
      for(let i=0;i<40&&!captured;i++)await wait(25);
      assert.ok(captured,'native text context-menu event');assert.equal(captured.options.window,window);assert.ok(captured.options.frame);
      const labels=captured.menu.items.filter(i=>i.type!=='separator').map(i=>i.label);assert.deepEqual(labels,['撤销','重做','剪切','复制','粘贴','全选']);
      const copy=captured.menu.getMenuItemById('text-copy');assert.equal(copy.enabled,true);copy.click({},window,window.webContents);await wait(50);assert.equal(await clipboard.readText(),'Q07-复制-'+scope);
      await clipboard.writeText('Q07-粘贴-'+scope);const paste=captured.menu.getMenuItemById('text-paste');assert.equal(paste.enabled,true);paste.click({},window,window.webContents);await wait(80);
      const value=await run(`(()=>{const s=[...qingye.sessions.values()].at(-1);return ('${scope}'==='reader'?s.frame.contentDocument:document).getElementById('${scope}'==='reader'?'q07ReaderInput':'directText').value;})()`);
      assert.equal(value,'Q07-粘贴-'+scope);fixes[scope+'TextMenu']=true;
      if(scope==='reader')await run("[...qingye.sessions.values()].at(-1).frame.contentDocument.getElementById('q07ReaderInput')?.remove()");
    }
  }finally{Menu.prototype.popup=originalPopup;if(savedClipboard.length)await clipboard.write(savedClipboard);else clipboard.clear();await run('qingye.direct.close()');}
  const error=await run(`(async()=>{const s=[...qingye.sessions.values()].at(-1),pages=s.app.pagesCount;await qingye.tools.open('organize');document.getElementById('toolPageMode').value='delete';document.getElementById('toolPages').value=Array.from({length:pages},(_,i)=>i+1).join(',');await document.getElementById('applyToolDraft').onclick();const result={message:document.getElementById('messageBody').textContent,open:document.getElementById('messageDialog').open,pages:s.app.pagesCount};return {...result,unchanged:pages===result.pages};})()`);
  assert.equal(error.message,'至少保留一页。');assert.equal(error.open,true);assert.equal(error.unchanged,true);fixes.friendlyError=error;
  await fs.writeFile(path.join(output,'q08-error.png'),(await window.webContents.capturePage()).toPNG());
  await run("document.getElementById('messageDialog').close();document.getElementById('closeTools').click()");
  await fs.writeFile(path.join(output,'q05-q08-result.json'),JSON.stringify(fixes,null,2));
  return fixes;
};
