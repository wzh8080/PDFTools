# -*- coding: utf-8 -*-
# 验证：把横向拼版页按栏切割，矢量放大嵌入A4
import os
import sys

import pymupdf

# 用法: python verify_split.py [输入试卷.pdf] [输出.pdf]
# 默认读 pdftool_test/input.pdf（已在 .gitignore 中，不会误提交真实试卷）
HERE = os.path.dirname(os.path.abspath(__file__))
SRC = sys.argv[1] if len(sys.argv) > 1 else os.path.join(HERE, 'pdftool_test', 'input.pdf')
OUT = sys.argv[2] if len(sys.argv) > 2 else os.path.join(HERE, 'pdf_preview', 'split_verify.pdf')
if not os.path.exists(SRC):
    sys.exit('找不到输入文件: %s' % SRC)
os.makedirs(os.path.dirname(OUT), exist_ok=True)

def detect_cols(w, h):
    r = w / h
    # 2栏: 每栏A4纵向比例0.707 -> 整页比例 ~1.414
    # 3栏: 整页比例 ~2.121
    if r >= 1.85:
        return 3
    if r >= 1.2:
        return 2
    return 1

src = pymupdf.open(SRC)
out = pymupdf.open()
A4 = pymupdf.paper_rect('a4')  # 595 x 842
MARGIN = 12

for pno in range(src.page_count):
    page = src[pno]
    r = page.rect
    n = detect_cols(r.width, r.height)
    cw = r.width / n
    for k in range(n):
        clip = pymupdf.Rect(r.x0 + k * cw, r.y0, r.x0 + (k + 1) * cw, r.y1)
        np = out.new_page(width=A4.width, height=A4.height)
        avail_w = A4.width - 2 * MARGIN
        avail_h = A4.height - 2 * MARGIN
        s = min(avail_w / clip.width, avail_h / clip.height)
        w = clip.width * s
        h = clip.height * s
        x0 = (A4.width - w) / 2
        y0 = (A4.height - h) / 2
        target = pymupdf.Rect(x0, y0, x0 + w, y0 + h)
        np.show_pdf_page(target, src, pno, clip=clip)

out.save(OUT, garbage=4, deflate=True)
print('pages out:', out.page_count)
print('saved:', OUT)
src.close(); out.close()
