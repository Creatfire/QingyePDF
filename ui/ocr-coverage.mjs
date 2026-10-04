const cache=new WeakMap();
export function parseOcrPages(spec,total) {
  if(!String(spec||'').trim())return Array.from({length:total},(_,i)=>i+1);
  const selected=new Set();for(const part of String(spec).split(',')){
    const match=/^\s*(\d+)(?:\s*-\s*(\d+))?\s*$/.exec(part);if(!match)throw new Error('页码请使用 1-3,5 这样的格式。');
    const from=Number(match[1]),to=Number(match[2]||match[1]);if(from<1||to<from||to>total)throw new Error('识别页码超出文档范围。');for(let n=from;n<=to;n++)selected.add(n);
  }return [...selected].sort((a,b)=>a-b);
}
export function coverageFor(document,total) {
  if(!cache.has(document))cache.set(document,{total,checked:0,textPages:[],missingPages:[],known:new Map()});return cache.get(document);
}
export async function inspectTextLayers(document,total,{cancelled=()=>false,onProgress=()=>{}}={}) {
  const state=coverageFor(document,total);
  for(let page=1;page<=total;page++){
    if(cancelled())break;
    if(!state.known.has(page)){
      const content=await(await document.getPage(page)).getTextContent();if(cancelled())break;
      const text=content.items.some(item=>typeof item.str==='string'&&item.str.trim());state.known.set(page,text);
      (text?state.textPages:state.missingPages).push(page);state.checked=state.known.size;onProgress(state);
      if(page%8===0)await new Promise(r=>setTimeout(r,0));
    }
  }return state;
}
