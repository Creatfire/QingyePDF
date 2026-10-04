// 0.11.0: the two-way link between a note and its PDF (excerpt boxes, jumping back, region
// excerpts, annotation sync, scroll sync), library search and reference details, in the real window.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
exports.run=async({window,app,dialog,openFiles,samplePdf,output})=>{
  await fs.rm(output,{recursive:true,force:true});await fs.mkdir(output,{recursive:true});
  window.webContents.on('console-message',(_event,...args)=>{const d=typeof args[0]==='object'?args[0]:{message:args[1]};console.log('RENDERER:',d.message);});
  const run=code=>window.webContents.executeJavaScript(code,true).catch(error=>{console.error('FAILED SCRIPT:',code.slice(0,600));throw error;}),pause=ms=>new Promise(r=>setTimeout(r,ms));
  const until=async(code,label=code)=>{for(let n=0;n<200;n++){if(await run(code))return;await pause(100);}throw Error('0.11.0 check timed out: '+label);};
  const shot=async name=>fs.writeFile(path.join(output,name),(await window.webContents.capturePage(undefined,{stayHidden:true,stayAwake:true})).toPNG());
  const pdf=path.join(output,'zebrafish atlas.pdf'),md=path.join(output,'notes.md'),other=path.join(output,'second.pdf');
  const filler=Array.from({length:60},(_,n)=>`Filler paragraph ${n+1} keeps the note long enough to scroll.`).join('\n\n');
  await fs.writeFile(pdf,samplePdf('Zebrafish atlas'));await fs.writeFile(other,samplePdf('Quokka handbook'));await fs.writeFile(md,'# Reading notes\n\nMarmoset remark in the note.\n\n'+filler+'\n');
  const opened=await openFiles([pdf,md,other]);await run(`qingye.addDocuments(${JSON.stringify(opened.map(d=>({...d,...(d.bytes?{bytes:Array.from(d.bytes)}:{})})))})`);
  const [pdfId,mdId,otherId]=opened.map(d=>d.id),P=`qingye.sessions.get(${JSON.stringify(pdfId)})`,M=`qingye.sessions.get(${JSON.stringify(mdId)})`;
  const report={version:app.getVersion(),excerptRect:false,jumpBack:false,region:false,regionPick:false,annotationSync:false,scrollSync:false,library:false,libraryOpenHit:false,citation:false};
  await until(`${P}.loaded&&${M}.loaded&&qingye.sessions.get(${JSON.stringify(otherId)}).loaded`,'documents loaded');
  await run(`qingye.notes.start(${JSON.stringify(pdfId)},${JSON.stringify(mdId)})`);await until('qingye.notes.active()');await run('qingye.notes.setSync(true)');
  await until(`${P}.frame.contentDocument.querySelector('.page[data-page-number="1"] .textLayer span')`,'text layer');await pause(400);

  // 1. Excerpting the selected text records where it sits on the page.
  await run(`(()=>{const d=${P}.frame.contentDocument,span=[...d.querySelectorAll('.page[data-page-number="1"] .textLayer span')].find(n=>n.textContent.includes('open-source home'));const r=d.createRange();r.selectNodeContents(span);const s=${P}.frame.contentWindow.getSelection();s.removeAllRanges();s.addRange(r);})()`);
  const source=await run(`qingye.notes.selectionSource(${P})`);assert.equal(source.page,1);assert.match(source.text,/open-source home/);
  // The sample line is set at x=72, baseline y=692, 13 pt.
  assert.ok(source.rect&&Math.abs(source.rect[0]-72)<4&&source.rect[1]>680&&source.rect[1]<694&&source.rect[3]>694&&source.rect[3]<712&&source.rect[2]>250,'selection rect '+source.rect);
  await run(`qingye.notes.excerptSelection(${P})`);
  let text=await run(`${M}.editor.text`);assert.match(text,/> An open-source home for your documents\./);
  const link=/zebrafish%20atlas\.pdf#page=1&rect=([\d.%C]+)>\)/.exec(text);assert.ok(link,'excerpt link with rect: '+text.slice(-300));
  assert.deepEqual(decodeURIComponent(link[1]).split(',').map(Number),source.rect.map(v=>Math.round(v*1000)/1000));report.excerptRect=true;

  // 2. Following the link goes back to the page and marks the passage.
  await run(`${P}.app.pdfViewer.currentPageNumber=2;qingye.markdown.setViewMode(${M},'read')`);await pause(300);
  await run(`[...${M}.panel.querySelectorAll('a[href^="file:"]')].find(a=>a.getAttribute('href').includes('rect=')).click()`);
  await until(`${P}.app.pdfViewer.currentPageNumber===1`,'jump to page 1');await until(`!!${P}.frame.contentDocument.querySelector('.page[data-page-number="1"] .sourceNoteHighlight')`,'passage highlight');
  const mark=await run(`(()=>{const d=${P}.frame.contentDocument,b=d.querySelector('.sourceNoteHighlight').getBoundingClientRect(),s=[...d.querySelectorAll('.page[data-page-number="1"] .textLayer span')].find(n=>n.textContent.includes('open-source home')).getBoundingClientRect();return [b.left-s.left,b.top-s.top,b.width-s.width,b.height-s.height];})()`);
  assert.ok(mark.every(v=>Math.abs(v)<8),'highlight covers the passage: '+mark);assert.equal(await run('qingye.notes.active()'),true);report.jumpBack=true;await shot('jump-back.png');
  await run(`qingye.markdown.setViewMode(${M},'live')`);

  // 3. A region of the page becomes a picture beside the note, with a link to that region.
  const cut=await run(`qingye.notes.excerptRegion(${P},1,[.08,.08,.75,.24])`);
  assert.match(cut.image,/^assets\/image-\d+\.png$/);assert.ok(cut.width>=900&&cut.height>100,'region size '+cut.width+'×'+cut.height);
  const png=await fs.readFile(path.join(output,cut.image));assert.equal(png.subarray(1,4).toString(),'PNG');assert.ok(png.length>2000,'picture has content: '+png.length);
  text=await run(`${M}.editor.text`);assert.ok(text.includes(`![zebrafish atlas.pdf 第 1 页](${cut.image})`));assert.match(text,/第 1 页 · 区域\]\(<file:[^>]+#page=1&rect=/);
  // 595 × 842 pt page: the box is 8–75 % across and 8–24 % down.
  assert.ok(Math.abs(cut.rect[0]-47.6)<2&&Math.abs(cut.rect[2]-446.25)<2&&Math.abs(cut.rect[3]-774.6)<2&&Math.abs(cut.rect[1]-639.9)<2,'region rect '+cut.rect);
  assert.equal(await run(`qingye.notes.excerptRegion(${P},1,[.2,.2,.201,.9]).then(()=>'ok',e=>e.message)`),'框选的区域太小，请重新拖动。');report.region=true;
  // The same by dragging on the page; Esc cancels.
  await run(`qingye.notes.pickRegion()`);assert.equal(await run('qingye.notes.picking()'),true);
  await run(`${P}.frame.contentDocument.dispatchEvent(new KeyboardEvent('keydown',{key:'Escape',bubbles:true,cancelable:true}))`);assert.equal(await run('qingye.notes.picking()'),false);
  const images=async()=>(await fs.readdir(path.join(output,'assets'))).length,beforePick=await images();
  await run(`(()=>{qingye.notes.pickRegion();const d=${P}.frame.contentDocument,page=d.querySelector('.page[data-page-number="1"]'),layer=page.querySelector('.textLayer'),b=layer.getBoundingClientRect();
    const fire=(type,x,y)=>layer.dispatchEvent(new PointerEvent(type,{bubbles:true,cancelable:true,button:0,clientX:b.left+b.width*x,clientY:b.top+b.height*y}));fire('pointerdown',.1,.1);fire('pointermove',.4,.2);window.__box=!!d.querySelector('.qyRegionBox')&&getComputedStyle(d.querySelector('.qyRegionBox')).borderTopStyle==='solid'&&d.defaultView.getComputedStyle(page).cursor==='crosshair';fire('pointerup',.6,.3);})()`);
  assert.equal(await run('window.__box'),true);assert.equal(await run(`${P}.frame.contentWindow.getComputedStyle(${P}.frame.contentDocument.querySelector('.page')).cursor`),'auto');
  for(let n=0;n<100&&await images()===beforePick;n++)await pause(100);assert.equal(await images(),beforePick+1);assert.equal(await run('qingye.notes.picking()'),false);
  assert.equal(await run(`${P}.frame.contentDocument.querySelectorAll('.qyRegionBox').length`),0);report.regionPick=true;await pause(300);await shot('region.png');

  // 4. Annotations of the PDF go into the note once.
  const first=await run(`qingye.notes.syncAnnotations()`);assert.ok(first.added>=1,'annotations added: '+JSON.stringify(first));
  text=await run(`${M}.editor.text`);const synced=(text.match(/第 1 页 · [^\]]+\]\(<file:[^>]+#page=1&rect=/g)||[]).length;assert.ok(synced>=first.added+1);
  const second=await run(`qingye.notes.syncAnnotations()`);assert.equal(second.added,0);assert.equal(second.skipped,first.added);assert.equal(await run(`${M}.editor.text.length`),text.length);report.annotationSync=true;

  // 5. Scroll sync: while the PDF is read, the note follows to the excerpt of the page shown.
  await run(`qingye.notes.excerpt(${P},'Every tab keeps its own reader state.',2,[72,680,300,700])`);await pause(1200);
  await run(`${M}.editor.scroller.scrollTo({top:0,behavior:'instant'})`);await pause(300);assert.ok(await run(`${M}.editor.scroller.scrollTop`)<40);
  // Not while the note has the focus: typing must never be interrupted.
  await run(`qingye.activate(${JSON.stringify(mdId)},{keepFocus:true});${P}.app.pdfViewer.currentPageNumber=2`);await pause(600);assert.ok(await run(`${M}.editor.scroller.scrollTop`)<40,'the note is not moved while it has the focus');
  await run(`${P}.app.pdfViewer.currentPageNumber=1;qingye.activate(${JSON.stringify(pdfId)},{keepFocus:true})`);await pause(300);
  await run(`${P}.app.pdfViewer.currentPageNumber=2`);await until(`${M}.editor.scroller.scrollTop>400`,'note follows the PDF');
  await until(`(()=>{const e=${M}.editor,box=e.scroller.getBoundingClientRect(),q=[...e.scroller.querySelectorAll('blockquote')].find(n=>n.textContent.includes('Every tab keeps'))?.getBoundingClientRect();return !!q&&q.top-box.top>=-4&&q.bottom<=box.bottom+2;})()`,'the page 2 excerpt is in view');await pause(300);await shot('scroll-sync.png');
  await pause(1500);await run(`qingye.notes.setSync(false);${M}.editor.scroller.scrollTo({top:0,behavior:'instant'});${P}.app.pdfViewer.currentPageNumber=1`);await pause(300);await run(`${P}.app.pdfViewer.currentPageNumber=2`);await pause(700);
  assert.ok(await run(`${M}.editor.scroller.scrollTop`)<40,'sync off: the note stays');await run('qingye.notes.setSync(true)');report.scrollSync=true;
  // The title-bar button now opens the commands of notes mode instead of leaving it.
  await run(`document.getElementById('notesButton').click()`);await until('document.getElementById("notesMenu").matches(":popover-open")','notes menu');
  assert.deepEqual(await run('[...document.querySelectorAll("#notesMenu .menuItem .notesMenuText")].map(n=>n.textContent)'),['摘录选中的文字','框选区域（公式、图表、表格）','同步 PDF 批注到笔记','关闭滚动联动','引用信息 / BibTeX…','交换左右窗格','退出笔记模式']);
  await pause(200);await shot('notes-menu.png');await run('document.getElementById("notesMenu").hidePopover()');

  // 6. Library search: every document of the recent list, by content.
  await run(`qingye.saveSession(${M},false)`);await until(`!${M}.dirty`,'note saved');
  await run(`document.getElementById('libraryButton').click()`);await until('document.getElementById("libraryDialog").open','library dialog');
  await run(`qingye.library.refresh()`);
  let found=await run(`qingye.library.search('zebrafish')`);assert.deepEqual(found.documents.map(d=>d.name).sort(),['notes.md','zebrafish atlas.pdf']);
  found=await run(`qingye.library.search('quokka')`);assert.deepEqual(found.documents.map(d=>[d.name,d.kind,d.hits[0].page]),[['second.pdf','pdf',1]]);
  // (The profile may hold documents of other suites; only the three of this run are checked.)
  found=await run(`qingye.library.search('reader state')`);const mine=found.documents.filter(d=>d.path.startsWith(output));assert.deepEqual(mine.map(d=>d.name).sort(),['notes.md','second.pdf','zebrafish atlas.pdf']);assert.ok(mine.filter(d=>d.kind==='pdf').every(d=>d.hits[0].page===2));
  found=await run(`qingye.library.search('"marmoset remark"')`);assert.deepEqual(found.documents.map(d=>d.name),['notes.md']);assert.ok(found.documents[0].hits[0].line>=3);assert.equal((await fs.readFile(md,'utf8')).slice(found.documents[0].hits[0].offset).slice(0,15).toLowerCase(),'marmoset remark');
  assert.equal((await run(`qingye.library.search('nothing-like-this')`)).total,0);assert.match(await run('document.getElementById("librarySummary").textContent'),/没有找到/);
  await run(`qingye.library.search('reader state')`);await pause(200);await shot('library.png');
  assert.ok(await run('document.querySelectorAll("#libraryResults .libraryHit mark").length')>=3);report.library=true;
  // Opening a hit goes to the page and highlights the term there.
  await run(`qingye.notes.end();[...document.querySelectorAll('#libraryResults .libraryDoc')].find(n=>n.querySelector('.libraryDocHead').title===${JSON.stringify(other)}).querySelector('.libraryHit').click()`);
  const O=`qingye.sessions.get(${JSON.stringify(otherId)})`;
  await until(`!document.getElementById('libraryDialog').open&&${O}.app.pdfViewer.currentPageNumber===2&&[...qingye.sessions.values()].find(s=>!s.panel.hidden)?.id===${JSON.stringify(otherId)}`,'hit opened');
  await until(`${O}.app.findController.pageMatches?.[1]?.length===1`,'term highlighted on the page');
  // An edited file is indexed again; the Markdown hit leads to its paragraph.
  await fs.appendFile(other,'\n% changed\n');await run(`qingye.library.open('marmoset')`);await run(`qingye.library.refresh()`);
  await run(`document.querySelector('#libraryResults .libraryHit').click()`);await until(`[...qingye.sessions.values()].find(s=>!s.panel.hidden)?.id===${JSON.stringify(mdId)}`,'markdown hit opened');report.libraryOpenHit=true;

  // 7. Reference details: detected from the PDF, edited, written as BibTeX, inserted into the note.
  await run(`qingye.notes.start(${JSON.stringify(pdfId)},${JSON.stringify(mdId)})`);
  await run(`qingye.citations.open(${P})`);await until('document.getElementById("citationDialog").open','citation dialog');
  const detected=await run('qingye.citations.read()');assert.equal(detected.title,'Zebrafish atlas');assert.equal(detected.type,'misc');
  await run(`(()=>{const set=(f,v)=>{const n=document.querySelector('#citationDialog [data-field="'+f+'"]');n.value=v;n.dispatchEvent(new Event('input',{bubbles:true}));};set('type','article');set('authors','Lovelace, Ada; Alan Turing');set('year','2024');set('journal','Journal of Tests');set('doi','10.1234/zebra.2024.01');})()`);
  const bib=await run('document.getElementById("citationBibtex").value');
  assert.equal(bib,'@article{lovelace2024zebrafish,\n  title = {{Zebrafish atlas}},\n  author = {Lovelace, Ada and Alan Turing},\n  year = {2024},\n  journal = {Journal of Tests},\n  doi = {10.1234/zebra.2024.01}\n}');
  assert.equal(await run('document.getElementById("citationReference").textContent'),'LOVELACE A, TURING A. Zebrafish atlas[J]. Journal of Tests, 2024. https://doi.org/10.1234/zebra.2024.01.');
  await pause(200);await shot('citation.png');
  await run('document.getElementById("citationReference").click()');assert.match(await run('document.getElementById("citationReference").textContent'),/^Lovelace, A\., & Turing, A\. \(2024\)\./);
  await run('document.getElementById("citationInsert").click()');await until(`${M}.editor.text.includes('[@lovelace2024zebrafish]')`,'reference inserted');
  // The library of references is exported as one .bib file; the details are remembered per document.
  const bibFile=path.join(output,'references.bib'),originalSave=dialog.showSaveDialog;dialog.showSaveDialog=async()=>({canceled:false,filePath:bibFile});
  try{await run('document.getElementById("citationExport").click()');for(let n=0;n<100&&!await fs.stat(bibFile).catch(()=>null);n++)await pause(100);}finally{dialog.showSaveDialog=originalSave;}
  assert.match(await fs.readFile(bibFile,'utf8'),/@article\{lovelace2024zebrafish,[\s\S]*doi = \{10\.1234\/zebra\.2024\.01\}/);
  await run('document.getElementById("citationClose").click()');await run(`qingye.citations.open(${P})`);assert.equal((await run('qingye.citations.read()')).journal,'Journal of Tests');await run('qingye.citations.close()');
  assert.equal(await run(`desktop.citationLookup('not a doi').then(()=>'ok',e=>/DOI 格式无效/.test(e.message)?'rejected':e.message)`),'rejected');report.citation=true;

  await run(`${M}.editor.replaceAll(${M}.savedText??${M}.editor.text);qingye.syncDirty(${M})`);
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));return report;
};
