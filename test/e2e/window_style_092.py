# 0.9.2 interface style (Windows / MacOS) in a plain Chromium (no Electron): the settings chooser,
# saving the choice, "restart now" through the normal close flow, the drawn traffic lights (window
# controls, maximize / focus state), the window-vibrancy switch, translation, and that the Windows
# style keeps the 0.9.1 chrome (no traffic lights, native caption space on the right).
# Usage: python3 test/e2e/window_style_092.py [source-root] [screenshot-dir]
import asyncio, os, subprocess, sys, time
from pathlib import Path
from playwright.async_api import async_playwright

ROOT = Path(sys.argv[1] if len(sys.argv) > 1 else Path(__file__).resolve().parents[2])
SHOTS = Path(sys.argv[2] if len(sys.argv) > 2 else ROOT / 'test-output' / 'window-style-092')
SHOTS.mkdir(parents=True, exist_ok=True)
PORT = 8772

def stub(style='windows', vibrancy=False, acrylic=False, lang='zh-CN', relaunched=False):
    js = lambda v: 'true' if v else 'false'
    return r'''
try{localStorage.setItem('qingye.language','%s')}catch{}
window.__calls=[];window.__cmd=null;
const log=(k,a)=>window.__calls.push([k,JSON.parse(JSON.stringify(a||[]))]);
const base={platform:'win32',
 windowStyle:{style:'%s',drawnCaption:%s,vibrancy:%s,acrylicSupported:%s,relaunched:%s,saved:{style:'%s',vibrancy:%s}},
 onCommand:cb=>{window.__cmd=cb;return()=>{}},onJobProgress:()=>()=>{},appVersion:async()=>'0.9.2',
 recent:async()=>[],windowState:async()=>({maximized:false,fullscreen:false,focused:true}),recoveryList:async()=>[],lastSessionCount:async()=>%s,restoreSession:async()=>{log('restoreSession');return [];},
 mdThemes:async()=>[],mdHistory:async()=>[],mdPandocInfo:async()=>({found:false}),editCommand:async()=>true,mdKatexCss:async()=>'',markdownAsset:async()=>null,
 assocStatus:async()=>({supported:false,reason:'x',types:{}}),
 aiState:async()=>({connections:[],defaults:{},server:{},presets:[],serverStatus:{}}),
 setWindowStyle:async v=>{log('setWindowStyle',[v]);return v;},
 windowControl:async a=>{log('windowControl',[a]);return true;},
 relaunchOnClose:async v=>{log('relaunchOnClose',[v]);return v;},
 finishSession:async()=>{log('finishSession');return true;},
 finishClose:()=>log('finishClose')};
window.desktop=new Proxy(base,{get:(t,k)=>k in t?t[k]:async(...a)=>{log(String(k),a);return null;}});
''' % (lang, style, js(style == 'macos'), js(vibrancy), js(acrylic), js(relaunched), style, js(vibrancy), '1' if relaunched else '0')

results, failures = {}, []
def check(name, actual, expected):
    results[name] = actual
    if actual != expected: failures.append(f'{name}: {actual!r} != {expected!r}')

CALLS = "k=>window.__calls.filter(c=>c[0]===k).map(c=>c[1])"

async def page(browser, **kw):
    pg = await browser.new_page(viewport={'width': 1360, 'height': 860})
    errors = []
    pg.on('pageerror', lambda e: errors.append(str(e)))
    await pg.add_init_script(stub(**kw) + "localStorage.setItem('qingye-theme','light');")
    await pg.goto(f'http://localhost:{PORT}/ui/index.html'); await pg.wait_for_timeout(1200)
    pg.errors = errors
    return pg

