# Composes the labelled 21-state sheets from the frames the modeller's renderer wrote into poses/frames/.
#   python poses/tools/compose-sheet.py front poses/sheet.png
#   python poses/tools/compose-sheet.py 34 poses/sheet-34.png
import json
import sys
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont

here = Path(__file__).resolve().parent.parent
view, out = sys.argv[1], Path(sys.argv[2])
states = json.loads((here.parent / "poses.json").read_text(encoding="utf-8"))["_meta"]["states"]
cols = 7
tile = 400
label_h = 34
rows = (len(states) + cols - 1) // cols
sheet = Image.new("RGB", (cols * tile, rows * (tile + label_h)), (238, 241, 246))
draw = ImageDraw.Draw(sheet)
try:
    font = ImageFont.truetype("segoeuib.ttf", 20)  # found by name in the system font folders; falls back below
except OSError:
    font = ImageFont.load_default()
for i, name in enumerate(states):
    img = Image.open(here / "frames" / view / f"{name}.png").convert("RGB").resize((tile, tile), Image.LANCZOS)
    x, y = (i % cols) * tile, (i // cols) * (tile + label_h)
    sheet.paste(img, (x, y))
    w = draw.textlength(name, font=font)
    draw.text((x + (tile - w) / 2, y + tile + 4), name, fill=(34, 34, 51), font=font)
sheet.save(out)
print("wrote", out, sheet.size)
