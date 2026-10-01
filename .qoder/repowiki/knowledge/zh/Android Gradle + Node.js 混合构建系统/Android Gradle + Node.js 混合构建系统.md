---
kind: build_system
name: Android Gradle + Node.js 混合构建系统
category: build_system
scope:
    - '**'
source_files:
    - android/build.gradle.kts
    - android/app/build.gradle.kts
    - android/settings.gradle.kts
    - android/gradle.properties
    - .gitignore
    - pdftool_test/package.json
---

## 1. 使用的构建体系

仓库采用多语言、多子项目的混合构建：
- **Android 应用壳**：基于 Gradle Kotlin DSL（`build.gradle.kts`），使用 Android Gradle Plugin 9.3.0 与 Kotlin 2.2.10，编译目标 Java/Kotlin 17。
- **PDF 前端 PWA**：纯浏览器端静态资源（`pdf-splitter/`），无独立构建步骤，直接以源码形式被 Android 任务同步进 APK。
- **Node.js 验证脚本**：位于 `pdftool_test/`，通过 `npm install` 安装 `pdf-lib` 与 `pdfjs-dist`，无自定义 npm scripts，仅保留占位 `test` 命令。
- **辅助工具**：根目录的 `make_icon.py` 用于图标生成，`verify_split.py` 为 PDF 切分结果校验脚本。

仓库根没有 Makefile、Dockerfile、CI 配置文件或发布流水线脚本；不存在跨平台交叉编译配置。