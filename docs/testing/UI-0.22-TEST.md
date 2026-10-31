# 0.22 界面改版并行测试文档（4 个 agent，源码版）

本文供 4 个测试 agent 在同一台 Apple 芯片 Mac 上**同时**执行，验证 `ui-redesign-0.22` 分支的界面改版。每个 agent 领一张任务卡（B1–B4），使用自己的应用实例、配置目录、端口和测试文件。改动要点见第 0 节，驱动脚本用法与 [macOS 0.21 并行测试文档](MACOS-0.21-TEST.md) 第 2 节相同，另加 `Q size`（见本文第 2 节）。

## 0. 被测版本与改动要点

| 项目 | 值 |
|---|---|
| 分支 | `ui-redesign-0.22`（基于 0.21.0 的 `c1bfa14`） |
| 运行方式 | **源码版**：`Q start` 不加 `--packaged`，用 `node_modules/electron` 启动。本轮不构建安装包 |
| 版本号 | 仍显示 0.21.0，属预期 |

本轮改了什么（测试时对照）：

1. **只有一套界面**：设置里不再有“界面风格（Windows / macOS）”；`ui/macos.css` 已删除；macOS 上仍保留系统红绿灯。
2. **左侧导航栏** `#appRail`（宽 68px）：首页 `#homeButton`、文档库 `#libraryButton`、工作区 `#workspaceButton`、转换 `#convertButton`、任务 `#railTasks`（有进行中任务时显示数字角标 `#railTaskBadge`）；底部外观 `#themeButton`、设置 `#settingsButton`、帮助 `#helpButton`。上下方向键可在导航项之间移动焦点。全屏时导航栏隐藏。
3. **精简标题栏**：只剩阅读前进 / 后退、文档标签和一个搜索框 `#commandButton`（“搜索文档、内容和命令”，⇧⌘P）。窗口宽度小于 1000px 时搜索框只显示图标。标题栏里的“笔记”按钮 `#notesButton` 只在 Markdown 文档里显示。
4. **统一搜索**：命令面板输入文字后，先列出匹配的命令，最后两项是“在当前文档中查找“…””（打开了 PDF 时）和“在所有文档中搜索“…””。
5. **批注工具带** `#annotStrip`：进入任一批注工具（高亮、自由绘制、文本框等）或图形工具后，工具栏下方出现一条工具带：所有批注工具、图形、区域下划线 / 删除线、“Esc 退出”提示、“批注列表”“完成”。退出批注后工具带消失。
6. **批注面板重排**：顶部只有搜索框和“筛选”（展开后是类型、颜色、标签、页码、状态；有生效的筛选时显示“筛选 · N”）；勾选批注后列表下方出现批量操作栏；导出收进“整理与导出”；卡片用颜色圆点，不再用左侧彩色竖条。
7. **状态栏**：PDF 模式下页码与缩放固定在状态栏中间；左侧只显示文件名（悬停看完整路径）；窗口小于 1100px 时隐藏详细信息。
8. **首页**：标题为“下午好 今天想读点什么？”（问候语随时间变化，绿色），四个动作块排成 2 × 2。
9. **统一令牌**：字号 11/12/13/15/17/22px，圆角 6/8/12px；浅色和深色配色微调。
10. 新增文字有英文、繁体、日文、韩文翻译。

## 1. 并行规则（所有 agent 必须遵守）

| 资源 | 规则 |
|---|---|
| 鼠标、键盘、屏幕焦点、剪贴板 | 所有 agent 都**不操作真实鼠标键盘、不读写剪贴板**，只通过 `scripts/agent-session.cjs` 给自己的窗口发事件 |
| 全屏、打印、系统设置 | 不进入系统全屏（B4 用测试接口检查全屏样式时除外，见任务卡），不打印，不改系统设置 |
| 端口 | B1 = 9311，B2 = 9312，B3 = 9313，B4 = 9314，只用自己的端口 |
| 文件夹 | 只写 `test-output/agents/<编号>/`（B1–B4，和 0.21 的 A1–A8 不重名）。不改仓库里的其他文件，不运行 `git` 写操作 |
| 进程 | 只停止自己的会话（`Q stop`）。禁止 `killall`、`pkill Electron`、`pkill QingyePDF` |
| 构建与依赖 | 不运行 `npm install`、不构建安装包。只有 B1 运行 `npm run verify` 和 `scripts/ci-smoke.cjs` |
| 源码 | **只测试和记录，不修改任何源码** |

## 2. 通用准备（每个 agent 都做）

把 `B2` 换成自己的编号、`9312` 换成自己的端口：

