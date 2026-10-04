import { createHistory } from './history.mjs';
export function subtreeEnd(rows,index){let end=index+1;while(end<rows.length&&rows[end][0]>rows[index][0])end++;return end;}
export function moveBranch(rows,from,to){
  const end=subtreeEnd(rows,from);if(to>=from&&to<end)return rows;
  const branch=rows.splice(from,end-from),level=rows[to>=end?to-branch.length:to]?.[0]||1;
  const delta=level-branch[0][0];for(const r of branch)r[0]+=delta;
  rows.splice(to>=end?to-branch.length:to,0,...branch);return rows;
}
export function createOutlineEditor({container,currentPage,pageCount,guard,generate}){
  let rows=[],selected=-1,dragged;const history=createHistory();let inputBefore;
  const capture=()=>JSON.stringify(rows);
  function record(before,label){const after=capture();if(before!==after)history.push(before,after,label);updateHistory();}
  function updateHistory(){undo.disabled=!history.canUndo;redo.disabled=!history.canRedo;summary.textContent=history.rows.filter(r=>r.applied).map(r=>r.label).join(" · ");}
  const toolbar=document.createElement('div');toolbar.className='outlineEditorActions';
  const list=document.createElement('div');list.id='outlineEditorRows';list.className='outlineEditorRows';
  const button=(label,action)=>{const b=document.createElement('button');b.textContent=label;b.onclick=()=>guard(async()=>{const before=capture();await action();record(before,label);});toolbar.append(b);return b;};
  const undo=document.createElement('button'),redo=document.createElement('button'),summary=document.createElement('p');undo.textContent='↶ 撤销目录';redo.textContent='↷ 重做目录';
  undo.onclick=()=>{const value=history.undo();if(value){rows=JSON.parse(value);draw();}updateHistory();};redo.onclick=()=>{const value=history.redo();if(value){rows=JSON.parse(value);draw();}updateHistory();};toolbar.append(undo,redo);container.append(summary);updateHistory();
  button('＋ 章节',()=>{const at=selected<0?rows.length:subtreeEnd(rows,selected);rows.splice(at,0,[selected<0?1:rows[selected][0],'新章节',currentPage()]);selected=at;draw();});
  button('＋ 子章节',()=>{if(selected<0)throw new Error('先选择一个章节。');const at=subtreeEnd(rows,selected);rows.splice(at,0,[rows[selected][0]+1,'新子章节',currentPage()]);selected=at;draw();});
  button('← 升级',()=>shift(-1));button('→ 降级',()=>shift(1));
  button('绑定当前页',()=>{if(selected<0)throw new Error('先选择一个章节。');rows[selected][2]=currentPage();draw();});
  button('删除分支',()=>{if(selected<0)return;rows.splice(selected,subtreeEnd(rows,selected)-selected);selected=Math.min(selected,rows.length-1);draw();});
  button('自动识别标题',async()=>{const found=await generate();if(!found?.length)throw new Error('未识别到标题。扫描页请先 OCR，也可手动添加。');if(rows.length){const dialog=document.createElement('dialog');const p=document.createElement('p');p.textContent='自动识别将替换当前目录草稿，请检查识别结果后再导出。';const yes=document.createElement('button');yes.textContent='替换草稿';const no=document.createElement('button');no.textContent='取消';dialog.append(p,yes,no);document.body.append(dialog);const ok=await new Promise(resolve=>{yes.onclick=()=>{dialog.close();resolve(true);};no.onclick=()=>{dialog.close();resolve(false);};dialog.oncancel=()=>resolve(false);dialog.showModal();});dialog.remove();if(!ok)return;}set(found);});
  container.append(toolbar,list);
  function shift(delta){if(selected<0)throw new Error('先选择一个章节。');const level=rows[selected][0]+delta;if(level<1||level>32||selected===0&&level!==1||delta>0&&level>(rows[selected-1]?.[0]||0)+1)throw new Error('此位置不能调整到该层级。');for(let n=selected,end=subtreeEnd(rows,selected);n<end;n++)rows[n][0]+=delta;draw();}
  function draw(){list.replaceChildren();
    rows.forEach((r,i)=>{const row=document.createElement('div');row.className='outlineEditRow'+(i===selected?' selected':'');row.style.paddingLeft=(r[0]-1)*18+8+'px';row.draggable=true;row.dataset.index=i;
      const handle=document.createElement('button');handle.textContent='⠿';handle.title='选择或拖动整段目录';handle.onclick=()=>{selected=i;draw();};
      const title=document.createElement('input');title.value=r[1];title.placeholder='章节标题';title.setAttribute('aria-label',`第 ${i+1} 个章节标题`);title.onfocus=()=>{inputBefore=capture();selected=i;for(const node of list.children)node.classList.toggle('selected',Number(node.dataset.index)===i);};title.oninput=()=>{r[1]=title.value;};title.onchange=()=>record(inputBefore,"修改章节标题");
      const page=document.createElement('input');page.type='number';page.min=1;page.max=pageCount();page.value=r[2];page.setAttribute('aria-label','目标页码');page.onfocus=()=>{inputBefore=capture();};page.oninput=()=>{r[2]=Number(page.value);};page.onchange=()=>record(inputBefore,"修改章节页码");
      const level=document.createElement('span');level.textContent=r[0]+'级';row.append(handle,level,title,page);
      row.ondragstart=e=>{dragged=i;e.dataTransfer.setData('text/plain','qingye-outline-'+i);};row.ondragover=e=>{if(dragged!==undefined)e.preventDefault();};row.ondrop=e=>{e.preventDefault();e.stopPropagation();if(dragged===undefined)return;const before=capture();moveBranch(rows,dragged,i);record(before,"移动目录分支");dragged=undefined;selected=-1;draw();};row.ondragend=()=>{dragged=undefined;};list.append(row);
    });if(!rows.length){const p=document.createElement('p');p.textContent='暂无章节，点击“＋ 章节”或“自动识别标题”。';list.append(p);}
  }
  function set(value){history.reset();updateHistory();rows=value.map(r=>[Number(r[0]),String(r[1]),Number(r[2])]);selected=-1;draw();}
  function get(){let previous=0;return rows.map(r=>{if(!r[1].trim()||!Number.isInteger(r[2])||r[2]<1||r[2]>pageCount()||r[0]>previous+1)throw new Error('请检查目录标题、页码与层级。');previous=r[0];return [...r];});}
  return {set,get,history,undo:()=>undo.click(),redo:()=>redo.click(),select:index=>{selected=index;draw();},shift:delta=>{const before=capture();shift(delta);record(before,"调整目录层级");},move:(from,to)=>{const before=capture();moveBranch(rows,from,to);record(before,"移动目录分支");draw();}};
}
