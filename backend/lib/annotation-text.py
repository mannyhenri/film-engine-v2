"""Local text-label rasterization only. No network, source-file writes or provider access."""
import io, json, os, sys
from PIL import Image, ImageDraw, ImageFont
image = Image.open(io.BytesIO(sys.stdin.buffer.read())).convert('RGBA')
labels = json.loads(sys.argv[1])
scale = max(image.size) / 640
font = None
for candidate in [os.environ.get('FILM_ANNOTATION_FONT', ''), '/System/Library/Fonts/SFNS.ttf', '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf']:
    if candidate and os.path.isfile(candidate):
        font = ImageFont.truetype(candidate, max(1, round(13 * scale)))
        break
font = font or ImageFont.load_default(size=max(1, round(13 * scale)))
for label in labels:
    x, y = label['p']
    text = str(label['mark'].get('text') or '')
    draw = ImageDraw.Draw(image)
    box = draw.textbbox((x, y), text, font=font, anchor='ls')
    plate = Image.new('RGBA', image.size)
    ImageDraw.Draw(plate).rectangle((box[0]-4*scale, y-14*scale, box[2]+4*scale, y+5*scale), fill=(0,0,0,153))
    image = Image.alpha_composite(image, plate)
    ImageDraw.Draw(image).text((x,y), text, font=font, fill=label['mark'].get('color') or '#f59e0b', anchor='ls')
image.save(sys.stdout.buffer, format='PNG')