```bash
cd /Volumes/RC10/QingyePDF/QingyePDF-v0.20.0
export PATH="/opt/homebrew/bin:$PATH"
export AGENT=B2 PORT=9312
export D="$PWD/test-output/agents/$AGENT" F="$PWD/test-output/agents/$AGENT/fixtures"
mkdir -p "$D/shots"
Q() { node scripts/agent-session.cjs "$@" --name "$AGENT"; }
.backend-build/bin/python scripts/agent-fixtures.py "$F"
Q start --port "$PORT" "$F/text.pdf"
```

启动后先关掉首次启动说明、切成简体中文、等文档加载完：

```bash
Q eval "(async()=>{const m=document.getElementById('messageDialog');if(m.open)m.close();await qingye.i18n.setLanguage('zh-CN');return qingye.i18n.current()})()"
Q eval "(async()=>{for(let i=0;i<100&&![...qingye.sessions.values()].at(-1)?.loaded;i++)await new Promise(r=>setTimeout(r,200));return [...qingye.sessions.values()].map(s=>[s.name,s.loaded])})()"
```

预期分别输出 `"zh-CN"` 和 `[["text.pdf", true]]`。

常用检查写法：

- 元素是否可见：`Q eval "(()=>{const e=document.querySelector('#annotStrip');const r=e.getBoundingClientRect();return {hidden:e.hidden,display:getComputedStyle(e).display,w:r.width,h:r.height}})()"`
- 两个元素是否重叠、文字是否被截断：比较 `getBoundingClientRect()`，以及 `scrollWidth > clientWidth`。
- 看某个窗口尺寸下的布局：`Q size 920x640 "$D/shots/B2-12-920.png" --eval "<检查用的 JS>"`。这个命令临时按该尺寸排版，截图并执行检查后恢复，窗口本身不变；所以检查必须写在同一条命令的 `--eval` 里。
- 截图：`Q shot "$D/shots/B2-01.png"`。**每一项都要截图**，报告里写路径。

## 3. 报告格式

每个 agent 写 `test-output/agents/<编号>/report.md`：

```markdown
# <编号> 测试报告
环境：macOS 版本、芯片、开始与结束时间
| 编号 | 结果 | 证据 | 备注 |
|---|---|---|---|
| B2-01 | 通过 / 失败 / 阻塞 / 跳过 | 截图或输出路径 | 实际现象 |
## 发现的问题
### <编号>-BUG-1 标题
- 重现步骤（可复制的命令）、预期、实际、截图、app.log 片段、严重程度（阻断 / 严重 / 一般 / 轻微）
## 观感意见
（不是缺陷但看着别扭的地方：对齐、间距、颜色、文字，附截图）
```

全部完成后写 `test-output/agents/<编号>/DONE`（内容一行总结：通过 / 失败 / 阻塞各多少项）。

## 4. 任务卡

### B1 · 自动测试与冒烟（端口 9311）

不启动交互实例。

| 编号 | 操作 | 预期 |
|---|---|---|
| B1-01 | `git log --oneline -5; git status --short` | 最新提交是 0.22 界面改版的几次提交；记录未提交文件 |
| B1-02 | `npm run verify`（完整输出存 `$D/verify.log`） | oxlint 0 错误、文档检查通过、单元测试除既有跳过项外全部通过。**任何 lint 警告或失败都逐条记录**（文件、行号、规则） |
| B1-03 | `node scripts/ci-smoke.cjs --report "$D/source-smoke.json"`（输出存 `$D/smoke.log`） | 全部源码冒烟套件 PASS。失败的套件记录断言信息，并单独重跑一次确认：`node scripts/ci-smoke.cjs --only <套件名>` |
| B1-04 | 打开 `test-output/ci/smoke/test-output/` 下 `design-*.png`、`toolbar-*.png` 等截图逐张看 | 左侧导航栏、标题栏搜索框、工具栏、菜单、工具中心、命令面板显示正常，无错位、重叠、文字截断；把有问题的截图复制到 `$D/shots/` 并说明 |
| B1-05 | `grep -rn "style-macos\|macos.css\|setWindowStyle\|windowStyleChoice" ui main.cjs window-shell.cjs preload.cjs` | 没有残留（注释除外） |
| B1-06 | `python3 scripts/i18n/build.py && git diff --stat ui/i18n` | 词表重建后没有变化（说明提交的翻译文件是最新的） |

### B2 · 外壳：导航栏、标题栏、统一搜索、首页、状态栏（端口 9312）

