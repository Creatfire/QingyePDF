import { createHistory } from './history.mjs';
import { createSearchOcr } from './search-ocr.mjs';
export function createNavigation({ current, guard, views, openTools, api, snapshot, addDocuments, applyEdit,navigate=action=>action(),readingTrail,status=()=>{},isProcessing,notesFor=()=>null,insertNotes }) {
  const $ = id => document.getElementById(id);
  const pane=document.createElement('aside');pane.id='navigationPanel';pane.hidden=true;
  pane.setAttribute('aria-labelledby','navigationTitle');
  pane.innerHTML='<header><strong id="navigationTitle">搜索</strong><button id="closeNavigation" data-icon="x" title="关闭侧栏" aria-label="关闭导航"></button></header><nav aria-label="侧栏视图"><button data-nav="search" data-icon="search">搜索</button><button data-nav="outline" data-icon="outline">目录</button><button data-nav="bookmarks" data-icon="bookmark">书签</button><button data-nav="thumbnails" data-icon="grid">页面</button><button data-nav="comments" data-icon="comment">批注</button></nav><div id="navigationControls"></div><div id="navigationContent"></div>';
  $('workspace').append(pane);
  let mode='search',ticket=0,observer,debounce,matchTicket=0,findTimer;
  const content=$('navigationContent'),controls=$('navigationControls');
  const destinations=new WeakMap();
  const searchOcr=createSearchOcr({api,applyEdit,guard,status,isProcessing,onUpdated:s=>{if(!pane.hidden&&mode==='search'&&s===current())guard(async()=>{if(s.searchQuery)await search(s,s.searchQuery,s.searchOptions);await refreshMatches(s);});}});
  const button=(text,action,parent=controls)=>{const b=document.createElement('button');b.textContent=text;b.onclick=()=>guard(action);parent.append(b);return b;};
  const input=(placeholder,parent=controls)=>{const i=document.createElement('input');i.type='search';i.placeholder=placeholder;i.setAttribute('aria-label',placeholder);parent.append(i);return i;};
  function close(){searchOcr.detach();for(const id of ['searchButton','outlineButton'])$(id).setAttribute('aria-expanded','false');pane.hidden=true;document.body.classList.remove('navigationOpen');ticket++;observer?.disconnect();clearTimeout(debounce);clearTimeout(findTimer);}
  async function refreshMatches(s){
    if(pane.hidden||mode!=='search'||s!==current())return;
    const myTicket=++matchTicket;
    const matches=s.app.findController.pageMatches;
    const total=matches.reduce((n,row)=>n+(row?.length||0),0);
    if(total&&s.searchRecordPending&&s.searchOrigin){readingTrail?.mark(s.searchOrigin);s.searchRecordPending=false;}
    $('searchSummary').textContent=s.searchQuery ? `找到 ${total} 处 · ${matches.filter(r=>r?.length).length} 页`:'输入关键词搜索全文';
    content.replaceChildren();
    let shown=0;
    for(let index=0;index<matches.length;index++)if(matches[index]?.length){
      s.searchText ||=new Map();let text=s.searchText.get(index);
      if(text===undefined){const page=await s.app.pdfDocument.getPage(index+1);const data=await page.getTextContent({disableNormalization:true});text=data.items.map(i=>typeof i.str==='string'?i.str+(i.hasEOL?'\n':''):'').join('');s.searchText.set(index,text);}
      if(myTicket!==matchTicket||pane.hidden||mode!=='search')return;
      for(let hit=0;hit<matches[index].length&&shown<300;hit++,shown++){
        const start=matches[index][hit],length=s.app.findController.pageMatchesLength[index]?.[hit]||s.searchQuery.length;
        const row=button('',()=>navigate(()=>{
          // Use PDF.js's actual match selection, so next/previous continue at the chosen occurrence.
          const find=s.app.findController;find._offset={pageIdx:index,matchIdx:hit,wrapped:false};find._selected={pageIdx:index,matchIdx:hit};find._scrollMatches=true;
          s.app.pdfViewer.currentPageNumber=index+1;s.app.eventBus.dispatch('updatetextlayermatches',{source:find,pageIndex:-1});
        }),content);row.className='navigationRow searchMatch';row.dataset.page=index+1;row.dataset.match=hit;
        const title=document.createElement('strong');title.textContent=`第 ${index+1} 页 · 第 ${hit+1} 处`;const snippet=document.createElement('span');
        const mark=document.createElement('mark');mark.textContent=text.slice(start,start+length);
        snippet.append(document.createTextNode((start>40?'…':'')+text.slice(Math.max(0,start-40),start)),mark,document.createTextNode(text.slice(start+length,start+length+60)+(start+length+60<text.length?'…':'')));
        row.append(title,snippet);
      }
    }
    if(shown===300){const note=document.createElement('p');note.textContent='列表显示前 300 处；上一个 / 下一个可遍历全部命中。';content.append(note);}
    if(s.searchQuery&&!total){content.textContent=s.ocrCoverage?.missingPages.length?'当前未找到匹配内容；缺少文字层的页面尚未参与文字搜索，请先识别。':s.ocrCoverage?.checked===s.app.pagesCount?'全文没有匹配内容。':'正在检查文字层，当前搜索结果可能不包含扫描页。';}
  }
  async function search(s,query,options={}){
    s.searchOrigin=readingTrail?.capture();s.searchRecordPending=!!query.trim();
    if(s.view.reflow)await views.change('reflow',false,s);
    s.app.viewsManager.switchView(0);
    s.searchQuery=query; s.searchOptions=options;
    if(query.trim()){const history=JSON.parse(localStorage.getItem('qingye-search-history')||'[]');localStorage.setItem('qingye-search-history',JSON.stringify([query,...history.filter(x=>x!==query)].slice(0,12)));}
    s.app.eventBus.dispatch('find',{source:window,type:'',query,caseSensitive:!!options.caseSensitive,entireWord:!!options.entireWord,highlightAll:true,findPrevious:false,matchDiacritics:false});
  }
  function searchControls(s){
    const box=input('搜索文档中的文字');box.id='searchQuery';box.value=s.searchQuery||'';
    const history=document.createElement('datalist');history.id='searchHistory';for(const term of JSON.parse(localStorage.getItem('qingye-search-history')||'[]')){const o=document.createElement('option');o.value=term;history.append(o);}box.setAttribute('list',history.id);controls.append(history);
    const options=document.createElement('div');options.className='navigationOptions';controls.append(options);
    const flags={};
    for(const [name,label] of [['caseSensitive','区分大小写'],['entireWord','全词匹配']]){const l=document.createElement('label'),c=document.createElement('input');c.type='checkbox';c.checked=!!s.searchOptions?.[name];l.append(c,document.createTextNode(label));options.append(l);flags[name]=c;}
    const submit=()=>search(s,box.value,{caseSensitive:flags.caseSensitive.checked,entireWord:flags.entireWord.checked});
    box.oninput=()=>{clearTimeout(debounce);debounce=setTimeout(()=>guard(submit),300);};
    box.onkeydown=e=>{if(e.key==='Enter'){e.preventDefault();clearTimeout(debounce);guard(submit);}};
    for(const c of Object.values(flags))c.onchange=()=>guard(submit);
    const actions=document.createElement('div');actions.className='navigationOptions';controls.append(actions);
    for(const [label,previous] of [['上一个',true],['下一个',false]])button(label,()=>s.app.eventBus.dispatch('find',{source:window,type:'again',query:s.searchQuery||'',...s.searchOptions,highlightAll:true,findPrevious:previous}),actions).dataset.icon=previous?'up':'down';
    const summary=document.createElement('p');summary.id='searchSummary';controls.append(summary);
    searchOcr.mount(s,controls);
    refreshMatches(s);box.focus();
  }
  async function outline(s,myTicket){
    const items=await s.app.pdfDocument.getOutline();if(myTicket!==ticket)return;
    const filter=input('筛选目录标题');
    const actions=document.createElement('div');actions.className='navigationOptions';controls.append(actions);
    button('全部展开',()=>{for(const d of content.querySelectorAll('details'))d.open=true;},actions);
    button('全部折叠',()=>{for(const d of content.querySelectorAll('details'))d.open=false;},actions);
    button('编辑目录',()=>openTools('outline'),actions);
    function draw(){
      content.replaceChildren();const term=filter.value.trim().toLocaleLowerCase();
      const contains=item=>item.title.toLocaleLowerCase().includes(term)||item.items?.some(contains);
      const append=(list,parent)=>{for(const item of list){if(term&&!contains(item))continue;
        const row=button(item.title||'无标题',()=>navigate(()=>s.app.pdfLinkService.goToDestination(item.dest)),document.createElement('div'));row.className='outlineTitle';
        if(item.items?.length){const details=document.createElement('details');details.open=!!term;const summary=document.createElement('summary');summary.append(row);details.append(summary);const children=document.createElement('div');children.className='outlineChildren';append(item.items,children);details.append(children);parent.append(details);}
        else parent.append(row);
      }};
      if(!items?.length)content.textContent='文档没有内置目录。点击“编辑目录”可以添加章节与页码，并导出带目录的 PDF。';else append(items,content);
    }
    filter.oninput=draw;draw();
  }
  function bookmarks(s){
    s.bookmarks ||= s.state?.bookmarks || [];
    button('将当前页加入书签',()=>{
      const page=s.app.pdfViewer.currentPageNumber;
      if(!s.bookmarks.some(b=>b.page===page))s.bookmarks.push({page,title:`第 ${page} 页`});
      draw();
    }).dataset.icon='bookmark';
    const draw=()=>{content.replaceChildren();
      for(const bookmark of s.bookmarks.sort((a,b)=>a.page-b.page)){
        const row=document.createElement('div');row.className='bookmarkRow';
        button(`${bookmark.title} · ${bookmark.page}`,()=>navigate(()=>{s.app.pdfViewer.currentPageNumber=bookmark.page;}),row);
        const name=document.createElement('input');name.value=bookmark.title;name.setAttribute('aria-label','书签标题');name.onchange=()=>{bookmark.title=name.value.slice(0,200)||`第 ${bookmark.page} 页`;draw();};row.append(name);
        button('×',()=>{s.bookmarks=s.bookmarks.filter(b=>b!==bookmark);draw();},row);content.append(row);
      }
      if(!s.bookmarks.length)content.textContent='阅读书签保存在本机；要写入 PDF，请编辑“目录”。';
    };draw();
  }
  function thumbnails(s,myTicket){
    const select=document.createElement('select');select.setAttribute('aria-label','缩略图列数');select.innerHTML='<option value="1">1 列</option><option value="2" selected>2 列</option>';controls.append(select);
    content.className='thumbnailGrid';select.onchange=()=>content.style.gridTemplateColumns=`repeat(${select.value},1fr)`;select.onchange();
    let order=s.pageDraft?.order||Array.from({length:s.app.pagesCount},(_,i)=>i+1),selected=new Set(),dragged;
    const history=s.pageDraft?.history||createHistory();s.pageDraft={order,history};
    const remember=(before,label)=>{history.push(JSON.stringify(before),JSON.stringify(order),label);s.pageDraft.order=order;};
    const actions=document.createElement('div');actions.className='pageActions';controls.append(actions);
    const note=document.createElement('p');note.textContent='点击页码多选；拖动卡片排序，处理后导出副本。';controls.append(note);
    const draw=()=>{for(const n of order){const card=content.querySelector(`[data-page="${n}"]`);if(card){content.append(card);card.classList.toggle('selected',selected.has(n));card.querySelector('input').checked=selected.has(n);}}};
    async function apply(pageMode){let spec=pageMode==='reorder'?order:[...selected];if(!spec.length)throw new Error('请先勾选页面。');if(pageMode==='delete'&&spec.length===order.length)throw new Error('至少保留一页。');const result=await api.toolsJob(s.id,await snapshot(s),{action:'organize',mode:pageMode,pages:spec.join(','),angle:90});if(result.opened?.length)await addDocuments(result.opened);return result;}
    button('↶ 撤销排序',()=>{const v=history.undo();if(v){order=JSON.parse(v);s.pageDraft.order=order;draw();}},actions);button('↷ 重做排序',()=>{const v=history.redo();if(v){order=JSON.parse(v);s.pageDraft.order=order;draw();}},actions);
    button('应用排序 · 可撤销',async()=>{await applyEdit(s,{action:'organize',mode:'reorder',pages:order.join(',')},'页面重排 · '+order.slice(0,30).join(',')+(order.length>30?'…':''));},actions);
    button('全部选择',()=>{selected=new Set(order);draw();},actions);button('清除选择',()=>{selected.clear();draw();},actions);
    for(const [label,action]of [['导出排序','reorder'],['提取','extract'],['删除','delete'],['旋转','rotate']])button(label,()=>['delete','rotate'].includes(action)?(selected.size?applyEdit(s,{action:'organize',mode:action,pages:[...selected].join(','),angle:90},(action==='delete'?'删除页面':'旋转页面')+' · '+[...selected].join(',')):Promise.reject(new Error('请先选择页面。'))):apply(action),actions);
    observer=new IntersectionObserver(async entries=>{
      for(const entry of entries){if(!entry.isIntersecting||entry.target.dataset.rendered)continue;
        const b=entry.target;b.dataset.rendered='true';
        try{const page=await s.app.pdfDocument.getPage(Number(b.dataset.page));if(myTicket!==ticket)return;
          const canvas=b.querySelector('canvas');const viewport=page.getViewport({scale:130/page.getViewport({scale:1}).width});canvas.width=viewport.width;canvas.height=viewport.height;
          await page.render({canvasContext:canvas.getContext('2d'),viewport}).promise;
        }catch{b.title='缩略图未加载，可点击打开页面。';}
      }
    },{root:content,rootMargin:'100px'});
    for(let n=1;n<=s.app.pagesCount;n++){const b=document.createElement('div');b.tabIndex=0;b.draggable=true;b.dataset.page=n;b.className='thumbnailCard';b.setAttribute('aria-label',`第 ${n} 页`);const canvas=document.createElement('canvas');canvas.width=130;canvas.height=180;const label=document.createElement('label'),check=document.createElement('input');check.type='checkbox';check.setAttribute('aria-label',`选择第 ${n} 页`);check.onchange=()=>{if(check.checked)selected.add(n);else selected.delete(n);draw();};label.append(check,document.createTextNode(' '+n));b.append(canvas,label);b.onclick=e=>{if(!e.target.closest('label'))s.app.pdfViewer.currentPageNumber=n;};b.onkeydown=e=>{if(e.key==='Enter')s.app.pdfViewer.currentPageNumber=n;};
      b.ondragstart=e=>{dragged=n;e.dataTransfer.setData('text/plain','qingye-page-'+n);e.dataTransfer.effectAllowed='move';};b.ondragover=e=>{if(dragged){e.preventDefault();e.stopPropagation();}};b.ondrop=e=>{if(!dragged)return;e.preventDefault();e.stopPropagation();const moving=selected.has(dragged)?order.filter(n=>selected.has(n)):[dragged];if(moving.includes(n))return;const before=[...order];order=order.filter(p=>!moving.includes(p));order.splice(order.indexOf(n),0,...moving);remember(before,'页面重排');dragged=null;draw();};b.ondragend=()=>{dragged=null;};
      content.append(b);observer.observe(b);}
    s.pageOrganizer={get order(){return [...order];},move:(from,to)=>{const before=[...order];order=order.filter(n=>n!==from);order.splice(order.indexOf(to),0,from);remember(before,"页面重排");draw();},select:n=>{selected.add(n);draw();},undo:()=>{const v=history.undo();if(v){order=JSON.parse(v);s.pageDraft.order=order;draw();}},redo:()=>{const v=history.redo();if(v){order=JSON.parse(v);s.pageDraft.order=order;draw();}},apply};
  }
  async function comments(s,myTicket){
    const progress=document.createElement('p');progress.textContent='正在读取批注与摘录…';controls.append(progress);
    const result=await api.toolsJob(s.id,await snapshot(s),{action:'inspect',annotations:true});if(myTicket!==ticket)return;
    const notes=result.data.notes||[];s.notes=notes;const selected=new Set();
    const term=input('筛选批注或摘录');const type=document.createElement('select'),color=document.createElement('select');
    for(const [select,label,values]of [[type,'全部类型',[...new Set(notes.map(n=>n.type))]],[color,'全部颜色',[...new Set(notes.map(n=>n.color).filter(Boolean))]]]){select.setAttribute('aria-label',label);const all=document.createElement('option');all.value='';all.textContent=label;select.append(all);for(const v of values){const o=document.createElement('option');o.value=o.textContent=v;select.append(o);}controls.append(select);}
    const filtered=()=>notes.filter(n=>(!type.value||n.type===type.value)&&(!color.value||n.color===color.value)&&(!term.value||(n.text+' '+n.excerpt).toLocaleLowerCase().includes(term.value.toLocaleLowerCase())));
    const draw=()=>{content.replaceChildren();const found=filtered();progress.textContent=`${found.length} / ${notes.length} 条批注 · 包含未保存修改`;
      for(const n of found){const holder=document.createElement('div');holder.className='annotationSelectRow';const check=document.createElement('input');check.type='checkbox';check.checked=selected.has(n);check.setAttribute('aria-label','选择第 '+n.page+' 页批注');check.onchange=()=>{if(check.checked)selected.add(n);else selected.delete(n);};holder.append(check);
        const row=button(`第 ${n.page} 页 · ${n.type}\n${n.excerpt||''}${n.excerpt&&n.text?'\n':''}${n.text||''}`,()=>navigate(()=>{s.app.pdfViewer.currentPageNumber=n.page;}),holder);row.className='navigationRow';if(n.color)row.style.borderLeft='4px solid '+n.color;content.append(holder);}
      if(!found.length)content.textContent='没有符合条件的批注。';};term.oninput=type.onchange=color.onchange=draw;draw();
    const actions=document.createElement('div');actions.className='navigationOptions';controls.append(actions);
    button('刷新',()=>show('comments'),actions);
    button('全选筛选结果',()=>{filtered().forEach(n=>selected.add(n));draw();},actions);button('清除批注选择',()=>{selected.clear();draw();},actions);
    button('将选中批注整理为笔记',async()=>{if(!selected.size)throw new Error('请先勾选要整理的批注。');const made=await api.notesMarkdown(s.id,[...selected]);
      // Notes mode: the notes go into the Markdown document beside this PDF instead of a new tab.
      const note=notesFor(s);if(note&&made[0]){insertNotes(note,made[0].text.replace(/^# .*\n+/,''));await api.closeDocument(made[0].id,{}).catch(()=>{});status('已整理到 '+note.name+' · 可撤销，尚未保存');return;}
      await addDocuments(made);},actions).id='notesToMarkdown';
    for(const [label,format]of [['导出 Markdown','md'],['导出 Word','docx']])button(label,async()=>{const result=await api.exportNotes(s.id,filtered(),format,await snapshot(s));if(result?.path)progress.textContent='已导出：'+result.path;},actions);
  }
  async function show(next=mode){
    const s=current();if(!s?.loaded)return;
    if($('viewPanel').matches(':popover-open'))$('viewPanel').hidePopover();
    if(s.view.reflow)await views.change('reflow',false,s);
    s.app.viewsManager.switchView(0);
    for(const [id,target]of [['searchButton','search'],['outlineButton','outline']])$(id).setAttribute('aria-expanded',String(target===next));
    mode=next;const myTicket=++ticket;observer?.disconnect();clearTimeout(debounce);
    searchOcr.detach();
    pane.hidden=false;document.body.classList.add('navigationOpen');controls.replaceChildren();content.replaceChildren();content.className='';content.style.gridTemplateColumns='';
    $('navigationTitle').textContent={search:'全文搜索',outline:'文档大纲',bookmarks:'阅读书签',thumbnails:'缩略图',comments:'批注列表'}[mode];
    for(const b of pane.querySelectorAll('[data-nav]'))b.setAttribute('aria-pressed',String(b.dataset.nav===mode));
    if(mode==='search')searchControls(s);else if(mode==='outline')await outline(s,myTicket);else if(mode==='bookmarks')bookmarks(s);else if(mode==='thumbnails')thumbnails(s,myTicket);else await comments(s,myTicket);
  }
  function bind(s){const service=s.app.pdfLinkService;if(!destinations.has(service))destinations.set(service,service.goToDestination.bind(service));service.goToDestination=dest=>navigate(()=>destinations.get(service)(dest));for(const event of ['updatefindmatchescount','updatefindcontrolstate'])s.app.eventBus.on(event,()=>{clearTimeout(findTimer);findTimer=setTimeout(()=>guard(()=>refreshMatches(s)),100);});s.app.eventBus.on('editingstateschanged',()=>{if(!pane.hidden&&mode==='comments'&&s===current()){clearTimeout(debounce);debounce=setTimeout(()=>guard(()=>show('comments')),500);}});}
  function sync(){const s=current();$('searchButton').disabled=$('outlineButton').disabled=!s?.loaded;if(!s?.loaded)close();else if(!pane.hidden)guard(()=>show(mode));}
  function toggle(next){return !pane.hidden&&mode===next?close():show(next);}
  $('searchButton').onclick=()=>guard(()=>toggle('search'));$('outlineButton').onclick=()=>guard(()=>toggle('outline'));
  $('closeNavigation').onclick=close;for(const b of pane.querySelectorAll('[data-nav]'))b.onclick=()=>guard(()=>show(b.dataset.nav));
  function addBookmark(s,page){s.bookmarks ||= s.state?.bookmarks || [];if(!s.bookmarks.some(b=>b.page===page))s.bookmarks.push({page,title:`第 ${page} 页`});if(!pane.hidden&&mode==='bookmarks'&&s===current())show('bookmarks');}
  return {show,toggle,close,bind,sync,search,addBookmark,searchOcr};
}
