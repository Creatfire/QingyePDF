"""Builds a realistic scanned-document PDF for serial performance testing.

500 A4 pages of 200 DPI grayscale "scan" imagery (text-like blocks + noise,
JPEG-compressed), with a real text layer on the first and last few pages so
full-document search has actual hits. Run with the build virtualenv.
"""
import io
import random
import sys
from pathlib import Path

import pymupdf as fitz
from PIL import Image, ImageDraw

W, H = 1654, 2339  # A4 at 200 DPI


def scan_page(seed):
    rng = random.Random(seed)
    page = Image.new('L', (W, H), 246 + rng.randint(-6, 6))
    draw = ImageDraw.Draw(page)
    for line in range(38):
        y = 210 + line * 50
        for _ in range(rng.randint(2, 6)):
            x = rng.randint(120, W - 420)
            width = rng.randint(90, 420)
            draw.rectangle([x, y, x + width, y + 26], fill=rng.randint(28, 95))
    # Banding and speckle, like a real feeder scan.
    for band in range(rng.randint(2, 5)):
        top = rng.randint(0, H - 60)
        draw.rectangle([0, top, W, top + rng.randint(4, 18)], fill=rng.randint(180, 235))
    noise = Image.effect_noise((W, H), 16)
    page = Image.blend(page, noise, 0.05)
    buffer = io.BytesIO()
    page.save(buffer, format='JPEG', quality=70)
    return buffer.getvalue()


def build(target: Path, pages: int = 500):
    doc = fitz.open()
    for index in range(pages):
        page = doc.new_page(width=595, height=842)
        if index < 5 or index >= pages - 5:
            page.insert_text((72, 96), f'NEEDLE scan page {index + 1}', fontsize=20)
            for line in range(30):
                page.insert_text((72, 150 + line * 22), f'line {line} sample text {index}', fontsize=11)
        page.insert_image(page.rect, stream=scan_page(index))
        if index % 50 == 0:
            print(f'{index}/{pages}', file=sys.stderr, flush=True)
    doc.save(target, deflate=True, garbage=3)
    print(f'{target} {target.stat().st_size / 1e6:.1f} MB {pages} pages', file=sys.stderr)


if __name__ == '__main__':
    build(Path(sys.argv[1] if len(sys.argv) > 1 else 'test-output/large-scan.pdf'))
