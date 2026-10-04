export function prepareMarkdownChange(original, selection, text, position = 'cursor') {
  const length = original.length, from = Math.max(0, Math.min(length, Number(selection.from) || 0));
  const to = position === 'replace_selection' ? Math.max(from, Math.min(length, Number(selection.to) || from)) : from;
  if (position === 'end') return { from: length, to: length, insert: (length && !original.endsWith('\n\n') ? (original.endsWith('\n') ? '\n' : '\n\n') : '') + text };
  return { from, to, insert: text };
}

export function lineDiff(before, after) {
  const a = before ? before.replace(/\r\n/g, '\n').split('\n') : [], b = after ? after.replace(/\r\n/g, '\n').split('\n') : [];
  let prefix = 0, suffix = 0;
  while (prefix < a.length && prefix < b.length && a[prefix] === b[prefix]) prefix++;
  while (suffix < a.length-prefix && suffix < b.length-prefix && a[a.length-1-suffix] === b[b.length-1-suffix]) suffix++;
  const x = a.slice(prefix, a.length-suffix), y = b.slice(prefix, b.length-suffix), result = a.slice(0,prefix).map(text=>({type:'same',text}));
  // ponytail: bounded line LCS; large edits use a changed block instead of quadratic memory.
  if (x.length*y.length > 250000) result.push(...x.map(text=>({type:'removed',text})),...y.map(text=>({type:'added',text})));
  else {
    const width=y.length+1, grid=new Uint32Array((x.length+1)*width);
    for(let i=x.length-1;i>=0;i--)for(let j=y.length-1;j>=0;j--)grid[i*width+j]=x[i]===y[j]?grid[(i+1)*width+j+1]+1:Math.max(grid[(i+1)*width+j],grid[i*width+j+1]);
    let i=0,j=0;
    while(i<x.length||j<y.length){
      if(i<x.length&&j<y.length&&x[i]===y[j]){result.push({type:'same',text:x[i++]});j++;}
      else if(i<x.length&&(j===y.length||grid[(i+1)*width+j]>=grid[i*width+j+1]))result.push({type:'removed',text:x[i++]});
      else result.push({type:'added',text:y[j++]});
    }
  }
  return result.concat(a.slice(a.length-suffix).map(text=>({type:'same',text})));
}
