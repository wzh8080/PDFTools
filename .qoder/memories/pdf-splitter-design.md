---
title: "pdf-splitter 设计事实（分栏模型 / 旋转 / 原生桥接 / 界面规约）"
category: project_architecture
updated: 2026-10-01
---

本文件是 `pdf-splitter/`（Web 本体）+ `android/`（WebView 壳）的设计口径，
所有条目均已对照当前源码核实（`app.js` / `index.html` / `MainActivity.kt`），不是历史叙述。

## 定位与技术栈

本地离线 PDF 切分工具：把 A3/A4 拼版试卷（横排 2/3 栏）切成「一页一题」标准 A4 PDF。
前端零构建、纯 `index.html` + `app.js`，依赖 `pdf.js`（渲染预览）与 `pdf-lib`（改写 PDF），
两份库都本地化在 `pdf-splitter/lib/`，无 CDN、无网络依赖。原生壳是 Kotlin + WebView，
`minSdk = 29`（Android 10+），负责文件选择、MediaStore 写入、FileProvider 分享。
`applicationId = com.pdfsplitter.app`，debug 变体带 `applicationIdSuffix = ".debug"`，
所以 debug 包与已装 release 包可在同一台设备上并存，真机验证一律用 debug 包。

## 分栏模型：每页任意分割线

- `state.cuts[i]` = 第 i 页**内部边界**占页宽的比例数组；栏数 = `cuts.length + 1`。
- `bandsFor(i, W, H)`（`app.js:58`）由 `cuts` + 全局 `state.shift` 统一算出各栏像素矩形，
  预览与切分共用这一份，坐标才可能一致。改任何切分几何都必须走它，不要另算。
- `cutsFor(i)`：`state.cuts[i]` 未设置时按当前模式给默认；`auto` 模式在检测完成前**暂按 2 栏**。
- 三种来源：①固定按钮「左右 2 栏 / 左右 3 栏」→ `applyEqualCuts(n)` 把所有页铺成等分（点一次即覆盖手拖）；
  ②「智能识别」→ `detectAllCols()` 逐页 `analyzeCuts()` 写 `state.cuts`；
  ③预览每页分割线上的 `.cut-grip` 把手横向拖动，只改该页该边界（全局 `shift` 仍叠加）。
- 打开文件 / 换文件：清空 `state.cuts` 与 `state.userRot`，并 `setMode('2')` 回到「左右 2 栏」。

### 内容检测的实际阈值（`detectCutsFromCanvas`）

检测用位图宽约 420 px（`scale = min(1, 420/页宽)`），逐列统计墨迹像素数 `colInk`，
然后**两路证据各算一遍再合并**（旧实现是"找到竖线就短路"，会整条丢掉没印线的边界）：

1. **竖线候选**：`colInk[x] >= h × 0.75` 才算竖线列；成段后要求段宽 `<= max(3, w × 0.03)`
   且段中心落在页宽 **0.12 – 0.88** 内（排除页面左右外框），取段中心。
   阈值 0.75 是实测分界：真印刷分隔线纵向覆盖率接近 1，而**左对齐正文每行同一起点，
   首字符列覆盖率约 0.5** —— 旧值 0.45 会把文字边缘认成分隔线，导致三栏只画一条挤在一起的线、
   两栏被多切成三栏。
2. **空白沟候选（决定栏数）**：`colInk[x] > max(2, h × 0.012)` 记为有墨列；相邻区段间隙
   `< max(4, w × 0.02)` 合并；宽度 `< w × 0.03` 的碎段丢弃；每个沟取中点为切点，
   但若沟内（左右各放 **1.5% 容差**，因为印刷线常正好压在墨迹带边上）存在竖线，
   **切点吸附到竖线位置**，比沟中心准。
3. **窄边条并入**：首或尾区段宽度 `< 总墨迹跨度 × 0.16` 时删掉那个切点（姓名/班级不单独成页）。
4. **合并与上限**：两路候选按位置排序，相距 `< 3%` 页宽视为同一条（竖线位置优先，
   但被合并的一方若来自空白沟，该位置仍记为"有内容块证据"）；超过两条时
   **优先保留有内容块证据的两条**，否则退化为取相距最远的两条。
   上限由 `MAX_CUTS = 2` 表示，即**最多 3 栏**。
5. `analyzeCuts` 内部 `try/catch` + 外层 `.catch` 都回落到 `detectCols()` 比例启发，保证不 reject。

> 修正一处旧表述：**宽高比判据并没有被删除**，`detectCols(W,H)`（`r>=1.85→3 / r>=1.2→2 / 否则 1`）
> 仍在，只是降级为「渲染或取像素失败时的兜底」。它作为主判据的缺陷（同尺寸 2 栏与 3 栏比值相同）
> 才是引入内容检测的原因。

## 旋转校正：手动为主，保留 `/Rotate` 烘焙

