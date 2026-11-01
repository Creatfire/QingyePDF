// 0.23: the home page in the real window: empty state, the reading card with its thumbnail, chapter
// and highlight, the shelf and its filters, notes and excerpts, the one input, and narrow windows.
const fs=require('node:fs/promises'),path=require('node:path'),assert=require('node:assert/strict');
exports.run=async({window,app,openFiles,samplePdf,output})=>{
  await fs.rm(output,{recursive:true,force:true});await fs.mkdir(output,{recursive:true});
  window.webContents.on('console-message',(_event,...args)=>{const d=typeof args[0]==='object'?args[0]:{message:args[1]};console.log('RENDERER:',d.message);});
  const run=code=>window.webContents.executeJavaScript(code,true).catch(error=>{console.error('FAILED SCRIPT:',code.slice(0,600));throw error;}),pause=ms=>new Promise(r=>setTimeout(r,ms));
  const until=async(code,label=code)=>{for(let n=0;n<200;n++){if(await run(code))return;await pause(100);}throw Error('home check timed out: '+label);};
  const text=id=>run(`document.getElementById(${JSON.stringify(id)}).innerText`);
  const noOverflow=()=>run(`(()=>{const h=document.getElementById('home');return h.scrollWidth<=h.clientWidth&&document.documentElement.scrollWidth<=innerWidth})()`);
  const report={version:app.getVersion(),emptyState:false,reading:false,shelf:false,notesAndExcerpts:false,input:false,narrow:false,languages:false,forget:false};

  // 1. Nothing opened yet: the empty state offers the three ways in, and the page stays in its width.
  await run('qingye.activate(null);qingye.home.refresh()');await until(`!document.getElementById('homeEmpty').hidden`,'empty state');
  assert.equal(await run(`document.getElementById('homeReading').hidden`),true);
  for(const id of ['homeEmptyOpen','homeEmptyNote','exampleButton'])assert.equal(await run(`!!document.getElementById('${id}').offsetParent`),true,id);
  assert.match(await text('homeDate'),/\d+ 月 \d+ 日 星期./);assert.match(await text('greeting'),/，$/);assert.equal(await noOverflow(),true);report.emptyState=true;

  // 2. Reading: page, chapter, thumbnail, and the highlight on that page.
  const pdf=path.join(output,'Zebrafish atlas.pdf'),other=path.join(output,'Quokka handbook.pdf'),note=path.join(output,'field notes.md'),done=path.join(output,'Finished.pdf');
  await fs.writeFile(pdf,samplePdf('Zebrafish atlas'));await fs.writeFile(other,samplePdf('Quokka handbook'));await fs.writeFile(done,samplePdf('Finished'));
  await fs.writeFile(note,`# Field notes\n\nMarmoset remark in the note.\nSecond line of it.\n\n[source](file://${encodeURI(pdf.replace(/\\/g,'/'))}#page=2)\n`);
  const add=async files=>{const opened=await openFiles(files);await run(`qingye.addDocuments(${JSON.stringify(opened.map(d=>({...d,...(d.bytes?{bytes:Array.from(d.bytes)}:{})})))})`);await until(`[...qingye.sessions.values()].every(s=>s.loaded)`,'documents loaded');return opened;};
  const [doneDoc]=await add([done]);
  await run(`(()=>{const s=qingye.sessions.get(${JSON.stringify(doneDoc.id)});s.app.pdfViewer.currentPageNumber=s.app.pagesCount})()`);await pause(300);
  await run(`qingye.closeTab(${JSON.stringify(doneDoc.id)})`);
  const [first,second]=await add([pdf,other,note]);
  const P=`qingye.sessions.get(${JSON.stringify(first.id)})`;
  await run(`${P}.bookmarks=[{page:1,title:'start'}]`);
  await until(`!!${P}.outlineFlat`,'outline read');
  // The window-level PDF: last activated and left on its first page, which carries the sample highlight.
  await run(`qingye.activate(${JSON.stringify(first.id)})`);await pause(300);
  await run('qingye.activate(null)');
  await until(`qingye.home.feed.books.some(b=>b.name==='Zebrafish atlas.pdf'&&b.hasThumb)`,'thumbnail stored');
  await run('qingye.home.refresh()');
  await until(`qingye.home.feed.books.find(b=>b.name==='Zebrafish atlas.pdf')?.marksSig===qingye.home.feed.books.find(b=>b.name==='Zebrafish atlas.pdf')?.sig`,'highlights read');
  await run('qingye.home.refresh()');await pause(300);
  const book=await run(`(({id,page,pages,chapter,bookmarks,annotations,highlights,hasThumb})=>({page,pages,chapter,bookmarks,annotations,highlights,hasThumb}))(qingye.home.feed.books.find(b=>b.name==='Zebrafish atlas.pdf'))`);
  assert.equal(book.pages,2);assert.equal(book.bookmarks,1);assert.ok(book.annotations>=1,'annotations '+book.annotations);assert.ok(book.highlights.length>=1,'highlights');assert.ok(book.chapter,'chapter');
  const card=await text('homeReading');assert.match(card,/正在读/);assert.match(card,/Zebrafish atlas/);assert.match(card,/第 1 页，共 2 页/);assert.match(card,/1 个书签/);assert.match(card,/从第 1 页继续/);
  assert.notEqual(await run(`qingye.home.feed.books.find(b=>b.name==='Finished.pdf')?.page`),undefined);
  assert.equal(await run(`!!document.querySelector('#homeReading .readingQuote')`),true,'quote');assert.equal(await run(`!!document.querySelector('#homeReading img.pageThumb')`),true,'thumbnail');
  assert.equal(await run(`!![...document.querySelectorAll('#homeReading button')].find(b=>b.textContent.includes('和笔记并排'))`),true,'note pairing');
  report.reading=true;

  // 3. Shelf: covers for each kind, the pinned filter and its hint, and a workspace as a collection.
  await until(`document.querySelectorAll('#shelfBooks .bookItem').length===4`,'four books');
  assert.equal(await run(`document.querySelectorAll('#shelfBooks .bookCover.typeCover.kind-markdown').length`),1);
  await run(`[...document.querySelectorAll('#shelfFilters button')].find(b=>b.textContent==='已固定').click()`);
  assert.match(await text('shelfEmpty'),/还没有固定/);assert.equal(await run(`document.getElementById('shelfBooks').hidden`),true);
  await run(`qingye.workspaces.pin(${JSON.stringify(second.id)})`);await run('qingye.home.refresh()');await until(`document.querySelectorAll('#shelfBooks .bookItem').length===1`,'pinned filter');
  await run(`[...document.querySelectorAll('#shelfFilters button')].find(b=>b.textContent==='全部').click()`);report.shelf=true;

  // 4. Notes and excerpts.
  const notes=await text('homeNotes');assert.match(notes,/Field notes/);assert.match(notes,/Marmoset remark/);assert.match(notes,/Zebrafish atlas\.pdf/);
  assert.match(await text('homeMarksAll'),/全部 \d+/);assert.equal(await run(`document.querySelectorAll('#homeMarks .markRow').length>0`),true);
  report.notesAndExcerpts=true;

  // 5. The one input: groups, "/" for commands, Enter opens the first row, Ctrl+K focuses it.
  const type=value=>run(`(()=>{const i=document.getElementById('homeOmniInput');i.focus();i.value=${JSON.stringify(value)};i.dispatchEvent(new Event('input'))})()`);
  const groups=()=>run(`[...document.querySelectorAll('#homeOmniList .omniGroupTitle')].map(n=>n.textContent)`);
  await type('Quokka');await until(`!document.getElementById('homeOmniList').hidden`,'result list');
  assert.equal((await groups())[0],'文件');
  await type('/设置');assert.deepEqual(await groups(),['命令']);
  await type('/');assert.ok(await run(`qingye.home.rows.length>3`),'commands listed');
  await run(`(()=>{const i=document.getElementById('homeOmniInput');i.value='';i.dispatchEvent(new Event('input'));i.blur()})()`);
  await run(`document.getElementById('home').dispatchEvent(new KeyboardEvent('keydown',{key:'k',code:'KeyK',ctrlKey:true,bubbles:true}))`);
  await type('Quokka');await until(`qingye.home.rows[0]?.kind==='file'`,'first row is the file');
  await run(`qingye.activate(null)`);await type('Quokka');
  await run(`document.getElementById('homeOmniInput').dispatchEvent(new KeyboardEvent('keydown',{key:'Enter',bubbles:true}))`);
  await until(`document.body.dataset.mode==='pdf'&&qingye.sessions.get(${JSON.stringify(second.id)}).panel.hidden===false`,'Enter opened the first result');
  await run('qingye.activate(null)');await pause(200);report.input=true;

  // 6. Narrow windows: fewer covers, nothing wider than the page, in both themes.
  const before=window.getContentSize();
  for(const [width,count] of [[1400,6],[920,5]]){
    window.setContentSize(width,700);await pause(350);
    const shown=await run(`getComputedStyle(document.getElementById('shelfBooks')).getPropertyValue('--shelf-n').trim()`);
    assert.equal(Number(shown),count,`covers at ${width}`);assert.equal(await noOverflow(),true,'overflow at '+width);
  }
  await run(`document.getElementById('themeButton').click()`);await pause(120);assert.equal(await noOverflow(),true,'overflow in the other theme');
  await run(`document.getElementById('themeButton').click()`);window.setContentSize(before[0],before[1]);await pause(200);report.narrow=true;

  // 7. Languages: the fixed text follows; titles of the user's documents do not.
  await run(`qingye.i18n.setLanguage('en',{remember:false})`);await run('qingye.home.refresh()');await pause(200);
  assert.equal(await run(`document.querySelector('.homeTitle').innerText.replace(/\\s+/g,' ').includes('keep reading.')`),true);assert.equal(await text('shelfTitle'),'Shelf');
  assert.match(await text('homeDate'),/[A-Za-z]/);
  assert.equal(await run(`document.getElementById('homeOmniInput').placeholder`),'Open a file, search everything, or type a command…');
  assert.match(await text('homeReading'),/Page 1 of 2/);assert.match(await text('homeReading'),/Continue from page 1/);
  await run(`qingye.i18n.setLanguage('zh-CN',{remember:false})`);await run('qingye.home.refresh()');await pause(150);report.languages=true;

  // 8. Forgetting a recent entry forgets its page image and its quoted text.
  const id=await run(`qingye.home.feed.books.find(b=>b.name==='Zebrafish atlas.pdf').id`);
  assert.equal(await run(`desktop.homeThumb(${JSON.stringify(id)}).then(Boolean)`),true);
  await run(`qingye.closeTab(${JSON.stringify(first.id)})`);await run('qingye.activate(null)');await pause(200);
  await run(`desktop.recent().then(list=>{const hit=list.find(x=>x.name==='Zebrafish atlas.pdf');return desktop.recentRemove(hit.id)})`);
  await run('qingye.home.refresh()');await pause(150);
  assert.equal(await run(`qingye.home.feed.books.some(b=>b.name==='Zebrafish atlas.pdf')`),false);
  const index=JSON.parse(await fs.readFile(path.join(app.getPath('userData'),'home','index.json'),'utf8'));
  assert.equal(index.thumbs.some(t=>t.path.endsWith('Zebrafish atlas.pdf')),false);assert.equal(index.marks.some(t=>t.path.endsWith('Zebrafish atlas.pdf')),false);report.forget=true;

  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2));
  await fs.mkdir(path.dirname(path.join(output,'..','report.json')),{recursive:true}).catch(()=>{});await fs.writeFile(path.join(output,'..','report.json'),JSON.stringify(report,null,2));
  return report;
};
