// PDF snapshots are bounded in memory; dropping old undo points never drops current edits.
export function createHistory(limit=128*1024*1024) {
  let entries=[],position=0,size=0;
  return {
    push(before,after,label){
      entries.splice(position);entries.push({before,after,label,time:new Date().toLocaleTimeString()});position=entries.length;
      size=entries.reduce((n,e)=>n+(e.before.byteLength??e.before.length)+(e.after.byteLength??e.after.length),0);
      while(entries.length>1&&(size>limit||entries.length>20)){const e=entries.shift();size-=(e.before.byteLength??e.before.length)+(e.after.byteLength??e.after.length);position--;}
    },
    discardRedo(){entries.splice(position);},
    undo(){return position?entries[--position].before:null;},
    redo(){return position<entries.length?entries[position++].after:null;},
    get canUndo(){return position>0;},get canRedo(){return position<entries.length;},
    get rows(){return entries.map((e,i)=>({label:e.label,time:e.time,applied:i<position}));},
    reset(){entries=[];position=0;size=0;}
  };
}