- 预览每页**左右各一个**按钮：左上 `.pv-rot-l` `data-rot="270"`（逆时针）、
  右上 `.pv-rot-r` `data-rot="90"`（顺时针）；另有 `#btn-rot-all-left` / `#btn-rot-all-right`
  整篇一次转 90°。两者共用同一个 `state.userRot` 数组，整篇转后仍可单页微调。
- 按钮上**不显示度数角标**，朝向由预览画面本身体现；也不显示「页面方向不对？点…」提示行。
- 每页总角度 = `(声明 /Rotate + state.userRot[i]) % 360`。
- 读 `/Rotate` 必须用 `page.node.getInheritableAttribute(PDFName.of('Rotate'))`（沿整条父链递归），
  手动遍历 `Parent()` 只查一级会漏深层继承。
- **重存判据是并集**：只要某页 `声明 /Rotate ≠ 0` **或** `userRot ≠ 0` 就重存，
  即使合成后净角度为 0（例如声明 90 + 用户 270）。原因见 `pdf-splitter-pitfalls.md`。
- 每次交互都从原始 `ArrayBuffer` 重新 load + 重建工作字节，因此幂等、不随点击累积失真；
  预览与 `process()` 消费同一份已烘焙字节，`process` / `trim` 不需要感知旋转。
- 不做基于图像内容的方向自动检测（开销大且易误判），这是产品决定，不是遗漏。

## 原生桥接 PdfShell：三个方法语义不等价

`MainActivity.kt` 内 `PdfShell`：

| 方法 | 行为 | 是否产生用户可见文件 |
|---|---|---|
| `save()` | `exportToDownloads()` 写入设备「下载/试卷切分」，成功后回调 JS 侧 `__onPdfSaved(uri)` | ✅ 唯一落盘入口 |
| `share()` | 字节只写 `cacheDir/out`，再经 FileProvider 拉起系统分享 | ❌ 不写下载目录 |
| `open()` | `ACTION_VIEW` 打开**先前 `save()` 返回的 uri** | ❌ 依赖 save |
| `begin/chunk/process/end` | 把 Web 侧字节分块送进原生缓冲，供 save/share 消费 | ❌ |

前端不变量：`process()`（点「开始切分」）只生成 `state.resultBytes` + blob 并显示结果卡，
**从不调用 `PdfShell.save()`**；`begin/chunk/save` 序列要等用户点「下载」才发生。
所以「切分完成 ≠ 已保存」「分享 ≠ 保存」。2026-09-30 据此核查，用户「切分完成即自动保存、
按钮改成查看文件+分享」的前提不成立，**决定不改行为**（方案已列，见 deferred-decisions）。
另：Web 浏览器无静默落盘能力，非用户手势触发的自动下载常被拦截，自动保存只能在原生侧生效。

## 界面规约（现状态，改 UI 前对照）

- 分栏区第一行「左右 2 栏 / 左右 3 栏」，第二行整宽「智能识别」；**没有**「不切分」也**没有**旧「自动识别」。
- 分割线控件（每页独立，均只作用于该页 `state.cuts[i]`）：
  - 线上端 `.cut-lbl` 显示编号 `k`（1 起），线下端 `.cut-del` 是**真 `<button>`** 的垃圾桶图标，
    17×15px 与编号标签同量级、`::after` 把触摸热区外扩 6px，点击 `splice(k-1,1)` 删除该线；
    编号与页数由 `updateOverlays()` 重渲染自动重排。
  - 页右下角 `.pv-add` 红色加号：在**当前最宽那一栏**的正中插入一条线；已有 2 条线时按钮 `disabled`。
  - 两者都要求 `cuts.length <= MAX_CUTS(2)`，即最多 3 栏。
  - `.cut-line` 用 `margin-left:-1px` 而不是 `transform` 居中：`transform` 会生成层叠上下文，
    把 `.cut-del` 压在 `.pv-add` 之下（线拖到 96% 时点不到删除）。现由 `.cut-del` 的 `z-index:4`
    高于 `.pv-add` 的 3 保证删除优先。
  - `pointerdown` 命中 `.cut-del` 时直接 return，不进入把手拖动。
- 手动删/加使实际栏数与 `state.mode` 的固定值不符时，`updateOverlays()` 会**撤掉**「左右 N 栏」的
  高亮（不再出现高亮 2 栏却显示"保持 1 页"）；`auto` 模式的高亮不受影响。
- 边距（左右 / 上下）与切分线微调三个滑块，两侧各有 `−` / `+` 步进按钮，点一次动一个单位，
  改值后 `dispatch input` 复用既有 handler，保证数值、标签、预览三者同步并钳制在 min/max。
- 任何改动 `state.cuts` 的路径（拖动、删除、新增、换模式、`pointercancel`）都必须调
  `resetResult()`，否则结果卡仍可下载旧字节。
- 涉及系统动作的按钮文案按实际行为措辞：只读预览用「查看文件」，不用「打开文件」。
