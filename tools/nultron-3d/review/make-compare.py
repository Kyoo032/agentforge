from PIL import Image, ImageDraw
import os
# OPTIONAL review helper (Python 3 + Pillow); the app's images never need it.
# Builds work/look/compare.png: reference crops (row 1), our renders on a light background (row 2) and on a dark one (row 3).
#   node render.mjs --batch look-jobs.json      writes work/look/*.png
#   python review/crop-ref.py                   writes work/ref/*.png (crops of the reference sheet)
#   python review/make-compare.py
root = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
here = os.path.join(root, "work")
cols = [
    ("front", "ref/front.png", "look/front.png"),
    ("three-quarter", "ref/hero.png", "look/threequarter.png"),
    ("head", "ref/head_front.png", "look/head.png"),
    ("app icon", "ref/icon.png", "look/icon-tile.png"),
]
H = 620
LIGHT = "#EFE1D4"
DARK = "#14161c"

def fit(im, h):
    return im.resize((round(im.width * h / im.height), h), Image.LANCZOS)

def on(bg, path):
    rgba = Image.open(os.path.join(here, path)).convert("RGBA")
    c = Image.new("RGBA", rgba.size, bg)
    c.alpha_composite(rgba)
    return c.convert("RGB")

rows = []
for kind in ("ref", "light", "dark"):
    row = []
    for name, ref, mine in cols:
        if kind == "ref":
            im = Image.open(os.path.join(here, ref)).convert("RGB")
        else:
            im = on(LIGHT if kind == "light" else DARK, mine)
        row.append(fit(im, H))
    rows.append(row)

# make every column as wide as its widest cell so rows line up
widths = [max(r[i].width for r in rows) for i in range(len(cols))]
gap = 10
label_h = 26
W = sum(widths) + gap * (len(cols) - 1)
sheet = Image.new("RGB", (W, (H + label_h) * 3 + gap * 2), "#ffffff")
d = ImageDraw.Draw(sheet)
labels = ["reference (6.jpg)", "render on light", "render on dark"]
for r, row in enumerate(rows):
    y = r * (H + label_h + gap)
    x = 0
    for i, cell in enumerate(row):
        bg = {0: "#d8d2ca", 1: LIGHT, 2: DARK}[r]
        pad = Image.new("RGB", (widths[i], H), bg)
        pad.paste(cell, ((widths[i] - cell.width) // 2, 0))
        sheet.paste(pad, (x, y + label_h))
        d.text((x + 4, y + 6), f"{labels[r]}: {cols[i][0]}", fill=(30, 30, 30))
        x += widths[i] + gap
out = os.path.join(here, "look", "compare.png")
sheet.save(out)
print(out, sheet.size)
