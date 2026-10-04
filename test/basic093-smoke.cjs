// Small release check only; the independent test handoff covers full UI and real AI providers.
const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
exports.run = async ({ window, app, dialog, openFiles, samplePdf, output }) => {
  await fs.mkdir(output, { recursive: true });
  const run = code => window.webContents.executeJavaScript(code, true), pause = ms => new Promise(r => setTimeout(r, ms));
  const until = async code => { for (let n = 0; n < 100; n++) { if (await run(code)) return; await pause(100); } throw new Error('Basic check timed out: ' + code); };
  const one = path.join(output, 'one.md'), two = path.join(output, 'two.md'), pdf = path.join(output, 'reference.pdf');
  await fs.writeFile(one, '# Alpha\n\nOne'); await fs.writeFile(two, '# Beta\n\nTwo'); await fs.writeFile(pdf, samplePdf());
  const oldOpen = dialog.showOpenDialog;
  const report = { version: app.getVersion(), scope: 'basic only; full acceptance delegated' };
  try {
    await run('qingye.converter.open()'); await until('document.getElementById("convertTo").options.length > 1');
    dialog.showOpenDialog = async (_window, options) => ({ canceled: false, filePaths: options.properties.includes('openDirectory') ? [output] : [one, two] });
    await run('document.getElementById("convertMode").value="batch"; document.getElementById("convertMode").dispatchEvent(new Event("change")); document.getElementById("convertPickInputs").click()');
    await until('document.querySelectorAll("#convertFiles li").length===2');
    await run('document.getElementById("convertPickOutput").click()'); await until('!!document.getElementById("convertOutput").textContent');
    await run('document.getElementById("convertStart").click()'); await until('!document.getElementById("convertStart").disabled');
    assert.equal(await run('document.querySelectorAll("#convertResults [data-state=success]").length'), 2);
    assert.match(await fs.readFile(path.join(output, 'one.html'), 'utf8'), /Alpha/); report.batchUi = true;
    await run('qingye.converter.dialog.close()');
    const opened = await openFiles([pdf]); await run(`qingye.addDocuments(${JSON.stringify(opened.map(d => ({ ...d, bytes: Array.from(d.bytes) })))})`); const id = opened[0].id;
    await until(`qingye.sessions.get(${JSON.stringify(id)})?.loaded`);
    await run(`(async()=>{
      document.getElementById('aiPanel').remove(); document.getElementById('aiConfirm').remove(); localStorage.removeItem('qingye.ai.chats');
      const {createAiPanel}=await import('./ai/panel.mjs');
      qingye.basicTrace=[];const follow=qingye.aiTools.followReference;qingye.aiTools.followReference=async ref=>{qingye.basicTrace.push({phase:'start',ref});const value=await follow(ref);qingye.basicTrace.push({phase:'end',value});return value;};
      let calls=0;
      const api={aiState:async()=>({connections:[{id:'basic',name:'Basic mock',enabled:true,models:['mock']}],defaults:{connectionId:'basic',model:'mock',tools:true}}),
        aiChat:async(_id,request)=>{if(!calls++){if(!request.tools?.length)throw Error('Tools not ready');return {toolCalls:[{id:'read',name:'read_document',arguments:{document_id:${JSON.stringify(id)},start_page:2,end_page:2}}]};}
          const data=JSON.parse(request.messages.findLast(m=>m.role==='tool').content); return {content:'Evidence [Page 2]('+data.references[0].href+') and [fake](#qingye-ref-forged)'};},aiCancel:async()=>true};
      qingye.basicError=''; qingye.basicAi=createAiPanel({api,guard:fn=>fn().catch(e=>{qingye.basicError=e.message;console.error(e);}),status:()=>{},tools:qingye.aiTools,current:()=>qingye.sessions.get(${JSON.stringify(id)}),openSettings:()=>{}});
      await qingye.basicAi.refresh(); qingye.basicAi.setOpen(true); await qingye.basicAi.send('Read page two');
      qingye.basicAi.panel.querySelector('.aiLog').addEventListener('click',e=>qingye.basicTrace.push({phase:'click',href:e.target.closest('a')?.getAttribute('href')}));
    })()`);
    await until('!!document.querySelector(".aiBubble a.aiCitation[href]")');
    await run(`(async()=>{await qingye.basicAi.ready;await qingye.sessions.get(${JSON.stringify(id)}).app.pdfViewer.pagesPromise;})()`);
    // Flush the hidden/offscreen frame before sending an input event to the rendered citation.
    await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true });
    assert.equal(await run('document.querySelector(".aiBubble a.aiCitation:not([href])").textContent'), 'fake');
    await run(`qingye.sessions.get(${JSON.stringify(id)}).app.pdfViewer.currentPageNumber=1`);
    await pause(100);
    await run(`const citation=document.querySelector('.aiBubble a.aiCitation[href]');if(!citation?.isConnected)throw Error('Citation is not attached');citation.click()`);
    await until(`qingye.sessions.get(${JSON.stringify(id)}).app.pdfViewer.currentPageNumber===2 || !!qingye.basicError`);
    assert.equal(await run('qingye.basicError'), ''); report.citationUi = true; report.forgedCitationDisabled = true;
    await fs.writeFile(path.join(output, 'basic-ui.png'), (await window.webContents.capturePage(undefined, { stayHidden: true, stayAwake: true })).toPNG());
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify(report, null, 2)); return report;
  } catch(error) {
    const trace=await run(`({trace:qingye.basicTrace,error:qingye.basicError,documents:[...qingye.sessions.values()].filter(s=>s.app).map(s=>({page:s.app.pdfViewer.currentPageNumber,scroll:s.app.pdfViewer.container.scrollTop,height:s.app.pdfViewer.container.clientHeight,pages:s.app.pdfViewer._pages.map(p=>({page:p.id,top:p.div.offsetTop,height:p.div.offsetHeight}))}))})`).catch(()=>null);
    await fs.writeFile(path.join(output,'failure-trace.json'),JSON.stringify(trace,null,2));throw error;
  } finally { dialog.showOpenDialog = oldOpen; }
};
