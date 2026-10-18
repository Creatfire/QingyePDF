const cache=new WeakMap();
export function parseOcrPages(spec,total) {
  if(!String(spec||'').trim())return Array.from({length:total},(_,i)=>i+1);
  const selected=new Set();for(const part of String(spec).split(',')){
    const match=/^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);if(!match)throw new Error('页码请使用 1-3,5 这样的格式。');
    const from=Number(match[1]),to=Number(match[2]||match[1]);if(from<1||to<from||to>total)throw new Error('识别页码超出文档范围。');for(let n=from;n<=to;n++)selected.add(n);
  }return [...selected].sort((a,b)=>a-b);
}
export function coverageFor(document,total) {
  if(!cache.has(document))cache.set(document,{total,checked:0,textPages:[],missingPages:[],mixedPages:[],known:new Map()});return cache.get(document);
}
// Same rule as backend/worker.py page_text_state: no text → 'scan'; a little text (a page number, a
// stamp) on a page that paints images → 'mixed', still worth recognising; otherwise 'text'.
export const MIXED_TEXT_CHARS=40;
const IMAGE_OPS=['paintImageXObject','paintInlineImageXObject','paintImageMaskXObject','paintImageXObjectRepeat'];
export async function classifyPage(page,content){
  content??=await page.getTextContent();
  const chars=content.items.reduce((n,item)=>n+(typeof item.str==='string'?item.str.replace(/\s+/g,'').length:0),0);
  if(!chars)return 'scan';if(chars>=MIXED_TEXT_CHARS||typeof page.getOperatorList!=='function')return 'text';
  const {OPS}=await import('../vendor/pdfjs/build/pdf.mjs'),codes=new Set(IMAGE_OPS.map(name=>OPS[name]).filter(code=>code!=null));
  const list=await page.getOperatorList();return list.fnArray.some(fn=>codes.has(fn))?'mixed':'text';
}
export async function inspectTextLayers(document,total,{cancelled=()=>false,onProgress=()=>{}}={}) {
  const state=coverageFor(document,total);
  for(let page=1;page<=total;page++){
    if(cancelled())break;
    if(!state.known.has(page)){
      const pdfPage=await document.getPage(page),kind=await classifyPage(pdfPage);if(cancelled())break;
      state.known.set(page,kind);
      (kind==='text'?state.textPages:kind==='mixed'?state.mixedPages:state.missingPages).push(page);state.checked=state.known.size;onProgress(state);
      if(page%8===0)await new Promise(r=>setTimeout(r,0));
    }
  }return state;
}
