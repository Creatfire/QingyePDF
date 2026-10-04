import { findTable, formatTableText } from './commands.mjs';
export function parseVisualTable(source) {
  const table=findTable(source,0);if(!table)return null;
  const rows=table.rows.filter((_,i)=>i!==1).map(r=>[...r,...Array(Math.max(0,table.columns-r.length)).fill('')]);
  return {rows,aligns:[...table.aligns,...Array(Math.max(0,table.columns-table.aligns.length)).fill('')],tail:source.slice(table.to)};
}
function cell(value) {
  const text=String(value).replace(/\r\n?|\n/g,'<br>');let out='';
  for(let i=0;i<text.length;i++){const ch=text[i];if(ch==='\\'&&i+1<text.length){out+=ch+text[++i];continue;}out+=ch==='|'?'\\|':ch;}
  return out;
}
export function serializeVisualTable(model) {
  validateTableSize(model.rows.length,model.aligns.length);
  const columns=model.aligns.length,rows=model.rows.map(r=>Array.from({length:columns},(_,i)=>cell(r[i]??'')));
  rows.splice(1,0,Array(columns).fill('---'));
  return formatTableText({columns,rows,aligns:model.aligns})+(model.tail||'');
}
export function validateTableSize(rows,columns) { if(rows>200||columns>50||rows*columns>10000)throw new Error('可视化表格最多支持 200 行和 50 列。'); }
export function parseTsv(text) {
  const rows=[],row=[];let value='',quoted=false;
  for(let i=0;i<text.length;i++){
    const ch=text[i];
    if(ch==='"'){if(quoted&&text[i+1]==='"'){value+='"';i++;}else if(quoted||!value)quoted=!quoted;else value+=ch;}
    else if(!quoted&&(ch==='\t'||ch==='\n'||ch==='\r')){row.push(value);value='';if(ch!=='\t'){rows.push([...row]);row.length=0;if(ch==='\r'&&text[i+1]==='\n')i++;}}
    else value+=ch;
  }
  row.push(value);if(row.some(Boolean)||!rows.length)rows.push(row);
  validateTableSize(rows.length,Math.max(...rows.map(r=>r.length)));return rows;
}
export function pasteCells(model,rows,row=0,column=0) {
  const columns=Math.max(model.aligns.length,column+Math.max(...rows.map(r=>r.length))),count=Math.max(model.rows.length,row+rows.length);validateTableSize(count,columns);
  const next={...model,aligns:[...model.aligns,...Array(columns-model.aligns.length).fill('')],rows:Array.from({length:count},(_,i)=>Array.from({length:columns},(_,c)=>model.rows[i]?.[c]??''))};
  rows.forEach((r,i)=>r.forEach((value,c)=>{next.rows[row+i][column+c]=value;}));return next;
}
