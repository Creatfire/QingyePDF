const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs/promises');
const path=require('node:path');
const os=require('node:os');
const {execFileSync}=require('node:child_process');
const {atomicWrite,digest}=require('../core.cjs');
const {waitForAbort}=require('../offline.cjs');
async function temporary(fn){const dir=await fs.mkdtemp(path.join(os.tmpdir(),'qingye-013-'));try{return await fn(dir);}finally{if(path.dirname(dir)===os.tmpdir()&&path.basename(dir).startsWith('qingye-013-'))await fs.rm(dir,{recursive:true,force:true});}}
test('canceling a pending save picker finishes without accepting a later result',async()=>{
  let finish;const picker=new Promise(resolve=>finish=resolve),controller=new AbortController();
  const pending=waitForAbort(picker,controller.signal);controller.abort();
  await assert.rejects(pending,/任务已取消/);finish({filePath:'late.pdf'});
  const already=new AbortController();already.abort();await assert.rejects(waitForAbort(Promise.resolve(123),already.signal),/任务已取消/);
  assert.equal(await waitForAbort(Promise.resolve(456),new AbortController().signal),456);
});
test('new code blocks put the typing caret after the opening fence newline',async()=>{
  const {insertCodeBlock}=await import('../ui/markdown/commands.mjs');
  const edit=insertCodeBlock('',{from:0,to:0}),change=edit.changes[0];
  assert.equal(change.insert.slice(0,edit.selection.from),'```\n');
  const result=change.insert.slice(0,edit.selection.from)+'正文'+change.insert.slice(edit.selection.from);
  assert.match(result,/^```\n正文\n```/);
});
test('Unicode output paths are literal; a read-only target remains intact on failure',{skip:process.platform!=='win32'},()=>temporary(async dir=>{
  const folder=path.join(dir,'中文目录 (测试)');await fs.mkdir(folder);
  const file=path.join(folder,'目标文件.txt');await atomicWrite(file,Buffer.from('原始内容'),null);
  const original=await fs.readFile(file);await fs.chmod(file,0o444);
  try{await assert.rejects(atomicWrite(file,Buffer.from('修改'),digest(original)));assert.deepEqual(await fs.readFile(file),original);}
  finally{await fs.chmod(file,0o666);}
  assert.deepEqual(await fs.readdir(folder),['目标文件.txt']);
}));
test('native chunked HTML ZIP contains UTF-8 Chinese paths without replacement characters',()=>temporary(async dir=>{
  const input=path.join(dir,'中文输入.md'),target=path.join(dir,'章节.zip');
  await fs.writeFile(input,'# 中文标题\n\n测试正文\n\n# 第二章\n\n更多内容','utf8');
  await require('../pandoc-engine.cjs').convertFile({inputs:[input],target,to:'chunkedhtml'});
  const bytes=await fs.readFile(target),end=bytes.lastIndexOf(Buffer.from([0x50,0x4b,0x05,0x06]));
  let at=bytes.readUInt32LE(end+16);const names=[];
  for(let n=0;n<bytes.readUInt16LE(end+10);n++){
    assert.equal(bytes.readUInt32LE(at),0x02014b50);const size=bytes.readUInt16LE(at+28);
    assert.ok(bytes.readUInt16LE(at+8)&0x0800);names.push(bytes.subarray(at+46,at+46+size).toString('utf8'));
    at+=46+size+bytes.readUInt16LE(at+30)+bytes.readUInt16LE(at+32);
  }
  assert.ok(names.some(name=>name.includes('中文标题')));assert.ok(names.some(name=>name.includes('第二章')));assert.ok(names.every(name=>!name.includes('\uFFFD')));
}));
test('CJK FreeText normalization keeps identity/content and embeds portable font streams',()=>temporary(async dir=>{
  const root=path.resolve(__dirname,'..'),python=path.join(root,'.backend-build',process.platform==='win32'?'Scripts/python.exe':'bin/python');
  const code=`import sys,json\nfrom pathlib import Path\nsys.path.insert(0,sys.argv[1])\nimport pymupdf as f\nfrom worker import process\nbase=Path(sys.argv[2]); original=f.open();p=original.new_page();a=p.add_freetext_annot(f.Rect(50,50,310,120),'中文文本框测试',fontsize=12);a.set_info(title='QA author');original.save(base/'original.pdf');before=a.xref\nprocess({'action':'normalize-annotations'},base/'original.pdf',base/'output')\nd=f.open(base/'output/result.pdf');page=d[0];annots=list(page.annots());assert len(annots)==1;assert annots[0].type[1]=='FreeText';assert annots[0].info['content']=='中文文本框测试';assert annots[0].info['title']=='QA author';assert any(d.xref_get_key(n,'FontFile2')[0]!='null' for n in range(1,d.xref_length()))\ntry:\n sys.path.insert(0,sys.argv[3]);import pypdfium2 as pdfium\n pdf=pdfium.PdfDocument(base/'output/result.pdf');image=pdf[0].render(scale=2).to_pil().convert('RGB');crop=image.crop((100,100,620,240));assert sum(min(px)<180 for px in crop.getdata())>100;crop.save(base/'pdfium-cjk.png')\nexcept ImportError: pass\nprint(json.dumps({'annotations':len(annots),'fonts_embedded':True,'content_retained':True}))`;
  const result=execFileSync(python,['-c',code,path.join(root,'backend'),dir,path.join(root,'.downloads/test-python')],{windowsHide:true,env:{...process.env,PYTHONIOENCODING:'utf-8'}});
  assert.equal(JSON.parse(result).content_retained,true);
}));
