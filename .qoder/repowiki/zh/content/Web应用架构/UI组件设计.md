# UI组件设计

<cite>
**本文引用的文件**   
- [index.html](file://pdf-splitter/index.html)
- [app.js](file://pdf-splitter/app.js)
- [README.md](file://README.md)
</cite>

## 更新摘要
**变更内容**   
- 新增交互式分割线手柄功能，支持可拖拽调整切分位置
- 添加 .cut-grip 类用于视觉反馈，包含圆形握把指示器
- 实现光标样式（cursor:ew-resize）和触摸动作配置（touch-action:none）
- 增强分割线手柄的视觉效果，包括阴影效果和背景适配

## 目录
1. [引言](#引言)
2. [项目结构](#项目结构)
3. [核心组件](#核心组件)
4. [架构总览](#架构总览)
5. [详细组件分析](#详细组件分析)
6. [依赖关系分析](#依赖关系分析)
7. [性能与渲染特性](#性能与渲染特性)
8. [样式与DOM操作规范](#样式与dom操作规范)
9. [故障排查指南](#故障排查指南)
10. [结论](#结论)

## 引言
本文件面向Web前端UI设计与实现，聚焦基于HTML/CSS的前端界面架构与JavaScript交互逻辑。该应用是一个"试卷切分助手"，把A3/A4拼版PDF按栏切分为标准A4页面，并在浏览器或Android WebView中离线运行。文档重点解释以下方面：
- 文件选择界面、参数配置面板、实时预览网格、结果展示卡片的设计模式
- DOM操作管理策略，包括事件监听器的绑定与解绑机制
- 响应式布局方案，包括aspect-ratio保持预览比例、flexbox自适应排列
- 用户交互流程，包括拖拽/点击上传、滑块调节、按钮点击、**可拖拽分割线手柄**的统一处理
- CSS样式规范与JavaScript DOM操作最佳实践示例（以路径引用代替具体代码）

## 项目结构
Web本体位于`pdf-splitter/`，包含入口HTML、主脚本以及本地化的pdf.js与pdf-lib库；Android壳工程负责WebView桥接与系统能力补充。

```mermaid
graph TB
subgraph "Web层"
HTML["index.html<br/>结构与内联样式"]
JS["app.js<br/>状态、交互、渲染、导出"]
PDFJS["lib/pdf.min.js<br/>解析与预览"]
PDFLIB["lib/pdf-lib.min.js<br/>裁剪与生成"]
end
subgraph "原生壳层"
ACTIVITY["MainActivity.kt<br/>WebView + PdfShell桥"]
MANIFEST["AndroidManifest.xml<br/>权限与queries"]
end
HTML --> JS
JS --> PDFJS
JS --> PDFLIB
ACTIVITY --> HTML
ACTIVITY --> JS
```

**图表来源**
- [index.html:1-12](file://pdf-splitter/index.html#L1-L12)
- [index.html:284-286](file://pdf-splitter/index.html#L284-L286)
- [app.js:1-11](file://pdf-splitter/app.js#L1-L11)
- [README.md:13-22](file://README.md#L13-L22)

**章节来源**
- [README.md:13-22](file://README.md#L13-L22)

## 核心组件
- 文件选择区：支持点击触发隐藏input[type=file]，并显示已选文件信息
- 参数配置面板：分栏模式选择、左右/上下边距滑块、**可拖拽切分线微调**、白边裁剪开关
- 实时预览网格：每页一个卡片，使用aspect-ratio保持比例，叠加**带可拖拽手柄的切分线**与标签
- 结果展示卡片：完成提示、下载/分享按钮、保存路径与查看文件入口
- 底部固定操作栏：进度条与"开始切分/更换文件"按钮

这些组件通过CSS变量统一主题色、圆角、阴影等视觉风格，并通过hidden属性控制显隐。

**章节来源**
- [index.html:14-141](file://pdf-splitter/index.html#L14-L141)
- [index.html:161-282](file://pdf-splitter/index.html#L161-L282)

## 架构总览
整体交互由HTML提供结构，app.js管理状态与事件，pdf.js用于解析与预览，pdf-lib用于裁剪与输出。Android壳在需要时接管文件选择与结果保存/分享。

```mermaid
sequenceDiagram
participant U as "用户"
participant H as "index.html"
participant J as "app.js"
participant PJS as "pdf.js"
participant PLIB as "pdf-lib"
participant SHELL as "PdfShell(原生)"
U->>H : 点击选择文件
H->>J : 触发fileInput.change
J->>PLIB : load(ArrayBuffer)
J->>PJS : getDocument(bytes)
J->>J : normalizeRotation()
J->>J : buildPreview()
U->>H : 调整滑块/模式
H->>J : input/change事件
J->>J : updateOverlays()/resetResult()
U->>H : **拖拽分割线手柄**
H->>J : pointerdown/move/up事件
J->>J : 更新cuts数组
U->>H : 点击开始切分
H->>J : process()
J->>PLIB : embedPages/drawPage/save
J->>J : 生成Blob/ObjectURL
J->>H : 显示结果卡片
alt Android壳可用
J->>SHELL : begin/chunk/save/share
else 浏览器
J->>H : 触发下载/分享
end
```

**图表来源**
- [app.js:195-239](file://pdf-splitter/app.js#L195-L239)
- [app.js:265-361](file://pdf-splitter/app.js#L265-L361)
- [app.js:412-508](file://pdf-splitter/app.js#L412-L508)
- [app.js:530-552](file://pdf-splitter/app.js#L530-L552)

## 详细组件分析

### 文件选择界面
- 设计模式：外层dropzone作为可点击区域，内部隐藏真实input[type=file]，避免原生样式差异
- 交互流程：点击dropzone触发fileInput.click；change事件中校验类型、读取ArrayBuffer、加载PDF、归一化旋转、打开文档、构建预览
- DOM管理：通过id选择器集中获取节点，统一更新card-file/card-config/card-preview/action-bar的hidden状态

```mermaid
flowchart TD
Start(["进入loadFile"]) --> Validate["校验文件类型"]
Validate --> |非法| Alert["提示请选择PDF"]
Validate --> |合法| Reset["重置结果与UI状态"]
Reset --> ReadAB["读取ArrayBuffer"]
ReadAB --> LoadLib["pdf-lib.load(ArrayBuffer)"]
LoadLib --> Normalize["normalizeRotation()"]
Normalize --> OpenDoc["pdf.js.getDocument(bytes)"]
OpenDoc --> BuildPrev["buildPreview()"]
BuildPrev --> ShowUI["显示文件信息与配置/预览/操作栏"]
Alert --> End(["结束"])
ShowUI --> End
```

**图表来源**
- [app.js:204-239](file://pdf-splitter/app.js#L204-L239)

**章节来源**
- [index.html:163-192](file://pdf-splitter/index.html#L163-L192)
- [app.js:195-239](file://pdf-splitter/app.js#L195-L239)

### 参数配置面板
- 分栏模式：segmented按钮组，active类切换当前模式，影响colsFor计算与预览切分线
- 边距滑块：左右/上下边距分别对应marginX/marginY，单位mm，影响最终A4缩放与留白
- **可拖拽切分线微调**：shift百分比偏移，影响预览切分线与实际裁剪位置，现在支持直接拖拽调整
- 白边裁剪：checkbox默认关闭，localStorage持久化用户选择；开启后逐栏扫描墨迹最小矩形

```mermaid
classDiagram
class ConfigState {
+string mode
+number marginX
+number marginY
+number shift
+boolean trim
}
class UIControls {
+seg-mode按钮组
+margin-x-range滑块
+margin-y-range滑块
+shift-range滑块
+trim-chk复选框
+可拖拽分割线手柄
}
ConfigState <.. UIControls : "双向同步"
```

**图表来源**
- [index.html:194-220](file://pdf-splitter/index.html#L194-L220)
- [app.js:363-399](file://pdf-splitter/app.js#L363-L399)

**章节来源**
- [index.html:194-220](file://pdf-splitter/index.html#L194-L220)
- [app.js:363-399](file://pdf-splitter/app.js#L363-L399)

### 实时预览网格
- 布局：pv-grid为纵向flex容器，每个pv-item包含pv-wrap与pv-foot
- 比例保持：pv-wrap使用aspect-ratio=页面宽高比，canvas宽度100%、高度auto
- **增强的切分线系统**：cut-layer绝对定位覆盖整个pv-wrap，动态插入cut-line与cut-lbl，**新增可拖拽的cut-handle和cut-grip元素**
- 懒渲染：IntersectionObserver观察可见项，state.busy时让路给处理任务，完成后补渲染

**更新** 新增了交互式分割线手柄功能，允许用户直接拖拽调整切分位置

```mermaid
flowchart TD
Init["buildPreview()"] --> CreateItems["创建pv-item与canvas"]
CreateItems --> SetAR["设置aspect-ratio=W/H"]
SetAR --> UpdateOverlay["updateOverlays()绘制切分线与手柄"]
UpdateOverlay --> Observe["IntersectionObserver.observe()"]
Observe --> RenderVisible{"是否可见且未渲染?"}
RenderVisible --> |是| RenderItem["renderItem()栅格化"]
RenderVisible --> |否| Wait["等待滚动进入视口"]
RenderItem --> MarkPainted["it.painted=true供裁白边复用"]
MarkPainted --> DragHandle["用户拖拽分割线手柄"]
DragHandle --> UpdateCuts["更新state.cuts数组"]
UpdateCuts --> RefreshOverlay["重新渲染切分线"]
```

**图表来源**
- [index.html:92-103](file://pdf-splitter/index.html#L92-L103)
- [app.js:265-329](file://pdf-splitter/app.js#L265-L329)
- [app.js:488-543](file://pdf-splitter/app.js#L488-L543)

**章节来源**
- [index.html:92-103](file://pdf-splitter/index.html#L92-L103)
- [app.js:265-329](file://pdf-splitter/app.js#L265-L329)
- [app.js:488-543](file://pdf-splitter/app.js#L488-L543)

### 结果展示卡片
- 内容：成功图标、统计文案、下载/分享按钮、查看文件按钮、保存路径提示
- 行为：process成功后显示卡片并滚动到底部；根据环境决定是否调用PdfShell桥
- 资源释放：resetResult中撤销ObjectURL并清理按钮状态

```mermaid
sequenceDiagram
participant J as "app.js"
participant H as "index.html"
participant S as "PdfShell(可选)"
J->>J : out.save() -> bytes
J->>J : Blob + ObjectURL
J->>H : card-result.hidden=false
J->>H : scrollTo(0, body.scrollHeight)
alt 壳可用
J->>S : save()/share()
else 浏览器
J->>H : 触发下载链接或navigator.share
end
```

**图表来源**
- [app.js:479-508](file://pdf-splitter/app.js#L479-L508)
- [app.js:530-552](file://pdf-splitter/app.js#L530-L552)

**章节来源**
- [index.html:231-264](file://pdf-splitter/index.html#L231-L264)
- [app.js:479-508](file://pdf-splitter/app.js#L479-L508)
- [app.js:530-552](file://pdf-splitter/app.js#L530-L552)

### 底部固定操作栏
- 作用：常驻底部，提供进度条与"开始切分/更换文件"按钮
- 状态：ab-prog在process开始时显示，完成后隐藏；按钮在busy期间禁用并显示旋转动画

```mermaid
flowchart TD
Click["点击开始切分"] --> Busy["state.busy=true"]
Busy --> ShowProg["ab-prog.on显示进度"]
ShowProg --> DisableBtn["btn-process.disabled=true"]
DisableBtn --> Process["embedPages/drawPage/save"]
Process --> ClearProg["clearProgress()"]
ClearProg --> EnableBtn["恢复按钮文本"]
```

**图表来源**
- [index.html:126-134](file://pdf-splitter/index.html#L126-L134)
- [app.js:401-410](file://pdf-splitter/app.js#L401-L410)
- [app.js:412-508](file://pdf-splitter/app.js#L412-L508)

**章节来源**
- [index.html:126-134](file://pdf-splitter/index.html#L126-L134)
- [app.js:401-410](file://pdf-splitter/app.js#L401-L410)

## 依赖关系分析
- pdf.js：负责解析PDF与渲染到Canvas，提供viewport与getDocument API
- pdf-lib：负责创建新PDF、嵌入页面、裁剪区域、保存到字节流
- app.js：协调两者，管理状态、DOM、事件与进度反馈
- index.html：定义结构、样式与静态资源引入

```mermaid
graph LR
HTML["index.html"] --> JS["app.js"]
JS --> PJS["pdf.js"]
JS --> PLIB["pdf-lib"]
JS --> Shell["PdfShell(可选)"]
```

**图表来源**
- [index.html:284-286](file://pdf-splitter/index.html#L284-L286)
- [app.js:1-11](file://pdf-splitter/app.js#L1-L11)
- [app.js:566-576](file://pdf-splitter/app.js#L566-L576)

**章节来源**
- [README.md:22-22](file://README.md#L22-L22)
- [app.js:1-11](file://pdf-splitter/app.js#L1-L11)

## 性能与渲染特性
- 旋转归一化：对带/Rotate的页面进行烘焙，确保预览与裁剪坐标一致，避免横倒输出
- 白边裁剪：将每栏渲染为位图，扫描有墨迹的最小矩形作为裁剪框；若检测不到墨迹则退回整栏
- 预览复用：已渲染的Canvas可直接复用，避免重复栅格化，显著降低耗时
- 懒加载：IntersectionObserver仅渲染可见项，减少首屏压力
- 进度反馈：分段setProgress与tick让长任务不阻塞UI
- **拖拽优化**：使用pointer events统一处理鼠标和触摸事件，避免重复绑定

优化建议：
- 大文件分批处理：当前一次性嵌入所有页面，内存峰值偏高；可按批嵌入并逐步save
- 预取下一页：在滚动接近阈值时提前渲染下一张，提升流畅度
- 裁剪缓存：对相同尺寸与参数的页面缓存裁剪框，避免重复扫描

**章节来源**
- [app.js:57-103](file://pdf-splitter/app.js#L57-L103)
- [app.js:105-193](file://pdf-splitter/app.js#L105-L193)
- [app.js:288-329](file://pdf-splitter/app.js#L288-L329)
- [README.md:77-90](file://README.md#L77-L90)

## 样式与DOM操作规范

### CSS样式规范
- 使用CSS变量统一管理颜色、圆角、阴影等主题值，便于扩展与维护
- 使用flexbox与grid组织布局，保证在不同屏幕下的自适应
- 使用aspect-ratio保持预览卡片比例，配合canvas width:100%;height:auto实现等比缩放
- 使用hidden属性控制模块显隐，避免频繁display切换带来的重排开销
- 使用过渡与动画增强交互反馈，如按钮active态、进度条填充动画
- **分割线手柄样式**：.cut-handle启用指针事件和水平调整光标，.cut-grip提供圆形握把指示器，包含白色边框和阴影效果

参考路径：
- [index.html:14-141](file://pdf-splitter/index.html#L14-L141)
- [index.html:103-106](file://pdf-splitter/index.html#L103-L106)

### DOM操作最佳实践
- 集中获取DOM节点：通过id选择器在初始化阶段缓存，避免重复查询
- 事件委托与就近匹配：如segmented按钮组使用closest('button')精准定位目标
- 状态驱动视图：变更state后调用updateOverlays/resetResult等方法统一刷新UI
- 资源释放：在resetResult中撤销ObjectURL，避免内存泄漏
- 异步协作：使用tick让出时间片，避免长任务阻塞渲染；IntersectionObserver与state.busy协同控制渲染时机
- **拖拽事件管理**：使用pointerdown/move/up事件统一处理鼠标和触摸输入，dragCtx对象管理拖拽上下文

参考路径：
- [app.js:30-55](file://pdf-splitter/app.js#L30-L55)
- [app.js:363-399](file://pdf-splitter/app.js#L363-L399)
- [app.js:517-543](file://pdf-splitter/app.js#L517-L543)
- [app.js:554-564](file://pdf-splitter/app.js#L554-L564)

### 响应式布局实现要点
- 主体最大宽度限制与居中：wrap.max-width与margin:0 auto
- 顶部工具栏与卡片间距：topbar.inner与main.gap
- 预览网格纵向排列：pv-grid.flex-direction:column
- 底部操作栏固定定位：action-bar.position:fixed与safe-area适配
- **移动端适配**：touch-action:none防止触摸冲突，cursor:ew-resize提供桌面端视觉反馈

参考路径：
- [index.html:38-51](file://pdf-splitter/index.html#L38-L51)
- [index.html:92-103](file://pdf-splitter/index.html#L92-L103)
- [index.html:126-134](file://pdf-splitter/index.html#L126-L134)
- [index.html:105-106](file://pdf-splitter/index.html#L105-L106)

### 新增：交互式分割线手柄系统

**更新** 新增了完整的可拖拽分割线手柄功能，提供更直观的切分线调整体验。

#### 视觉设计
- **cut-handle类**：启用指针事件接收器，设置水平调整光标(cursor:ew-resize)，禁用触摸动作(touch-action:none)
- **cut-grip类**：圆形握把指示器，26px直径，红色背景(#ef4444)，白色边框，阴影效果确保在各种背景下的可见性
- **定位策略**：使用absolute定位，垂直居中(top:50%)，水平对齐到分割线位置(left:0)

#### 交互逻辑
- **事件捕获**：pointerdown事件检测.cut-handle元素，记录拖拽上下文(dragCtx)
- **实时反馈**：pointermove事件实时更新分割线位置，clamp函数确保边界约束
- **状态同步**：拖拽过程中更新state.cuts数组，调用updateOverlays()重新渲染
- **移动适配**：pointercancel事件处理取消情况，确保状态一致性

```mermaid
flowchart TD
PointerDown["pointerdown事件"] --> CheckHandle{"是否点击cut-handle?"}
CheckHandle --> |是| InitDrag["初始化dragCtx上下文"]
CheckHandle --> |否| Ignore["忽略事件"]
InitDrag --> PointerMove["pointermove事件"]
PointerMove --> CalcPosition["计算新位置"]
CalcPosition --> ClampBounds["边界约束检查"]
ClampBounds --> UpdateCut["更新state.cuts数组"]
UpdateCut --> RefreshUI["调用updateOverlays()"]
RefreshUI --> PointerUp["pointerup事件"]
PointerUp --> Cleanup["清理dragCtx"]
Cleanup --> ResetResult["重置结果状态"]
```

**图表来源**
- [app.js:517-543](file://pdf-splitter/app.js#L517-L543)

**章节来源**
- [index.html:103-106](file://pdf-splitter/index.html#L103-L106)
- [app.js:488-543](file://pdf-splitter/app.js#L488-L543)

## 故障排查指南
- 无法打开PDF：可能是加密文件，需先去除密码；错误信息会alert提示
- 预览空白或方向异常：检查/Rotate是否正确归一化；确认normalizeRotation执行路径
- 切分线错位：检查mode与shift参数，确认updateOverlays被调用
- **分割线手柄无响应**：检查.pointer-events属性，确认.cut-handle类正确应用，验证pointer事件监听器
- 白边裁剪无效：确认trim-chk勾选且已渲染过该页；若未渲染，首次处理会走独立栅格化
- 下载/分享失败：Android壳下走PdfShell通道；浏览器下检查navigator.share支持与ObjectURL有效性

参考路径：
- [app.js:234-238](file://pdf-splitter/app.js#L234-L238)
- [app.js:517-543](file://pdf-splitter/app.js#L517-L543)
- [app.js:530-552](file://pdf-splitter/app.js#L530-L552)
- [README.md:83-90](file://README.md#L83-L90)

**章节来源**
- [app.js:234-238](file://pdf-splitter/app.js#L234-L238)
- [app.js:517-543](file://pdf-splitter/app.js#L517-L543)
- [app.js:530-552](file://pdf-splitter/app.js#L530-L552)
- [README.md:83-90](file://README.md#L83-L90)

## 结论
该Web UI采用清晰的模块化结构与状态驱动视图模式，结合pdf.js与pdf-lib实现离线PDF预览与切分。通过CSS变量与flexbox/grid构建响应式布局，利用aspect-ratio保持预览比例，借助IntersectionObserver与state.busy实现高效懒渲染。**新增的可拖拽分割线手柄功能**提供了更直观的切分线调整体验，通过pointer事件统一处理鼠标和触摸输入，确保跨设备的一致性。事件处理集中在app.js中，遵循就近匹配与统一刷新原则，保障交互一致性。针对移动端与Android WebView场景，提供了PdfShell桥接能力，完善文件选择与结果落盘/分享体验。建议在后续版本中引入分批处理与裁剪缓存，进一步优化大文件场景的性能与内存占用。