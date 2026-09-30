import { PDFDocument } from 'pdf-lib';
import fs from 'fs';

import path from 'path';
import { fileURLToPath } from 'url';

// 用法: node <本文件> [输入试卷.pdf] [输出.pdf]
// 默认读同目录下的 input.pdf（已在 .gitignore 中，不会误提交真实试卷）
const HERE = path.dirname(fileURLToPath(import.meta.url));
const SRC = process.argv[2] || path.join(HERE, 'input.pdf');
const OUT = process.argv[3] || path.join(HERE, 'debug.pdf');
if (!fs.existsSync(SRC)) {
  console.error('找不到输入文件: ' + SRC);
  console.error('请把试卷另存为 pdftool_test/input.pdf，或用参数指定路径。');
  process.exit(1);
}

const src = await PDFDocument.load(fs.readFileSync(SRC), { ignoreEncryption: true });
const out = await PDFDocument.create();

const { width: W, height: H } = src.getPages()[0].getSize();
const cw = W / 2;
console.log('W,H,cw =', W, H, cw);

const [tp1] = await out.copyPages(src, [0]);
const [tp2] = await out.copyPages(src, [0]);
console.log('same object?', tp1 === tp2);
out.addPage(tp1);
out.addPage(tp2);

tp1.setMediaBox(0, 0, cw, H);
tp2.setMediaBox(cw, 0, cw, H);

fs.writeFileSync(OUT, await out.save());
console.log('saved debug.pdf pages =', out.getPageCount());
