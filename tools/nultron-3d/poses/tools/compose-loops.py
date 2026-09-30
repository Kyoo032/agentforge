# Stacks poses/frames/loop-<state>.png (4 frames each) into poses/loops.png, three strips per row.
import json
from pathlib import Path
from PIL import Image

here = Path(__file__).resolve().parent.parent
states = [n for n, s in json.loads((here.parent / "poses.json").read_text(encoding="utf-8"))["states"].items() if s.get("loop")]
strips = [Image.open(here / "frames" / f"loop-{n}.png").convert("RGB") for n in states]
w, h = strips[0].size
cols = 3
rows = (len(strips) + cols - 1) // cols
scale = 0.62
tw, th = int(w * scale), int(h * scale)
sheet = Image.new("RGB", (cols * tw, rows * th), (238, 241, 246))
for i, im in enumerate(strips):
    sheet.paste(im.resize((tw, th), Image.LANCZOS), ((i % cols) * tw, (i // cols) * th))
sheet.save(here / "loops.png")
print("wrote", here / "loops.png", sheet.size, len(strips), "loops")
