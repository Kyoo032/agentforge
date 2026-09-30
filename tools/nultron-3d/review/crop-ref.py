# OPTIONAL review helper (Python 3 + Pillow); the app's images never need it.
# Cuts the reference crops make-compare.py lines the renders up against, from Rizky's character sheet in
# docs/internal/brand/nultron/reference/. The boxes below were measured on a 1932 px sheet; the sheet kept in the repo is
# 2000 px, so every box is scaled by width / 1932 (close, not pixel-exact).
#   python review/crop-ref.py [sheet]      writes work/ref/<name>.png
import os
import sys

from PIL import Image

root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sheet = sys.argv[1] if len(sys.argv) > 1 else os.path.join(
    root, "..", "..", "docs", "internal", "brand", "nultron", "reference", "sheet-v3-hires.jpg"
)
out = os.path.join(root, "work", "ref")
os.makedirs(out, exist_ok=True)
im = Image.open(sheet).convert("RGB")
scale = im.width / 1932
crops = {
    "front": (430, 1080, 830, 1620),
    "hero": (960, 40, 1900, 730),
    "icon": (150, 1630, 530, 1910),
    "head_front": (460, 1090, 780, 1330),
}
for name, box in crops.items():
    c = im.crop(tuple(round(v * scale) for v in box))
    s = 2 if (box[2] - box[0]) < 500 else 1
    c = c.resize((c.width * s, c.height * s), Image.LANCZOS)
    c.save(os.path.join(out, name + ".png"))
    print(name, c.size)
