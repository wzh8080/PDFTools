# 项目记忆（随仓库迁移）

这是「试卷切分助手 / FileTools」的**权威项目记忆**，用纯 Markdown 存放，纳入 git 版本控制。
换电脑 / 换账号时它跟着 `git clone` 走，不依赖任何云端同步或某台机器的 `~/.qoder` 目录。

> 约定：本目录下的文件**不得**写死任何机器相关信息（用户目录、盘符、账号 ID、口令）。
> 真机路径与签名口令一律放 `android/local.properties`、`android/keystore.properties`
> （两者都已 `.gitignore`），这里只写「需要哪些、放哪、怎么配」的中立说明。

## 索引

- [Android 构建与迁移环境核对](android-build-migration.md) — 换机时 build android/ 模块要核对的清单：JDK17 / SDK platform 36 / local.properties / 签名 / Gradle 9.7.1 缓存
- [pdf-splitter 设计事实](pdf-splitter-design.md) — 分栏 cuts 模型与内容检测阈值、旋转烘焙判据、PdfShell 三方法语义、界面规约（已对照源码核实）
- [pdf-splitter 专属坑与验证前提](pdf-splitter-pitfalls.md) — /Rotate 净角度陷阱、合成样例造假白沟、并发 reject 静默失效、前端改动未重打包、阈值未经真卷验证
- [pdf-splitter 三个暂缓的优化点](pdf-splitter-deferred-decisions.md) — 边距文案、预览预热 20 页方案、切分位图复用；含实测数字，用户 2026-09-30 决定暂不动
- [思考与工作准则](working-principles.md) — 先查前提、独立判断不迎合、核实来源、敢指出错误；外加每任务提交+隐私安检、草稿放工程外

## 与其它记忆存放处的关系

- Qoder IDE 记忆库（自动注入上下文的那套）在 `~/.qoder/memories/<账号ID>/projects/<本项目路径 slug>/`，
  由 App+云端托管，**本机重建、不进 git**；换机时路径 slug 变化会让其检索失效。
- 用户级全局记忆（跨项目偏好、工具经验）在 `~/.qoder/memory/*.md`，不随仓库走。
- 本目录 = 项目专属、可迁移、可 review 的那一份。

## 冲突时的优先级

用户当前指令 > 代码 / 配置 > 本目录 > IDE 记忆库 > 全局记忆。
后两层里与本目录表述不一致的条目一律以本目录为准；本目录没有、且属跨项目通用的规则才去全局层取。