| 编号 | 操作 | 预期 |
|---|---|---|
| B2-01 | 在首页（`Q eval "qingye.activate(null)"` 或点 `#homeButton`）截图 | 左侧导航栏 9 个按钮，图标和文字居中对齐；“首页”为选中样式；标题栏只有前进后退、“首页”标签和搜索框；红绿灯不和任何内容重叠 |
| B2-02 | 依次点 `#homeButton`、`#libraryButton`、`#workspaceButton`、`#convertButton`、`#railTasks`、`#settingsButton`、`#helpButton`，每次截图后按 Escape 或关闭弹出的界面 | 首页：回到首页；文档库：打开全库搜索；工作区：回到首页并滚动到“继续工作 / 工作区”区域；转换：打开转换中心；任务：打开任务中心；设置、帮助：打开对应界面。没有报错（`$D/app.log` 无新错误） |
| B2-03 | 焦点放到 `#homeButton` 后连按 `ArrowDown` 5 次再 `ArrowUp` 2 次，每次读 `document.activeElement.id` | 焦点在导航项之间依次移动 |
| B2-04 | 打开 PDF 后检查 `#homeButton` 的 `aria-current` | 不再是 `page`；回到首页后恢复为 `page` |
| B2-05 | `#themeButton` 切换深色，在首页和 PDF 各截图，再切回 | 深色下导航栏、标题栏、首页卡片、状态栏颜色协调，文字清晰；切回浅色正常 |
| B2-06 | `Q key Meta+Shift+P`，输入“打印”，截图；读面板里所有结果的文字 | 第一项是“打印”命令；最后两项是“在当前文档中查找“打印””和“在所有文档中搜索“打印””；按 Escape 关闭 |
| B2-07 | 在面板里输入 PDF 里存在的一个词（先用 `Q eval` 从 `text.pdf` 第 1 页取一个词），选“在当前文档中查找…”并回车 | 打开搜索并定位到该词，有命中 |
| B2-08 | 回到首页，打开面板，输入任意词 | 没有“在当前文档中查找”这一项（首页没有打开的文档），只有“在所有文档中搜索” |
| B2-09 | 选“在所有文档中搜索…” | 打开全库搜索并带上这个词 |
| B2-10 | 点标题栏搜索框 `#commandButton` | 打开同一个面板 |
| B2-11 | 打开 `text.pdf` 和 `long.pdf`，检查状态栏 | 中间是页码和缩放；左侧显示文件名，鼠标悬停（读 `title`）是完整路径；翻页时页码更新 |
| B2-12 | 用 `Q size` 看 1440x900、1100x720、1000x700、920x640 四种尺寸，PDF 模式和首页各截图，`--eval` 里检查重叠与截断 | 1000px 以下搜索框只剩图标；1100px 以下状态栏详细信息隐藏；任何尺寸下工具栏不和标题栏、导航栏重叠，“选择 / 抓手”“搜索”“侧栏”始终可见，没有文字截断 |
| B2-13 | 首页：标题、2 × 2 动作块、最近打开、右侧 PDF 工具 | 问候语为绿色并和“今天想读点什么？”同一行；动作块高度一致；最近打开列表正常 |
| B2-14 | 设置界面截图，查找“界面风格”“Windows”“macOS 风格” | 不存在界面风格选项 |
| B2-15 | 打开一个 Markdown 文件（`$F` 里的 `.md`，没有就新建一个） | 标题栏出现“笔记”按钮；Markdown 编辑器（Typora 式菜单栏和所见即所得）正常；切回 PDF 后“笔记”按钮隐藏 |
| B2-16 | 拖放提示：`Q eval` 触发 `document.body` 上的 `dragenter`（带 Files 类型），截图 | 拖放提示区域不被左侧导航栏挡住 |

### B3 · 批注工具带与批注面板（端口 9313）

