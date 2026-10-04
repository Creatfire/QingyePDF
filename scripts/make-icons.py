#!/usr/bin/env python3
"""Renders every Qingye icon from the master logo build/logo.png (1024 px, transparent corners):
  build/icons/icon-<size>.png   the sizes packed into the Windows icon
  build/icon.ico                32-bit bitmaps up to 128 px (widest shell compatibility) + PNG at 256 px
  ui/icon.png                   window / taskbar icon and the About dialog (256 px)
  ui/logo.png                   title-bar mark and the About card (96 px)
Requires Pillow. Run after replacing build/logo.png; scripts/generate-icon.mjs only verifies."""
import io
import struct
from pathlib import Path
from PIL import Image

root = Path(__file__).resolve().parent.parent
master = Image.open(root / 'build/logo.png').convert('RGBA')
sizes = [16, 20, 24, 32, 40, 48, 64, 128, 256]
(root / 'build/icons').mkdir(parents=True, exist_ok=True)
images = {}
for size in sizes:
    images[size] = master.resize((size, size), Image.LANCZOS)
    images[size].save(root / f'build/icons/icon-{size}.png', optimize=True)
images[256].save(root / 'ui/icon.png', optimize=True)
master.resize((96, 96), Image.LANCZOS).save(root / 'ui/logo.png', optimize=True)


def bitmap(image):
    """BITMAPINFOHEADER + bottom-up BGRA pixels + 1-bit AND mask, as stored inside an .ico."""
    size = image.width
    pixels = image.transpose(Image.FLIP_TOP_BOTTOM).tobytes('raw', 'BGRA')
    row = ((size + 31) // 32) * 4
    mask = bytearray()
    alpha = image.transpose(Image.FLIP_TOP_BOTTOM).getchannel('A').load()
    for y in range(size):
        bits = bytearray(row)
        for x in range(size):
            if alpha[x, y] == 0:
                bits[x // 8] |= 0x80 >> (x % 8)
        mask += bits
    header = struct.pack('<IiiHHIIiiII', 40, size, size * 2, 1, 32, 0, len(pixels) + len(mask), 0, 0, 0, 0)
    return header + pixels + bytes(mask)


entries = []
for size in sizes:
    if size == 256:
        buffer = io.BytesIO(); images[size].save(buffer, format='PNG', optimize=True); data = buffer.getvalue()
    else:
        data = bitmap(images[size])
    entries.append((size, data))
offset = 6 + 16 * len(entries)
out = struct.pack('<HHH', 0, 1, len(entries))
for size, data in entries:
    out += struct.pack('<BBBBHHII', size % 256, size % 256, 0, 0, 1, 32, len(data), offset)
    offset += len(data)
for _, data in entries:
    out += data
(root / 'build/icon.ico').write_bytes(out)
print('icons written:', ', '.join(str(s) for s in sizes))
