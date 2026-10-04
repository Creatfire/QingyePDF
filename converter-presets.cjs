const engine=require('./pandoc-engine.cjs');
const builtinPresets=[
  {id:'builtin-word',name:'Word 文档',from:'auto',to:'docx',standalone:true,toc:false,numberSections:false,citeproc:false,extensions:'',extraArgs:[],pdfOptions:{pageSize:'A4',marginMm:16,landscape:false}},
  {id:'builtin-pdf',name:'带目录 PDF',from:'auto',to:'pdf-chromium',standalone:true,toc:true,numberSections:true,citeproc:false,extensions:'',extraArgs:[],pdfOptions:{pageSize:'A4',marginMm:16,landscape:false}},
  {id:'builtin-epub',name:'电子书 EPUB',from:'auto',to:'epub3',standalone:true,toc:true,numberSections:false,citeproc:false,extensions:'',extraArgs:[],pdfOptions:{pageSize:'A4',marginMm:16,landscape:false}}
];
function validatePdfOptions(value={}) {
  const pageSize=value.pageSize||'A4',marginMm=value.marginMm??16;
  if(!['A3','A4','A5','Letter','Legal'].includes(pageSize)||typeof marginMm!=='number'||!Number.isFinite(marginMm)||marginMm<0||marginMm>60)throw new Error('PDF 纸张或页边距参数无效。');
  return {pageSize,marginMm,landscape:value.landscape===true};
}
function validatePreset(value) {
  if(!value||typeof value!=='object'||typeof value.name!=='string'||!value.name.trim()||value.name.length>50)throw new Error('预设名称需要 1–50 个字符。');
  if(typeof value.from!=='string'||typeof value.to!=='string'||value.from.length>80||value.to.length>80)throw new Error('预设格式无效。');
  const extraArgs=engine.validateExtra(value.extraArgs||[]);
  if(extraArgs.length>80||extraArgs.some(s=>s.length>4096)||extraArgs.join('').length>20000)throw new Error('预设高级参数过长。');
  const extensions=value.extensions||'';if(typeof extensions!=='string'||extensions.length>300||extensions&&!/^(?:[+-][a-z\d_]+)+$/i.test(extensions))throw new Error('预设读取扩展无效。');
  return {name:value.name.trim(),from:value.from,to:value.to,extensions,standalone:value.standalone!==false,toc:value.toc===true,numberSections:value.numberSections===true,citeproc:value.citeproc===true,extraArgs:[...extraArgs],pdfOptions:validatePdfOptions(value.pdfOptions)};
}
module.exports={builtinPresets,validatePreset,validatePdfOptions};
