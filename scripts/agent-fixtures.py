# Test documents for one test agent (docs/testing/MACOS-0.21-TEST.md), written into its own folder
# so parallel agents never share or overwrite a file.
# Usage: .backend-build/bin/python scripts/agent-fixtures.py test-output/agents/A5/fixtures
import shutil, sys
from html import escape
from pathlib import Path

import pymupdf as fitz
from docx import Document
from openpyxl import Workbook
from pptx import Presentation
from pptx.util import Inches, Pt

root = Path(__file__).resolve().parents[1]
out = Path(sys.argv[1]).resolve()
out.mkdir(parents=True, exist_ok=True)

PAGES = [
    ('第一章 引言', 'Qingye PDF test document. 青页 PDF 测试文档。\n联系电话 13800138000，邮箱 tester@example.com。\nThe quick brown fox jumps over the lazy dog.'),
    ('第二章 方法', 'Section two describes the method. 第二章介绍方法。\n金额：¥1,234.56；日期：2026-10-28。\nRepeated keyword: reader reader reader.'),
    ('第三章 结论', 'Conclusion page. 结论页。\n身份证号 110101199003071234（虚构）。\nEnd of document.'),
]

def text_pdf(path, pages, toc=True):
    doc = fitz.open()
    for title, body in pages:
        page = doc.new_page(width=595, height=842)
        # The HTML layout picks CJK and Latin fonts per character, so English is not set in full-width glyphs.
        html = '<h2>' + escape(title) + '</h2>' + ''.join('<p>' + escape(line) + '</p>' for line in body.split('\n'))
        page.insert_htmlbox(fitz.Rect(72, 72, 523, 770), html)
    if toc:
        doc.set_toc([[1, title, n + 1] for n, (title, _) in enumerate(pages)])
    doc.save(path)

text_pdf(out / 'text.pdf', PAGES)
# A second version for comparison: one changed line, one added line.
changed = [list(p) for p in PAGES]
changed[1][1] = changed[1][1].replace('介绍方法', '介绍改进后的方法') + '\nAdded line in version two.'
text_pdf(out / 'text-v2.pdf', changed)
# Twelve pages for page management, splitting and page numbers.
text_pdf(out / 'long.pdf', [(f'第 {n} 页', f'Page {n} of 12. 第 {n} 页正文。') for n in range(1, 13)])
shutil.copy(root / 'test' / 'fixtures' / 'mixed-scan.pdf', out / 'scan.pdf')
shutil.copy(root / 'ui' / 'sample-guide-mac.pdf', out / 'guide.pdf')
shutil.copy(root / 'test' / 'fixtures' / 'cjk-freetext.pdf', out / 'annotated.pdf')

# A small picture for image stamps.
pix = fitz.Pixmap(fitz.csRGB, fitz.IRect(0, 0, 240, 120), False)
pix.clear_with(0x1D7A57)
pix.save(out / 'stamp.png')

(out / 'notes.md').write_text('# 阅读笔记\n\n- 第一条笔记\n- Second note\n\n$$E = mc^2$$\n\n```mermaid\ngraph TD; A-->B;\n```\n', encoding='utf-8')

d = Document(); d.add_heading('测试报告 Test report', 1)
d.add_paragraph('这是一份用于 Office 转 PDF 的 Word 文档。This Word file checks Office to PDF conversion.')
t = d.add_table(rows=3, cols=3)
for r in range(3):
    for c in range(3): t.cell(r, c).text = f'单元格 {r + 1}-{c + 1}'
d.save(out / 'report.docx')

wb = Workbook(); ws = wb.active; ws.title = '数据'
ws.append(['项目', '数量', '金额']); ws.append(['苹果', 3, 12.5]); ws.append(['香蕉', 5, 8.0]); ws.append(['合计', '=SUM(B2:B3)', '=SUM(C2:C3)'])
wb.save(out / 'table.xlsx')

prs = Presentation()
for n, title in enumerate(['第一页 封面', '第二页 内容'], 1):
    s = prs.slides.add_slide(prs.slide_layouts[5]); s.shapes.title.text = title
    box = s.shapes.add_textbox(Inches(1), Inches(2), Inches(8), Inches(1)); box.text_frame.text = f'幻灯片 {n} · Slide {n}'
    box.text_frame.paragraphs[0].runs[0].font.size = Pt(28)
prs.save(out / 'slides.pptx')

(out / 'broken.docx').write_bytes(b'this is not a real docx file')
print('\n'.join(sorted(p.name for p in out.iterdir())))
