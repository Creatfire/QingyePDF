export function parseSourceFragment(fragment) {
  if(typeof fragment!=='string'||!/^page=\d+(?:&|$)/.test(fragment))return null;
  const params=new URLSearchParams(fragment),page=Number(params.get('page'));if(!Number.isInteger(page)||page<1)throw new Error('原文页码无效。');
  const raw=params.get('rect'),rect=raw?raw.split(',').map(Number):null;
  if(rect&&(rect.length!==4||rect.some(v=>!Number.isFinite(v)||Math.abs(v)>10000000)))throw new Error('批注区域无效。');return {page,rect};
}
