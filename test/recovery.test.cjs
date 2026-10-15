const assert=require('node:assert/strict');
const {test}=require('node:test');
const fs=require('node:fs/promises');
const os=require('node:os');
const path=require('node:path');
const {randomUUID}=require('node:crypto');
const {Recovery}=require('../recovery.cjs');
const {samplePdf}=require('../core.cjs');

test('draft survives process exit, retains updates, removes discarded data and restores clean tabs',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'qingye-recovery-test-'));
  try{
    const abandoned=new Recovery(folder,99999999),id=randomUUID();
    await abandoned.checkpoint([{id,name:'draft.pdf',path:'C:/example.pdf',hash:'old',dirty:true,bytes:samplePdf('Unsaved annotation'),state:{page:2}}],id);
    await abandoned.checkpoint([{id,name:'draft.pdf',path:'C:/example.pdf',hash:'old',dirty:true,state:{page:1}}],id);
    const next=new Recovery(folder);const list=await next.list();assert.equal(list.length,1);assert.equal(list[0].entries[0].state.page,1);
    const draft=list[0].entries[0].draft;assert.match((await fs.readFile(path.join(folder,draft))).toString(),/Unsaved annotation/);
    await next.checkpoint([{id,name:'draft.pdf',dirty:true,bytes:samplePdf('Updated annotation')}],id);
    await next.remove(list[0]);assert.equal((await next.list()).length,0);assert.match((await fs.readFile(path.join(folder,next.entries[0].draft))).toString(),/Updated annotation/);
    await next.finish([{id,name:'saved.pdf',path:'C:/saved.pdf',state:{page:2}}],id);assert.equal((await next.last()).entries[0].state.page,2);
    assert.equal((await fs.readdir(folder)).filter(n=>n.endsWith('.pdf')).length,0);
    const live=new Recovery(folder);await live.checkpoint([{id,name:'still running.pdf',dirty:false}],id);assert.equal((await new Recovery(folder).list()).length,0);
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});

test('tree reordering moves a complete branch and keeps valid levels',async()=>{
  const {moveBranch,subtreeEnd}=await import('../ui/outline.mjs');
  const rows=[[1,'A',1],[2,'A1',2],[3,'A1a',3],[1,'B',4],[2,'B1',5]];
  assert.equal(subtreeEnd(rows,0),3);moveBranch(rows,3,0);assert.deepEqual(rows.map(r=>r[1]),['B','B1','A','A1','A1a']);
  moveBranch(rows,0,3);assert.deepEqual(rows.map(r=>r[1]),['A','B','B1','A1','A1a']);assert.deepEqual(rows.map(r=>r[0]),[1,2,3,2,3]);
});

test('Markdown drafts keep their undo history beside the draft and clean it up (0.14)',async()=>{
  const folder=await fs.mkdtemp(path.join(os.tmpdir(),'qingye-recovery-history-'));
  try{
    const crashed=new Recovery(folder,99999999),id=randomUUID();
    await crashed.checkpoint([{id,name:'n.md',kind:'markdown',dirty:true,text:'v1',history:'{"v":1,"step":1}'}],id);
    await crashed.checkpoint([{id,name:'n.md',kind:'markdown',dirty:true,state:{caret:1}}],id);
    const list=await new Recovery(folder).list(),entry=list[0].entries[0];
    assert.equal(entry.history,entry.draft+'.history.json');
    assert.equal(await fs.readFile(path.join(folder,entry.history),'utf8'),'{"v":1,"step":1}','unchanged text keeps the previous history');
    await crashed.checkpoint([{id,name:'n.md',kind:'markdown',dirty:true,text:'v2'}],id);
    assert.equal(crashed.entries[0].history,undefined,'a new draft without history drops the old sidecar');
    assert.equal((await fs.readdir(folder)).filter(n=>n.endsWith('.history.json')).length,0);
    await crashed.checkpoint([{id,name:'n.md',kind:'markdown',dirty:true,text:'v3',history:'{"v":1}'}],id);
    const item=(await new Recovery(folder).list())[0];await new Recovery(folder).remove(item);
    assert.deepEqual((await fs.readdir(folder)).filter(n=>/\.(md|json)$/.test(n)&&!n.endsWith(crashed.id+'.json')),[]);
  }finally{await fs.rm(folder,{recursive:true,force:true});}
});
