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

检测用位图宽约 420 px（`scale = min(1, 420/页宽)`），逐列统计两个量：`colInk[x]`（该列墨迹
像素数）与 `colRun[x]`（该列**最长连续**墨迹段）。然后**两路证据各算一遍再合并**
（旧实现是"找到竖线就短路"，会整条丢掉没印线的边界）：

1. **竖线候选**：`colInk >= h×0.6` **且** `colRun >= h×0.35`；成段后要求段宽 `<= max(3, w×0.03)`
   且段中心落在页宽 **0.12 – 0.88** 内（排除页面左右外框），取段中心。两个条件缺一不可：
   左对齐正文的首字符列密度能到 50% 但连续段只有 1–2% 页高；正文里竖排对齐的笔画连续段能到
   14–18% 页高但密度只有 25–44%。真卷实测印刷实线为 91–96% / 连续 53–96%。
   （历史值：先 0.45 后 0.75 的单密度判据都被真卷证伪——虚线分隔线密度只有 46–70%。）
2. **空白沟候选（决定栏数）**：`colInk > max(2, h×0.012)` 记为有墨；先做两件预处理——
   把竖线连同两侧 2px 抗锯齿边从墨迹里抹掉；**把宽度 `< max(3, w×0.015)` 的细墨列当噪声丢掉**
   （印在沟里的虚线本身只有 1–3px 宽，不丢就会和左右两栏各自粘上，整页被认成一栏）。
   之后相邻区段间隙 `< max(4, w×0.02)` 合并，但**中间隔着竖线就不许合并**（竖线是不可跨越的
   屏障：真卷分隔线离正文常常只有 3px，单靠 minGap 会直接跨过去）；宽度 `< w×0.03` 的碎段丢弃；
   每个沟取中点为切点，若沟内（左右各放 **1.5% 容差**，因为印刷线常正好压在墨迹带边上）
   存在竖线，**切点吸附到竖线位置**，比沟中心准。
3. **窄边条并入**：首或尾区段宽度 `< 总墨迹跨度 × 0.16` 时删掉那个切点（姓名/班级不单独成页）。
4. **合并与上限**：两路候选按位置排序，相距 `< 3%` 页宽视为同一条（竖线位置优先，
   但被合并的一方若来自空白沟，该位置仍记为"有内容块证据"）；超过两条时
   **优先保留有内容块证据的两条**，否则退化为取相距最远的两条。
   检测上限固定**最多 3 栏（2 条线）**，与手动加线的上限无关。
5. `analyzeCuts` 内部 `try/catch` + 外层 `.catch` 都回落到 `detectCols()` 比例启发，保证不 reject。

> **别再动 `inkT`（`h×0.012`）**：曾以为"栏边界被稀疏字角拖偏"，试着提到 3% / 5% / 8%，
> 结果是文字栏内部被切断、凭空多出假线（一页从 1 条变 2 条甚至 5 条）。实测两栏真卷 16 页，
> 切点到左右两栏墨迹边缘的距离 `dLeft` 与 `dRight` 相差 ≤ 0.6%（多数为 0.0–0.2%），
> 白沟宽 5.8–8.5% —— 线本来就在空白正中，"贴着右栏字边"的观感不是算法问题。

> **方向前提**：算法只认「竖排分栏」。A4 竖版里横放的三栏拼版（扫描件常见）必须先
> 「整篇左旋/右旋」转成横版再识别，否则整页就是一整块横带，识别成 1 栏是正确行为。
> 旋转后 `reloadPreview()` 在 `auto` 模式下会自动重跑识别（朝向变了必须重算），
> 代价是**覆盖掉该页已手拖/手删的分割线**。

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
  - 页右下角 `.pv-add` 红色加号：新线落在**最右边那一栏**（最后一条线与右页边之间）的正中，
    用户 2026-10-02 要求「从右边出来」，之前的"落在当前最宽那一栏正中"已废弃 —— 那个位置会随
    删线/拖动跳来跳去，不好预期。`state.cuts[i]` 始终升序，所以直接取末元素即可，别再 `Math.max`。
    上限
    `MAX_MANUAL_CUTS = 4`（即每页最多 5 栏）。到顶时按钮**置灰**（`addBtn.disabled`，
    由 `updateOverlays()` 每次刷新），不给文字提示——用户 2026-10-01 明确选了置灰而不是轻提示。
    注意：置灰后 click 事件不再触发，所以以后想加提示就不能置灰。
  - 智能识别的上限独立于手动上限，仍是**最多 3 栏（2 条线）**——`detectCutsFromCanvas` 里
    候选超过两条时只保留两条。手动路径与检测路径的上限不是一回事，别把它们合成一个常量。
  - 测试时用 `click({force:true})` 点已置灰的 `.pv-add` 会**穿到下层**：加号与最右那条线的
    `.cut-del` 位置重叠，删除优先，于是"点加号没反应"变成"删掉了一条线"。别把这当 bug 报。
  - `.cut-line` 用 `margin-left:-1px` 而不是 `transform` 居中：`transform` 会生成层叠上下文，
    把 `.cut-del` 压在 `.pv-add` 之下（线拖到 96% 时点不到删除）。现由 `.cut-del` 的 `z-index:4`
    高于 `.pv-add` 的 3 保证删除优先。
  - `pointerdown` 命中 `.cut-del` 时直接 return，不进入把手拖动。
