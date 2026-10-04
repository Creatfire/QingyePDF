export function createTextSelection({current,api,applyEdit,guard,status,tools}){
  const button=document.getElementById('selectTextButton');let task;
  function sync(){button.disabled=!!task?.applying||!task&&(!current()?.loaded||current()?.saving||current()?.editBusy||tools.isBusy()||current()?.view.reflow);const text=task?.applying?'正在更新文字层':task?'取消识别':'文本选择';(button.querySelector('.label')||button).textContent=text;button.setAttribute('aria-label',text);}
  function select(s){s.app.eventBus.dispatch('switchannotationeditormode',{source:button,mode:0});s.app.pdfCursorTools?.switchTool(0);s.textSelection=true;}
  async function ensure(s=current(),pageNumber=s?.app.pdfViewer.currentPageNumber,retry=false){
    if(!s?.loaded||s.saving||s.editBusy||tools.isBusy()||!document.getElementById('directEditor').hidden||s.view.reflow)return false;
    if(s.app.pdfCursorTools?.activeTool!==0||s.app.pdfViewer.annotationEditorMode>0)return false;
    if(task)return false;
    if(!retry&&s.emptyOcrPages?.has(pageNumber))return false;
    const pdfDocument=s.app.pdfDocument,page=await pdfDocument.getPage(pageNumber),text=await page.getTextContent();
    if(text.items.some(item=>item.str?.trim()))return true;
    if(task||!s.loaded||s.editBusy||s.saving||tools.isBusy()||current()!==s||pdfDocument!==s.app.pdfDocument||!document.getElementById('directEditor').hidden)return false;
    const pending=task={id:crypto.randomUUID(),session:s,page:pageNumber,canceled:false};sync();
    try{
      status(`正在识别 ${s.name} 第 ${pageNumber} 页，完成后可拖选文字…`);
      const result=await applyEdit(s,{action:'ocr-layer',pages:String(pageNumber),jobId:pending.id},`识别扫描文字 · 第 ${pageNumber} 页`,()=>{if(pending.canceled)return false;pending.applying=true;sync();return true;});
      if(pending.canceled||result.canceled){status('已取消文字识别。');return false;}
      if(!result.unchanged){select(s);status(`第 ${pageNumber} 页文字已识别，可拖选复制；保存可保留识别结果。`);return true;}
      (s.emptyOcrPages??=new Set()).add(pageNumber);status(result.note||'未识别到文字，请尝试锐化或扫描优化。');return false;
    }catch(error){if(pending.canceled){status('已取消文字识别。');return false;}throw error;}
    finally{if(task===pending)task=null;sync();const next=s.app.pdfViewer.currentPageNumber;if(!pending.canceled&&current()===s&&next!==pageNumber&&s.textSelection)queueMicrotask(()=>guard(()=>ensure(s,next)));}
  }
  button.onclick=()=>guard(async()=>{if(task){if(task.applying)return;task.canceled=true;status('正在取消文字识别…');await api.cancelJob(task.id);return;}const s=current();if(!s?.loaded)return;if(!document.getElementById('directEditor').hidden){status('请先应用或取消当前页面编辑，再选择文字。');return;}select(s);await new Promise(resolve=>s.frame.contentWindow.requestAnimationFrame(resolve));return ensure(s,s.app.pdfViewer.currentPageNumber,true);});
  api.onJobProgress((id,data)=>{if(task?.id===id)status(`识别 ${task.session.name} 第 ${task.page} 页 · ${data.label||'处理中'} ${data.done}/${data.total}`);});
  function bind(s){
    s.frame.contentDocument.getElementById('cursorSelectTool')?.addEventListener('click',()=>{s.textSelection=true;guard(()=>ensure(s));});
    s.frame.contentDocument.addEventListener('pointerdown',event=>{
      if(event.button!==0||!event.target.closest('.page')||event.target.closest('input,textarea,[contenteditable=true],.annotationEditorLayer,.directEditBox'))return;
      if(s.app.pdfCursorTools?.activeTool!==0||s.app.pdfViewer.annotationEditorMode>0)return;
      s.textSelection=true;guard(()=>ensure(s,Number(event.target.closest('.page').dataset.pageNumber)));
    },true);
    s.app.eventBus.on('pagechanging',()=>{if(s.textSelection&&current()===s)guard(()=>ensure(s));});
  }
  return {bind,sync,ensure,select,isBusy:()=>!!task};
}
