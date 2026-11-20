#!/usr/bin/env python3 -I
# Makes ../art.png (the picture at the top of the rest modal) from wii.webp, the
# original. Run it again after you change the crop or the fade:
#   python3 -I ~/.config/herdr-app/mods/rest/art-source/make-art.py
# - Crops off the picture's slate frame.
# - Paints the frame left in its rounded corners with the wall gray.
# - Fades the bottom FADE px into the wall gray, so the picture runs into the card
#   (the card's color in main.js, C.card, is the same gray: #e6e8ec).
# Needs only macOS `sips` (webp -> bmp) and the Python standard library.
import math, os, struct, subprocess, tempfile, zlib

HERE = os.path.dirname(os.path.abspath(__file__))
SRC, OUT = os.path.join(HERE, "wii.webp"), os.path.join(HERE, "..", "art.png")
WALL = (0xE6, 0xE8, 0xEC)
IX0, IX1, IY0, IY1, R = 21, 1263, 18, 745, 46  # the frame's inner edge and corner radius
X0, X1, Y0, Y1 = 27, 1257, 24, 740             # the crop
FADE = 70

with tempfile.TemporaryDirectory() as tmp:
    bmp = os.path.join(tmp, "src.bmp")
    subprocess.run(["sips", "-s", "format", "bmp", SRC, "--out", bmp], check=True, capture_output=True)
    b = open(bmp, "rb").read()
off = struct.unpack_from("<I", b, 10)[0]
W, H = struct.unpack_from("<ii", b, 18)
bp = struct.unpack_from("<H", b, 28)[0] // 8
row, flip, H = (W * bp + 3) // 4 * 4, H > 0, abs(H)

def px(x, y):
    i = off + ((H - 1 - y) if flip else y) * row + x * bp
    return [b[i + 2], b[i + 1], b[i]]

out = bytearray()
for y in range(Y0, Y1):
    out.append(0)
    for x in range(X0, X1):
        c = px(x, y)
        cx = IX0 + R if x < IX0 + R else IX1 - R if x > IX1 - R else None
        cy = IY0 + R if y < IY0 + R else IY1 - R if y > IY1 - R else None
        if cx is not None and cy is not None and math.hypot(x - cx, y - cy) > R - 6:
            c = list(WALL)
        d = Y1 - 1 - y
        if d < FADE:
            t = (1 - d / FADE) ** 1.6
            c = [round(c[k] * (1 - t) + WALL[k] * t) for k in range(3)]
        out += bytes(c)

def chunk(t, d):
    return struct.pack(">I", len(d)) + t + d + struct.pack(">I", zlib.crc32(t + d) & 0xFFFFFFFF)

w, h = X1 - X0, Y1 - Y0
png = (b"\x89PNG\r\n\x1a\n" + chunk(b"IHDR", struct.pack(">IIBBBBB", w, h, 8, 2, 0, 0, 0))
       + chunk(b"IDAT", zlib.compress(bytes(out), 9)) + chunk(b"IEND", b""))
open(OUT, "wb").write(png)
print(f"wrote {os.path.normpath(OUT)} ({w} x {h})")
