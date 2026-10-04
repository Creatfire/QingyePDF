const fs = require('node:fs/promises');
const path = require('node:path');
const os = require('node:os');
const { spawn } = require('node:child_process');
const { pdfBytes } = require('./core.cjs');

const actions = new Set(['inspect','notes-export','scan','sharpen','ocr-layer','export','encrypt','decrypt','organize','outline','compress','flatten','ocr','redact','text','stamp','image','page-stamp','number','watermark','shape','annotation','form','crop','import','compare']);
async function runOffline({ bytes, request, packaged = false, resources = '', assets = [], inputs = [], inputName = 'input.pdf', signal, onProgress }) {
  if (!request || !actions.has(request.action)) throw new Error('不支持的本地操作。');
  if (JSON.stringify(request).length > 2_000_000) throw new Error('操作参数过大。');
  if(signal?.aborted)throw new Error('任务已取消。');
  const job = await fs.mkdtemp(path.join(os.tmpdir(), 'qingye-job-'));
  try {
    const input = path.join(job, 'input' + path.extname(inputName).toLowerCase());
    await fs.writeFile(input, request.action === 'import' ? bytes : pdfBytes(bytes));
    const safe = { ...request };
    // Filesystem paths are supplied exclusively by the main process.
    delete safe.asset; delete safe.inputs; delete safe.tessdata;
    if (assets.length) { safe.asset = path.join(job,'asset' + path.extname(assets[0].name)); await fs.writeFile(safe.asset,assets[0].bytes); }
    safe.inputs = [];
    for (let i=0; i<inputs.length; i++) { const file=path.join(job,`merge-${i}.pdf`); await fs.writeFile(file,pdfBytes(inputs[i])); safe.inputs.push(file); }
    safe.tessdata = packaged ? path.join(resources,'ocr') : path.join(__dirname,'vendor','ocr');
    const output = path.join(job,'output');
    const config = path.join(job,'job.json');
    await fs.writeFile(config,JSON.stringify({request:safe,input,output}));
    // The frozen engine is QingyeWorker.exe on Windows and QingyeWorker on macOS / Linux.
    const engine = process.platform === 'win32' ? 'QingyeWorker.exe' : 'QingyeWorker';
    const executable = packaged ? path.join(resources,'backend',engine) : path.join(__dirname,'backend','bin','QingyeWorker',engine);
    let program = executable, args = [config];
    try { await fs.access(program); } catch {
      if (packaged) throw new Error('本地处理引擎缺失，请重新解压完整发布包。');
      program = process.platform === 'win32' ? path.join(__dirname,'.backend-build','Scripts','python.exe') : path.join(__dirname,'.backend-build','bin','python'); args = [path.join(__dirname,'backend','worker.py'),config];
    }
    const result = await new Promise((resolve,reject) => {
      const child = spawn(program,args,{windowsHide:true,stdio:['ignore','pipe','pipe']});
      let stdout='',stderr='',lines='',failure;
      const stop=message=>{failure=new Error(message);child.kill();};
      const abort=()=>stop('任务已取消。');signal?.addEventListener('abort',abort,{once:true});if(signal?.aborted)abort();
      const timer = setTimeout(() => stop('本地处理超过 15 分钟，已终止。'),15*60*1000);
      child.stdout.on('data',chunk => {stdout+=chunk; if(stdout.length>8_000_000)stop('处理结果过大。');});
      child.stderr.on('data',chunk => {stderr=(stderr+chunk).slice(-4000);lines+=chunk;let at;while((at=lines.indexOf('\n'))>=0){const line=lines.slice(0,at);lines=lines.slice(at+1);if(line.startsWith('QINGYE_PROGRESS '))try{onProgress?.(JSON.parse(line.slice(16)));}catch{}}});
      child.on('error',error => {clearTimeout(timer);signal?.removeEventListener('abort',abort);reject(error);});
      child.on('close',code => {
        clearTimeout(timer);signal?.removeEventListener('abort',abort);if(failure){reject(failure);return;}
        try { const data=JSON.parse(stdout.trim()); if(!data.ok) reject(new Error(data.error)); else if(code!==0) reject(new Error('处理引擎异常退出。')); else resolve(data); }
        catch(error){reject(new Error(stderr || error.message || '处理失败。'));}
      });
    });
    const files=[];
    for(const name of result.files || []) {
      if(!/^result\.(pdf|zip|txt|html|docx|xlsx|csv|pptx)$/.test(name)) throw new Error('处理引擎返回了非法文件名。');
      files.push({name,bytes:await fs.readFile(path.join(output,name))});
    }
    return {data:result.data,note:result.note || '',unchanged:!!result.unchanged,files};
  } finally { await fs.rm(job,{recursive:true,force:true,maxRetries:3,retryDelay:200}); }
}
module.exports={runOffline};
