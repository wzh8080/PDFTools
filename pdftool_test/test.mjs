import { PDFDocument } from 'pdf-lib';
import fs from 'fs';

import path from 'path';
import { fileURLToPath } from 'url';

// 用法: node <本文件> [输入试卷.pdf] [输出.pdf]
// 默认读同目录下的 input.pdf（已在 .gitignore 中，不会误提交真实试卷）
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.argv[2] || path.join(HERE, 'input.pdf');
const OUT = process.argv[3] || path.join(HERE, 'test_out.pdf');
if (!fs.existsSync(SRC)) {
  console.error('找不到输入文件: ' + SRC);
  console.error('请把试卷另存为 pdftool_test/input.pdf，或用参数指定路径。');
  process.exit(1);
}

const src = await PDFDocument.load(fs.readFileSync(SRC), { ignoreEncryption: true });
const out = await PDFDocument.create();

const A4W = 595.276, A4H = 841.89, MARGIN = 12;
const srcPages = src.getPages();
const tempIdx = [];
const DO_PAGES = Math.min(2, srcPages.length);

for (let pno = 0; pno < DO_PAGES; pno++) {
  const sp = srcPages[pno];
  const { width: W, height: H } = sp.getSize();
  const ratio = W / H;
  const n = ratio >= 1.85 ? 3 : ratio >= 1.2 ? 2 : 1;
  const cw = W / n;

  for (let k = 0; k < n; k++) {
    const [tp] = await out.copyPages(src, [pno]);
    out.addPage(tp);
    tempIdx.push(out.getPageCount() - 1);
    const clipX = k * cw;
    tp.setMediaBox(clipX, 0, cw, H);
    tp.setCropBox(clipX, 0, cw, H);
    const [emb] = await out.embedPages([tp]);
    const np = out.addPage([A4W, A4H]);
    const availW = A4W - 2 * MARGIN, availH = A4H - 2 * MARGIN;
    const s = Math.min(availW / cw, availH / H);
    const dw = cw * s, dh = H * s;
    const x0 = (A4W - dw) / 2, y0 = (A4H - dh) / 2;
    np.drawPage(emb, { x: x0, y: y0, width: dw, height: dh });
  }
}

tempIdx.sort((a, b) => b - a);
for (const i of tempIdx) out.removePage(i);

const outBytes = await out.save();
fs.writeFileSync(OUT, outBytes);
console.log('done, out pages =', out.getPageCount(), 'size KB =', Math.round(outBytes.length / 1024));
