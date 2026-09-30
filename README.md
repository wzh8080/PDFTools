# 试卷切分助手

把 A3/A4 拼版试卷（一页里横排 2 栏或 3 栏）切分成「一页一题」的标准 A4 PDF，方便直接打印。
全部处理在手机/电脑本地完成，**不联网、不上传**：安装包没有 INTERNET、也没有任何存储/定位等用户可见权限（只有一条 androidx 自动带入的、仅本应用自己用的签名级内部权限）。

```
原 PDF：一页两栏（A3 横版拼版）        输出：每栏一页 A4 纵向
┌───────────┬───────────┐            ┌─────────┐  ┌─────────┐
│  第 1 页   │  第 2 页   │    ──▶     │ 第 1 页  │  │ 第 2 页  │
└───────────┴───────────┘            └─────────┘  └─────────┘
```

## 目录结构

| 路径 | 说明 |
| --- | --- |
| `pdf-splitter/` | Web 本体（PWA）。`index.html` + `app.js` + 本地化的 `lib/pdf.js`、`lib/pdf-lib`，无 CDN 依赖 |
| `android/` | Android 壳工程（Kotlin + WebView），构建时把 `pdf-splitter/` 同步进 `assets/www` |
| `dist/` | 打包好的 APK（已在 `.gitignore` 中，不入库） |
| `pdftool_test/`、`pdf_preview/` | 本地验证脚本与它们的输出（输出不入库） |

技术选型：切分用 [pdf-lib](https://github.com/Hopding/pdf-lib) 按栏裁剪后等比放入 A4 页面，预览用 [pdf.js](https://mozilla.github.io/pdf.js/) 渲染并叠加切分线。

## 安装使用（Android）

1. 把 `dist/试卷切分助手-v1.3.1.apk` 传到手机，点击安装（需允许「安装未知应用」）。
2. 打开 App → 点击选择试卷 PDF → 选分栏方式（默认自动识别，带 `/Rotate` 的扫描件会自动转正）→ 开始切分。勾选项「裁掉页面四周白边」默认开启。
3. 点「保存到本地」，结果写入 **下载（Download）/ 试卷切分/**，按钮下方会用一行小字显示实际路径（重名时系统会自动加 "(1)"）。
4. 保存成功后出现「查看文件」，直接交给 WPS / 小米多看等阅读器打开；点「分享」可发到微信、QQ 或系统打印服务（分享只发送文件，不会额外写入下载目录）。
5. 底部常驻操作栏是「更换文件 + 重新切分」两个按钮，切完一份可直接选下一份，不用回到顶部。
6. 打印时在打印对话框里选 A4、缩放「适应页面」即可。

**页边距**（默认 4 mm，可调 0–10 mm）指的是**切出来的那一栏图片边缘到 A4 纸边**的留白，不是原卷文字到自己页边的距离——后者会随图片一起等比缩放，这个滑块管不到。想让试卷尽量铺满纸面就设 0。

要求 Android 10 及以上（minSdk 29）。已在小米 10 / Android 13 实测通过：选文件、预览、切分、保存到本地、查看文件、系统分享、更换文件续切。

## 也能在浏览器里用

`pdf-splitter/` 本身就是完整可用的 PWA：

- 直接双击 `pdf-splitter/index.html` 即可离线使用；
- 或 `cd pdf-splitter && python -m http.server 8000` 后访问 `http://localhost:8000`，在 Chrome 里「安装到桌面/主屏幕」当 App 用（浏览器版走下载文件方式保存，不经手机下载目录）。

## 构建 APK

环境：JDK 17、Android SDK（platform 36 + build-tools）、Gradle（仓库已带 wrapper，走腾讯镜像）。

```bash
cd android
./gradlew :app:assembleRelease     # 产物：android/app/build/outputs/apk/release/app-release.apk
./gradlew :app:assembleDebug       # 调试包（包名带 .debug 后缀，可与正式版共存）
```

改了网页代码不用手动拷贝：`pdf-splitter/` 是唯真源，构建任务 `:app:syncWebAssets` 会自动同步进 `android/app/src/main/assets/www/`（该目录已 gitignore）。

调试 WebView：装 debug 包后，Chrome 访问 `chrome://inspect` 可直接审查页面、看 console。

### 签名

`android/keystore/release.jks` + `android/keystore.properties` 是本地生成的签名密钥，**已 gitignore，不要提交，务必备份**——丢了就无法给已安装用户推送升级（只能卸载重装）。换自己的密钥：

```bash
keytool -genkeypair -v -keystore android/keystore/release.jks -alias pdfsplitter \
  -keyalg RSA -keysize 2048 -validity 10950
```

## 原生壳做了什么

`MainActivity.kt` 只补 WebView 做不到、手机上又必需的四件事，业务逻辑一律留在网页里：

- `WebViewAssetLoader` 把本地资源以 `https://appassets.androidplatform.net/assets/www/` 提供，避免 `file://` 下 pdf.js worker 加载失败；
- `onShowFileChooser` 接系统文件选择器（`<input type="file">` 在裸 WebView 里默认无效），并保留原始文件名；
- `PdfShell` 桥：结果 PDF 分块 base64 传给原生。`save()` 经 MediaStore 写入「下载/试卷切分」并把真实路径回传给页面显示；`share()` 只用 FileProvider 发起分享，不落盘（否则点分享会误报「已保存」）；
- 「查看文件」按 `VIEWER_PREFS` 白名单定向到真正的阅读器（WPS、小米多看、夸克等）。系统里注册了 PDF 接收器的应用很多，邮箱 / 网盘 / AI 助手会把文件当附件上传而不是预览，所以不能交给系统默认选择器；相应地 manifest 里必须声明 `<queries>`，否则 Android 11+ 的包可见性限制会让查询返回空。白名单都没命中时才退回系统选择器。
- `onJsAlert` / `onJsConfirm` 让页面的提示弹窗正常显示。

## 处理流程里的两个关键点

**旋转校正**：pdf.js 的 viewport 会自动应用页面的 `/Rotate`，而 pdf-lib 的 `getSize()` / `embedPage()` 完全忽略它——两者本来就用着两套坐标。所以加载文件后先做一次归一化：把 `/Rotate` 顺时针烘焙进内容（`embedPage` 的 transformationMatrix），90°/270° 时交换宽高，并去掉 `/Rotate`。之后预览、检测栏数、裁剪全在同一套显示坐标里，输出方向也与源文件显示一致。四个角度的矩阵是用文本坐标逐一实测核对过的（见 `pdftool_test/`）。没有任何页面带旋转时会跳过重存，直接用原字节。

**裁掉白边**（默认开启）：把每栏渲染成位图（长边约 1100px）扫出有墨迹的最小矩形，作为真正的裁剪框，再等比放进 A4。实测同样内容下字号可放大约 5.5 倍，也就是纸面铺得更满。检测不到墨迹的栏会退回整栏，不会裁空。

## 已知限制

- **自动识别只按页面长宽比判断**：比例 ≥1.85 判 3 栏、≥1.2 判 2 栏。A3 横版三栏的比例约 1.41，会被判成 2 栏，需要手动选「左中右 3 栏」。
- 切分线只能整体等分 + 全局微调，不能逐栏设独立边界。
- 裁白边按每栏独立计算，各页的放大倍率可能略有差异；若某栏有跨到中缝的文字，仍按等分线切。
- 大文件（几百页扫描件）一次性嵌入，内存峰值偏高且不能中途取消。
- 加密 PDF 不支持，需先去除密码。

完整待办清单见仓库 issue 或本次交付说明。
