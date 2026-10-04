# Collects the Simplified Chinese UI strings that the runtime translator sees and lists the ones
# not yet in scripts/i18n/catalog.json (written to scripts/i18n/harvest-new.json). Append new strings
# to the END of catalog.json (ids are positions) and add their translations as new rows in src/*.tsv. Usage: python3 scripts/i18n/harvest.py [root]   (needs Playwright)
import asyncio, json, os, re, subprocess, sys, time
from pathlib import Path
from playwright.async_api import async_playwright
ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[2])
PORT = 8769
STUB = '''localStorage.setItem('qingye.language','zh-CN');
const base={platform:'win32',onCommand:()=>()=>{},onJobProgress:()=>()=>{},appVersion:async()=>'0.8.2',recent:async()=>[],windowState:async()=>({}),recoveryList:async()=>[],lastSessionCount:async()=>1,
 mdThemes:async()=>[],mdHistory:async()=>[],mdPandocInfo:async()=>({found:false}),editCommand:async()=>true,mdKatexCss:async()=>'',markdownAsset:async()=>null,
 assocStatus:async()=>({supported:true,exe:'C:/x.exe',types:{pdf:{registered:true,isDefault:false,current:'Edge'},md:{registered:false,isDefault:false,current:''}}})};
window.desktop=new Proxy(base,{get:(t,k)=>k in t?t[k]:async()=>null});'''
COLLECT = r'''(() => {
  const out = new Set(), cjk = /[\u3400-\u9fff]/;
  const SKIP = '.mdEditorHost, .mdOutlineList, .mdFileList, .recentText, .tabText, script, style, textarea, code, pre, kbd, [translate="no"]';
  const add = s => { s = (s || '').trim(); if (s && cjk.test(s) && s.length < 400) out.add(s); };
  const w = document.createTreeWalker(document.body, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, { acceptNode: n => n.nodeType === 1 && n.matches(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT });
  for (let n = w.nextNode(); n; n = w.nextNode()) {
    if (n.nodeType === 3) add(n.nodeValue);
    else for (const a of ['title', 'aria-label', 'placeholder', 'alt']) if (n.hasAttribute(a)) add(n.getAttribute(a));
  }
  return [...out];
})()'''
async def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--directory', str(ROOT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    found = set()
    try:
        async with async_playwright() as p:
            opts = {'args': ['--no-sandbox']}
            if os.environ.get('CHROMIUM'): opts['executable_path'] = os.environ['CHROMIUM']
            b = await p.chromium.launch(**opts)
            pg = await b.new_page(viewport={'width': 1400, 'height': 900})
            await pg.add_init_script(STUB)
            await pg.goto(f'http://localhost:{PORT}/ui/index.html'); await pg.wait_for_timeout(1500)
            grab = lambda: pg.evaluate(COLLECT)
            found |= set(await grab())
            await pg.click('#settingsButton'); await pg.wait_for_timeout(300)
            for pane in ['general', 'pdf', 'markdown', 'files', 'data', 'about']:
                await pg.click(f'.settingsNav button[data-pane={pane}]'); await pg.wait_for_timeout(250); found |= set(await grab())
            await pg.keyboard.press('Escape')
            await pg.evaluate("document.getElementById('helpButton').click()"); await pg.wait_for_timeout(200); found |= set(await grab())
            await pg.evaluate("document.getElementById('messageDialog').close()")
            text = (ROOT / 'ui/markdown/sample.md').read_text(encoding='utf8')
            await pg.evaluate("t=>qingye.addDocuments([{id:'11111111-1111-1111-1111-111111111111',kind:'markdown',name:'a.md',path:'C:/a.md',text:t,state:{},eol:'\\n'}])", text)
            await pg.wait_for_timeout(1500); found |= set(await grab())
            S = "[...qingye.sessions.values()].find(s=>s.kind==='markdown')"
            # registry and menu model
            found |= set(await pg.evaluate("""(async()=>{const m=await import('./markdown/registry.mjs');const reg=qingye.markdown.typora.reg;const out=[];
              for(const c of reg.list){out.push(c.label);if(c.label2)out.push(c.label2);if(c.group)out.push(c.group);if(c.pandoc)out.push((c.label2||c.label)+'（Pandoc）');}
              const walk=items=>{for(const it of items){if(Array.isArray(it)){if(typeof it[0]==='string')out.push(it[0]);if(Array.isArray(it[1]))walk(it[1]);}}};
              for(const [name,items] of m.menuModel(reg)){out.push(name);walk(items);}
              out.push('打开最近文件','自定义主题','（空）');return out.filter(s=>/[\\u3400-\\u9fff]/.test(s));})()"""))
            # context menu, find, modes
            box = await pg.evaluate(S + ".ui.panel.querySelector('.mdDoc p').getBoundingClientRect().toJSON()")
            await pg.mouse.click(box['x'] + 30, box['y'] + 8, button='right'); await pg.wait_for_timeout(250); found |= set(await grab())
            await pg.keyboard.press('Escape')
            await pg.evaluate(S + ".ui.modes.querySelector('[data-mode=read]').click()"); await pg.wait_for_timeout(150)
            await pg.mouse.click(box['x'] + 30, box['y'] + 8, button='right'); await pg.wait_for_timeout(250); found |= set(await grab())
            await pg.keyboard.press('Escape')
            await pg.evaluate(S + ".ui.modes.querySelector('[data-mode=live]').click()")
            await pg.keyboard.press('Control+h'); await pg.wait_for_timeout(200); found |= set(await grab())
            for tab in ['general', 'appearance', 'images', 'export', 'keys']:
                await pg.evaluate(f"qingye.markdown.typora.H.openPrefs(null,'{tab}')"); await pg.wait_for_timeout(250); found |= set(await grab())
                await pg.keyboard.press('Escape'); await pg.wait_for_timeout(100)
            await pg.evaluate(S + ".ui.stats.click()"); await pg.wait_for_timeout(200); found |= set(await grab())
            await pg.evaluate("qingye.markdown.typora.H.quickStart()"); await pg.wait_for_timeout(200); found |= set(await grab())
            await pg.evaluate("document.getElementById('messageDialog').close()")
            await pg.evaluate("qingye.activate(null)"); await pg.wait_for_timeout(300); found |= set(await grab())
            await b.close()
    finally:
        srv.terminate()
    # Short string literals from UI modules: status messages, labels built at runtime.
    lit = re.compile(r"(['`])((?:(?!\1)[^\\\n]|\\.)*?[\u4e00-\u9fff](?:(?!\1)[^\\\n]|\\.)*?)\1")
    for f in list((ROOT / 'ui').glob('*.mjs')) + [ROOT / 'ui/markdown' / n for n in ['host.mjs', 'typora-ui.mjs', 'typora-dialogs.mjs', 'registry.mjs', 'editor.mjs', 'editor-typora.mjs', 'diagrams.mjs', 'export.mjs']]:
        for m in lit.finditer(f.read_text(encoding='utf8')):
            s = m.group(2)
            if '${' in s or '<' in s or len(s) > 60 or '\\n' in s: continue
            found.add(s.strip())
    known = set(json.loads((ROOT / 'scripts/i18n/catalog.json').read_text(encoding='utf8')))
    cat = sorted(s for s in found if s and re.search(r'[\u4e00-\u9fff]', s) and s not in known)
    (ROOT / 'scripts/i18n/harvest-new.json').write_text(json.dumps(cat, ensure_ascii=False, indent=0), encoding='utf8')
    print(len(cat), 'strings not in catalog.json (dynamic text and fragments are handled by patterns in build.py)')
asyncio.run(main())
