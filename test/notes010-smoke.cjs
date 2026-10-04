// 0.10.0 notes mode: loads the real window and checks the split view, focus rules, excerpting,
// link navigation inside the split, AI tools across both panes and leaving the mode.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
exports.run=async({window,app,openFiles,samplePdf,output})=>{
  await fs.mkdir(output,{recursive:true});
  window.webContents.on('console-message',(_event,...args)=>{const d=typeof args[0]==='object'?args[0]:{message:args[1]};console.log('RENDERER:',d.message);});
  const run=code=>window.webContents.executeJavaScript(code,true).catch(error=>{console.error('FAILED SCRIPT:',code.slice(0,600));throw error;}),pause=ms=>new Promise(r=>setTimeout(r,ms));
  const until=async code=>{for(let n=0;n<200;n++){if(await run(code))return;await pause(100);}throw Error('0.10.0 check timed out: '+code);};
  const shot=async name=>fs.writeFile(path.join(output,name),(await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  const pdf=path.join(output,'paper.pdf'),md=path.join(output,'notes.md'),other=path.join(output,'second.pdf');
  await fs.writeFile(pdf,samplePdf('Notes mode 0.10.0'));await fs.writeFile(other,samplePdf('Second document'));await fs.writeFile(md,'# Reading notes\n\nFirst paragraph.\n');
  const opened=await openFiles([pdf,md,other]);await run(`qingye.addDocuments(${JSON.stringify(opened.map(d=>({...d,...(d.bytes?{bytes:Array.from(d.bytes)}:{})})))})`);
  const [pdfId,mdId,otherId]=opened.map(d=>d.id),P=`qingye.sessions.get(${JSON.stringify(pdfId)})`,M=`qingye.sessions.get(${JSON.stringify(mdId)})`,O=`qingye.sessions.get(${JSON.stringify(otherId)})`;
  const report={version:app.getVersion(),split:false,focus:false,resize:false,excerpt:false,linkInPlace:false,replacePane:false,aiBothPanes:false,aiAnnotate:false,closeLeaves:false};
  await until(`${P}.loaded&&${M}.loaded&&${O}.loaded`);
  const active=()=>run(`[...qingye.sessions.values()].find(s=>s.panel.classList.contains('noteFocus'))?.id||null`);
  const visible=()=>run(`[...qingye.sessions.values()].filter(s=>!s.panel.hidden).map(s=>s.id)`);

  // Enter notes mode: PDF on the left, the note on the right; both panels are visible.
  // Through the title-bar button: the menu offers a new note and every other open document.
  await run(`qingye.activate(${JSON.stringify(pdfId)});document.getElementById('notesButton').click()`);await until('document.getElementById("notesMenu").matches(":popover-open")');
  const entries=await run('[...document.querySelectorAll("#notesMenu .menuItem .notesMenuText")].map(n=>n.textContent)');
  assert.deepEqual(entries,['新建一份笔记','notes.md','second.pdf','打开其他文件…']);await pause(250);await shot('notes-menu.png');
  await run('[...document.querySelectorAll("#notesMenu .menuItem")].find(b=>b.textContent.includes("notes.md")).click()');await until('qingye.notes.active()');
  assert.deepEqual(await run('qingye.notes.ids()'),[pdfId,mdId]);assert.equal(await run('document.getElementById("notesButton").getAttribute("aria-pressed")'),'true');
  assert.deepEqual((await visible()).sort(),[pdfId,mdId].sort());assert.equal(await active(),mdId);
  assert.equal(await run('document.body.classList.contains("notesMode")'),true);assert.equal(await run('document.body.dataset.mode'),'pdf');
  const widths=await run(`[${P}.panel,${M}.panel].map(p=>Math.round(p.getBoundingClientRect().width))`);assert.ok(Math.abs(widths[0]-widths[1])<=2,'equal halves: '+widths);
  assert.equal(await run('document.querySelectorAll("#tabs .tab.inSplit").length'),2);report.split=true;await pause(400);await shot('notes-split.png');

  // Focus follows the pane that is clicked; the PDF toolbar keeps serving the PDF either way.
  assert.equal(await run('document.getElementById("searchButton").disabled'),false);
  await run(`${P}.frame.contentDocument.body.dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);assert.equal(await active(),pdfId);
  await run(`${M}.panel.querySelector('.mdEditor,.mdDoc').dispatchEvent(new PointerEvent('pointerdown',{bubbles:true}))`);assert.equal(await active(),mdId);
  assert.deepEqual((await visible()).sort(),[pdfId,mdId].sort());report.focus=true;

  // Divider: ratio is clamped and both panes follow.
  await run('qingye.notes.setRatio(90)');assert.equal(await run('qingye.notes.ratio()'),75);
  await run('qingye.notes.setRatio(40)');const resized=await run(`[${P}.panel,${M}.panel].map(p=>p.getBoundingClientRect().width)`);assert.ok(Math.abs(resized[0]/(resized[0]+resized[1])-.4)<.01);report.resize=true;

  // Excerpt a passage of the PDF into the note, with a link back to the page.
  await run(`qingye.notes.excerpt(${P},'An open-source home for your documents.',1)`);
  const text=await run(`${M}.editor.text`);assert.match(text,/> An open-source home for your documents\./);assert.match(text,/paper\.pdf · 第 1 页\]\(<file:\/\/\/.*paper\.pdf#page=1>\)/);
  assert.equal(await run(`qingye.syncDirty(${M}),${M}.dirty`),true);await run(`${M}.editor.undo()`);assert.equal(await run(`${M}.editor.text.includes('open-source home')`),false);await run(`${M}.editor.redo()`);report.excerpt=true;

  // Following that link stays inside the split: the PDF pane goes to the page, nothing is swapped.
  await run(`${P}.app.pdfViewer.currentPageNumber=2;qingye.markdown.setViewMode(${M},'read')`);await pause(300);
  await run(`${M}.panel.querySelector('a[href^="file:"]').click()`);await until(`${P}.app.pdfViewer.currentPageNumber===1`);
  assert.deepEqual((await visible()).sort(),[pdfId,mdId].sort());assert.equal(await run('qingye.notes.active()'),true);report.linkInPlace=true;

  // Activating a third document replaces the pane of the same kind (PDF replaces PDF).
  await run(`qingye.activate(${JSON.stringify(otherId)})`);assert.deepEqual(await run('qingye.notes.ids()'),[otherId,mdId]);assert.deepEqual((await visible()).sort(),[otherId,mdId].sort());
  await run(`qingye.activate(${JSON.stringify(pdfId)})`);assert.deepEqual(await run('qingye.notes.ids()'),[pdfId,mdId]);report.replacePane=true;

  // AI tools: both panes are listed with their side, either can be read, and the note can be written
  // while the PDF has the focus.
  const list=await run('qingye.aiTools.run("list_documents")');assert.deepEqual(list.notes_mode,{left_document_id:pdfId,right_document_id:mdId});
  assert.equal(list.documents.find(d=>d.id===pdfId).pane,'left');assert.equal(list.documents.find(d=>d.id===mdId).pane,'right');assert.equal(list.documents.find(d=>d.id===otherId).pane,undefined);
  const readPdf=await run(`qingye.aiTools.run('read_document',{document_id:${JSON.stringify(pdfId)},start_page:1,end_page:1})`),readMd=await run(`qingye.aiTools.run('read_document',{document_id:${JSON.stringify(mdId)}})`);
  assert.match(readPdf.pages[0].text,/open-source home/);assert.match(readMd.text,/Reading notes/);
  await run(`qingye.markdown.setViewMode(${M},'live');qingye.aiTools.run('insert_markdown',{document_id:${JSON.stringify(mdId)},text:'AI summary line.',position:'end'},{source:'panel',confirmEdits:false})`);
  await until(`${M}.editor.text.includes('AI summary line.')`);assert.deepEqual((await visible()).sort(),[pdfId,mdId].sort());report.aiBothPanes=true;

  // AI annotates the PDF: a highlight on the quoted passage, as one undoable edit.
  const before=await run(`(async()=>{const p=await ${P}.app.pdfDocument.getPage(1);return (await p.getAnnotations()).length;})()`);
  const marked=await run(`qingye.aiTools.run('annotate_pdf',{document_id:${JSON.stringify(pdfId)},page:1,quote:'An open-source home',comment:'Key claim'},{source:'panel',confirmEdits:false})`);
  assert.equal(marked.ok,true);await until(`${P}.loaded&&!${P}.editBusy`);
  const annotations=await run(`(async()=>{const p=await ${P}.app.pdfDocument.getPage(1);return (await p.getAnnotations()).map(a=>({subtype:a.subtype,contents:a.contentsObj?.str||'',rect:a.rect}));})()`);
  assert.equal(annotations.length,before+1);const added=annotations.find(a=>a.contents==='Key claim');assert.equal(added.subtype,'Highlight');
  // The sample line sits at y≈692 in PDF units; the highlight must cover it, not the whole page.
  assert.ok(added.rect[1]<700&&added.rect[3]>688&&added.rect[3]-added.rect[1]<40,'highlight rect '+added.rect);assert.ok(added.rect[0]<90&&added.rect[2]>150);
  assert.equal(await run(`${P}.dirty`),true);
  await assert.rejects(run(`qingye.aiTools.run('annotate_pdf',{document_id:${JSON.stringify(pdfId)},page:1,quote:'this text is not on the page'},{source:'panel',confirmEdits:false})`));
  report.aiAnnotate=true;await shot('notes-annotated.png');

  // Closing one of the two documents leaves notes mode and keeps the other open.
  await run(`${M}.editor.replaceAll(${M}.savedText??'# Reading notes\\n\\nFirst paragraph.\\n');qingye.syncDirty(${M})`);
  await run(`qingye.notes.swap()`);assert.deepEqual(await run('qingye.notes.ids()'),[mdId,pdfId]);
  await run(`qingye.notes.end()`);assert.equal(await run('document.body.classList.contains("notesMode")'),false);assert.equal((await visible()).length,1);
  // Right-click on another tab offers to put it beside the current document; Ctrl+\\ leaves again.
  await run(`qingye.activate(${JSON.stringify(pdfId)});[...document.querySelectorAll('#tabs .tab')].find(t=>t.textContent.includes('notes.md')).dispatchEvent(new MouseEvent('contextmenu',{bubbles:true,cancelable:true,clientX:420,clientY:30}))`);
  await until('document.getElementById("notesMenu").matches(":popover-open")');await pause(200);await shot('notes-tab-menu.png');
  await run('[...document.querySelectorAll("#notesMenu .menuItem")].find(b=>b.textContent.includes("在右侧打开")).click()');await until('qingye.notes.active()');assert.deepEqual(await run('qingye.notes.ids()'),[pdfId,mdId]);
  await run(`document.dispatchEvent(new KeyboardEvent('keydown',{code:'Backslash',key:'\\\\',ctrlKey:true,bubbles:true,cancelable:true}))`);await until('!qingye.notes.active()');
  await run(`qingye.notes.start(${JSON.stringify(otherId)},${JSON.stringify(mdId)})`);await run(`qingye.closeTab(${JSON.stringify(otherId)})`);
  await until(`!qingye.sessions.has(${JSON.stringify(otherId)})`);assert.equal(await run('qingye.notes.active()'),false);assert.deepEqual(await visible(),[mdId]);report.closeLeaves=true;
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));return report;
};
