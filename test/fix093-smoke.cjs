const fs = require('node:fs/promises');
const path = require('node:path');
const assert = require('node:assert/strict');
exports.run = async ({ window, dialog, output, openFiles, samplePdf }) => {
  await fs.mkdir(output, { recursive: true });
  const run = code => window.webContents.executeJavaScript(code, true), pause = ms => new Promise(r => setTimeout(r, ms));
  const until = async code => { for (let n = 0; n < 120; n++) { if (await run(code)) return; await pause(50); } throw new Error('Fix check timed out: ' + code); };
  const input = path.join(output, 'large.md'); await fs.writeFile(input, '# Large\n\n' + 'paragraph for conversion\n\n'.repeat(200000));
  const old = dialog.showOpenDialog;
  dialog.showOpenDialog = async (_w, options) => ({ canceled: false, filePaths: options.properties.includes('openDirectory') ? [output] : [input] });
  try {
    await run('qingye.converter.open()');
    await until('document.getElementById("convertTo").options.length > 1');
    await run('document.getElementById("convertMode").value="batch";document.getElementById("convertMode").dispatchEvent(new Event("change"));document.getElementById("convertPickInputs").click()');
    await until('document.querySelectorAll("#convertFiles li").length===1');
    await run('document.getElementById("convertPickOutput").click()'); await until('!!document.getElementById("convertOutput").textContent');
    await run('document.getElementById("convertStart").click()'); await until('!!document.querySelector("#convertResults [data-state=running]")');
    window.webContents.focus(); window.webContents.sendInputEvent({ type: 'keyDown', keyCode: 'Escape' }); window.webContents.sendInputEvent({ type: 'keyUp', keyCode: 'Escape' });
    await until('!document.getElementById("convertStart").disabled');
    assert.equal(await run('qingye.converter.dialog.open'), true); assert.equal(await run('document.querySelector("#convertResults li").dataset.state'), 'canceled');
    // Exercise Chromium's non-cancelable fallback as well as actual keyboard input.
    await run('document.getElementById("convertStart").click()'); await until('!!document.querySelector("#convertResults [data-state=running]")');
    await run('qingye.converter.dialog.dispatchEvent(new Event("cancel",{cancelable:false}));qingye.converter.dialog.close()');
    await until('!document.getElementById("convertStart").disabled && qingye.converter.dialog.open');
    assert.equal(await run('document.querySelector("#convertResults li").dataset.state'), 'canceled');
    await run('qingye.converter.dialog.close();qingye.i18n.setLanguage("en")'); await run('qingye.converter.open()');
    await run('document.getElementById("convertMode").value="merge";document.getElementById("convertMode").dispatchEvent(new Event("change"))');
    assert.equal(await run('document.getElementById("convertModeHint").textContent'), 'Multiple input files are combined into one output document.');
    const leftovers = (await fs.readdir(output)).filter(n => n.startsWith('.qy-') || n.endsWith('.html')); assert.deepEqual(leftovers, []);
    await run('qingye.converter.dialog.close();qingye.i18n.setLanguage("zh-CN")');
    const pdf = path.join(output, 'bound.pdf'), other = path.join(output, 'other.md'); await fs.writeFile(pdf, samplePdf()); await fs.writeFile(other, '# Other\n\nDo not silently read this document.');
    const opened = await openFiles([pdf, other]), pdfId = opened[0].id;
    await run(`qingye.addDocuments(${JSON.stringify(opened.map(d => ({ ...d, ...(d.bytes ? { bytes: Array.from(d.bytes) } : {}) })))})`);
    await until(`qingye.sessions.get(${JSON.stringify(pdfId)})?.loaded`);
    await run(`(async()=>{
      document.getElementById('aiPanel').remove();document.getElementById('aiConfirm').remove();localStorage.removeItem('qingye.ai.chats');
      const {createAiPanel}=await import('./ai/panel.mjs');let called=false;qingye.bindingError='';
      const api={aiState:async()=>({connections:[{id:'test',name:'test',enabled:true,models:['mock']}],defaults:{connectionId:'test',model:'mock',tools:true}}),
        aiChat:async(_id,request)=>{if(!called){called=true;await qingye.closeTab(${JSON.stringify(pdfId)});return {toolCalls:[{id:'implicit',name:'read_document',arguments:{}}]};}
          const result=JSON.parse(request.messages.findLast(m=>m.role==='tool').content);if(!result.error||result.references)throw Error('Implicit tool read another document');return {content:'Closed source correctly rejected'};},aiCancel:async()=>{}};
      qingye.bindAi=createAiPanel({api,guard:fn=>fn(),status:()=>{},tools:qingye.aiTools,current:()=>qingye.sessions.get(${JSON.stringify(pdfId)}),openSettings:()=>{}});
      await qingye.bindAi.refresh();await qingye.bindAi.send('Read the current PDF');
    })()`);
    assert.equal(await run('qingye.bindAi.chat.error'), ''); assert.equal(await run('qingye.bindAi.chat.messages.find(m=>m.role==="tool").ok'), false);
    await fs.writeFile(path.join(output, 'report.json'), JSON.stringify({ nativeEscape: true, noncancelableFallback: true, canceledOutputPreserved: true, mergeHintEnglish: true, implicitClosedDocumentRejected: true }, null, 2));
  } finally { dialog.showOpenDialog = old; }
};
