import os
import asyncio, subprocess, time, sys, json
from playwright.async_api import async_playwright
srv = subprocess.Popen(['python3','-m','http.server','8766','--directory',os.environ.get('QINGYE_E2E_ROOT', os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', '..'))],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
time.sleep(1)
STUB = '''
window.__calls=[];
const base={platform:'linux',onCommand:()=>()=>{},onJobProgress:()=>()=>{},appVersion:async()=>'0.7.1',recent:async()=>[{id:'r1',name:'notes.md',path:'C:/x/notes.md'}],windowState:async()=>({}),recoveryList:async()=>[],
 mdThemes:async()=>[],mdHistory:async()=>[{name:'1.md',time:Date.now(),size:120}],mdHistoryRead:async()=>'# old',mdPandocInfo:async()=>({found:false}),editCommand:async()=>true,
 mdOpenFolder:async()=>({root:'C:/x',children:[{name:'a.md',path:'C:/x/a.md',type:'file'},{name:'sub',path:'C:/x/sub',type:'dir',children:[{name:'b.md',path:'C:/x/sub/b.md',type:'file'}]}]}),
 mdKatexCss:async()=>'', markdownAsset:async()=>null, mdExportSave:async(...a)=>{window.__calls.push(['exportSave',a[1],typeof a[2]==='string'?a[2].length:a[2].length]);return {path:'C:/out.'+a[1]}}};
window.desktop=new Proxy(base,{get:(t,k)=>k in t?t[k]:async(...a)=>{window.__calls.push([String(k)]);return null;}});
'''
async def main():
    async with async_playwright() as p:
        b = await p.chromium.launch(executable_path='/opt/pw-browsers/chromium', args=['--no-sandbox'])
        pg = await b.new_page(viewport={'width':1300,'height':850})
        logs=[]
        pg.on('console', lambda m: logs.append(m.type+': '+m.text)); pg.on('pageerror', lambda e: logs.append('PAGEERR '+str(e)))
        await pg.add_init_script(STUB)
        await pg.goto('http://localhost:8766/ui/index.html')
        await pg.wait_for_timeout(1500)
        text=open('/tmp/ex/doc.md',encoding='utf8').read()
        await pg.evaluate('''t=>window.qingye.addDocuments([{id:'11111111-1111-1111-1111-111111111111',kind:'markdown',name:'doc.md',path:'C:/x/doc.md',text:t,state:{},eol:'\\n'}])''', text)
        await pg.wait_for_timeout(1500)
        import importlib.util
        spec=importlib.util.spec_from_file_location('steps','/tmp/t/steps.py');m=importlib.util.module_from_spec(spec);spec.loader.exec_module(m);await m.steps(pg,logs)
        print('\n'.join(logs[:40]))
        await b.close()
asyncio.run(main())
srv.terminate()
