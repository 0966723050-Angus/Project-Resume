# 產生 PWA PNG 圖示(與 icons/icon.svg 同一設計)
from PIL import Image, ImageDraw
import os

OUT = os.path.join(os.path.dirname(os.path.abspath(__file__)), "icons")
BLUE, SKY, LIGHT, WHITE, AMBER = (30, 64, 175, 255), (147, 197, 253, 255), (191, 219, 254, 255), (255, 255, 255, 255), (245, 158, 11, 255)

def make(size, path, maskable=False):
    s = size / 512
    img = Image.new("RGBA", (size, size), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)
    if maskable:
        d.rectangle([0, 0, size, size], fill=BLUE)
        k, off = 0.78, size * 0.11
    else:
        d.rounded_rectangle([0, 0, size - 1, size - 1], radius=112 * s, fill=BLUE)
        k, off = 1.0, 0
    f = lambda v: off + v * s * k
    d.rounded_rectangle([f(128), f(104), f(384), f(424)], radius=28 * s * k, fill=WHITE)
    d.rounded_rectangle([f(196), f(80), f(316), f(136)], radius=18 * s * k, fill=SKY)
    for y, w, c in ((180, 128, BLUE), (236, 100, BLUE), (292, 116, AMBER), (348, 84, BLUE)):
        d.rounded_rectangle([f(164), f(y), f(204), f(y + 26)], radius=6 * s * k, fill=c)
        d.rounded_rectangle([f(220), f(y), f(220 + w), f(y + 26)], radius=6 * s * k, fill=LIGHT)
    img.save(path)

make(192, os.path.join(OUT, "icon-192.png"))
make(512, os.path.join(OUT, "icon-512.png"))
make(512, os.path.join(OUT, "icon-maskable-512.png"), maskable=True)
print("ok")
