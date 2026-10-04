#!/usr/bin/env python3
"""Export the approved desktop master with existing Pillow and macOS iconutil.

Run npm run icons after changing public/branding/filmengine-app-icon.png.
The master already carries rounded corners and transparency; do not mask it again.
"""
from pathlib import Path
import subprocess
import sys
import tempfile
from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
HERE = ROOT / 'electron'
source = Image.open(ROOT / 'public/branding/filmengine-app-icon.png').convert('RGBA')
if source.size != (1024, 1024):
    raise ValueError('The desktop master must be 1024 × 1024')
source.save(HERE / 'icon.png')
source.save(HERE / 'icon.ico', sizes=[(s, s) for s in (16, 32, 48, 64, 128, 256)])
sizes = HERE / 'icons'
sizes.mkdir(exist_ok=True)
for size in (16, 32, 48, 64, 128, 256, 512, 1024):
    source.resize((size, size), Image.Resampling.LANCZOS).save(sizes / f'icon-{size}.png')
if sys.platform == 'darwin':
    with tempfile.TemporaryDirectory(prefix='filmengine-icons-') as tmp:
        iconset = Path(tmp) / 'FilmEngine.iconset'
        iconset.mkdir()
        for size in (16, 32, 128, 256, 512):
            for scale in (1, 2):
                pixels = size * scale
                suffix = '@2x' if scale == 2 else ''
                source.resize((pixels, pixels), Image.Resampling.LANCZOS).save(iconset / f'icon_{size}x{size}{suffix}.png')
        subprocess.run(['/usr/bin/iconutil', '-c', 'icns', str(iconset), '-o', str(HERE / 'icon.icns')], check=True)
print('Exported Film Engine desktop PNGs, ICO' + (' and ICNS' if sys.platform == 'darwin' else ' (ICNS export requires macOS)'))
