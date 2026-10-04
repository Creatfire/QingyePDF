import { t,tf } from './i18n/i18n.mjs';
import { parseOcrPages,coverageFor,inspectTextLayers } from './ocr-coverage.mjs';
export function createSearchOcr({api,applyEdit,guard,status,onUpdated,isProcessing=()=>false}) {
  let view=null,task=null,analysis=0;
  function sync(){if(!view)return;const s=view.session;
    view.rangeButton.disabled=view.allButton.disabled=!!task||s.saving||s.editBusy||isProcessing();view.cancel.hidden=!task;view.cancel.disabled=!!task?.applying;
    const state=s.ocrCoverage;
    view.coverage.textContent=state?tf('已检查 {checked}/{total} 页 · 可搜索 {text} 页 · 缺少文字层 {missing} 页',{checked:state.checked,total:state.total,text:state.textPages.length,missing:state.missingPages.length}):t('正在检查文字层…');
    if(task)view.progress.textContent=tf('识别 {name} · {progress}',{name:task.session.name,progress:task.progress||t('处理中')});
  }
  async function analyze(s){const ticket=++analysis,doc=s.app.pdfDocument;s.ocrCoverage=coverageFor(doc,s.app.pagesCount);sync();
    await inspectTextLayers(doc,s.app.pagesCount,{cancelled:()=>ticket!==analysis||!s.loaded||s.app.pdfDocument!==doc,onProgress:()=>{if(ticket===analysis)sync();}});
    if(ticket===analysis&&s.app.pdfDocument===doc){sync();onUpdated?.(s);}
  }
  async function recognize(s,spec,password='') {
    if(task||s.saving||s.editBusy||isProcessing())throw new Error('请等待当前处理完成后再识别文字。');
    const pages=parseOcrPages(spec,s.app.pagesCount),job=task={id:crypto.randomUUID(),session:s,canceled:false,applying:false,progress:''};sync();
    try{
      const result=await applyEdit(s,{action:'ocr-layer',pages:pages.join(','),jobId:job.id,password},'识别扫描文字 · '+pages.length+' 页',()=>{if(job.canceled)return false;job.applying=true;sync();return true;});
      if(job.canceled||result.canceled){status('文字识别已取消，未应用新的识别结果。');return;}
      status(result.note||'文字识别完成，保存文档可保留文字层。');
      if(view?.session===s){view.progress.textContent=result.note||t('文字识别完成');await analyze(s);}
    }catch(error){if(job.canceled){status('文字识别已取消，未应用新的识别结果。');return;}throw error;}
    finally{if(task===job)task=null;if(view&&view.session!==s)view.progress.textContent=t('文字识别任务已结束');sync();if(view?.session===s)onUpdated?.(s);}
  }
  function mount(s,parent){const section=document.createElement('section');section.className='searchOcr';
    const coverage=document.createElement('p');coverage.className='ocrCoverage';coverage.setAttribute('role','status');
    const range=document.createElement('input');range.type='text';range.id='ocrPageRange';range.placeholder=t('页码，例如 1-3,5；留空为全文');range.setAttribute('aria-label',t('文字识别页码'));
    const password=document.createElement('input');password.type='password';password.placeholder=t('打开密码（若需要）');password.setAttribute('aria-label',t('PDF 打开密码'));
    const rangeButton=document.createElement('button'),allButton=document.createElement('button'),cancel=document.createElement('button');rangeButton.id='ocrRecognizeRange';allButton.id='ocrRecognizeAll';cancel.id='ocrCancel';
    rangeButton.textContent=t('识别指定页');allButton.textContent=t('识别全文');cancel.textContent=t('取消识别');
    rangeButton.onclick=()=>guard(()=>recognize(s,range.value,password.value));allButton.onclick=()=>guard(()=>recognize(s,'',password.value));cancel.onclick=()=>{if(task&&!task.applying){task.canceled=true;api.cancelJob(task.id).catch(console.warn);}};
    const progress=document.createElement('p');progress.className='ocrProgress';progress.setAttribute('aria-live','polite');
    section.append(coverage,range,password,rangeButton,allButton,cancel,progress);parent.append(section);view={session:s,coverage,range,rangeButton,allButton,cancel,progress};sync();guard(()=>analyze(s));
  }
  api.onJobProgress((id,data)=>{if(task?.id===id){task.progress=(data.label||t('处理中'))+' '+data.done+'/'+data.total;sync();status(tf('识别 {name} · {progress}',{name:task.session.name,progress:task.progress}));}});
  return {mount,recognize,analyze,detach:()=>{analysis++;view=null;},isBusy:()=>!!task};
}
