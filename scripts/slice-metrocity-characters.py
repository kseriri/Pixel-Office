#!/usr/bin/env python3
"""Slice MetroCity 2.0 layered sheets into Pixel Office character PNGs.

The MetroCity 2.0 pack ships modular sheets on a 32px grid, 24 columns per row:
  cols 0-5 = facing down, 6-11 = right, 12-17 = up, 18-23 = left
Each row is one body/colour. `Suit.png` bodies include a cap (usable as-is);
`Suit1.png` bodies are bare-headed and take a hairstyle from `Hair.png`
(same grid, one style per row) composited on top.

We emit the app's character format: 112×96 = 3 rows (down, up, right) × 7 frames
(16×32): walk1, walk2, walk3, type1, type2, read1, read2. We only need a walk
cycle, so type/read reuse the idle frame.

Usage:
  python3 scripts/slice-metrocity-characters.py <src-dir> <out-dir> [start-index]
  # <src-dir> holds Suit.png, Suit1.png, Hair.png (extracted from the pack)
"""
import sys, os
from PIL import Image

CELL = 32
# down / up / right source columns → 3 walk frames + reuse idle for type/read
MAP = {
    'down':  [0, 2, 4, 0, 0, 0, 0],
    'up':    [12, 14, 16, 12, 12, 12, 12],
    'right': [6, 8, 10, 6, 6, 6, 6],
}

# char index → (body sheet, body row, hair sheet|None, hair row)
# Note: Hair.png row 1 is a partial (eyebrow) layer, not a full style — skip it.
ROSTER = [
    ('Suit.png', 0, None, 0),    # navy business suit (has cap)
    ('Suit.png', 1, None, 0),    # red business suit
    ('Suit.png', 3, None, 0),    # orange business suit
    ('Suit1.png', 0, 'Hair.png', 0),  # casual, white top
    ('Suit1.png', 2, 'Hair.png', 2),  # casual, blue top
    ('Suit1.png', 3, 'Hair.png', 3),  # casual, teal top
    ('Suit1.png', 4, 'Hair.png', 4),  # casual, magenta top
]


def content_bbox(img):
    px = img.load(); w, h = img.size
    minx = miny = 10 ** 9; maxx = maxy = -1
    for y in range(h):
        for x in range(w):
            if px[x, y][3] > 10:
                minx = min(minx, x); maxx = max(maxx, x)
                miny = min(miny, y); maxy = max(maxy, y)
    return (minx, miny, maxx, maxy) if maxx >= 0 else None


def place(cell):
    """Center a source cell's content into a 16×32 frame, feet at y=30."""
    out = Image.new('RGBA', (16, 32), (0, 0, 0, 0))
    bb = content_bbox(cell)
    if not bb:
        return out
    minx, miny, maxx, maxy = bb
    c = cell.crop((minx, miny, maxx + 1, maxy + 1)); cw, ch = c.size
    if cw > 16:  # side frames are a touch wide — center-crop to 16
        l = (cw - 16) // 2; c = c.crop((l, 0, l + 16, ch)); cw = 16
    x = (16 - cw) // 2; y = 30 - ch + 1
    if y < 0:
        c = c.crop((0, -y, cw, ch)); ch = c.size[1]; y = 0
    out.paste(c, (x, y))
    return out


def cell_at(sheet, col, row):
    return sheet.crop((col * CELL, row * CELL, col * CELL + CELL, row * CELL + CELL))


def build(body, brow, hair, hrow):
    out = Image.new('RGBA', (112, 96), (0, 0, 0, 0))
    for di, dname in enumerate(['down', 'up', 'right']):
        for fi, col in enumerate(MAP[dname]):
            cell = cell_at(body, col, brow).copy()
            if hair is not None:
                cell.alpha_composite(cell_at(hair, col, hrow))
            out.paste(place(cell), (fi * 16, di * 32))
    return out


def main():
    if len(sys.argv) < 3:
        print(__doc__); sys.exit(1)
    src, out_dir = sys.argv[1], sys.argv[2]
    start = int(sys.argv[3]) if len(sys.argv) > 3 else 6
    sheets = {}
    for name in ('Suit.png', 'Suit1.png', 'Hair.png'):
        p = os.path.join(src, name)
        if os.path.exists(p):
            sheets[name] = Image.open(p).convert('RGBA')
    for i, (body_name, brow, hair_name, hrow) in enumerate(ROSTER):
        body = sheets[body_name]
        hair = sheets[hair_name] if hair_name else None
        img = build(body, brow, hair, hrow)
        dest = os.path.join(out_dir, f'char_{start + i}.png')
        img.save(dest)
        print('wrote', dest, f'({body_name} row {brow}' + (f' + {hair_name} row {hrow}' if hair_name else '') + ')')


if __name__ == '__main__':
    main()
