---
title: "Android 构建与迁移环境核对"
category: project_build_configuration
keywords: [JDK 17, SDK platform 36, local.properties, keystore.properties, Gradle 9.7.1, 换机迁移]
updated: 2026-10-01
---

build `android/` 模块（AGP 9.3.0 + Kotlin 2.2.10，`compileSdk/targetSdk = 36`，`minSdk = 29`）前，
换电脑时必须核对以下 5 项。带 ❌ 的是「不会随 git 走、每台机器都要重建」的东西。

## 1. JDK 17
Gradle 走 `JAVA_HOME`。PATH 上若另有 `java`（常见是 JDK 8）不影响 Gradle，但直接调 `java`
的脚本会踩坑，建议把 JDK 17 的 `bin` 放到 PATH 前面。

## 2. Android SDK platform 36 + build-tools 36.x ❌
新装的 SDK 常只带到 android-33/34。缺 36 会在配置阶段直接报
`Failed to find target with hash string 'android-36'`。补装：

    sdkmanager "platforms;android-36" "build-tools;36.1.0"
    sdkmanager --licenses   # 若提示未接受

## 3. android/local.properties ❌（被 .gitignore）
每台机器手建，内容指向本机 SDK。注意 `.properties` 里反斜杠是转义符：

    sdk.dir=<ANDROID_SDK 路径，反斜杠双写成 \\ 或改用正斜杠 />

裸写单个 `C:\...` 会被吃掉转义导致解析错误。

## 4. 签名文件 release.jks + android/keystore.properties ❌（均被 .gitignore）
- `keystore.properties` 由 `rootProject.file(...)` 解析，而 Gradle 根目录是 **`android/`**
  （不是仓库根 FileTools/）。文件必须放 `android/keystore.properties`，其 `storeFile` 也相对 `android/` 解析。
- 四个键：`storeFile` / `storePassword` / `keyAlias` / `keyPassword`。
- 缺失时 `assembleRelease` **不报错**，只是不启用签名 → 打出的 APK 未签名、装到真机会被拒。
  「构建成功」不等于「能安装」。
- ⚠️ 一旦 `release.jks` 丢失只能重新生成新签名，结果是**无法覆盖升级旧版**，用户必须先卸载
  旧 App（本地数据丢失）。所以密钥务必异地多处备份。

## 5. Gradle 9.7.1 发行包缓存 ❌
`gradle-wrapper.properties` 的 `distributionUrl` 指向腾讯镜像的 `gradle-9.7.1-bin.zip`。
新机器两处 wrapper/dists（`~/.gradle` 与 `GRADLE_USER_HOME` 指向的目录）通常都没有 9.7.1，
首次构建会重新下载。别动 `distributionSha256Sum`，镜像包与官方包校验值一致。

### GRADLE_USER_HOME 陷阱
若用户级环境变量 `GRADLE_USER_HOME` 指向某目录（如 D 盘），Gradle 只读那个目录，
`~/.gradle` 里现成的 `caches/modules-2` 依赖缓存与 `init.d/init.gradle` 镜像脚本都不会被生效。
先定归属再构建，否则缓存白下。改环境变量后需重开终端（进程内 env 不自动刷新）。

## 构建验证顺序（失败面最小）

    cd android
    ./gradlew --version          # 先只触发 wrapper 解包，确认 Gradle 9.7.1 落地
    ./gradlew :app:assembleDebug # 先出 debug 包：不需签名，验证 SDK36 + AGP9 链路
    ./gradlew :app:assembleRelease
    apksigner verify --print-certs app/build/outputs/apk/release/app-release.apk

最后一条不是可选项：必须看到证书 DN 与 SHA-256 指纹且**非 debug key**，才算 release 可用。
`BUILD SUCCESSFUL` 只证明编译通过，不证明签名生效（见第 4 项）。

`android/app/src/main/assets/www/` 是空的不用手补 —— `preBuild` 依赖的 `syncWebAssets`
会自动从 `pdf-splitter/` 同步。debug 包可用 Chrome `chrome://inspect` 调 WebView。

## 已就绪、无需改动的项（本机 2026-10-01 实测）
- `gradle.properties` 已含 AGP 9 所需关闭项：`android.newDsl=false`、`android.builtInKotlin=false`、
  `configuration-cache=false`。
- `settings.gradle.kts` 已内置阿里云 maven 镜像（gradle-plugin / google / public）。
- adb / platform-tools、SDK licenses 均在位。
