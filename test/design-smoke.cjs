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
 await run("qingye.navigation.toggle('outline')");await capture('design-reader');await run("qingye.navigation.close()");
 const chrome=await run(`(()=>{const s=[...qingye.sessions.values()].find(x=>!x.panel.hidden),d=s.frame.contentDocument,visible=el=>!!el&&el.getBoundingClientRect().height>0&&getComputedStyle(el).visibility!=='hidden';
  return {pager:visible(s.panel.querySelector('.pager')),pdfToolbar:visible(d.getElementById('toolbarViewer'))||visible(d.getElementById('viewFindButton')),pdfSidebar:visible(d.getElementById('viewsManager')),customTitle:!!document.querySelector('.titlebar #tabs .tab.active')};})()`);
 assert.deepEqual(chrome,{pager:true,pdfToolbar:false,pdfSidebar:false,customTitle:true},'custom chrome replaces PDF.js toolbar and sidebar');
 window.webContents.debugger.attach('1.3');try{await window.webContents.debugger.sendCommand('Emulation.setEmulatedMedia',{features:[{name:'prefers-reduced-motion',value:'reduce'}]});assert.equal(await run("getComputedStyle(document.querySelector('.homeContent')).animationName"),'none');}finally{window.webContents.debugger.detach();}
 if(theme)await run("document.getElementById('themeButton').click()");
 await fs.writeFile(path.join(output,'design-result.json'),JSON.stringify({version:'0.8.2',homeWithoutToolbar:true,light:true,dark:true,compact:true,toolShortcut:true,dragFeedback:true,reducedMotion:true},null,2));
};
