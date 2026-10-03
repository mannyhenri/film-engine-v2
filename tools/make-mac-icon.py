#!/usr/bin/env python3
"""
electron/icon.png: the iPhone app's icon (electron/icon-ios.png, copied from
film-engine) in the macOS app-icon shape: an 824 px rounded square with
continuous (superellipse) corners, centred on a transparent 1024 px canvas,
as Apple's macOS icon grid lays it out. Run after the iPhone icon changes.
"""
from pathlib import Path
from PIL import Image, ImageDraw, ImageFilter

HERE = Path(__file__).resolve().parent.parent / 'electron'
CANVAS, BODY, SS = 1024, 824, 4            # canvas, icon body, supersampling
N = 5.0                                    # superellipse exponent ~ Apple's continuous corner

def squircle_mask(size):
    big = size * SS
    m = Image.new('L', (big, big), 0)
    px = m.load()
    r = big / 2
    for y in range(big):
        dy = abs((y + 0.5 - r) / r) ** N
        if dy >= 1: continue
        half = r * (1 - dy) ** (1 / N)
        for x in range(int(r - half), int(r + half)):
            px[x, y] = 255
    return m.resize((size, size), Image.LANCZOS)

src = Image.open(HERE / 'icon-ios.png').convert('RGBA').resize((BODY, BODY), Image.LANCZOS)
body = Image.new('RGBA', (BODY, BODY), (0, 0, 0, 0))
body.paste(src, (0, 0), squircle_mask(BODY))

out = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
off = (CANVAS - BODY) // 2
# A soft drop shadow, as macOS icons carry.
shadow = Image.new('RGBA', (CANVAS, CANVAS), (0, 0, 0, 0))
sm = squircle_mask(BODY)
shadow.paste((0, 0, 0, 90), (off, off + 10), sm)
out = Image.alpha_composite(out, shadow.filter(ImageFilter.GaussianBlur(14)))
out.alpha_composite(body, (off, off))
out.save(HERE / 'icon.png')
print('wrote', HERE / 'icon.png')
