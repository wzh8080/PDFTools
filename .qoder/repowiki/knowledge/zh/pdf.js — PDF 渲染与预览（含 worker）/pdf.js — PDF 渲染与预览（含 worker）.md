---
kind: external_dependency
name: pdf.js — PDF 渲染与预览（含 worker）
slug: pdf-js
category: external_dependency
category_hints:
    - vendor_identity
    - framework_behavior
scope:
    - '**'
source_files:
    - pdf-splitter/lib/pdf.min.js
    - pdf-splitter/lib/pdf.worker.min.js
---

### pdf.js（Mozilla/pdf.js）
- 角色：PDF 渲染引擎，用于在浏览器/WebView 中预览试卷并叠加切分线；worker 脚本由 `pdf.worker.min.js` 提供。
- 集成点：`pdf-splitter/lib/pdf.min.js` 与 `pdf.worker.min.js` 本地化引入；Android 上必须通过 `WebViewAssetLoader` 以 `https://appassets.androidplatform.net/assets/www/` 提供，否则 `file://` 协议下 worker 加载失败。
- 行为约束：viewport 会自动应用页面的 `/Rotate`，与 pdf-lib 的坐标体系不同，因此必须先做旋转归一化再交给 pdf.js 渲染；裁白边时逐页栅格化，已画过的页用 `it.painted` 标记复用，避免重复渲染。
- 验证：exact API/参数以官方文档为准。