- 手动删/加使实际栏数与 `state.mode` 的固定值不符时，`updateOverlays()` 会**撤掉**「左右 N 栏」的
  高亮（不再出现高亮 2 栏却显示"保持 1 页"）；`auto` 模式的高亮不受影响。
- **单页全屏层** `#pv-focus` / `#fs-holder`：每页左下角 `.pv-fs`（28px，与右下角加号对称）
  进入，右上角「退出全屏」按钮或 Esc 退出。做法是把那张 `.pv-item` **整块搬进**覆盖层，
  退出时按 `it.fsNext` 插回原位，所以：
  - `updateOverlays()` 必须遍历 `previewItems` 而不是 `pvGrid.querySelectorAll('.pv-item')`，
    否则项被搬走后按下标取节点会错位；
  - 拖动与点击的委托事件要同时挂在 `pvGrid` 和 `fsHolder` 上（`onPreview()`），
    否则在全屏层里拖不动；
  - `buildPreview()` 开头记下 `fsItem.idx`、`exitFocus()`、建完再 `enterFocus(idx)`，
    这样旋转/重建预览后全屏层继续盯着同一页；
  - **不要用原生 Fullscreen API**：WebView 里 `requestFullscreen` 不可靠，且它的
    `fullscreenchange` 事件会和"重建后重新进入"抢状态，把焦点弄丢（实测踩过）。覆盖层
    `position:fixed;inset:0` 本身已经铺满视口。
  - **双指缩放只在这一层开**：`setPinch(on)` 同时切两层闸门 —— 原生 `WebSettings.supportZoom`
    （走 `PdfShell.setZoom`）和 viewport meta 的 `user-scalable/maximum-scale`。必须两层都切：
    新版 Chromium 出于无障碍策略会**忽略** `user-scalable=no`，真闸门是 `supportZoom`；
    而 `supportZoom=false` 时 WebView 干脆无视整个 viewport meta。默认态是**全局禁缩放**
    （`MainActivity` 里 `setSupportZoom(false)` + meta 带 `maximum-scale=1, user-scalable=no`）。
    退出时把 meta 收回 `maximum-scale=1`，Chromium 会把已放大的比例**夹回 1**（实测 2.03 → 1），
    所以不会留下"退出全屏页面还是放大着又缩不回去"的状态。`exitFocus('rebuild')` 分支**不关**缩放，
    紧接着的 `enterFocus(i, true)` 复用同一条记录；整篇旋转后实测仍停在原页且仍可双指放大。
    之前"有时能有时不能"的原因：meta 里从来没有 `user-scalable=no`、WebView 的 `supportZoom`
    又默认 true，所以缩放一直是全局开着的；能不能触发只取决于两指落在哪儿 —— 落在
    `.cut-handle`（`touch-action:none`）或按钮上时手势被拖拽/点击逻辑吃掉，就不放大。
  - **退出按钮要跟着视觉视口走**：`position:fixed` 是相对*布局*视口定位的，手机上双指缩放后
    工具条会跟内容一起飘。解法：监听 `visualViewport` 的 `resize`/`scroll`，把 `#fs-bar`
    `translate(offsetLeft, offsetTop)` 顶回屏幕角（`pinFsBar()`），退出时清 transform 与监听。
  - **手机返回键先关全屏层而不是退出应用**：原生侧 `MainActivity` 已有
    `onBackPressedDispatcher.addCallback { if (webView.canGoBack()) goBack() else finish() }`，
    所以 JS 只需进全屏时 `history.pushState({pvfs:1})` + 监听 `popstate` 调 `exitFocus('pop')`。
    三条路径的历史必须分清：用户点退出/Esc → `exitFocus()` 自己 `history.back()` 弹掉那条记录；
    重建预览（旋转等）→ `exitFocus('rebuild')` 后 `enterFocus(i, true)` **复用同一条**，
    否则每转一次多压一条、返回键要按好几次才退得掉。实测：进入 +1 条、旋转后仍 1 条、
    返回后关层且 16 页预览仍在原位。