async def main():
    srv = subprocess.Popen([sys.executable, '-m', 'http.server', str(PORT), '--directory', str(ROOT)], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    time.sleep(1)
    try:
        async with async_playwright() as p:
            opts = {'args': ['--no-sandbox']}
            if os.environ.get('CHROMIUM'): opts['executable_path'] = os.environ['CHROMIUM']
            b = await p.chromium.launch(**opts)

            # ——— Windows style (default): unchanged chrome, chooser, save, revert, restart ———
            pg = await page(b)
            check('win: body class', await pg.evaluate("document.body.className.includes('style-windows')"), True)
            check('win: no traffic lights', await pg.locator('.trafficLights').count(), 0)
            check('win: caption space kept', await pg.evaluate("getComputedStyle(document.getElementById('titlebar')).paddingRight"), '140px')
            await pg.click('#settingsButton'); await pg.wait_for_timeout(300)
            check('win: chooser checked', await pg.get_attribute('.styleChoices [data-style="windows"]', 'aria-checked'), 'true')
            check('win: restart hidden', await pg.is_hidden('.styleRestart'), True)
            check('win: vibrancy row hidden', await pg.is_hidden('#setVibrancyRow'), True)
            await pg.click('.styleChoices [data-style="macos"]'); await pg.wait_for_timeout(200)
            check('win→mac: saved', await pg.evaluate(CALLS, 'setWindowStyle'), [[{'style': 'macos', 'vibrancy': False}]])
            check('win→mac: restart shown', await pg.is_visible('.styleRestart'), True)
            check('win→mac: vibrancy row shown', await pg.is_visible('#setVibrancyRow'), True)
            check('win→mac: vibrancy needs Windows 11', await pg.is_disabled('#setVibrancy'), True)
            check('win→mac: still Windows until restart', await pg.locator('.trafficLights').count(), 0)
            await pg.screenshot(path=str(SHOTS / 'settings-windows-choose-macos.png'))
            await pg.keyboard.press('ArrowLeft'); await pg.wait_for_timeout(200)
            check('arrow key back to Windows', await pg.get_attribute('.styleChoices [data-style="windows"]', 'aria-checked'), 'true')
            check('back to Windows: restart hidden', await pg.is_hidden('.styleRestart'), True)
            await pg.click('.styleChoices [data-style="macos"]'); await pg.wait_for_timeout(200)
            await pg.click('#styleRestartNow'); await pg.wait_for_timeout(400)
            check('restart: relaunch requested', await pg.evaluate(CALLS, 'relaunchOnClose'), [[True]])
            check('restart: close flow finished', [len(await pg.evaluate(CALLS, k)) for k in ['finishSession', 'finishClose']], [1, 1])
            check('win: no page errors', pg.errors, [])
            await pg.close()

            # ——— MacOS style: traffic lights and window state ———
            pg = await page(b, style='macos')
            check('mac: body class', await pg.evaluate("document.body.className.includes('style-macos')"), True)
            check('mac: three lights', await pg.locator('.trafficLights .trafficLight').count(), 3)
            check('mac: lights first in title bar', await pg.evaluate("document.getElementById('titlebar').firstElementChild.className"), 'trafficLights')
            check('mac: no caption space', await pg.evaluate("getComputedStyle(document.getElementById('titlebar')).paddingRight"), '10px')
            check('mac: close color', await pg.evaluate("getComputedStyle(document.querySelector('.trafficLight.close')).backgroundColor"), 'rgb(255, 95, 87)')
            check('mac: lights not draggable', await pg.evaluate("getComputedStyle(document.querySelector('.trafficLight')).getPropertyValue('app-region') || getComputedStyle(document.querySelector('.trafficLight')).webkitAppRegion"), 'no-drag')
            for action in ['close', 'minimize', 'maximize']: await pg.click(f'.trafficLight.{action}')
            check('mac: window controls', await pg.evaluate(CALLS, 'windowControl'), [['close'], ['minimize'], ['maximize']])
            await pg.evaluate("window.__cmd('window-maximized', true)"); await pg.wait_for_timeout(100)
            check('mac: maximized label', await pg.get_attribute('.trafficLight.maximize', 'aria-label'), '还原')
            await pg.evaluate("window.__cmd('window-maximized', false)")
            check('mac: restored label', await pg.get_attribute('.trafficLight.maximize', 'aria-label'), '最大化')
            await pg.mouse.move(700, 500); await pg.evaluate("window.__cmd('window-focus', false)"); await pg.wait_for_timeout(200)
            check('mac: inactive grey', await pg.evaluate("getComputedStyle(document.querySelector('.trafficLight.close')).backgroundColor"), 'rgb(212, 212, 216)')
            await pg.screenshot(path=str(SHOTS / 'macos-inactive.png'), clip={'x': 0, 'y': 0, 'width': 400, 'height': 60})
            await pg.evaluate("window.__cmd('window-focus', true)")
            await pg.hover('.trafficLight.minimize'); await pg.wait_for_timeout(200)
            check('mac: glyphs on hover', await pg.evaluate("getComputedStyle(document.querySelector('.trafficLight.close'),'::before').opacity"), '1')
            await pg.screenshot(path=str(SHOTS / 'macos-hover.png'), clip={'x': 0, 'y': 0, 'width': 400, 'height': 60})
            check('mac: glass menus', await pg.evaluate("(()=>{const d=document.createElement('div');d.className='mdMenu';document.body.append(d);const v=getComputedStyle(d).backdropFilter;d.remove();return v.includes('blur');})()"), True)
            await pg.click('#settingsButton'); await pg.wait_for_timeout(300)
            check('mac: chooser checked', await pg.get_attribute('.styleChoices [data-style="macos"]', 'aria-checked'), 'true')
            check('mac: restart hidden', await pg.is_hidden('.styleRestart'), True)
            check('mac: dialog radius', await pg.evaluate("getComputedStyle(document.getElementById('settingsDialog')).borderRadius"), '16px')
            await pg.screenshot(path=str(SHOTS / 'settings-macos.png'))
            check('mac: no page errors', pg.errors, [])
            await pg.close()

            # ——— Windows 11: window vibrancy switch ———
            pg = await page(b, style='macos', acrylic=True)
            await pg.click('#settingsButton'); await pg.wait_for_timeout(300)
            check('acrylic: switch enabled', await pg.is_enabled('#setVibrancy'), True)
            await pg.click('#setVibrancyRow'); await pg.wait_for_timeout(200)
            check('acrylic: saved', await pg.evaluate(CALLS, 'setWindowStyle'), [[{'style': 'macos', 'vibrancy': True}]])
            check('acrylic: restart shown', await pg.is_visible('.styleRestart'), True)
            await pg.close()
            pg = await page(b, style='macos', vibrancy=True, acrylic=True)
            check('vibrancy: class', await pg.evaluate("document.body.classList.contains('vibrancy')"), True)
            check('vibrancy: transparent body', await pg.evaluate("getComputedStyle(document.body).backgroundColor"), 'rgba(0, 0, 0, 0)')
            await pg.evaluate("document.documentElement.style.background='linear-gradient(120deg,#6a8dff,#ff8fb1 45%,#ffd36e)'")
            await pg.screenshot(path=str(SHOTS / 'macos-vibrancy.png'))
            await pg.close()

            # ——— Translation ———
            pg = await page(b, style='macos', lang='en')
            check('en: minimize label', await pg.get_attribute('.trafficLight.minimize', 'aria-label'), 'Minimize')
            await pg.click('#settingsButton'); await pg.wait_for_timeout(300)
            check('en: heading', await pg.inner_text('.styleHeading b'), 'Interface style')
            check('en: no Chinese left in chooser', await pg.evaluate("/[\\u4e00-\\u9fff]/.test(document.querySelector('.styleChoices').innerText)"), False)
            await pg.close()

            # ——— Restart reopens the tabs it closed ———
            pg = await page(b, relaunched=True)
            await pg.wait_for_timeout(900)
            check('relaunched: tabs restored', len(await pg.evaluate(CALLS, 'restoreSession')), 1)
            await pg.close()
            await b.close()
    finally:
        srv.kill()
    for k, v in results.items(): print(('FAIL ' if any(f.startswith(k + ':') for f in failures) else 'ok   ') + k)
    print(f'{len(results) - len(failures)}/{len(results)} passed')
    if failures: print('\n'.join(failures)); sys.exit(1)

asyncio.run(main())
