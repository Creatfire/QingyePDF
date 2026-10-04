# Renders a full-page "scanned document" image (A4, 150 dpi) for the OCR demo page of the sample guide.
# The PDF page holding it has no text layer, so "文本选择" triggers local OCR on it.
import random, sys
from PIL import Image, ImageDraw, ImageFont, ImageFilter
out = sys.argv[1]
W, H = 1240, 1754
img = Image.new('L', (W, H), 238)
d = ImageDraw.Draw(img)
F = lambda size, bold=False: ImageFont.truetype('/usr/share/fonts/opentype/noto/NotoSansCJK-%s.ttc' % ('Bold' if bold else 'Regular'), size, index=2)
d.text((120, 150), '扫描件示例', font=F(64, True), fill=35)
d.text((120, 245), 'Scanned page · 文字识别演示', font=F(30), fill=90)
d.line((120, 310, 1120, 310), fill=110, width=3)
paragraphs = [
    '这一页是一张图片，看起来有字，但电脑无法选中、复制或搜索这些文字。',
    '点击工具栏的“文本选择”，再在这一页上拖动鼠标。青页会在本机识别这一页的中英文，并叠加一层透明文字。',
    '识别完成后，试着选中这一段并复制，或者用 Ctrl+F 搜索“扫描”。',
    'OCR runs locally on your computer. Nothing is uploaded and no account is needed.',
    '保存文档后，识别出的文字会一起保留，下次打开无需再次识别。',
]
font = F(34); y = 380
for para in paragraphs:
    import re
    tokens = re.findall(r'[A-Za-z0-9+.,:;!?\'-]+ ?|.', para)
    line = ''
    for tok in tokens:
        closing = tok in '，。、：；！？”）'
        if d.textlength(line + tok, font=font) > 1000 and not closing:
            d.text((120, y), line.rstrip(), font=font, fill=45); y += 62; line = tok
        else: line += tok
    d.text((120, y), line, font=font, fill=45); y += 96
d.rectangle((120, y + 20, 1120, y + 220), outline=120, width=3)
d.text((150, y + 50), '备注：识别准确率取决于扫描质量，重要内容请复核。', font=F(30), fill=70)
d.text((150, y + 120), '青页 PDF · 第 6 页', font=F(30), fill=110)
random.seed(7)
px = img.load()
for _ in range(26000):
    x, yy = random.randrange(W), random.randrange(H); px[x, yy] = max(0, px[x, yy] - random.randrange(15, 60))
img = img.rotate(-0.8, resample=Image.BICUBIC, expand=False, fillcolor=238).filter(ImageFilter.GaussianBlur(0.55))
img.save(out)
