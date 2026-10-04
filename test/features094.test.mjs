import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {createReadingHistory} from '../ui/reading-history.mjs';
import {lineDiff,prepareMarkdownChange} from '../ui/ai/diff.mjs';
import {parseVisualTable,serializeVisualTable,parseTsv,pasteCells} from '../ui/markdown/table-model.mjs';
import {parseOcrPages,inspectTextLayers} from '../ui/ocr-coverage.mjs';
import {parseSourceFragment} from '../ui/source-links.mjs';
import {createDocTools} from '../ui/ai/doc-tools.mjs';
const require=createRequire(import.meta.url);
test('navigation captures original positions, back/forward and a new branch',async()=>{
  let point={id:'pdf',page:1,scrollTop:200};const history=createReadingHistory({capture:()=>({...point}),restore:async p=>{point={...p};}});
  await history.record(()=>{point={id:'pdf',page:3,scrollTop:2600};});assert.equal(history.state().canBack,true);
  point.scrollTop=2750;await history.back();assert.deepEqual(point,{id:'pdf',page:1,scrollTop:200});await history.forward();assert.equal(point.scrollTop,2750);
  await history.back();await history.record(()=>{point={id:'md',offset:20,scrollTop:50};});assert.equal(history.state().canForward,false);assert.equal(history.state().count,2);
});
test('presets retain format/options and reject unsafe or invalid configurations',()=>{
  const {validatePreset,builtinPresets}=require('../converter-presets.cjs');
  const p=validatePreset({...builtinPresets[1],name:'My PDF',pdfOptions:{pageSize:'Letter',marginMm:12,landscape:true}});assert.equal(p.toc,true);assert.deepEqual(p.pdfOptions,{pageSize:'Letter',marginMm:12,landscape:true});
  assert.throws(()=>validatePreset({...p,extraArgs:['--output=outside.pdf']}));assert.throws(()=>validatePreset({...p,pdfOptions:{marginMm:-1}}));
});
test('diff shows added/removed lines and stale write confirmation cannot overwrite changes',async()=>{
  const ops=lineDiff('same\nold\nend','same\nnew\nend');assert.deepEqual(ops.map(o=>o.type),['same','removed','added','same']);assert.equal(lineDiff('','new')[0].type,'added');
  const change=prepareMarkdownChange('012345',{from:2,to:4},'AB','replace_selection');assert.deepEqual(change,{from:2,to:4,insert:'AB'});
  const s={id:'md',kind:'markdown',name:'x.md',loaded:true,editor:{text:'original',currentSelection:()=>({from:0,to:8}),apply:()=>assert.fail('must not write')}};
  const sessions=new Map([[s.id,s]]);const tools=createDocTools({sessions,current:()=>s,activate(){},markdown:{},confirm:async req=>{assert.equal(req.before,'original');assert.equal(req.after,'new');s.editor.text='external change';return true;}});
  await assert.rejects(tools.run('insert_markdown',{text:'new',position:'replace_selection'},{source:'panel'}),/原文已变化/);
});
test('visual table edits and quoted multiline Excel TSV preserve Markdown structure',()=>{
  const model=parseVisualTable('| A | B |\n| :--- | ---: |\n| one | two |\n');assert.deepEqual(model.aligns,['left','right']);
  const data=parseTsv('"a\tb"\t"c\nline"\r\nX\tY\r\n');assert.deepEqual(data,[['a\tb','c\nline'],['X','Y']]);
  const next=pasteCells(model,data,1,0);next.rows[2][1]='a|b';const text=serializeVisualTable(next);assert.match(text,/c<br>line/);assert.match(text,/a\\\|b/);assert.equal(parseVisualTable(text).rows.length,3);
  assert.throws(()=>pasteCells(model,[Array(51).fill('x')]));
});
test('OCR ranges, missing text layers, cancellation and document cache',async()=>{
  assert.deepEqual(parseOcrPages('1-3,2,5',5),[1,2,3,5]);assert.throws(()=>parseOcrPages('3-2',5));assert.throws(()=>parseOcrPages('0',5));
  let calls=0;const doc={getPage:async n=>({getTextContent:async()=>{calls++;return {items:[{str:n===2?'':'text'}]};}})};
  const state=await inspectTextLayers(doc,3);assert.deepEqual(state.missingPages,[2]);assert.equal(state.checked,3);await inspectTextLayers(doc,3);assert.equal(calls,3);
  const cancelled=await inspectTextLayers({getPage:()=>assert.fail()},2,{cancelled:()=>true});assert.equal(cancelled.checked,0);
});
test('annotation notes contain file page/rect links and encoded file fragments resolve',()=>{
  const {notesMarkdown}=require('../notes-markdown.cjs'),{resolveLocal}=require('../markdown-files.cjs');
  const text=notesMarkdown({id:'pdf',name:'source.pdf',path:'C:\\docs\\source #1.pdf'},[{page:2,type:'Highlight',text:'[untrusted](x)',excerpt:'quote',rect:[1,2,30,40]}]);
  assert.match(text,/page=2/);assert.match(text,/%231\.pdf/);assert.match(text,/\\\[untrusted\\\]/);
  const href=text.match(/\]\(<([^>]+)>\)/)[1],resolved=resolveLocal(null,href);assert.match(resolved.file,/source #1\.pdf$/);const point=parseSourceFragment(resolved.fragment);assert.deepEqual(point,{page:2,rect:[1,2,30,40]});
  assert.match(notesMarkdown({id:'pdf',name:'untitled'},[{page:1,type:'Text',text:'note'}]),/#qingye-source-/);assert.throws(()=>parseSourceFragment('page=2&rect=NaN,0,1,2'));
});
