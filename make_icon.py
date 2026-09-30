# -*- coding: utf-8 -*-
"""生成 PWA 图标 icon-192.png / icon-512.png。
图形与 android/app/src/main/res/drawable/ic_launcher_foreground.xml 保持一致：
横版双栏试卷 + 中间红色裁切虚线。改完重跑：python make_icon.py
"""
import os

from PIL import Image, ImageDraw

OUT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "pdf-splitter")

# 以 512 为设计稿坐标系
DOC = (86, 131, 426, 381)   # 纸张：340 x 250，横版
ROWS = (165, 195, 225, 255, 285, 315, 345)
COL_L = (116, 232)
COL_R = (280, 396)
FOLD = (150, 346)


def make(S):
    img = Image.new("RGBA", (S, S), (0, 0, 0, 0))
    d = ImageDraw.Draw(img)

    def sc(*vals):
        return tuple(v * S / 512.0 for v in vals)

    def w(base, min_px=2):
        return max(min_px, int(round(base * S / 512.0)))

    # 图标底色（自适应图标里由 background 层承担，PNG 里要自己画）
    d.rounded_rectangle((0, 0, S - 1, S - 1), radius=sc(112)[0], fill=(37, 99, 235, 255))
    d.rounded_rectangle(sc(*DOC), radius=sc(20)[0], fill=(255, 255, 255, 255))

    gray = (185, 196, 214, 255)
    for y in ROWS:
        for x0, x1 in (COL_L, COL_R):
            d.line(sc(x0, y, x1, y), fill=gray, width=w(12))

    red = (239, 68, 68, 255)
    y = FOLD[0]
    while y < FOLD[1]:
        d.line(sc(256, y, 256, min(y + 16, FOLD[1])), fill=red, width=w(9))
        y += 30
    return img


if __name__ == "__main__":
    os.makedirs(OUT_DIR, exist_ok=True)
    for size in (512, 192):
        path = os.path.join(OUT_DIR, f"icon-{size}.png")
        make(size).save(path)
        print("saved", path)
