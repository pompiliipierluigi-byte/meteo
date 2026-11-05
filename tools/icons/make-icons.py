# Genera le icone PWA in icons/ (eseguire a mano: python3 tools/icons/make-icons.py icons). Richiede Pillow.
import sys
from PIL import Image, ImageDraw
out = sys.argv[1]
def icon(size, maskable):
    s = 4  # supersampling
    S = size * s
    img = Image.new('RGBA', (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    bg = (14, 76, 122, 255)
    if maskable:
        d.rectangle([0, 0, S, S], fill=bg)
        k = 0.62  # contenuto nella safe zone (80 %)
    else:
        d.rounded_rectangle([0, 0, S - 1, S - 1], radius=int(S * 0.18), fill=bg)
        k = 0.8
    c = S / 2
    u = S * k / 2
    def p(x, y):
        return (c + x * u, c + y * u)
    # onde
    for i, y in enumerate([0.62, 0.82]):
        d.line([p(-0.95, y), p(-0.5, y - 0.08), p(0, y), p(0.5, y - 0.08), p(0.95, y)],
               fill=(120, 200, 235, 255), width=int(S * 0.035), joint='curve')
    # scafo
    d.polygon([p(-0.7, 0.38), p(0.7, 0.38), p(0.5, 0.52), p(-0.5, 0.52)], fill=(255, 255, 255, 255))
    # randa e fiocco
    d.polygon([p(-0.04, -0.9), p(-0.04, 0.3), p(-0.62, 0.3)], fill=(255, 255, 255, 255))
    d.polygon([p(0.06, -0.72), p(0.06, 0.3), p(0.55, 0.3)], fill=(255, 196, 61, 255))
    return img.resize((size, size), Image.LANCZOS)
icon(192, False).save(f'{out}/icon-192.png')
icon(512, False).save(f'{out}/icon-512.png')
icon(512, True).save(f'{out}/icon-maskable-512.png')
icon(180, True).save(f'{out}/apple-touch-icon.png')
icon(32, False).save(f'{out}/favicon-32.png')
