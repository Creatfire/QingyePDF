import { userError } from './errors.mjs';
// View settings are separate from PDF annotations and never change saved PDF bytes.
export function createViews({ current, commit, guard, api }) {
  const $ = id => document.getElementById(id);
  const panel = $('viewPanel');
  // 0.14.0: 'light' (日间) lays the page on cream paper (a multiply layer in viewer.css); 'plain' (原色) shows it untouched.
  const colors = ['light', 'plain', 'night', 'sepia', 'gray'];
  const tones = [
    ['雾白','#f0f4f5','#101820'], ['羊皮纸','#e5d5af','#59432b'], ['墨灰','#302e2c','#c4beb7'],
    ['深海蓝','#093448','#b5c9d0'], ['石墨','#353e3f','#d0d7d7'], ['玫瑰','#efd3dc','#ae3c5e'],
    ['暖黑','#332b2b','#f0d1d0'], ['冷灰','#354043','#aababc'], ['豆绿','#c1dbc2','#3e5744'],
    ['薄荷','#a4f5d2','#082c23'], ['橄榄','#5b633c','#f0d4ce'], ['森林','#073e12','#edf7e9'],
    ['雾蓝','#d1dce9','#2d425e'], ['天空','#9dccfa','#082945'], ['咖啡','#493624','#e8d5b1'],
  ];
  const validColor = value => colors.includes(value) || value === 'custom' || /^tone-\d+$/.test(value) && Number(value.slice(5)) < tones.length;
  const hex = value => /^#[0-9a-fA-F]{6}$/.test(value);
  function state(s) {
    return { scrollMode: s.app.pdfViewer.scrollMode, spreadMode: s.app.pdfViewer.spreadMode,
      color: s.view?.color || 'light', crop: s.view?.crop || [0, 0, 0, 0],
      reflow: !!s.view?.reflow, fontSize: s.view?.fontSize || 20,
      paper: s.view?.paper || '#f0f4f5', ink: s.view?.ink || '#101820',
      preserveImages:!!s.view?.preserveImages,brightness:s.view?.brightness||1,contrast:s.view?.contrast||1,
      ...(s.view?.reflow ? { page: s.reflowPage } : {}) };
  }
  function sync() {
    const s = current();
    $('viewButton').disabled = !s?.loaded || !!s?.saving;
    if (!s?.loaded) { panel.hidePopover(); return; }
    const v = state(s);
    for (const button of panel.querySelectorAll('[data-layout]')) button.setAttribute('aria-pressed', String(v.spreadMode === 0 ? button.dataset.layout === 'single' : button.dataset.layout === 'double'));
    $('coverMode').checked = v.spreadMode === 2;
    $('coverMode').disabled = v.spreadMode === 0 || v.reflow;
    $('verticalMode').checked = v.scrollMode === 0;
    $('reflowMode').checked = v.reflow;
    $('preserveImages').checked=v.preserveImages;
    $('readingBrightness').value=Math.round(v.brightness*100);$('readingContrast').value=Math.round(v.contrast*100);$('brightnessValue').value=Math.round(v.brightness*100)+'%';$('contrastValue').value=Math.round(v.contrast*100)+'%';
    for (const button of panel.querySelectorAll('[data-color]')) button.setAttribute('aria-pressed', String(button.dataset.color === v.color));
    for (const control of panel.querySelectorAll('[data-layout], #verticalMode, #rotateView, #thumbnailView, #cropView')) control.disabled = v.reflow;
    $('cropView').textContent = v.crop.some(Boolean) ? '阅读裁剪 · 已启用' : '裁剪页面…';
    $('viewButton').setAttribute('aria-expanded', String(panel.matches(':popover-open')));
  }
  async function renderText(s) {
    const pageNumber = s.reflowPage;
    const ticket = s.reflowTicket = (s.reflowTicket || 0) + 1;
    s.reflowText.textContent = '正在提取本页文字…';
    s.reflowLabel.textContent = `第 ${pageNumber} / ${s.app.pagesCount} 页`;
    s.reflowPrev.disabled = pageNumber === 1;
    s.reflowNext.disabled = pageNumber === s.app.pagesCount;
    try {
      const page = await s.app.pdfDocument.getPage(pageNumber);
      const content = await page.getTextContent();
      if (ticket !== s.reflowTicket) return;
      let text = '';
      for (const item of content.items) if (typeof item.str === 'string') text += item.str + (item.hasEOL ? '\n' : ' ');
      s.reflowText.textContent = text.trim() || '本页没有可提取的文字。扫描件需要 OCR，请退出重新排布查看原页面。';
      s.reflowBody.scrollTop = 0;
    } catch (error) { if (ticket === s.reflowTicket) s.reflowText.textContent = `无法提取本页文字：${userError(error)}`; }
  }
  function makeReflow(s) {
    if (s.reflowPanel) return;
    const element = document.createElement('section'); element.className = 'reflowPanel'; element.hidden = true;
    const toolbar = document.createElement('div'); toolbar.className = 'reflowToolbar';
    const button = (label, action) => { const b = document.createElement('button'); b.textContent = label; b.onclick = () => guard(action); toolbar.append(b); return b; };
    s.reflowPrev = button('上一页', () => { if (s.reflowPage > 1) { s.reflowPage--; return renderText(s); } });
    s.reflowLabel = document.createElement('span'); toolbar.append(s.reflowLabel);
    s.reflowNext = button('下一页', () => { if (s.reflowPage < s.app.pagesCount) { s.reflowPage++; return renderText(s); } });
    const spacer = document.createElement('span'); spacer.className = 'spacer'; toolbar.append(spacer);
    const label = document.createElement('label'); label.textContent = '字号 ';
    const size = document.createElement('input'); size.type = 'range'; size.min = '14'; size.max = '36'; size.value = s.view.fontSize; size.setAttribute('aria-label', '重排文字字号');
    size.oninput = () => { s.view.fontSize = Number(size.value); element.style.setProperty('--reading-size', `${size.value}px`); };
    label.append(size); toolbar.append(label);
    button('退出重新排布', () => change('reflow', false, s)).dataset.icon = 'x';
    s.reflowPrev.dataset.icon = 'left'; s.reflowNext.dataset.icon = 'right';
    const body = document.createElement('div'); body.className = 'reflowBody';
    const note = document.createElement('p'); note.className = 'reflowNotice'; note.textContent = '文字阅读视图 · 按 PDF 文字顺序提取，不保留原页面图表与批注。';
    const text = document.createElement('article'); text.className = 'reflowText';
    body.append(note, text); element.append(toolbar, body); s.panel.append(element);
    Object.assign(s, { reflowPanel: element, reflowText: text, reflowBody: body });
  }
  function appearance(s) {
    if(!s.frame.contentDocument)return;
    const { color, crop, reflow, fontSize, paper, ink,preserveImages,brightness,contrast } = state(s);
    const root = s.frame.contentDocument.documentElement;
    root.dataset.readingColor = color;
    root.dataset.preserveImages=String(preserveImages);
    const effect={light:'',plain:'',night:'invert(1) hue-rotate(180deg)',sepia:'sepia(.55)',gray:'grayscale(1)'}[color]??"url('#qingye-reading-color')";
    root.style.setProperty('--reading-filter',`${effect} brightness(${brightness}) contrast(${contrast})`.trim());
    for(let index=0;index<s.app.pagesCount;index++){const page=s.app.pdfViewer.getPageView(index);page?.div.querySelector('.originalImageOverlay')?.remove();}
    if(preserveImages&&s.imageRects)for(let index=0;index<s.app.pagesCount;index++)overlayImages(s,index);
    if (color === 'custom' || color.startsWith('tone-')) {
      const doc = s.frame.contentDocument, ns = 'http://www.w3.org/2000/svg';
      let svg = doc.getElementById('qingye-color-svg');
      if (!svg) {
        svg = doc.createElementNS(ns,'svg'); svg.id='qingye-color-svg'; svg.setAttribute('width','0'); svg.setAttribute('height','0'); svg.style.position='absolute'; svg.setAttribute('aria-hidden','true'); doc.body.append(svg);
      }
      svg.replaceChildren();
      const filter = doc.createElementNS(ns,'filter'); filter.id='qingye-reading-color'; filter.setAttribute('color-interpolation-filters','sRGB');
      const gray = doc.createElementNS(ns,'feColorMatrix'); gray.setAttribute('type','saturate'); gray.setAttribute('values','0'); filter.append(gray);
      const transfer=doc.createElementNS(ns,'feComponentTransfer');
      for(const [n,channel] of ['R','G','B'].entries()) {
        const f=doc.createElementNS(ns,'feFunc'+channel); const bg=parseInt(paper.slice(1+n*2,3+n*2),16)/255, fg=parseInt(ink.slice(1+n*2,3+n*2),16)/255;
        f.setAttribute('type','linear');f.setAttribute('slope',String(bg-fg));f.setAttribute('intercept',String(fg));transfer.append(f);
      }
      filter.append(transfer);svg.append(filter);
    }
    root.style.setProperty('--reading-crop', `inset(${crop.map(x => `${x}%`).join(' ')})`);
    root.dataset.readingCrop = String(crop.some(Boolean));
    if (s.reflowPanel) {
      s.reflowPanel.dataset.readingColor = color;
      s.reflowPanel.style.setProperty('--reading-size', `${fontSize}px`);
      if (color === 'custom' || color.startsWith('tone-')) { s.reflowPanel.style.background=paper; s.reflowPanel.style.color=ink; }
      else { s.reflowPanel.style.background='';s.reflowPanel.style.color=''; }
      s.reflowPanel.hidden = !reflow;
    }
  }
  function overlayImages(s,index){
    if(!s.view.preserveImages||!s.imageRects)return;
    const view=s.app.pdfViewer.getPageView(index),source=view?.canvas;if(!source?.width||!source.height||view.div.hidden)return;
    view.div.querySelector('.originalImageOverlay')?.remove();const rects=s.imageRects[index]||[];if(!rects.length)return;
    const layer=s.frame.contentDocument.createElement('canvas');layer.className='originalImageOverlay';layer.width=source.width;layer.height=source.height;
    const context=layer.getContext('2d');const sx=source.width/view.viewport.width,sy=source.height/view.viewport.height;
    for(const box of rects){const r=[...view.viewport.convertToViewportPoint(box[0],box[1]),...view.viewport.convertToViewportPoint(box[2],box[3])];const x=Math.max(0,Math.min(r[0],r[2])*sx),y=Math.max(0,Math.min(r[1],r[3])*sy),width=Math.min(source.width-x,Math.abs(r[2]-r[0])*sx),height=Math.min(source.height-y,Math.abs(r[3]-r[1])*sy);if(width>0&&height>0)context.drawImage(source,x,y,width,height,x,y,width,height);}
    view.div.append(layer);
  }
  async function loadImages(s){
    if(s.imageRects)return;
    s.imageScan ||= (async()=>{const bytes=await s.app.pdfDocument.getData();const result=await api.toolsJob(s.id,bytes,{action:'inspect',imageRects:'all'});s.imageRects=result.data.imagePages;})();
    try{await s.imageScan;}catch(error){s.imageScan=null;s.view.preserveImages=false;appearance(s);sync();throw new Error('无法读取图片区域：'+userError(error));}
  }
  async function change(action, value, s = current()) {
    if (!s?.loaded || s.saving) return;
    commit(s);
    const viewer = s.app.pdfViewer, page = viewer.currentPageNumber;
    switch (action) {
      case 'layout': viewer.spreadMode = value === 'single' ? 0 : ($('coverMode').checked ? 2 : 1); break;
      case 'cover': viewer.spreadMode = value ? 2 : 1; break;
      case 'vertical': viewer.scrollMode = value ? 0 : 3; break;
      case 'color':
        s.view.color = validColor(value) ? value : 'light';
        if(value.startsWith('tone-')) { const [,paper,ink]=tones[Number(value.slice(5))];s.view.paper=paper;s.view.ink=ink; }
        break;
      case 'custom-color':
        if(!hex(value.paper)||!hex(value.ink)) throw new Error('请选择有效的背景与文字颜色。');
        Object.assign(s.view,{color:'custom',paper:value.paper,ink:value.ink}); break;
      case 'preserve-images':s.view.preserveImages=!!value;if(value)await loadImages(s);break;
      case 'brightness':case 'contrast':if(!Number.isFinite(value)||value<.5||value>1.5)throw new Error('亮度与对比度应为 50%–150%。');s.view[action]=value;break;
      case 'rotate':
        viewer.pagesRotation = (viewer.pagesRotation + 90) % 360;
        for(let i=0;i<s.app.pagesCount;i++)viewer.getPageView(i)?.reset({keepAnnotationLayer:true,keepAnnotationEditorLayer:true});
        viewer.scrollPageIntoView({pageNumber:page});
        break;
      // Page thumbnails live in Qingye's single navigation panel, not PDF.js's sidebar.
      case 'thumbnails': if (panel.matches(':popover-open')) panel.hidePopover(); await window.qingye?.navigation.show('thumbnails'); break;
      case 'crop':
        if (!Array.isArray(value) || value.length !== 4 || value.some(x => !Number.isFinite(x) || x < 0 || x > 40)) throw new Error('裁剪边距应为 0–40%。');
        s.view.crop = [...value]; break;
      case 'reflow':
        s.view.reflow = !!value;
        if (value) { s.reflowPage = page; makeReflow(s); await renderText(s); }
        else if (s.reflowPage) viewer.currentPageNumber = s.reflowPage;
        break;
      case 'fullscreen': await api.fullscreen(); break;
    }
    if (['layout', 'cover', 'vertical', 'rotate'].includes(action)) {
      viewer.currentPageNumber = page;
      viewer.currentScaleValue = viewer.currentScaleValue;
      viewer.update();
    }
    appearance(s); sync();
  }
  async function restore(s, saved = {}) {
    s.view = { color: validColor(saved.color) ? saved.color : 'light',
      paper: hex(saved.paper) ? saved.paper : '#f0f4f5', ink: hex(saved.ink) ? saved.ink : '#101820',
      preserveImages:!!saved.preserveImages,brightness:Math.max(.5,Math.min(1.5,Number(saved.brightness)||1)),contrast:Math.max(.5,Math.min(1.5,Number(saved.contrast)||1)),
      crop: Array.isArray(saved.crop) && saved.crop.length === 4 ? saved.crop.map(x => Math.max(0, Math.min(40, Number(x) || 0))) : [0, 0, 0, 0],
      reflow: !!saved.reflow, fontSize: Math.max(14, Math.min(36, Number(saved.fontSize) || 20)) };
    if ([0, 1, 2, 3].includes(saved.scrollMode)) s.app.pdfViewer.scrollMode = saved.scrollMode;
    if ([0, 1, 2].includes(saved.spreadMode)) s.app.pdfViewer.spreadMode = saved.spreadMode;
    s.reflowPage = Math.max(1, Math.min(s.app.pagesCount, Number(saved.page) || 1));
    if (s.view.reflow) { makeReflow(s); await renderText(s); }
    appearance(s);
    if(!s.viewsBound){s.viewsBound=true;s.app.eventBus.on('pagerendered',({pageNumber})=>overlayImages(s,pageNumber-1));for(const event of ['scrollmodechanged','spreadmodechanged'])s.app.eventBus.on(event,sync);}
    if(s.view.preserveImages)loadImages(s).then(()=>appearance(s)).catch(console.warn);

  }
  panel.addEventListener('toggle', sync);
  $('preserveImages').onchange=e=>guard(()=>change('preserve-images',e.target.checked));
  for(const [id,action] of [['readingBrightness','brightness'],['readingContrast','contrast']])$(id).oninput=e=>guard(()=>change(action,Number(e.target.value)/100));
  for (const b of panel.querySelectorAll('[data-layout]')) b.onclick = () => guard(() => change('layout', b.dataset.layout));
  for (const b of panel.querySelectorAll('[data-color]')) b.onclick = () => guard(() => change('color', b.dataset.color));
  const palette=$('tonePalette');
  tones.forEach(([name,paper,ink],i)=>{
    const b=document.createElement('button');b.className='toneChip';b.textContent='A';b.title=name;b.setAttribute('aria-label',name);b.style.background=paper;b.style.color=ink;
    b.onclick=()=>guard(()=>change('color',`tone-${i}`));palette.append(b);
  });
  let colorSession;
  const favorites=document.createElement('div');favorites.className='favoriteColors';palette.after(favorites);
  function drawFavorites(){favorites.replaceChildren();for(const saved of JSON.parse(localStorage.getItem('qingye-color-favorites')||'[]')){const b=document.createElement('button');b.textContent='A';b.title=saved.paper+' / '+saved.ink;b.style.background=saved.paper;b.style.color=saved.ink;b.onclick=()=>guard(()=>change('custom-color',saved));favorites.append(b);}}
  const favoriteButton=document.createElement('button');favoriteButton.textContent='收藏当前配色';favoriteButton.onclick=()=>{const s=current(),saved={paper:s.view.paper,ink:s.view.ink};const list=JSON.parse(localStorage.getItem('qingye-color-favorites')||'[]');localStorage.setItem('qingye-color-favorites',JSON.stringify([saved,...list.filter(c=>c.paper!==saved.paper||c.ink!==saved.ink)].slice(0,12)));drawFavorites();};favorites.after(favoriteButton);drawFavorites();
  $('customColor').onclick=()=>{colorSession=current();$('paperColor').value=colorSession.view.paper;$('inkColor').value=colorSession.view.ink;panel.hidePopover();$('colorDialog').showModal();};
  $('applyColor').onclick=()=>guard(async()=>{await change('custom-color',{paper:$('paperColor').value,ink:$('inkColor').value},colorSession);$('colorDialog').close();});
  for (const [id, action] of [['coverMode', 'cover'], ['verticalMode', 'vertical'], ['reflowMode', 'reflow']]) $(id).onchange = event => guard(() => change(action, event.target.checked));
  for (const [id, action] of [['rotateView', 'rotate'], ['thumbnailView', 'thumbnails'], ['fullscreenView', 'fullscreen']]) $(id).onclick = () => guard(() => change(action));
  let cropSession;
  $('cropView').onclick = () => {
    cropSession = current(); panel.hidePopover();
    const crop = state(cropSession).crop;
    ['cropTop', 'cropRight', 'cropBottom', 'cropLeft'].forEach((id, i) => { $(id).value = crop[i]; });
    $('cropDialog').showModal();
  };
  $('applyCrop').onclick = () => guard(async () => {
    await change('crop', ['cropTop', 'cropRight', 'cropBottom', 'cropLeft'].map(id => Number($(id).value)), cropSession);
    $('cropDialog').close();
  });
  $('resetCrop').onclick = () => guard(async () => { await change('crop', [0, 0, 0, 0], cropSession); $('cropDialog').close(); });
  return { state, sync, change, restore };
}
