# 0.8 / 0.8.2 layout check in a plain Chromium (no Electron): home / Markdown chrome, three Markdown views,
# status bar, save button, find bar placement, reading-mode link click, context menu in reading mode,
# settings dialog and live language switching (0.8.2).
# Usage: python3 test/e2e/ui_modes_08.py [source-root] [screenshot-dir]
# Needs: pip install playwright (and a Chromium; set CHROMIUM=/path/to/chrome if not bundled).
# PDF rendering is NOT covered here (the bundled PDF.js needs Electron 44's Chromium); use `npm run smoke`.
import asyncio, os, subprocess, sys, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[2])
SHOTS = Path(sys.argv[2] if len(sys.argv) > 2 else ROOT / 'test-output' / 'ui-08')
SHOTS.mkdir(parents=True, exist_ok=True)
PORT = 8768
STUB = '''
try{localStorage.setItem('qingye.language','zh-CN')}catch{}
window.__calls=[];
const base={platform:'win32',onCommand:()=>()=>{},onJobProgress:()=>()=>{},appVersion:async()=>'0.8.0',
 recent:async()=>[{id:'r1',name:'notes.md',path:'C:/x/notes.md'}],windowState:async()=>({}),recoveryList:async()=>[],lastSessionCount:async()=>0,
 mdThemes:async()=>[],mdHistory:async()=>[],mdPandocInfo:async()=>({found:false}),editCommand:async()=>true,mdKatexCss:async()=>'',markdownAsset:async()=>null,
 markdownOpenLink:async(id,href)=>{window.__calls.push(['openLink',href]);return null;}};
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
            pg = await browser.new_page(viewport={'width': 1360, 'height': 860})
            errors = []
            pg.on('pageerror', lambda e: errors.append(str(e)))
            await pg.add_init_script(STUB)
            await pg.goto(f'http://localhost:{PORT}/ui/index.html'); await pg.wait_for_timeout(1200)
            shown = "(sel=>{const e=document.querySelector(sel);return !!e&&getComputedStyle(e).display!=='none'&&!e.hidden})"
            check('home.mode', await pg.evaluate('document.body.dataset.mode'), 'home')
            check('home.pdfToolbar', await pg.evaluate(shown + "('#pdfToolbar')"), False)
            check('home.status', await pg.evaluate(shown + "('body > .status')"), False)
            check('home.themeInTitlebar', await pg.evaluate("!!document.querySelector('.titlebar #themeButton')&&!!document.querySelector('.titlebar #helpButton')"), True)
            check('home.restoreHidden', await pg.evaluate("document.getElementById('restoreButton').hidden"), True)
            check('home.removedEntries', await pg.evaluate("[...document.querySelectorAll('[data-home-action]')].length"), 0)
            check('home.recentRows', await pg.evaluate("document.querySelectorAll('#recent .recentRow').length"), 1)
            await pg.click('.recentFilter button[data-filter=pdf]'); await pg.wait_for_timeout(100)
            check('home.recentFilterPdf', await pg.evaluate("[document.querySelectorAll('#recent .recentRow').length, !!document.querySelector('#recent .emptyRecent')]"), [0, True])
            await pg.click('.recentFilter button[data-filter=all]')
            check('home.samples', await pg.evaluate("!!document.getElementById('exampleButton') && !!document.getElementById('markdownExampleButton')"), True)
            await pg.screenshot(path=str(SHOTS / 'home.png'))
            # Settings (0.8.2)
            check('settings.buttonBeforeHelp', await pg.evaluate("document.getElementById('settingsButton').nextElementSibling?.id"), 'helpButton')
            await pg.click('#settingsButton'); await pg.wait_for_timeout(200)
            check('settings.panes', await pg.evaluate("document.querySelectorAll('#settingsDialog .settingsNav button').length"), 7)
            check('settings.languages', await pg.evaluate("[...document.querySelectorAll('#setLanguage option')].map(o=>o.value)"), ['auto', 'zh-CN', 'zh-TW', 'en', 'ja', 'ko'])
            await pg.select_option('#setLanguage', 'en'); await pg.wait_for_timeout(600)
            check('i18n.english', await pg.evaluate("[document.getElementById('settingsTitle').textContent.trim(), document.getElementById('helpButton').title, document.querySelector('.homeTitle').textContent]"), ['Settings', 'Help', 'What would you like to read today?'])
            await pg.select_option('#setLanguage', 'ja'); await pg.wait_for_timeout(600)
            check('i18n.japanese', await pg.evaluate("document.getElementById('settingsTitle').textContent.trim()"), '設定')
            await pg.select_option('#setLanguage', 'zh-CN'); await pg.wait_for_timeout(600)
            check('i18n.backToChinese', await pg.evaluate("[document.getElementById('settingsTitle').textContent.trim(), document.getElementById('helpButton').title, document.querySelector('.homeTitle').textContent]"), ['设置', '使用帮助', '今天想读点什么？'])
            await pg.click('.settingsNav button[data-pane=files]'); await pg.wait_for_timeout(300)
            check('settings.assocRows', await pg.evaluate("document.querySelectorAll('#settingsDialog .assocRow').length"), 2)
            await pg.keyboard.press('Escape'); await pg.wait_for_timeout(150)

            text = (ROOT / 'ui/markdown/sample.md').read_text(encoding='utf8')
            await pg.evaluate("t=>qingye.addDocuments([{id:'11111111-1111-1111-1111-111111111111',kind:'markdown',name:'sample.md',path:'C:/x/sample.md',text:t,state:{},eol:'\\n'}])", text)
            await pg.wait_for_timeout(1800)
            check('md.mode', await pg.evaluate('document.body.dataset.mode'), 'md')
            check('md.pdfToolbar', await pg.evaluate(shown + "('#pdfToolbar')"), False)
            check('md.globalStatus', await pg.evaluate(shown + "('body > .status')"), False)
            check('md.statusBar', await pg.evaluate(shown + "('.mdStatusBar')"), True)
            check('md.noPill', await pg.evaluate("!document.querySelector('.mdPill')"), True)
            check('md.sideTabs', await pg.evaluate(S + ".ui.sideTabs.querySelectorAll('[data-tab]').length"), 2)
            check('md.menus', await pg.evaluate("[...document.querySelectorAll('.mdMenuTop')].map(b=>b.textContent)"), ['文件', '编辑', '段落', '格式', '视图', '主题', '帮助'])
            check('md.saveClean', await pg.evaluate(S + ".ui.saveButton.textContent"), '已保存')
            await pg.screenshot(path=str(SHOTS / 'md-edit.png'))

            modes = []
            for m in ['read', 'source', 'live']:
                await pg.click(f'.mdModes button[data-mode={m}]'); await pg.wait_for_timeout(250)
                modes.append(await pg.evaluate(f"(()=>{{const s={S};return [!!s.readonly,s.editor.sourceMode,s.ui.modes.querySelector('[aria-pressed=\"true\"]').dataset.mode]}})()"))
                await pg.screenshot(path=str(SHOTS / f'md-{m}.png'))
            check('md.viewModes', modes, [[True, False, 'read'], [False, True, 'source'], [False, False, 'live']])

            await pg.keyboard.press('Control+Shift+R'); await pg.wait_for_timeout(200)
            check('md.ctrlShiftR', await pg.evaluate(S + ".readonly"), True)
            check('md.metaNotesHiddenWhenReading', await pg.evaluate(S + ".ui.panel.querySelectorAll('.mdBlock.isMeta').length >= 2 && [...document.querySelectorAll('.mdBlock.isMeta')].every(b => getComputedStyle(b).display === 'none')"), True)
            check('md.noRawCommentText', await pg.evaluate(S + ".editor.doc.textContent.includes('<!--')"), False)
            check('md.readStats', await pg.evaluate(S + ".ui.stats.textContent.includes('分钟读完')"), True)
            await pg.evaluate(S + ".ui.panel.querySelector('.mdDoc a[href^=\"https\"]').click()"); await pg.wait_for_timeout(200)
            check('md.readLinkOpens', await pg.evaluate("window.__calls.some(c=>c[0]==='openLink')"), True)
            box = await pg.evaluate(S + ".ui.panel.querySelector('.mdDoc p').getBoundingClientRect().toJSON()")
            await pg.mouse.click(box['x'] + 40, box['y'] + 10, button='right'); await pg.wait_for_timeout(250)
            check('md.readContextMenuHasNoFormat', await pg.evaluate("[...document.querySelectorAll('#mdContextMenu .menuLabel')].map(x=>x.textContent)"), [])
            await pg.keyboard.press('Escape'); await pg.mouse.click(10, 500)
            await pg.evaluate(S + ".editor.focus()"); await pg.keyboard.press('e'); await pg.wait_for_timeout(200)
            check('md.eEditsFromRead', await pg.evaluate(S + ".readonly"), False)

            await pg.evaluate(S + ".editor.activateAt(300)"); await pg.keyboard.type('XY'); await pg.wait_for_timeout(300)
            check('md.saveDirty', await pg.evaluate(S + ".ui.saveButton.classList.contains('isDirty')"), True)
            await pg.keyboard.press('Control+f'); await pg.wait_for_timeout(250)
            find = await pg.evaluate(S + ".ui.find.getBoundingClientRect().top"); bar = await pg.evaluate(S + ".ui.menubar.getBoundingClientRect().bottom")
            check('md.findBelowTopbar', find >= bar, True)
            await pg.keyboard.press('Escape')
            await pg.evaluate("qingye.markdown.typora.prefs.set('statusBar',false)"); await pg.wait_for_timeout(100)
            check('md.statusBarPref', await pg.evaluate(shown + "('.mdStatusBar')"), False)
            await pg.evaluate("qingye.markdown.typora.prefs.set('statusBar',true);qingye.markdown.typora.prefs.set('menubar',false)"); await pg.wait_for_timeout(100)
            check('md.menubarPrefKeepsViewSwitch', await pg.evaluate(shown + "('.mdModes')") and not await pg.evaluate(shown + "('.mdMenuTop')"), True)
            await pg.evaluate("qingye.markdown.typora.prefs.set('menubar',true)")
            await pg.evaluate("document.getElementById('themeButton').click()"); await pg.wait_for_timeout(500)
            await pg.screenshot(path=str(SHOTS / 'md-dark.png'))
            await pg.evaluate("qingye.activate(null)"); await pg.wait_for_timeout(200)
            check('back.home', await pg.evaluate('document.body.dataset.mode'), 'home')
            check('pageErrors', errors, [])
            await browser.close()
    finally:
        srv.terminate()
    for k, v in results.items(): print(('FAIL ' if any(f.startswith(k + ':') for f in failures) else 'ok   ') + k)
    print(f'{len(results) - len(failures)}/{len(results)} passed; screenshots in {SHOTS}')
    if failures: print('\n'.join(failures)); sys.exit(1)

asyncio.run(main())
