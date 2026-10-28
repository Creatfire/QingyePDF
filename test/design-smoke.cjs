const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
exports.run=async(window,output)=>{
 const run=code=>window.webContents.executeJavaScript(code,true);
 const settle=()=>new Promise(r=>setTimeout(r,550));
 const capture=async name=>{await settle();await fs.writeFile(path.join(output,name+'.png'),(await window.webContents.capturePage()).toPNG());};
 const check=async()=>assert.deepEqual(await run(`(()=>{const els=[...document.querySelectorAll('.appbar button,.quickTool,.actionTile,.homeHeader,.recentPanel,.sideCard')];return els.filter(e=>{const r=e.getBoundingClientRect();return r.width&& (r.left<0||r.right>innerWidth+1);}).map(e=>e.id||e.className)})()`),[],'controls stay inside viewport');
 const theme=await run("document.body.classList.contains('dark')");
 await run("qingye.activate(null); if(document.body.classList.contains('dark')) document.getElementById('themeButton').click()");
 assert.equal(await run("document.body.dataset.mode+':'+getComputedStyle(document.getElementById('pdfToolbar')).display"),'home:none','home has no PDF toolbar');
 await check();await capture('design-home-light');
 await run("document.getElementById('themeButton').click()");await capture('design-home-dark');
 assert.equal(await run("document.getElementById('themeButton').getAttribute('aria-label')"),'切换浅色界面');
 await run("document.getElementById('themeButton').click()");window.setSize(920,640);await settle();await check();await capture('design-home-compact');window.setSize(1360,940);await settle();
 await run("document.dispatchEvent(new DragEvent('dragenter',{dataTransfer:(()=>{const d=new DataTransfer();d.items.add(new File(['x'],'x.pdf'));return d})()}))");assert.equal(await run("document.body.classList.contains('fileDragging')"),true);
 await run("document.dispatchEvent(new Event('dragend'))");assert.equal(await run("document.body.classList.contains('fileDragging')"),false);
 await run("qingye.activate([...qingye.sessions.keys()][0]);document.querySelector('[data-tool=organize]').click()");await settle();
 assert.equal(await run("document.getElementById('toolAction').value"),'organize');
 assert.equal(await run("document.getElementById('toolsDialog').open"),true);await capture('design-tools');await run("document.getElementById('closeTools').click()");
 // 0.21 toolbar: menus, the tool center home with search and pins, the command palette, overflow.
 const shown=id=>run(`document.getElementById('${id}').matches(':popover-open')`);
 await run("document.getElementById('toolsButton').click()");assert.equal(await shown('toolsMenu'),true,'tools menu');
 assert.equal(await run("[...document.querySelectorAll('#toolsMenu .menuItem')].at(-1).textContent.startsWith('全部工具')"),true);await capture('toolbar-tools-menu');
 await run("document.getElementById('toolsMenu').hidePopover();document.getElementById('directButton').click()");assert.equal(await shown('editMenu'),true,'edit menu');
 assert.ok(await run("document.querySelectorAll('#editMenu .menuItem').length")>=8,'edit menu entries');await capture('toolbar-edit-menu');await run("document.getElementById('editMenu').hidePopover()");
 await run("document.getElementById('saveMenuButton').click()");assert.equal(await shown('saveMenu'),true,'save menu');await run("document.getElementById('saveMenu').hidePopover()");
 assert.equal(await run("!document.getElementById('printButton').disabled"),true,'print available for an open PDF');
 await run("qingye.tools.open()");assert.equal(await run("!document.getElementById('toolHome').hidden&&document.querySelectorAll('#toolGroups .toolCard').length>15"),true,'tool center home');
 await capture('toolbar-tool-center');
 await run("const q=document.getElementById('toolSearch');q.value='水印';q.dispatchEvent(new Event('input'))");
 assert.equal(await run("document.querySelector('#toolGroups .toolCardMain strong').textContent"),'水印','search finds the watermark tool');
 await run("document.querySelector('#toolGroups .toolCardPin').click()");
 assert.equal(await run("document.querySelector('#pinnedTools [data-tool-id=watermark]')?.hidden===false&&!document.getElementById('pinnedTools').hidden"),true,'pinned tool on the toolbar');
 await run("document.getElementById('closeTools').click();qingye.palette.open('打印')");
 assert.equal(await run("document.querySelector('#commandList [aria-selected=true] .commandName').textContent"),'打印','palette ranks 打印 first');await capture('toolbar-palette');
 await run("qingye.palette.close()");
 // The window cannot be narrower than 920 px, where the icon-only bar still fits; a narrower bar
 // (more pinned tools, a smaller screen) moves the lowest-priority buttons into "更多".
 const size=window.getSize();window.setSize(920,700);await settle();await check();
 assert.equal(await run("document.getElementById('moreButton').hidden"),true,'920 px fits without 更多');
 await run("document.getElementById('pdfToolbar').style.width='560px'");await settle();
 assert.equal(await run("!document.getElementById('moreButton').hidden&&document.querySelectorAll('#pdfToolbar .overflowed').length>0&&document.getElementById('pdfToolbar').scrollWidth<=document.getElementById('pdfToolbar').clientWidth+1"),true,'a narrow bar moves buttons into 更多');
 await run("document.getElementById('moreButton').click()");assert.ok(await run("document.querySelectorAll('#moreMenu .menuItem').length")>0,'更多 lists the hidden buttons');await capture('toolbar-narrow');
 await run("document.getElementById('moreMenu').hidePopover();document.getElementById('pdfToolbar').style.width='';qingye.tools.pin('watermark')");window.setSize(size[0],size[1]);await settle();
 assert.equal(await run("document.getElementById('pinnedTools').hidden"),true,'unpinned');
 await run("qingye.navigation.toggle('outline')");await capture('design-reader');await run("qingye.navigation.close()");
 const chrome=await run(`(()=>{const s=[...qingye.sessions.values()].find(x=>!x.panel.hidden),d=s.frame.contentDocument,visible=el=>!!el&&el.getBoundingClientRect().height>0&&getComputedStyle(el).visibility!=='hidden';
  return {pager:visible(s.panel.querySelector('.pager')),pdfToolbar:visible(d.getElementById('toolbarViewer'))||visible(d.getElementById('viewFindButton')),pdfSidebar:visible(d.getElementById('viewsManager')),customTitle:!!document.querySelector('.titlebar #tabs .tab.active')};})()`);
 assert.deepEqual(chrome,{pager:true,pdfToolbar:false,pdfSidebar:false,customTitle:true},'custom chrome replaces PDF.js toolbar and sidebar');
 window.webContents.debugger.attach('1.3');try{await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});assert.equal(await run("getComputedStyle(document.querySelector('.homeContent')).animationName"),'none');}finally{window.webContents.debugger.detach();}
 if(theme)await run("document.getElementById('themeButton').click()");
 await fs.writeFile(path.join(output,'design-result.json'),JSON.stringify({version:'0.8.2',homeWithoutToolbar:true,light:true,dark:true,compact:true,toolShortcut:true,dragFeedback:true,reducedMotion:true},null,2));
};
