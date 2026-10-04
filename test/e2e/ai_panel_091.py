# 0.9.1 AI collaboration panel in a plain Chromium (no Electron, no network): settings pane, add a
# connection from a preset, open the panel on a Markdown document, a tool-calling round trip with a
# scripted model, streaming, insert into the document, "/" presets, history, width, and the local
# interface bridge (confirmation dialog: allow / decline).
# Usage: python3 test/e2e/ai_panel_091.py [source-root] [screenshot-dir]
import asyncio, os, subprocess, sys, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[2])
SHOTS = Path(sys.argv[2] if len(sys.argv) > 2 else ROOT / 'test-output' / 'ai-091')
SHOTS.mkdir(parents=True, exist_ok=True)
PORT = 8769
STUB = r'''
try{localStorage.setItem('qingye.language','zh-CN')}catch{}
window.__calls=[];
const AI=window.__ai={requests:[],listeners:[],replies:[],bridge:null,
 cfg:{connections:[],defaults:{connectionId:'',model:'',temperature:0.7,maxTokens:4096,systemPrompt:'',contextChars:12000,tools:true,confirmEdits:true},server:{enabled:false,port:17654,token:'qy_test_token',allowEdits:false},prompts:null}};
const presets=[{id:'deepseek',name:'DeepSeek',type:'openai',baseUrl:'https://api.deepseek.com/v1',needsKey:true},{id:'ollama',name:'Ollama（本机）',type:'ollama',baseUrl:'http://127.0.0.1:11434',needsKey:false},{id:'custom',name:'自定义 OpenAI 兼容接口',type:'openai',baseUrl:'',needsKey:false}];
const wait=ms=>new Promise(r=>setTimeout(r,ms));
const base={platform:'win32',onCommand:()=>()=>{},onJobProgress:()=>()=>{},appVersion:async()=>'0.9.1',
 recent:async()=>[],windowState:async()=>({}),recoveryList:async()=>[],lastSessionCount:async()=>0,
 mdThemes:async()=>[],mdHistory:async()=>[],mdPandocInfo:async()=>({found:false}),editCommand:async()=>true,mdKatexCss:async()=>'',markdownAsset:async()=>null,
 aiState:async()=>JSON.parse(JSON.stringify({...AI.cfg,presets,encrypted:true,serverStatus:{running:AI.cfg.server.enabled,port:AI.cfg.server.port,url:AI.cfg.server.enabled?'http://127.0.0.1:'+AI.cfg.server.port:''}})),
 aiUpsert:async i=>{let c=AI.cfg.connections.find(x=>x.id===i.id);if(!c){c={id:'c'+(AI.cfg.connections.length+1),models:[]};AI.cfg.connections.push(c);}Object.assign(c,{name:i.name||'x',type:i.type,baseUrl:i.baseUrl,enabled:i.enabled!==false,hasKey:!!i.apiKey||!!c.hasKey,keyHint:i.apiKey?'sk-…'+i.apiKey.slice(-4):c.keyHint||'',error:''});if(i.models)c.models=i.models;if(!AI.cfg.defaults.connectionId)AI.cfg.defaults.connectionId=c.id;return c;},
 aiModels:async id=>{const c=AI.cfg.connections.find(x=>x.id===id);c.models=['deepseek-chat','deepseek-reasoner'];return c;},
 aiRemove:async id=>{AI.cfg.connections=AI.cfg.connections.filter(c=>c.id!==id);return true;},
 aiDefaults:async v=>Object.assign(AI.cfg.defaults,v),
 aiPrompts:async p=>(AI.cfg.prompts=p),
 aiServer:async v=>{Object.assign(AI.cfg.server,v);return {...AI.cfg.server,running:AI.cfg.server.enabled,url:'http://127.0.0.1:'+AI.cfg.server.port};},
 aiImportText:async()=>({added:1}),aiCancel:async()=>true,
 onAiEvent:cb=>{AI.listeners.push(cb);return()=>{}},
 onAiBridge:cb=>{AI.bridge=cb;return()=>{}},
 aiBridgeReply:async(id,ok,value)=>{AI.replies.push({id,ok,value});return true;},
 aiChat:async(jobId,req)=>{
   AI.requests.push(JSON.parse(JSON.stringify(req)));
   const msgs=req.messages, hasTool=msgs.some(m=>m.role==='tool');
   if(req.tools&&msgs.some(m=>m.role==='user'&&String(m.content).includes('循环'))) return {content:'',toolCalls:[{id:'w'+AI.requests.length,name:'insert_markdown',arguments:{text:'循环写入',position:'end'}}],finish:'tool_calls',model:req.model};
   if(req.tools&&!hasTool) return {content:'',toolCalls:[{id:'t1',name:'search_document',arguments:{query:'甘特图'}}],finish:'tool_calls',model:req.model};
   const reply='文档中有 **甘特图**，位于“六、图表”一节。\n\n- 读书计划\n- 三个分区';
   for(const part of reply.match(/[\s\S]{1,6}/g)){AI.listeners.forEach(cb=>cb(jobId,{delta:part}));await wait(15);}
   return {content:reply,toolCalls:[],finish:'stop',model:req.model};
 },
 markdownOpenLink:async()=>null};
window.desktop=new Proxy(base,{get:(t,k)=>k in t?t[k]:async(...a)=>{window.__calls.push([String(k)]);return null;}});
'''
S = "[...qingye.sessions.values()].find(s=>s.kind==='markdown')"
results, failures = {}, []
def check(name, actual, expected):
    results[name] = actual
    if actual != expected: failures.append(f'{name}: expected {expected!r}, got {actual!r}')

