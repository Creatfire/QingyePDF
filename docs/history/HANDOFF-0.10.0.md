# 青页 PDF 0.10.0 开发交接

基于 0.9.5（代码同 0.9.4）加笔记模式和新图标。上一版交接见 HANDOFF-0.9.4.md。

## 新增

| 功能 | 入口与行为 |
|---|---|
| 笔记模式 | 标题栏“笔记模式”按钮 / Ctrl+\\；右键标签“在右侧 / 左侧打开”。两个已打开文档左右并排，分隔条 25%–75%，可交换、可退出；关闭任一侧文档自动退出 |
| 焦点规则 | 最后点击的一侧是当前文档（保存、撤销、查找作用于它）。PDF + Markdown 时 PDF 工具栏与导航侧栏始终服务于 PDF |
| 摘录 | PDF 选中文字 → 右键“摘录到笔记”/ Ctrl+Shift+E → 引用 + 原文页码链接插入旁边的 Markdown；链接在另一侧原地定位 |
| 批注整理 | 笔记模式下“将选中批注整理为笔记”写入旁边的笔记，而不是新开标签 |
| AI 双文档 | AI 面板显示两份文档；`list_documents` 带 `notes_mode` 与每个文档的 `pane`；无工具模式会附带两份文档的摘要 |
| AI 批注 PDF | 新工具 `annotate_pdf`（page、quote、kind、comment、color）。在页面文字中定位原文片段，经后端 `annotation` 操作写入；确认规则与 `insert_markdown` 相同 |
| 新图标 | `build/logo.png` 为母版，`build/icons/` 为各尺寸；`ui/icon.png`、`ui/logo.png`、`build/icon.ico`、示例 PDF 封面、安卓图标均由它生成 |

## 实现

- `ui/notes-mode.mjs`：分屏状态、分隔条、入口菜单、摘录；纯函数（窗格选择、链接、摘录格式）有单元测试。`ui/notes.css` 为样式。
- `ui/app.mjs`：`activate(id, {keepFocus})` 认识分屏；`currentPdf()` 在 Markdown 获得焦点时返回旁边的 PDF；标签右键菜单；Ctrl+\\ 与 Ctrl+Shift+E。
- `ui/ai/doc-tools.mjs`：`quoteRect()` 把原文片段换算成页面比例矩形；`annotate_pdf`；`ui/ai/tools.json` 增加定义（外部 OpenAPI 接口随之多一个工具，受“允许外部程序直接修改文档”开关约束）。
- `ui/ai/panel.mjs`：系统提示和上下文标签包含另一侧文档。
- `ui/navigation.mjs`、`ui/direct.mjs`、`ui/markdown/host.mjs`：各一处小改动接入笔记模式。
- 主进程只加了 `--notes-smoke` 入口和“关于”对话框图标。**后端 `backend/worker.py` 未改**，冻结的 QingyeWorker 沿用 0.9.4。

## 验证

```
npm test                 # 82 项，含 test/notes010.test.mjs
npm run smoke:010        # electron . --notes-smoke
node scripts/ci-smoke.cjs
```

开发环境（Linux，Electron 44.4.5，xvfb）结果：

- `npm test` 82/82 通过。
- `--notes-smoke` 全部通过：入口菜单、分屏、焦点、分隔条、摘录与撤销、链接原地定位、同类型窗格替换、AI 读两侧 / 写笔记、AI 批注 PDF（校验批注类型、评论与矩形位置）、标签右键菜单、快捷键退出、关闭文档退出。
- markdown / conversion / basic / features 冒烟通过。`--smoke-test` 与 `--safety-smoke` 在该 Linux 环境失败，未改动的 0.9.5 代码在同一环境以相同方式失败（剪贴板与子进程沙箱），不是本版引入。

**未验证：**

- Windows 便携版 exe 是在 Linux 上交叉构建的，没有在 Windows 上启动过；图标、版本信息资源由 `scripts/after-pack.cjs` 写入。
- 笔记模式在 Windows 上的实际操作、MacOS 界面风格下的外观、高分屏。
- AI 批注依赖模型给出与页面一致的原文；扫描页（无文字层）需要先 OCR。

## 已知边界

- 同一文档不能放在两侧；只有左右两个窗格；没有同步滚动。
- 点击其他标签会把它放进同类型的窗格；从首页点击第三个文档也会进入分屏。
- 跨多行的 AI 批注是一个覆盖这些行的矩形，不是逐行贴合。
- 分屏状态不随“恢复上次标签”恢复；只记住文档之间的上次搭配（保存在界面本地存储）。
- 三栏（PDF、笔记、AI 面板）在 1360 宽窗口下较挤，可拖窄 AI 面板或分隔条。
