---
kind: external_dependency
name: pdf-lib — 本地 PDF 切分与写入库
slug: pdf-lib
category: external_dependency
category_hints:
    - vendor_identity
    - sdk_real_api
scope:
    - '**'
source_files:
    - pdf-splitter/lib/pdf-lib.min.js
---

### pdf-lib（Hopding/pdf-lib）
- 角色：PDF 读取/裁剪/写入的核心库，负责按栏裁剪后等比放入 A4 页面、烘焙 `/Rotate`、输出结果 PDF。
- 集成点：`pdf-splitter/lib/pdf-lib.min.js` 本地化引入，无 CDN 依赖；Android 壳通过 WebViewAssetLoader 以 `https://appassets.androidplatform.net/assets/www/` 提供该资源。
- 使用要点：与 pdf.js 两套坐标体系并存——加载后需先做旋转归一化（把 `/Rotate` 顺时针烘焙进 transformationMatrix，90°/270° 交换宽高并去掉 `/Rotate`），之后预览、检测栏数、裁剪才在同一套显示坐标下工作；加密 PDF 不支持。
- 验证：exact API/参数以官方文档为准。