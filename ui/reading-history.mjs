const same=(a,b)=>!!a&&!!b&&a.id===b.id&&a.page===b.page&&a.offset===b.offset&&Math.abs((a.scrollTop||0)-(b.scrollTop||0))<4;
export function createReadingHistory({capture,restore,onChange=()=>{},limit=60}) {
  let entries=[],index=-1,busy=false;
  const state=()=>({canBack:index>0,canForward:index>=0&&index<entries.length-1,count:entries.length,index});
  const notify=()=>onChange(state());
  function mark(before,after=capture()) {
    if(!before||!after||same(before,after))return;
    entries=entries.slice(0,index+1);
    if(index<0){entries.push(before);index=0;}else entries[index]=before;
    entries.push(after);index++;
    if(entries.length>limit){entries.shift();index--;}notify();
  }
  async function record(action,before=capture()) {
    if(busy)return action();busy=true;
    try{return await action();}
    finally{await new Promise(r=>setTimeout(r,60));mark(before);busy=false;}
  }
  async function step(direction) {
    if(busy)return false;const next=index+direction;if(next<0||next>=entries.length)return false;
    const here=capture();if(here)entries[index]=here;busy=true;
    try{await restore(entries[next]);index=next;notify();return true;}finally{busy=false;}
  }
  return {capture,record,mark,back:()=>step(-1),forward:()=>step(1),state,clear:()=>{entries=[];index=-1;notify();}};
}
