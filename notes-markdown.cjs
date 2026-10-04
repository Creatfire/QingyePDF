const {pathToFileURL}=require('node:url');
const escape=text=>String(text||'').replace(/[\\`*_{}\[\]<>#]/g,'\\$&');
function normalizeNotes(notes) {
  if(!Array.isArray(notes)||notes.length>100000)throw new Error('一次最多处理 100000 条批注。');
  return notes.map(n=>{const page=Math.floor(Number(n.page));if(!Number.isFinite(page)||page<1||page>1000000)throw new Error('批注页码无效。');
    return {page,type:String(n.type||'').slice(0,100),text:String(n.text||'').slice(0,10000),excerpt:String(n.excerpt||'').slice(0,10000),color:String(n.color||'').slice(0,20),...(Array.isArray(n.rect)&&n.rect.length===4&&n.rect.every(v=>typeof v==='number'&&Number.isFinite(v)&&Math.abs(v)<10000000)?{rect:n.rect}:{} )};});
}
function notesMarkdown(source,notes) {
  const items=normalizeNotes(notes),parts=['# '+escape(source.name)+' · 批注笔记',''];
  if(!source.path)parts.push('原 PDF 尚未保存，下面的原文链接仅在当前打开的窗口中可用。','');
  for(const n of items){
    let href;if(source.path){const params=new URLSearchParams({page:String(n.page)});if(n.rect)params.set('rect',n.rect.map(v=>Math.round(v*1000)/1000).join(','));href=pathToFileURL(source.path).href+'#'+params;}
    else href='#qingye-source-'+encodeURIComponent(JSON.stringify({id:source.id,page:n.page,rect:n.rect}));
    parts.push('## 第 '+n.page+' 页 · '+escape(n.type),'','[返回原文第 '+n.page+' 页](<'+href+'>)','');
    if(n.excerpt)parts.push('> '+escape(n.excerpt).replace(/\r?\n/g,'\n> '),'');if(n.text)parts.push(escape(n.text),'');
  }
  const text=parts.join('\n');if(Buffer.byteLength(text,'utf8')>32*1024*1024)throw new Error('批注笔记超过 32 MB，请减少选中的批注。');return text;
}
module.exports={notesMarkdown,normalizeNotes};
