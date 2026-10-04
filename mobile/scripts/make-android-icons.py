#!/usr/bin/env python3
"""Renders the Android launcher icons (legacy, round, adaptive foreground) and the launch
screen from the Qingye logo in build/logo.png."""
from pathlib import Path
from PIL import Image, ImageDraw

ROOT = Path(__file__).resolve().parent.parent
RES = ROOT / 'android/app/src/main/res'
LOGO = Image.open(ROOT.parent / 'build/logo.png').convert('RGBA')
DENSITIES = {'mdpi': 1, 'hdpi': 1.5, 'xhdpi': 2, 'xxhdpi': 3, 'xxxhdpi': 4}


def render(pixels, shape):
    if shape == 'square':
        return LOGO.resize((pixels, pixels), Image.LANCZOS)
    if shape == 'round':
        # The logo fills the circle; its own rounded corners fall outside the mask.
        big = pixels * 4
        scaled = LOGO.resize((round(big * 1.12),) * 2, Image.LANCZOS)
        canvas = Image.new('RGBA', (big, big), (12, 26, 16, 255))
        canvas.alpha_composite(scaled, ((big - scaled.width) // 2,) * 2)
        mask = Image.new('L', (big, big), 0)
        ImageDraw.Draw(mask).ellipse([0, 0, big - 1, big - 1], fill=255)
        canvas.putalpha(mask)
        return canvas.resize((pixels, pixels), Image.LANCZOS)
    # Adaptive foreground: only the inner 66/108 is always visible, so the logo sits inside it
    # on the launcher-drawn background colour (values/ic_launcher_background.xml).
    canvas = Image.new('RGBA', (pixels, pixels), (0, 0, 0, 0))
    inner = LOGO.resize((round(pixels * .62),) * 2, Image.LANCZOS)
    canvas.alpha_composite(inner, ((pixels - inner.width) // 2,) * 2)
    return canvas


for name, factor in DENSITIES.items():
    folder = RES / f'mipmap-{name}'
    folder.mkdir(parents=True, exist_ok=True)
    render(round(48 * factor), 'square').save(folder / 'ic_launcher.png')
    render(round(48 * factor), 'round').save(folder / 'ic_launcher_round.png')
    render(round(108 * factor), 'foreground').save(folder / 'ic_launcher_foreground.png')

# Launch screen: the glyph on the app's light background, one image for every density bucket.
for folder in RES.glob('drawable*'):
    target = folder / 'splash.png'
    if not target.exists():
        continue
    with Image.open(target) as old:
        width, height = old.size
    canvas = Image.new('RGB', (width, height), (238, 243, 240))
    icon = render(min(width, height) // 4, 'square')
    canvas.paste(icon, ((width - icon.width) // 2, (height - icon.height) // 2), icon)
    canvas.save(target)
print('icons written to', RES)
