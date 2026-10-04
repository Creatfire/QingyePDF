# 架构概览

```
┌──────────────────────── Electron 主进程 (main.cjs) ────────────────────────┐
│ 文件读写、最近列表、草稿恢复 (recovery.cjs)、诊断 (diagnostics.cjs)          │
│ Markdown: markdown-ipc / markdown-files / markdown-tools                    │
│ 转换: converter-ipc → pandoc-engine → vendor/pandoc/pandoc.exe              │
│ PDF 工具箱: offline.cjs → backend/bin/QingyeWorker(.exe)  [worker.py]        │
│ AI: ai-service (模型请求) / ai-api-server (本地 OpenAPI，默认关闭)           │
│ 全库搜索: library-index.cjs (userData/library-index/*.json)                 │
└───────────────▲─────────────────────────────────────────────────────────────┘
                │ contextBridge (preload.cjs → window.desktop)，逐个声明的 IPC
┌───────────────┴────────────── 窗口 (ui/index.html) ─────────────────────────┐
│ app.mjs  标签与会话、保存 / 撤销、快捷键                                     │
│ ├─ 每个 PDF 标签：一个 iframe，里面是 PDF.js viewer (vendor/pdfjs)           │
│ ├─ 每个 Markdown 标签：markdown/editor.mjs（块级所见即所得）                 │
│ ├─ notes-mode.mjs  两个标签的面板并排；摘录、区域、批注同步、滚动联动        │
│ ├─ library.mjs     全库搜索对话框；用 PDF.js 取文字交给主进程建索引          │
│ ├─ citation.mjs    引用信息识别与 BibTeX                                     │
│ ├─ navigation / views / tools / direct   PDF 侧栏、视图、工具箱、页面编辑    │
│ └─ ai/             聊天面板与文档工具 (tools.json 定义，doc-tools.mjs 实现)   │
└──────────────────────────────────────────────────────────────────────────────┘
```

## 几条贯穿全局的规则

- **窗口进程不联网。** `session.webRequest` 拦截所有 http(s) 请求；需要联网的两件事（AI、DOI 查询）都由主进程在用户触发时完成。
- **窗口进程不直接碰文件系统。** 所有文件操作经 `preload.cjs` 暴露的具体函数，主进程按文档 ID 或最近列表令牌解析路径，并校验调用来源。
- **修改先进草稿，保存才写盘。** PDF 的结构性修改通过后端生成新字节流，进入每个标签自己的撤销历史；Markdown 编辑器有自己的撤销栈。每隔几秒把未保存内容写入恢复目录。
- **界面无构建步骤。** `ui/` 是原生 ES 模块，第三方库以预构建文件放在 `vendor/`。
- **源语言是简体中文。** 运行时由 `ui/i18n/i18n.mjs` 按词典替换 DOM 文字；词典由 `scripts/i18n/build.py` 生成。

- **文字只写一遍。** 快捷键提示按 Windows 写（“Ctrl+S”）；`ui/platform-text.mjs` 在翻译之后按平台改写：Mac 上变成 ⌘S，安卓上整段去掉并把“右键”换成“长按”。键盘处理本身把 ⌘ 和 Ctrl 视为同一个修饰键。

## 笔记与 PDF 的链接

摘录链接是普通的 Markdown 链接，任何编辑器都能显示：

```
[paper.pdf · 第 12 页](<file:///C:/docs/paper.pdf#page=12&rect=72,688.5,310.25,701.1>)
```

`rect` 是 PDF 用户空间坐标（左下角为原点）。青页打开这种链接时在已打开的 PDF 中定位并画出矩形；滚动联动和批注去重都靠解析笔记里的这些链接，没有额外的数据库。

## 安卓版

`mobile/` 用 Capacitor 包装同一套 `ui/`，Node / Electron 接口由 `mobile/src/shims/` 提供，后端 `worker.py` 在 Pyodide 中运行。笔记模式、全库搜索、引用信息在安卓上同样可用：手机竖屏时两个窗格上下排列，命令在“更多 → 笔记模式命令”里；触屏行为（轻点收起工具栏、双击缩放、选中文字的操作条）在 `mobile/src/ui/mobile-ui.js`。
