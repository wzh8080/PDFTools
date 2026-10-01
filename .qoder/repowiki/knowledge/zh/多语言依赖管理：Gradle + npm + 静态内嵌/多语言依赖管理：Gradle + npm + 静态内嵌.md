---
kind: dependency_management
name: 多语言依赖管理：Gradle + npm + 静态内嵌
category: dependency_management
scope:
    - '**'
source_files:
    - android/build.gradle.kts
    - android/app/build.gradle.kts
    - pdftool_test/package.json
    - pdftool_test/package-lock.json
    - pdf-splitter/lib/pdf-lib.min.js
    - pdf-splitter/lib/pdf.min.js
    - pdf-splitter/lib/pdf.worker.min.js
---

## 1. 使用的系统/方案

仓库包含三个相互独立的子模块，各自采用其生态的标准依赖管理方式：

- **Android 应用壳** (`android/`)：使用 Gradle Kotlin DSL（`build.gradle.kts`），通过 `plugins {}` 声明 Android Gradle Plugin 与 Kotlin 插件版本，通过 `dependencies { implementation(...) }` 声明运行时库。
- **Node.js 测试脚本集** (`pdftool_test/`)：使用 npm，依赖声明在 `package.json`，锁定版本由 `package-lock.json` 提供。
- **浏览器端 PWA** (`pdf-splitter/`)：**不通过 npm 引入 pdf-lib/pdfjs-dist**，而是将 `lib/pdf-lib.min.js`、`lib/pdf.min.js`、`lib/pdf.worker.min.js` 作为静态文件直接提交到仓库，由 `index.html` / `app.js` 通过 `<script>` 标签加载。Android 构建时再通过 Gradle `Sync` 任务把 `pdf-splitter/lib/**` 同步进 `src/main/assets/www`。

## 2. 关键文件

- `android/build.gradle.kts` — 顶层 Gradle 配置，集中声明 AGP `9.3.0` 与 Kotlin `2.2.10` 插件版本（`apply false` 仅声明，供子模块引用）。
- `android/app/build.gradle.kts` — Android 应用模块的依赖与构建逻辑；`dependencies` 块声明 `androidx.core:core-ktx:1.16.0`、`androidx.activity:activity-ktx:1.10.1`、`androidx.webkit:webkit:1.13.0`。
- `pdftool_test/package.json` — npm 依赖入口，声明 `pdf-lib ^1.17.1`、`pdfjs-dist ^3.11.174`。
- `pdftool_test/package-lock.json` — npm 依赖树锁定文件（随仓库提交）。
- `pdf-splitter/lib/pdf-lib.min.js`、`pdf-splitter/lib/pdf.min.js`、`pdf-splitter/lib/pdf.worker.min.js` — 以源码形式 vendored 的第三方 JS 库。

## 3. 架构与约定

- **Android 插件版本集中化**：根 `android/build.gradle.kts` 用 `id("...") version "..." apply false` 声明插件版本，子模块 `android/app/build.gradle.kts` 仅 `id(...)` 引用，避免版本散落。
- **WebView 资源自动同步**：`android/app/build.gradle.kts` 定义 `syncWebAssets` Sync 任务，从 `rootProject.file("../pdf-splitter")` 拷贝 `index.html`、`app.js`、`manifest.json`、图标及 `lib/**` 到 `src/main/assets/www`，并在 `preBuild` 阶段执行，保证 WebView 壳始终加载最新的前端产物。
- **JS 依赖双轨策略**：Android 壳通过 Gradle 同步已 vendored 的 minified 静态文件；Node 测试脚本则通过 npm 安装对应依赖，两者可独立演进。
- **签名配置外置**：`keystore.properties` 通过 `Properties().load()` 动态读取，不在仓库中提交，避免泄露签名信息。

## 4. 约定与约束

- **Android 插件版本必须通过根 build.gradle.kts 声明**：根文件以 `apply false` 注册插件，子模块再 `id(...)` 引用——这是当前仓库唯一的插件版本来源。
- **WebView 前端资源不得手动编辑 `assets/www`**：`android/app/build.gradle.kts` 注释明确说明“构建前自动同步进 assets/www，避免两处副本互相漂移；该目录已加入 .gitignore”，因此 `src/main/assets/www` 是生成产物，不应手工维护。
- **Android 运行时依赖统一通过 `implementation(...)` 声明**：所有三方库（androidx.*）均位于 `dependencies` 块，未出现 `api`/`compileOnly` 等其他变体。
- **npm 依赖使用语义化版本范围**：`pdf-lib` 和 `pdfjs-dist` 均以 `^` 前缀声明，允许小版本升级；精确版本由 `package-lock.json` 锁定。
- **浏览器端不使用 npm 打包流程**：pdf-lib/pdfjs-dist 以 minified 静态文件形式 vendored 在 `pdf-splitter/lib/`，由 HTML 直接 `<script>` 引入，无 webpack/vite 等构建工具链。
- **Android 编译目标固定为 Java/Kotlin 17**：`compileOptions.sourceCompatibility/targetCompatibility = JavaVersion.VERSION_17` 且 `kotlin.compilerOptions.jvmTarget = JVM_17`。
- **私有仓库/代理未在仓库中声明**：未发现 `.npmrc`、`gradle.properties` 中的 `systemProp.http.proxy*` 或 `mavenCentral()` 之外的 repository 源，默认使用各工具的官方中央仓库。