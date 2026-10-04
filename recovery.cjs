const fs = require('node:fs/promises');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const { pdfBytes, atomicWrite, fingerprint } = require('./core.cjs');

// One manifest per process: independent windows never overwrite another window's drafts.
class Recovery {
  constructor(folder, pid = process.pid) { this.folder=folder;this.pid=pid;this.id=randomUUID();this.file=path.join(folder,this.id+'.json');this.queue=Promise.resolve();this.entries=[]; }
  write(action) { this.queue=this.queue.catch(()=>{}).then(action);return this.queue; }
  async checkpoint(entries, activeId) {
    return this.write(async()=>{
      await fs.mkdir(this.folder,{recursive:true});
      const next=[];
      for(const entry of entries){
        const previous=this.entries.find(e=>e.id===entry.id);
        let draft=entry.dirty?previous?.draft:null;
        if(entry.kind==='markdown'&&typeof entry.text==='string'){draft=this.id+'-'+entry.id+'-'+randomUUID()+'.md';await atomicWrite(path.join(this.folder,draft),Buffer.from(entry.text,'utf8'),null);}
        else if(entry.bytes){draft=this.id+'-'+entry.id+'-'+randomUUID()+'.pdf';await atomicWrite(path.join(this.folder,draft),pdfBytes(entry.bytes),null);}
        const {bytes,text,...rest}=entry;next.push({...rest,draft});
      }
      await atomicWrite(this.file,Buffer.from(JSON.stringify({pid:this.pid,activeId,updated:Date.now(),entries:next})),await fingerprint(this.file));
      const obsolete=this.entries.filter(e=>e.draft&&!next.some(n=>n.draft===e.draft));
      this.entries=next;
      for(const e of obsolete)await fs.rm(path.join(this.folder,e.draft),{force:true});
    });
  }
  async list() {
    await fs.mkdir(this.folder,{recursive:true});const items=[];
    for(const name of await fs.readdir(this.folder)){
      if(!/^[\da-f-]{36}\.json$/i.test(name)||name===this.id+'.json')continue;
      try{
        const file=path.join(this.folder,name),data=JSON.parse(await fs.readFile(file,'utf8'));
        if(!Array.isArray(data.entries))continue;
        let live=false;try{process.kill(data.pid,0);live=true;}catch{}
        if(live)continue;
        const entries=data.entries.filter(e=>typeof e.name==='string'&&(!e.draft||/^[\da-f-]+\.(pdf|md)$/i.test(e.draft)));
        if(entries.length)items.push({file,...data,entries});
      }catch{}
    }
    return items.sort((a,b)=>b.updated-a.updated);
  }
  async remove(item) { await fs.rm(item.file,{force:true});for(const e of item.entries)if(e.draft)await fs.rm(path.join(this.folder,e.draft),{force:true}); }
  async finish(entries, activeId) {
    await this.checkpoint([],null);
    await this.write(async()=>{const file=path.join(this.folder,'last-session.json');await atomicWrite(file,Buffer.from(JSON.stringify({entries,activeId})),await fingerprint(file));await fs.rm(this.file,{force:true});});
  }
  async last() { try{return JSON.parse(await fs.readFile(path.join(this.folder,'last-session.json'),'utf8'));}catch{return {entries:[]};} }
}
module.exports={Recovery};
