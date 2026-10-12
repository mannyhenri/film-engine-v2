"""Decode a guidance image in the same EXIF orientation used by the image viewer."""
import sys
from PIL import Image, ImageOps
image = ImageOps.exif_transpose(Image.open(sys.argv[1])).convert('RGBA')
if image.width * image.height > 32_000_000:
    raise ValueError('Reference exceeds 32 megapixels')
image.save(sys.stdout.buffer, format='PNG')
