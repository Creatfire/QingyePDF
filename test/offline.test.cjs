const assert=require('node:assert/strict');
const test=require('node:test');
const fs=require('node:fs/promises');
const path=require('node:path');
const {runOffline}=require('../offline.cjs');
const {samplePdf}=require('../core.cjs');
test('frozen offline engine exports, removes source text, encrypts and performs local OCR',async()=>{
  const bytes=samplePdf('Qingye SECRET');
  const options=process.env.QINGYE_TEST_RESOURCES?{packaged:true,resources:process.env.QINGYE_TEST_RESOURCES}:{};
  const service=args=>runOffline({...args,...options});
  const run=request=>service({bytes,request});
  const info=await run({action:'inspect'});assert.equal(info.data.pages,2);
  const noImages=await run({action:'sharpen',strength:'standard'});assert.equal(noImages.unchanged,true);assert.equal(noImages.files.length,0);
  for(const format of ['docx','xlsx','pptx','png','html','txt']){
    const output=await run({action:'export',format});assert.ok(output.files[0].bytes.length>0);
    if(['docx','xlsx','pptx','png'].includes(format))assert.equal(output.files[0].bytes.subarray(0,2).toString(),'PK');
  }
  const removed=await run({action:'redact',pages:'1',rect:[.05,.05,.95,.15]});
  const redacted=await service({bytes:removed.files[0].bytes,request:{action:'export',format:'txt'}});
  assert.ok(!redacted.files[0].bytes.toString().includes('SECRET'));
  const encrypted=await run({action:'encrypt',userPassword:'reader',ownerPassword:'owner',edit:false,copy:false});
  await assert.rejects(service({bytes:encrypted.files[0].bytes,request:{action:'inspect',password:'wrong'}}),/密码/);
  await assert.rejects(service({bytes:encrypted.files[0].bytes,request:{action:'decrypt',password:'reader'}}),/管理密码/);
  const decrypted=await service({bytes:encrypted.files[0].bytes,request:{action:'decrypt',password:'owner'}});
  assert.equal((await service({bytes:decrypted.files[0].bytes,request:{action:'inspect'}})).data.pages,2);
  const ocr=await run({action:'ocr',force:true,pages:'1'});
  const text=await service({bytes:ocr.files[0].bytes,request:{action:'export',format:'txt'}});
  assert.match(text.files[0].bytes.toString().toUpperCase(),/SECRET/);
  const input=await fs.readFile(path.join(__dirname,'../ui/icon.png'));
  const imported=await service({bytes:input,inputName:'image.png',request:{action:'import'}});
  assert.equal((await service({bytes:imported.files[0].bytes,request:{action:'inspect'}})).data.pages,1);
  // Image stamps default to keeping the square icon's 1:1 ratio inside a 1.41:1 box.
  // inspect's image rects are PDF points, not page fractions.
  const aspect=async keepRatio => {
    const stamped=await service({bytes,request:{action:'image',rect:[.1,.1,.7,.4],keepRatio},assets:[{name:'icon.png',bytes:input}]});
    const info=await service({bytes:stamped.files[0].bytes,request:{action:'inspect',imageRects:'all'}});
    const [x0,y0,x1,y1]=info.data.images[0];
    return (x1-x0)/(y1-y0);
  };
  const kept=await aspect(true), stretched=await aspect(false);
  assert.ok(Math.abs(kept-1)<.03,`square stamp must stay square, got ${kept}`);
  assert.ok(Math.abs(stretched-1.41)<.03,`legacy stretch mode must fill the box, got ${stretched}`);
  const comparison=await service({bytes,inputs:[samplePdf('Different')],request:{action:'compare'}});
  assert.match(comparison.files[0].bytes.toString(),/Different/);
  const details=await run({action:'inspect',annotations:true,headings:true,imageRects:'all'});assert.ok(details.data.notes.length);assert.ok(details.data.headings.length);
  const visual=await service({bytes,inputs:[samplePdf('Different')],request:{action:'compare',visual:true}});assert.match(visual.files[0].bytes.toString(),/data:image\/png;base64/);assert.ok(Number(visual.files[0].bytes.toString().match(/差异像素 (\d+)/)[1])>0);
  const controller=new AbortController();let reported=false;
  await assert.rejects(service({bytes,request:{action:'ocr',force:true},signal:controller.signal,onProgress:()=>{reported=true;controller.abort();}}),/已取消/);assert.equal(reported,true);
});
