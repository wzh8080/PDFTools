---
kind: error_handling
name: 前端 JS 的 Promise 链式错误与用户提示模式
category: error_handling
scope:
    - '**'
source_files:
    - pdf-splitter/app.js
    - pdftool_test/debug.mjs
---

## 1. 使用的系统/方式

仓库是纯前端（`pdf-splitter/index.html` + `app.js`）+ Android WebView 壳工程，没有后端、没有 Node 服务。错误处理完全基于浏览器原生能力：

- **Promise 链**：所有异步操作（`file.arrayBuffer()`、`PDFDocument.load()`、`pdfjsLib.getDocument().promise`、`page.render().promise`、`out.save()`）通过 `.then(...).catch(...)` 串联。
- **async/await + try/catch**：主流程 `process()` 使用 `async function`，用 `try/catch/finally` 包裹整段切分逻辑，并在 `finally` 中恢复按钮状态和 `state.busy` 标志。
- **用户可见的错误**统一通过 `alert()` 弹出；调试信息通过 `console.error()` 输出。
- **Android 壳层**（`MainActivity.kt`）在 README 中说明通过 `onJsAlert` / `onJsConfirm` 把页面弹窗透传到原生 UI，因此前端的 `alert()` 能正常显示。

没有自定义 Error 子类、没有全局 unhandledrejection handler、没有 Sentry 等上报工具——这是一个极简的前端工具应用，错误处理保持最小化。

## 2. 关键文件

- `pdf-splitter/app.js`：唯一业务逻辑文件，集中了全部错误处理路径。
- `android/MainActivity.kt`（由 README 描述）：桥接 `onJsAlert` / `onJsConfirm`，让前端 `alert()` 在 WebView 中可见。
- `pdftool_test/debug.mjs`：Node 侧调试脚本，使用 `process.exit(1)` 表示失败退出。

## 3. 架构与约定

### 3.1 入口级 catch 兜底
`loadFile()` 的 PDF 加载链末尾有 `.catch(function (e) { ... })`，捕获 `PDFDocument.load` 抛出的异常（包括加密文件），并弹出包含原始 message 的 `alert`，附带“若是加密文件，请先去除密码”的提示。

### 3.2 主流程 try/catch/finally
`process()` 是唯一的长耗时异步入口，结构为：
```js
try {
  // 读取 → 裁剪 → 嵌入 → 保存
} catch (e) {
  console.error(e);
  clearProgress();
  alert('处理失败：\n' + (e && e.message ? e.message : e));
} finally {
  btn.disabled = false;
  btn.textContent = '重新切分';
  state.busy = false;
  setTimeout(renderVisiblePending, 400);
}
```
`finally` 保证无论成功或失败都恢复 UI 状态，避免按钮永久禁用。

### 3.3 局部 try/catch 用于可恢复场景
- `readRot()` 读取 `/Rotate` 时 `try/catch`，取不到就当不旋转，属于“容错而非报错”。
- `localStorage` 读写被 `try/catch` 包裹，注释写明“`file://` 或隐私模式下 localStorage 会抛，忽略即可”，属于降级处理。
- `openPdf()` 中销毁旧文档 `prev.destroy().catch(function () {})`，忽略销毁失败的 promise。
- `renderItem()` 渲染单个页面的 `.catch(function (e) { console.error('render', it.idx, e); })`，单页渲染失败不影响其他页。
- `trimBands()` 中 pdf.js 栅格化的 `.then(..., function (e) { ... return bands.map(function () { return null; }); })`，某页白边检测失败回退到整栏裁剪。

### 3.4 测试脚本的错误策略
`debug.mjs` 在输入文件不存在时直接 `console.error(...)` 后 `process.exit(1)`，这是 Node CLI 的标准失败信号。

## 4. 约定与约束

- **用户错误一律走 `alert()`**：文件类型校验失败（`loadFile`）、PDF 打开失败（`.catch`）、处理失败（`process` 的 `catch`）、分享不可用时（`btn-share` 分支）均使用 `alert()` 向用户展示可读消息，而不是静默失败或抛出未捕获异常。
- **调试日志一律走 `console.error()`**：所有内部异常的堆栈先打印到控制台，再决定是否向上冒泡给用户。
- **可恢复的底层异常就地吞掉**：`readRot`、`localStorage`、`prev.destroy()`、单页渲染失败、白边检测失败等场景使用空 `catch` 或返回默认值，保证上层流程继续执行。
- **UI 状态必须在 `finally` 中恢复**：`process()` 的 `finally` 块是唯一一处显式恢复 `busy` 标志和按钮文本的地方，防止异常导致界面卡死。
- **Android 壳层负责把前端 `alert()` 呈现出来**：README 明确说明 `onJsAlert` / `onJsConfirm` 让页面的提示弹窗正常显示，因此前端无需自行实现原生对话框。
- **无全局错误处理器**：代码中没有 `window.onerror`、`unhandledrejection` 监听器，也没有自定义错误类或错误码常量——错误以原生 `Error` 对象形式沿 Promise 链传播。
- **Node 测试脚本用 `process.exit(1)` 表达失败**：作为命令行工具的约定，非零退出码表示运行失败。