async def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--directory', str(ROOT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        async with async_playwright() as p:
            opts = {'args': ['--no-sandbox']}
            if os.environ.get('CHROMIUM'): opts['executable_path'] = os.environ['CHROMIUM']
            browser = await p.chromium.launch(**opts)
            ctx = await browser.new_context(viewport={'width': 1440, 'height': 900})
            await ctx.grant_permissions(['clipboard-read', 'clipboard-write'], origin=f'http://localhost:{PORT}')
            pg = await ctx.new_page()
            errors = []
            pg.on('pageerror', lambda e: errors.append(str(e)))
            await pg.add_init_script(STUB)
            await pg.goto(f'http://localhost:{PORT}/ui/index.html'); await pg.wait_for_timeout(1200)
            shown = "(sel=>{const e=document.querySelector(sel);return !!e&&getComputedStyle(e).display!=='none'&&!e.hidden})"
            check('home.panelHidden', await pg.evaluate(shown + "('#aiPanel')"), False)
            check('pdf.toolbarButton', await pg.evaluate("!!document.querySelector('#pdfToolbar #aiButton.aiToggle')"), True)

            # Settings → AI
            await pg.click('#settingsButton'); await pg.click('.settingsNav button[data-pane=ai]'); await pg.wait_for_timeout(300)
            check('settings.aiPane', await pg.evaluate(shown + "('#settingsDialog .settingsPane[data-pane=ai]')"), True)
            check('settings.empty', await pg.evaluate("!!document.querySelector('.aiConnEmpty')"), True)
            await pg.click('.aiAdd'); await pg.wait_for_timeout(100)
            check('settings.presets', await pg.evaluate("document.querySelectorAll('.aiPresetsRow button').length"), 3)
            await pg.click('.aiPresetsRow button >> nth=0')
            check('settings.presetFills', await pg.evaluate("[document.querySelector('.aiFName').value,document.querySelector('.aiFUrl').value]"), ['DeepSeek', 'https://api.deepseek.com/v1'])
            await pg.fill('.aiFKey', 'sk-test-9876')
            await pg.click('.aiForm button[type=submit]'); await pg.wait_for_timeout(400)
            check('settings.connRow', await pg.evaluate("[document.querySelectorAll('.aiConn').length, document.querySelector('.aiConnMeta').textContent.includes('2 个模型'), document.querySelector('.aiConnMeta').textContent.includes('sk-…9876')]"), [1, True, True])
            await pg.click('.aiSrvEnabled'); await pg.wait_for_timeout(200)
            check('settings.server', await pg.evaluate("[document.querySelector('.aiServerState').textContent, document.querySelector('.aiSrvToken').value, document.querySelector('.aiSrvHelp').textContent.includes('/openapi.json')]"), ['运行中：http://127.0.0.1:17654', 'qy_test_token', True])
            await pg.screenshot(path=str(SHOTS / 'settings-ai.png'))
            await pg.keyboard.press('Escape'); await pg.wait_for_timeout(150)

            # Markdown document + panel
            text = (ROOT / 'ui/markdown/sample.md').read_text(encoding='utf8')
            await pg.evaluate("t=>qingye.addDocuments([{id:'11111111-1111-1111-1111-111111111111',kind:'markdown',name:'sample.md',path:'C:/x/sample.md',text:t,state:{},eol:'\\n'}])", text)
            await pg.wait_for_timeout(1500)
            await pg.keyboard.press('Control+Shift+A'); await pg.wait_for_timeout(400)
            check('md.panelOpen', await pg.evaluate(shown + "('#aiPanel')"), True)
            check('md.viewersShrink', await pg.evaluate("Math.round(document.getElementById('workspace').getBoundingClientRect().right - document.getElementById('viewers').getBoundingClientRect().right)"), 380)
            check('md.topbarToggle', await pg.evaluate("document.querySelector('.mdMenubar .aiToggle')?.getAttribute('aria-pressed')"), 'true')
            check('md.modelSelected', await pg.evaluate("document.querySelector('.aiModel').selectedOptions[0]?.textContent"), 'deepseek-chat')
            check('md.suggestions', await pg.evaluate("document.querySelectorAll('.aiSuggestion').length >= 4"), True)
            await pg.screenshot(path=str(SHOTS / 'md-panel-empty.png'))

            await pg.fill('.aiInput', '文档里有甘特图吗？')
            await pg.press('.aiInput', 'Enter'); await pg.wait_for_timeout(1500)
            check('chat.requests', await pg.evaluate("__ai.requests.length"), 2)
            check('chat.systemPrompt', await pg.evaluate("__ai.requests[0].messages[0].role==='system' && __ai.requests[0].messages[0].content.includes('sample.md')"), True)
            check('chat.toolsSent', await pg.evaluate("__ai.requests[0].tools.map(t=>t.name).length"), 8)
            check('chat.toolResult', await pg.evaluate("(()=>{const m=__ai.requests[1].messages.find(m=>m.role==='tool');const v=JSON.parse(m.content);return [m.toolCallId, v.matches.length>0, typeof v.matches[0].line]})()"), ['t1', True, 'number'])
            check('chat.toolChip', await pg.evaluate("[document.querySelector('.aiTool').dataset.icon, document.querySelector('.aiTool span').textContent]"), ['check', '搜索“甘特图”'])
            check('chat.rendered', await pg.evaluate("[!!document.querySelector('.aiAssistant .aiBubble strong'), document.querySelectorAll('.aiAssistant .aiBubble li').length]"), [True, 2])
            check('chat.actions', await pg.evaluate("[...document.querySelectorAll('.aiActions button')].map(b=>b.textContent)"), ['复制', '插入文档', '新建 Markdown', '重新生成'])
            await pg.screenshot(path=str(SHOTS / 'md-panel-chat.png'))

            before = await pg.evaluate(S + ".editor.text.length")
            await pg.evaluate(S + ".editor.activateAt(0)")
            await pg.click('.aiActions button >> nth=1'); await pg.wait_for_timeout(300)
            check('chat.insert', await pg.evaluate(S + ".editor.text.includes('位于“六、图表”一节') && " + S + ".editor.text.length > %d" % before), True)
            await pg.keyboard.press('Control+z')

            # "/" presets
            await pg.fill('.aiInput', '/'); await pg.dispatch_event('.aiInput', 'input'); await pg.wait_for_timeout(100)
            check('presets.menu', await pg.evaluate("document.querySelectorAll('.aiPreset').length"), 7)
            await pg.fill('.aiInput', '/pol'); await pg.dispatch_event('.aiInput', 'input'); await pg.press('.aiInput', 'Enter')
            check('presets.pick', await pg.evaluate("document.querySelector('.aiInput').value.startsWith('润色')"), True)
            await pg.fill('.aiInput', '')

            # Regenerate, new chat, history
            await pg.click('.aiActions button >> nth=3'); await pg.wait_for_timeout(1200)
            check('chat.regenerate', await pg.evaluate("[__ai.requests.length, document.querySelectorAll('.aiUser').length]"), [4, 1])
            await pg.click('#aiPanel .aiHead button[aria-label=新对话]'); await pg.wait_for_timeout(150)
            check('chat.newEmpty', await pg.evaluate(shown + "('.aiEmpty')"), True)
            await pg.click('#aiPanel .aiHead button[aria-label=历史对话]'); await pg.wait_for_timeout(150)
            check('history.items', await pg.evaluate("document.querySelectorAll('.aiHistoryItem').length"), 1)
            await pg.click('.aiHistoryItem'); await pg.wait_for_timeout(150)
            check('history.reopen', await pg.evaluate("document.querySelectorAll('.aiAssistant').length >= 1"), True)

            # Width via keyboard on the splitter
            await pg.focus('.aiResize'); await pg.keyboard.press('ArrowLeft'); await pg.wait_for_timeout(100)
            check('panel.resize', await pg.evaluate("document.getElementById('aiPanel').offsetWidth"), 404)

            # Local interface bridge
            await pg.evaluate("__ai.bridge('b1','list_documents',{},{source:'api',allowEdits:false})"); await pg.wait_for_timeout(200)
            check('bridge.list', await pg.evaluate("(()=>{const r=__ai.replies.find(r=>r.id==='b1');return [r.ok, r.value.documents[0].kind]})()"), [True, 'markdown'])
            await pg.evaluate("__ai.bridge('b2','insert_markdown',{text:'外部程序写入的一行',position:'end'},{source:'api',allowEdits:false})"); await pg.wait_for_timeout(200)
            check('bridge.confirmShown', await pg.evaluate("[document.getElementById('aiConfirm').open, document.querySelector('.aiConfirmPreview').textContent]"), [True, '外部程序写入的一行'])
            await pg.screenshot(path=str(SHOTS / 'confirm.png'))
            await pg.click('.aiConfirmYes'); await pg.wait_for_timeout(200)
            check('bridge.allowed', await pg.evaluate("(()=>{const r=__ai.replies.find(r=>r.id==='b2');return [r.ok, " + S + ".editor.text.trimEnd().endsWith('外部程序写入的一行')]})()"), [True, True])
            await pg.evaluate("__ai.bridge('b3','insert_markdown',{text:'不应写入'},{source:'api',allowEdits:false})"); await pg.wait_for_timeout(200)
            await pg.click('.aiConfirmNo'); await pg.wait_for_timeout(200)
            check('bridge.declined', await pg.evaluate("(()=>{const r=__ai.replies.find(r=>r.id==='b3');return [r.ok, r.value.declined, " + S + ".editor.text.includes('不应写入')]})()"), [False, True, False])
            await pg.evaluate("__ai.bridge('b4','go_to',{heading:'六、图表'},{source:'api'})"); await pg.wait_for_timeout(200)
            check('bridge.goto', await pg.evaluate("__ai.replies.find(r=>r.id==='b4').ok"), True)
            await pg.evaluate("__ai.bridge('b5','read_document',{document_id:'nope'},{source:'api'})"); await pg.wait_for_timeout(100)
            check('bridge.notFound', await pg.evaluate("(()=>{const r=__ai.replies.find(r=>r.id==='b5');return [r.ok, r.value.status]})()"), [False, 404])

            # Typing in the panel must not trigger document shortcuts (e.g. "E" = edit in reading mode)
            await pg.click('.mdModes button[data-mode=read]'); await pg.wait_for_timeout(200)
            await pg.click('.aiInput'); await pg.keyboard.type('hello e world'); await pg.wait_for_timeout(100)
            check('keys.typingStaysInPanel', await pg.evaluate("[document.querySelector('.aiInput').value, !!" + S + ".readonly]"), ['hello e world', True])
            await pg.fill('.aiInput', ''); await pg.click('.mdModes button[data-mode=live]'); await pg.wait_for_timeout(150)

            # Stop while a tool waits for confirmation: nothing more is sent or written afterwards
            await pg.click('#aiPanel .aiHead button[aria-label=新对话]')
            n0 = await pg.evaluate("__ai.requests.length")
            await pg.fill('.aiInput', '循环写入'); await pg.press('.aiInput', 'Enter'); await pg.wait_for_timeout(300)
            check('stop.confirmOpen', await pg.evaluate("document.getElementById('aiConfirm').open"), True)
            await pg.evaluate("qingye.ai.stop()"); await pg.click('.aiConfirmYes'); await pg.wait_for_timeout(500)
            check('stop.noMoreRounds', await pg.evaluate("[__ai.requests.length - %d, qingye.ai.busy, document.getElementById('aiConfirm').open]" % n0), [1, False, False])
            check('stop.wireClean', await pg.evaluate("(()=>{const m=qingye.ai.chat.messages;return m.filter(x=>x.role==='tool').length===m.filter(x=>x.role==='assistant').flatMap(x=>x.toolCalls||[]).length})()"), True)
            # External confirmations are capped (3 waiting at most)
            await pg.evaluate("for(let i=0;i<5;i++)__ai.bridge('cap'+i,'insert_markdown',{text:'x'+i},{source:'api',allowEdits:false})"); await pg.wait_for_timeout(200)
            check('bridge.capped', await pg.evaluate("__ai.replies.filter(r=>r.id.startsWith('cap')).map(r=>r.value.declined)"), [True, True])
            for _ in range(3):
                await pg.click('.aiConfirmNo'); await pg.wait_for_timeout(120)
            await pg.click('#aiPanel .aiHead button[aria-label=新对话]')

            # Dark theme + English
            await pg.evaluate("document.getElementById('themeButton').click()"); await pg.wait_for_timeout(400)
            await pg.wait_for_timeout(1500)
            check('diagrams.rendered', await pg.evaluate("document.querySelectorAll('.mdMermaid svg').length >= 8"), True)
            check('diagrams.noLayoutShift', await pg.evaluate("Math.round(document.getElementById('workspace').getBoundingClientRect().bottom) === innerHeight && ![...document.body.children].some(e => e.id.startsWith('d') && e.id.includes('mermaid'))"), True)
            await pg.screenshot(path=str(SHOTS / 'md-panel-dark.png'))
            await pg.evaluate("qingye.i18n.setLanguage('en')"); await pg.wait_for_timeout(600)
            check('i18n.english', await pg.evaluate("[document.querySelector('.aiTitle').textContent.trim(), document.querySelector('.aiInput').placeholder.startsWith('Ask')]"), ['AI Assistant', True])
            await pg.screenshot(path=str(SHOTS / 'md-panel-en.png'))
            await pg.evaluate("qingye.i18n.setLanguage('zh-CN')"); await pg.wait_for_timeout(400)

            await pg.keyboard.press('Control+Shift+A'); await pg.wait_for_timeout(200)
            check('panel.closed', await pg.evaluate("[getComputedStyle(document.getElementById('aiPanel')).display, Math.round(document.getElementById('workspace').getBoundingClientRect().right - document.getElementById('viewers').getBoundingClientRect().right)]"), ['none', 0])
            check('pageErrors', errors, [])
            await browser.close()
    finally:
        srv.terminate()
    for k, v in results.items(): print(('FAIL ' if any(f.startswith(k + ':') for f in failures) else 'ok   ') + k)
    print(f'{len(results) - len(failures)}/{len(results)} passed; screenshots in {SHOTS}')
    if failures: print('\n'.join(failures)); sys.exit(1)

asyncio.run(main())
