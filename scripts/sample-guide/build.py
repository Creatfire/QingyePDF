# Builds ui/sample-guide.pdf, ui/sample-guide-mac.pdf and ui/sample-guide-touch.pdf (the "PDF 示例"
# opened from the home page on Windows, macOS and Android).
# Requires: Pillow, fontTools, Playwright + Chromium, Noto Sans CJK fonts (Regular, Bold and, for headings, Black). Run: python3 scripts/sample-guide/build.py
import asyncio, os, subprocess, sys
from pathlib import Path
from PIL import Image
here = Path(__file__).resolve().parent
root = here.parents[1]
subprocess.run([sys.executable, str(here / 'make_scan.py'), str(here / 'scan.png')], check=True)
Image.open(here / 'scan.png').convert('L').save(here / 'scan.jpg', quality=78, optimize=True)
(here / 'scan.png').unlink()
# Subset Noto Sans CJK SC to the characters in guide.html. Keeping only the characters actually
# used also drops the Kangxi/CJK radical code points that share glyphs with 一/青/页…, which would
# otherwise end up in the PDF's ToUnicode map and break search and copy.
import re, shutil
from fontTools.ttLib import TTCollection
from fontTools import subset
source = (here / 'guide.html').read_text(encoding='utf8')

# One guide per platform: the Windows text is the source; the Mac guide writes Mac shortcuts and
# the touch guide (Android) describes gestures instead of keys.
def mac(html):
    key = lambda *parts: ''.join(f'<kbd>{p}</kbd>' for p in parts)
    for old, new in [
        ('<kbd>Ctrl</kbd>+<kbd>Shift</kbd>+<kbd>S</kbd>', key('⇧', '⌘', 'S')), ('<kbd>Ctrl</kbd>+<kbd>Tab</kbd>', key('⌃', 'Tab')),
        ('<kbd>Ctrl</kbd>+<kbd>Y</kbd>', key('⇧', '⌘', 'Z')), ('<kbd>F11</kbd>', key('⌃', '⌘', 'F'))]:
        assert old in html, old; html = html.replace(old, new)
    html = re.sub(r'<kbd>Ctrl</kbd>\+<kbd>(\w)</kbd>', lambda m: key('⌘', m.group(1)), html)
    assert 'Ctrl' not in html
    return html.replace('在页面上单击右键', '在页面上单击右键（或按住 Control 单击）').replace('你的电脑上', '你的 Mac 上')
def touch(html):
    for old, new in [
        ('左下角的浮动面板用来翻页和缩放，<kbd>Ctrl</kbd>+<kbd>G</kbd> 直接跳到页码。', '底部的浮动面板用来翻页和缩放；轻点页面可以隐藏或显示工具栏，双指捏合可以缩放。'),
        ('在页面上单击右键，可以快速使用批注、页面编辑和页面管理。', '长按页面空白处，可以快速使用批注、页面编辑和页面管理。'),
        ('点击工具栏的“搜索”或按 <kbd>Ctrl</kbd>+<kbd>F</kbd>，', '点工具栏的“搜索”，'),
        ('然后按 <kbd>Ctrl</kbd>+<kbd>Z</kbd> 撤销试试。', '然后点工具栏上的撤销按钮试试。'),
        ('快捷键与数据安全', '手势与数据安全'), ('你的电脑上', '你的手机上'), ('会在本机定期保存草稿', '会在手机上定期保存草稿'), ('打开首页右侧的 Markdown 示例', '打开首页的 Markdown 示例')]:
        assert old in html, old; html = html.replace(old, new)
    start, end = html.index('<tr><th style="width:44mm">快捷键</th>'), html.index('</table>', html.index('<tr><th style="width:44mm">快捷键</th>'))
    rows = [('轻点页面', '隐藏或显示上下的工具栏'), ('双击页面', '放大到两倍 / 回到适合宽度'), ('双指捏合', '任意缩放'), ('长按文字', '选中后复制、高亮、搜索或摘录到笔记'),
            ('长按页面空白处', '页面菜单：批注、页面编辑、书签'), ('长按标签', '把文档放到笔记模式的另一侧'), ('返回键', '依次关闭菜单、退出笔记模式、回到首页')]
    table = '<tr><th style="width:44mm">手势</th><th>作用</th></tr>\n' + ''.join(f'    <tr><td>{a}</td><td>{b}</td></tr>\n' for a, b in rows) + '  '
    html = html[:start] + table + html[end:]
    assert 'Ctrl' not in html and 'F11' not in html
    return html
VARIANTS = {'sample-guide.pdf': lambda html: html, 'sample-guide-mac.pdf': mac, 'sample-guide-touch.pdf': touch}

def fonts_for(html):
    text = re.sub(r'<style>[\s\S]*?</style>', '', html) + ''.join(chr(c) for c in range(0x20, 0x7f)) + '“”‘’、，。：；！？（）《》—…·→'
    chars = {ord(c) for c in text if not (0x2E80 <= ord(c) <= 0x2FDF)}
    (here / 'fonts').mkdir(exist_ok=True)
    # 0.14.0: headings use the Black weight; systems without NotoSansCJK-Black.ttc fall back to Bold.
    for weight, file in (('regular', 'NotoSansCJK-Regular.ttc'), ('bold', 'NotoSansCJK-Bold.ttc'), ('black', 'NotoSansCJK-Black.ttc')):
        path = '/usr/share/fonts/opentype/noto/' + file
        if not os.path.exists(path): path = '/usr/share/fonts/opentype/noto/NotoSansCJK-Bold.ttc'
        coll = TTCollection(path)
        font = next(f for f in coll.fonts if 'Noto Sans CJK SC' in f['name'].getDebugName(1))
        opts = subset.Options(); opts.layout_features = ['*']; opts.name_IDs = ['*']; opts.notdef_outline = True
        sub = subset.Subsetter(opts); sub.populate(unicodes=chars); sub.subset(font)
        font.save(str(here / 'fonts' / f'guide-{weight}.otf'))
async def main():
    from playwright.async_api import async_playwright
    async with async_playwright() as p:
        opts = {'args': ['--no-sandbox']}
        if os.environ.get('CHROMIUM'): opts['executable_path'] = os.environ['CHROMIUM']
        b = await p.chromium.launch(**opts)
        for name, adapt in VARIANTS.items():
            html = adapt(source); fonts_for(html)
            page_file = here / '.variant.html'; page_file.write_text(html, encoding='utf8')
            pg = await b.new_page()
            await pg.goto(page_file.as_uri()); await pg.wait_for_timeout(500)
            await pg.pdf(path=str(root / 'ui' / name), prefer_css_page_size=True, print_background=True, outline=True, tagged=True)
            await pg.close(); page_file.unlink()
            print('ui/' + name, (root / 'ui' / name).stat().st_size, 'bytes')
        await b.close()
asyncio.run(main())
shutil.rmtree(here / 'fonts'); (here / 'scan.jpg').unlink()