| 编号 | 操作 | 预期 |
|---|---|---|
| B3-01 | 打开 `text.pdf`，确认 `#annotStrip` 隐藏 | `hidden` 为 true |
| B3-02 | 从 `#annotateButton` 菜单选“高亮” | 工具带出现在工具栏下方：标签“批注”、各批注工具（高亮为按下状态）、图形、区域下划线 / 删除线、“Esc 退出”、“批注列表”“完成”；PDF 页面没有被挡住（页面整体下移而不是被覆盖） |
| B3-03 | 在工具带上依次点自由绘制、文本框、签名等每个工具 | 每次只有当前工具是按下状态（`aria-pressed`），工具栏“批注”按钮显示当前工具名 |
| B3-04 | 用高亮工具在第 1 页拖选一段文字（用 `Q eval` 构造选区，或参考 `test/` 里已有的批注冒烟测试写法） | 生成高亮批注 |
| B3-05 | 在工具带上点矩形 / 椭圆 / 线 / 箭头 | 进入图形绘制，对应按钮按下；页面顶部出现图形样式条；拖动可画出图形 |
| B3-06 | 图形绘制中按 Escape | 图形工具结束，**工具带随之更新**（图形按钮不再按下；如果之前没有其他批注工具，工具带消失） |
| B3-07 | 图形绘制中点图形样式条的“完成” | 同上 |
| B3-08 | 工具带“批注列表” | 侧栏切到批注列表 |
| B3-09 | 工具带“完成” | 退出批注模式，工具带消失，工具栏“批注”按钮恢复 |
| B3-10 | 批注模式中按 Escape | 退出批注，工具带消失 |
| B3-11 | 在页面上做 5 条以上不同颜色、类型的批注（高亮、下划线、评论、矩形等），打开批注列表截图 | 顶部只有搜索框和“筛选”；卡片用颜色圆点区分颜色，没有左侧彩色竖条；没有勾选时看不到批量操作栏 |
| B3-12 | 展开“筛选”，按颜色和类型各筛一次 | 列表按条件过滤；“筛选”显示为“筛选 · 2”；清除后恢复为“筛选” |
| B3-13 | 在搜索框输入某条批注的原文 | 只剩匹配的卡片 |
| B3-14 | 勾选 2 条批注 | 列表下方出现批量操作栏（全选、改颜色、加 / 去标签、删除），滚动列表时它保持在底部可见 |
| B3-15 | 批量改颜色、加标签、删除，然后 ⌘Z 撤销 | 每一步都生效，撤销后恢复 |
| B3-16 | 展开“整理与导出”，导出 Markdown 和 Word | 文件写到 `$D/outputs/`，内容包含勾选（或当前筛选）的批注 |
| B3-17 | ⌘S 保存，关闭再打开文件 | 批注都在，颜色和标签正确 |
| B3-18 | 深色模式下重复 B3-02 和 B3-11 截图 | 工具带和批注面板颜色正常，文字清晰 |
| B3-19 | 批注模式中 `Q size 920x640` 截图并检查工具带 | 工具带不换行溢出窗口；放不下时可以横向滚动或收起，不和其他控件重叠 |

### B4 · 回归：工具栏、面板、Markdown、多语言、窄屏（端口 9314）

| 编号 | 操作 | 预期 |
|---|---|---|
| B4-01 | PDF 工具栏从左到右截图，逐个打开“保存 ▾”“重做 ▾”“编辑 ▾”“视图 ▾”“工具 ▾”菜单 | 菜单位置正确，不被左侧导航栏挡住，不超出窗口 |
| B4-02 | 打开工具中心（⇧⌘T）、AI 面板（⇧⌘A）、侧栏各页签 | 面板正常展开和关闭，与左侧导航栏、状态栏不重叠 |
| B4-03 | 笔记模式：PDF 工具栏“笔记”打开左右并排 | 正常并排；状态栏页码条在笔记模式下不错位（本轮规则：笔记模式下页码条不固定在状态栏） |
| B4-04 | 并排比较（视图 ▾ → 并排比较）打开 `long.pdf` | 正常；页码条不错位 |
| B4-05 | 用测试接口模拟全屏样式：`Q eval "document.body.classList.add('isFullscreen')"`，截图后去掉这个类 | 全屏时左侧导航栏隐藏，内容占满宽度 |
| B4-06 | 切到英文（`qingye.i18n.setLanguage('en')`），首页、PDF、命令面板（输入 print）、批注工具带、批注面板各截图 | 新界面文字都是英文：Library、Workspace、Tasks、Search documents, content and commands、Filter、Organize and export、Esc to exit、Search all documents for “print”；没有残留中文；英文较长时导航栏文字不溢出 |
| B4-07 | 同样检查日文和韩文、繁体中文的导航栏与首页 | 有翻译、不溢出 |
| B4-08 | 切回 `zh-CN` | 恢复中文 |
| B4-09 | Markdown：新建 Markdown，在阅读 / 编辑 / 源码间切换，打开文件树和大纲 | Typora 式菜单栏保留，配色与 PDF 界面一致，没有黑色实心按钮或明显的旧皮肤残留 |
| B4-10 | 键盘：⌘O、⌘F、⇧⌘P、⇧⌘T、⌘\\、⌘W 等窗口快捷键 | 都还有效 |
| B4-11 | 用 Tab 从标题栏走到导航栏再到工具栏，截图焦点环 | 焦点环清晰可见，顺序合理 |
| B4-12 | 检查颜色对比度：在浅色、深色下读 `--muted`、`--faint`、`--ink` 与 `--bg`、`--surface` 的计算颜色，算对比度 | 正文文字 ≥ 4.5:1，提示文字 ≥ 3:1；不达标的列出来 |
| B4-13 | 通读 `$D/app.log` | 记录所有 error / warning，尤其是 `rail`、`annotStrip`、`command-palette` 相关的 |
