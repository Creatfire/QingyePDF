import { parseVisualTable, serializeVisualTable, parseTsv, pasteCells, validateTableSize } from './table-model.mjs';
export function createVisualTables(editor) {
  let active=null,last={row:1,column:0};
  const status=text=>editor.options.onStatus?.(text);
  function replace(block,model) {
    if(editor.readonly)return;
    const source=editor.text.slice(block.from,block.to);
    if(source!==block.source){status('表格已变化，请重新选择单元格。');return;}
    const insert=serializeVisualTable(model);
    editor.apply([{from:block.from,to:block.to,insert}],{from:block.from,to:block.from},{group:'visual-table',activate:false,focus:false});
  }
  function finish(save=true) {
    const state=active;if(!state)return;active=null;
    if(save&&state.input.value!==state.value){state.model.rows[state.row][state.column]=state.input.value;replace(state.block,state.model);}
    else {editor.stale=true;editor.reconcile();if(!save)editor.options.onChange?.();}
  }
  function edit(block,row,column) {
    finish();if(editor.readonly||editor.sourceMode)return;
    const model=parseVisualTable(editor.text.slice(block.from,block.to));if(!model)return;
    validateTableSize(model.rows.length,model.aligns.length);editor.deactivate();
    const fresh=editor.blocks.find(b=>b.from===block.from&&b.kind==='table');if(!fresh)return;
    const table=fresh.el.querySelector('table'),target=table?.rows[row]?.cells[column];if(!target)return;
    const input=document.createElement('textarea');input.className='mdTableCellInput';input.rows=2;input.value=model.rows[row]?.[column]??'';input.setAttribute('aria-label','编辑表格单元格');
    const state=active={block:fresh,model,row,column,input,value:input.value};last={row,column};target.replaceChildren(input);input.focus();input.select();
    input.oninput=()=>editor.options.onChange?.();
    input.onblur=()=>{if(active===state)finish();};
    input.onkeydown=event=>{
      if(event.key==='Escape'){event.preventDefault();event.stopPropagation();finish(false);return;}
      if(event.key==='Tab'||event.key==='Enter'&&!event.altKey){event.preventDefault();event.stopPropagation();const backward=event.shiftKey;finish();
        const next=editor.blocks.find(b=>b.from===fresh.from&&b.kind==='table');if(!next)return;let r=row,c=column;
        if(event.key==='Enter'){r+=backward?-1:1;}else{c+=backward?-1:1;if(c>=model.aligns.length){c=0;r++;}if(c<0){c=model.aligns.length-1;r--;}}
        const updated=parseVisualTable(next.source);if(r>=updated.rows.length){updated.rows.push(Array(updated.aligns.length).fill(''));replace(next,updated);}
        edit(editor.blocks.find(b=>b.from===fresh.from&&b.kind==='table'),Math.max(0,r),Math.max(0,c));
      }
    };
    input.onpaste=event=>{
      const text=event.clipboardData?.getData('text/plain')||'';if(!text.includes('\t'))return;
      event.preventDefault();event.stopPropagation();active=null;
      try{replace(fresh,pasteCells(model,parseTsv(text),row,column));status('已粘贴表格，可用 Ctrl+Z 撤销。');}catch(error){status(error.message);editor.stale=true;editor.reconcile();}
    };
  }
  function decorate(block,rendered) {
    const table=rendered.querySelector('table');if(!table)return;
    const tools=document.createElement('div');tools.className='mdTableTools';tools.setAttribute('role','toolbar');tools.setAttribute('aria-label','可视化表格编辑');
    for(const [name,label]of [['row','添加行'],['column','添加列'],['delete-row','删除行'],['delete-column','删除列'],['source','表格源码']]){
      const button=document.createElement('button');button.type='button';button.dataset.tableAction=name;button.textContent=label;button.onmousedown=e=>e.preventDefault();
      button.onclick=event=>{event.preventDefault();event.stopPropagation();if(editor.readonly)return;finish();const current=editor.blocks.find(b=>b.from===block.from&&b.kind==='table');if(!current)return;
        if(name==='source'){editor.activateAt(current.from);return;}
        const model=parseVisualTable(current.source);if(!model)return;
        if(name==='row')model.rows.splice(Math.min(model.rows.length,Math.max(1,last.row+1)),0,Array(model.aligns.length).fill(''));
        if(name==='column'){const c=Math.min(model.aligns.length,last.column+1);model.aligns.splice(c,0,'');model.rows.forEach((r,i)=>r.splice(c,0,i===0?'新列':''));}
        if(name==='delete-row'){if(model.rows.length<=1||last.row===0){status('不能删除表头。');return;}model.rows.splice(Math.min(last.row,model.rows.length-1),1);}
        if(name==='delete-column'){if(model.aligns.length<=1){status('至少保留一列。');return;}const c=Math.min(last.column,model.aligns.length-1);model.aligns.splice(c,1);model.rows.forEach(r=>r.splice(c,1));}
        try{replace(current,model);}catch(error){status(error.message);}
      };tools.append(button);
    }
    rendered.append(tools);
  }
  function click(event) {
    const cell=event.target.closest('td,th'),block=cell?.closest('.mdBlock')?.blockRef;
    if(!cell||block?.kind!=='table'||!cell.closest('.mdRendered')||editor.readonly||editor.sourceMode||(event.ctrlKey||event.metaKey)&&event.target.closest('a'))return false;
    if(active?.input.contains(event.target))return true;
    event.preventDefault();event.stopPropagation();try{edit(block,cell.parentElement.rowIndex,cell.cellIndex);}catch(error){status(error.message);}return true;
  }
  function paste(event) {
    if(editor.readonly||editor.sourceMode||active)return false;
    const text=event.clipboardData?.getData('text/plain')||'';if(!text.includes('\t'))return false;
    event.preventDefault();event.stopPropagation();
    try{const rows=parseTsv(text),columns=Math.max(...rows.map(r=>r.length)),model={rows,aligns:Array(columns).fill(''),tail:'\n'};
      const sel=editor.currentSelection(),insert='\n\n'+serializeVisualTable(model)+'\n';editor.apply([{from:sel.from,to:sel.to,insert}],{from:sel.from+2,to:sel.from+2},{group:'paste-table',activate:false});status('已粘贴表格，可用 Ctrl+Z 撤销。');
    }catch(error){status(error.message);}return true;
  }
  return {decorate,click,paste,finish,get pendingDirty(){return !!active&&active.input.value!==active.value;}};
}
