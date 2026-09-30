import { PDFDocument } from 'pdf-lib';
import fs from 'fs';

import path from 'path';
import { fileURLToPath } from 'url';

// 用法: node <本文件> [输入试卷.pdf] [输出.pdf]
// 默认读同目录下的 input.pdf（已在 .gitignore 中，不会误提交真实试卷）
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.argv[2] || path.join(HERE, 'input.pdf');
const OUT = process.argv[3] || path.join(HERE, 'test3_out.pdf');
if (!fs.existsSync(SRC)) {
  console.error('找不到输入文件: ' + SRC);
  console.error('请把试卷另存为 pdftool_test/input.pdf，或用参数指定路径。');
  process.exit(1);
}

const src = await PDFDocument.load(fs.readFileSync(SRC), { ignoreEncryption: true });
const out = await PDFDocument.create();

const A4W = 595.276, A4H = 841.89, MARGIN = 12;
const srcPages = src.getPages();

const embedPagesArg = [];
const bbs = [];
const infos = [];

for (let pno = 0; pno < srcPages.length; pno++) {
  const sp = srcPages[pno];
  const { width: W, height: H } = sp.getSize();
  const ratio = W / H;
  const n = ratio >= 1.85 ? 3 : ratio >= 1.2 ? 2 : 1;
  const cw = W / n;
  for (let k = 0; k < n; k++) {
    embedPagesArg.push(sp);
    bbs.push({ left: k * cw, bottom: 0, right: (k + 1) * cw, top: H });
    infos.push({ cw, H });
  }
}

// 一次批量嵌入，copier 跨所有栏复用资源
const embs = await out.embedPages(embedPagesArg, bbs);

for (let i = 0; i < embs.length; i++) {
  const emb = embs[i];
  const np = out.addPage([A4W, A4H]);
  const availW = A4W - 2 * MARGIN, availH = A4H - 2 * MARGIN;
  const s = Math.min(availW / emb.width, availH / emb.height);
  const dw = emb.width * s, dh = emb.height * s;
  const x0 = (A4W - dw) / 2, y0 = (A4H - dh) / 2;
  np.drawPage(emb, { x: x0, y: y0, width: dw, height: dh });
}

const outBytes = await out.save({ useObjectStreams: true });
fs.writeFileSync(OUT, outBytes);
console.log('out pages =', embs.length, 'size KB =', Math.round(outBytes.length / 1024));
