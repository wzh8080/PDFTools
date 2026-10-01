---
kind: logging_system
name: 日志系统：pdftool_test 脚本使用原生 console 输出，无结构化日志框架
category: logging_system
scope:
    - '**'
source_files:
    - pdftool_test/debug.mjs
    - pdftool_test/test.mjs
    - pdftool_test/test2.mjs
    - pdftool_test/test3.mjs
    - pdftool_test/package.json
---

## 概述

本仓库的 `pdftool_test/` 子目录包含若干 Node.js 脚本（`debug.mjs`、`test.mjs`、`test2.mjs`、`test3.mjs`），用于 PDF 页面分割与调试。这些脚本**没有引入任何日志框架**（如 `winston`、`pino`、`log4js` 等），也没有自定义 logger 模块；所有输出均直接使用 Node.js 内置的 `console.log` 和 `console.error`。

## 使用的系统与方式

- **框架/工具**：无第三方日志库。依赖仅包含 `pdf-lib` 和 `pdfjs-dist`（见 `pdftool_test/package.json`）。
- **输出通道**：标准输出 (`console.log`) 用于进度/结果信息；标准错误 (`console.error`) 用于参数缺失等错误提示。
- **日志级别**：未定义级别体系，仅有“普通输出”和“错误输出”两种语义区分。
- **结构化字段**：无结构化日志记录；消息为拼接字符串或逐参打印，例如：
  - `console.log('W,H,cw =', W, H, cw);`
  - `console.log('done, out pages =', out.getPageCount(), 'size KB =', Math.round(outBytes.length / 1024));`
- **Sink/目标**：全部写入进程 stdout/stderr，无文件 sink、远程上报、采样或过滤配置。

## 关键文件

- `pdftool_test/debug.mjs` — 调试用脚本，打印页面尺寸、对象引用关系、输出页数量。
- `pdftool_test/test.mjs` — 主测试脚本，打印最终页数与输出文件大小。
- `pdftool_test/test2.mjs` / `pdftool_test/test3.mjs` — 其他变体测试脚本，同样使用 `console.*`。
- `pdftool_test/package.json` — 声明依赖，不含任何日志相关包。

## 约定与约束

- **描述性约定**：脚本在入口处通过 `console.error` 报告缺少输入文件的情况并调用 `process.exit(1)` 终止执行（见 `debug.mjs` 第 12–16 行、`test.mjs` 第 12–16 行等）。这是一种统一的错误处理模式，但并非由框架强制。
- **无约束**：仓库中不存在日志级别枚举、logger 工厂、日志配置文件、环境变量开关或统一封装函数；每个脚本自行决定何时调用 `console.log` / `console.error`。
- **范围限制**：上述结论基于对 `pdftool_test/` 下 `.mjs` 文件的检查；仓库根目录下的 Python 脚本（`make_icon.py`、`verify_split.py`）以及 `android/`、`pdf-splitter/` 目录未在本次调查范围内，因此不能断言整个仓库的日志策略一致。