- **智能识别有进度**：`detectAllCols()` 复用底部操作栏的进度条（`setProgress` / `clearProgress`），
  文案「正在识别 n / N 页…」，按每页 `analyzeCuts` 完成数递增；识别期间给 `<body>` 加
  `busy-lock` 类，CSS 把配置卡、整篇旋转按钮、分割线把手、加号、全屏按钮一律
  `pointer-events:none` + 降透明度，`#btn-process` 走原生 `disabled`。
  原因是 `state.cuts` 逐页写入，中途改参数或点切分会把还没测完的页当 1 栏切掉。
  结束必须同时 `clearProgress()` + 去掉 `busy-lock` + 恢复按钮。
- 边距（左右 / 上下）与切分线微调三个滑块，两侧各有 `−` / `+` 步进按钮，点一次动一个单位，
  改值后 `dispatch input` 复用既有 handler，保证数值、标签、预览三者同步并钳制在 min/max。
  上下边距出厂默认 10、范围 0–20（和左右边距一致）。
  三条滑块收在 `<details id="adv-box">`（标题「参数调整」）里，**默认收起**，配置卡只留分栏方式 + 白边开关。
  验证折叠是否真生效**不能看 `getClientRects()`**：Chrome 收起的 details 内容仍留有陈旧 rect
  （实测 `display:block`、rect 有值，但 `elementFromPoint` 命中的是别的元素）；要量 `details` 自身高度
  或用 `elementFromPoint` 反查。折叠态下 `applyCfgToSliders()` 改 `min/max/value` 照常生效。
- **滑块只跟拇指走**：原生 `range` 一碰轨道就跳到该位置，手机上误触即改值。解法 `onThumb()` 按
  当前值算出拇指中心（触点宽 24px、留 20px 容差），落在外面就 `preventDefault`。必须同时挂
  `pointerdown` / `mousedown` / `touchstart` 三种事件并都带 `{passive:false}`：鼠标流里
  `preventDefault(pointerdown)` **不会**顺带取消 `mousedown`，只挂一个必然漏。代价是手指若在
  轨道上起手想滑动页面会被吞掉，从别处滑即可，用户明确要求过这个取舍。
- **默认值设置面板**：标题栏右侧齿轮 `#btn-settings` → 底部抽屉 `#settings`（`.sheet` +
  `.sheet-mask`，`body.sheet-on` 锁滚动），可配左右/上下边距的默认值与上下限、以及分栏方式默认值。
  持久化在 `localStorage['pdfsplitter.settings']`，读出后**必须**过一遍 `normalizeCfg()`：
  每项钳到 0–60、保证 `min ≤ def ≤ max`（`def` 越界落回区间端点）、`mode` 只认 `2`/`3`/`auto`，
  其余一律回落 `2`。坏 JSON 直接当 `{}` 处理，不让设置面板把整个应用带崩。
  - `applyCfgToSliders()` 同时改滑块 `min/max/value` 与 `state.marginX/Y`，启动时和每次保存后都要跑；
  - `saveSettings()` 保存后立刻 `fillCfgForm()` 回填**纠正过**的值，让用户看到实际生效的数；
  - 已有预览时改默认值要即时反映：按新 `mode` 走 `setMode()`，`auto` 则 `detectAllCols()`，
    否则 `applyEqualCuts()` + `updateOverlays()` + `resetResult()`；
  - `恢复默认` 是删掉 `localStorage` 键再走一遍 normalize，不是把面板填成出厂值；
  - 分栏方式默认值只在 `loadFile()` 时应用（新文件/换文件回到默认），拖动、加删线等本地操作不回卷；
  - Esc 优先级：设置面板 > 全屏层。
  - 三行配置**必须一行放下**（用户明确否掉过换行）：`.set-row` 用 `flex-wrap:nowrap`，
    `.set-lab` 固定 82px + `white-space:nowrap`（要容得下最长的「默认分栏方式」），
    `.set-f` 给 `flex:1;min-width:0`，数字输入 `appearance:textfield` 并隐藏 webkit spin button
    （不隐藏的话箭头会吃掉宽度）。393 CSS px（小米 10 实际宽度）下三个输入各 39px，实测不溢出。
- 预览画布外圈用 `box-shadow: 0 0 0 1px #d7deea` 而不是 `border`：`border` 会占 1px 盒尺寸，
  让画布内容与分割线的百分比坐标错位；阴影不改变布局，正好只做视觉分隔（非全屏时页脚的
  「原第 N 页 / 切出 N 页」灰块和试卷纸几乎分不开）。
- 任何改动 `state.cuts` 的路径（拖动、删除、新增、换模式、`pointercancel`）都必须调
  `resetResult()`，否则结果卡仍可下载旧字节。
- 涉及系统动作的按钮文案按实际行为措辞：只读预览用「查看文件」，不用「打开文件」。
