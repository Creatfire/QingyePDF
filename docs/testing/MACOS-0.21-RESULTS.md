# macOS 0.21 并行测试结果汇总

被测：`dist/mac-arm64/QingyePDF.app` 0.20.0（DMG SHA-256 `4ff1f1ec…bfe`），分支 `feat/toolbar-redesign`，基于 `d833b50`。测试步骤见 [MACOS-0.21-TEST.md](MACOS-0.21-TEST.md)。8 个 agent 在 MiniMax Code 中运行，时间为 2026-10-28 10:51–21:32（PDT）。8 份报告都已交回；报告里的结论由汇总人对照源码和证据文件逐条抽查过。所有测试实例都已停止，没有残留进程。

## 各卡统计

| 任务卡 | 通过 | 失败 | 阻塞 | 说明 | 报告 |
|---|---|---|---|---|---|
| A1 构建产物与自动测试 | 10 | 2 | 0 | 失败的两项都是冒烟流水线，原因在测试脚本 | `test-output/agents/A1/report.md` |
| A2 工具栏第一、二期 | 15 | 0 | 1 | A2-03 用 CDP 发 Esc 关不掉原生打印面板 | `test-output/agents/A2/report.md` |
| A3 工具中心、固定与停靠 | 14 | 1 | 0 | | `test-output/agents/A3/report.md` |
| A4 命令面板、快捷键、窄宽度与多语言 | 10 | 2 | 0 | 测完已把语言切回 zh-CN | `test-output/agents/A4/report.md` |
| A5 PDF 处理工具结果正确性 | 14 | 1 | 0 | 每个输出都用 Python 库读过 | `test-output/agents/A5/report.md` |
| A6 编辑、批注、页面管理、撤销与保存 | 10 | 2 | 0 | A6-03 算部分通过 | `test-output/agents/A6/report.md` |
| A7 Office、Markdown、转换中心、笔记与搜索 | 10 | 1 | 0 | 没有联网，也没有配置 AI | `test-output/agents/A7/report.md` |
| A8 系统集成与人工交互 | 8 | 2 | 0 | 另有 3 项部分通过；没有辅助功能权限，5 个子步骤阻塞 | `test-output/agents/A8/report.md` |
| **合计** | **91** | **11** | **1** | 另有 3 项部分通过 | |

## 问题清单（按严重程度）

“核实”一列是汇总人对照源码或证据文件做的抽查结果。路径 `A1/…`～`A8/…` 都在 `test-output/agents/` 下。

### 严重

| 编号 | 问题 | 重现 | 证据 | 核实 |
|---|---|---|---|---|
| A8-BUG-1 | 在 PDF 页面里按 ⇧⌘P，弹出的是系统打印面板而不是命令面板；面板打开期间渲染进程卡住（复现 3/3）。A4-01 显示通过，是因为 CDP 按键发到了顶层文档，没经过 PDF.js 的 iframe | `node scripts/agent-session.cjs key --name A8 Meta+Shift+P`，之后执行 `eval "1+1"` 不返回 | `A8/shots/A8-05-2-print-panel-window.png` | 属实：`vendor/pdfjs/web/viewer.mjs:9014-9020` 在 window 的捕获阶段拦截 ⌘P；Electron 里有 `window.chrome`，Shift 豁免因此失效。应用自己的处理挂在 `ui/app.mjs:352` 的 document 上，排在它后面 |
| A6-05-BUG-1 | 在后台标签上应用页面管理，会一直停在“正在应用修改…”，不超时、不报错，切回该标签后才完成 | `node test-output/agents/A6/pmhang.cjs --port 9306 --name long.pdf --other text.pdf` | `A6/pmhang-run.log` | 属实：`ui/app.mjs:117` 在等 `onePageRendered`，而隐藏的 iframe 尺寸为 0，永远不会渲染。同一条路径（`replaceDocument`）上的其他编辑可能也受影响 |
| A6-03-BUG-1 | 批注菜单的“评论”只打开 PDF.js 的评论侧栏，在页面上无法新建评论批注 | A6 报告中点 `editorCommentButton` 后在页面上点击，`annotationStorage` 不变 | `A6/shots/A6-03-comment-mode-no-entry.png` | 属实：`ui/app.mjs:294-302` 没开启 `enableHighlightFloatingButton`。新建评论的入口（浮动工具栏、PDF.js 右键菜单）都被关闭或被 `ui/direct.mjs` 的右键菜单拦掉了 |
| A3-BUG-1 | 工具中心从“居中”切回“停靠”后，`body` 丢了 `toolsDocked` 类，`#viewers.right` 为 0，400 px 宽的面板压在文档上；要关掉再开才恢复 | `node test-output/agents/A3/a3.cjs '[{"key":"Meta+Shift+T"},{"wait":1200},{"click":"#toolDock"},{"wait":1200},{"click":"#toolDock"},{"wait":1500},{"eval":"document.body.className"}]'` | `A3/shots/A3-10c-bug-dock-toggle-back.png`、`A3/A3-10-repro.json` | 属实：`ui/tools.mjs:217-218` 先 `dialog.close()` 再加类，`:223` 的 `close` 监听异步触发，又把类删掉 |
| A8-BUG-3 | ad-hoc 签名的新包首次启动会弹出系统钥匙串口令框（“qingye-pdf Safe Storage”），每出一个新包都要问一次 | 用 `ditto` 把 DMG 里的 app 复制到 `/Applications`，再 `open` | `A8/shots/A8-02-gatekeeper-dialog.png` | 属实，本轮测试中确实在共享屏幕上弹出过。根因与 A1-BUG-2 相同。发布前需要 Developer ID 签名并公证 |
| A1-BUG-2 | `node scripts/ci-smoke.cjs --packaged` 卡在 startup 阶段：打包版没带 `--use-mock-keychain`，被钥匙串弹窗挡住 | `node scripts/ci-smoke.cjs --packaged --report /tmp/pkg.json` | `A1/evidence/packaged-hang/`、`A1/A1-10B-packaged-smoke-keychain.log` | 属实：`scripts/ci-smoke.cjs` 里没有 `mock-keychain`，`agent-session.cjs:55` 有。这是测试脚本的问题 |
| A1-BUG-1 | 冒烟断言“⌘C 复制 OCR 文字”失败，剪贴板为空（源码版、打包版都出现） | `node scripts/ci-smoke.cjs --only smoke --report /tmp/repro.json` | `A1/A1-09-source-smoke.log` | 冒烟流水线确实失败。但 A8-08 通过菜单的复制路径复制后，`pbpaste` 读到完全一致的文字，说明**产品的复制功能可用，是测试脚本的问题**（合成按键进不了 iframe 焦点），需要改冒烟测试 |
| A1-BUG-3 | 冒烟断言“进入原生全屏”在并行负载下 8 次全失败（源码版、打包版一致） | 同上 | `A1/A1-09-source-smoke-repeat.log`、`A1/A1-10C-packaged-smoke-repeat.log` | `test/smoke.cjs:160` 只等 4 秒。A8-06 实测 `desktop.fullscreen()` 能进入全屏，**产品的全屏功能可用，是测试等待时间太短**，需要改冒烟测试 |

### 一般

| 编号 | 问题 | 重现 | 证据 | 核实 |
|---|---|---|---|---|
| A4-BUG-2（与 A1-OBS-1、A8-BUG-2 是同一问题） | macOS 上，命令面板和标题栏的 13 个快捷键提示全部显示 `Ctrl+…` 而不是 ⌘（A4-02 因此失败；tooltip 显示正确） | 先执行 `test-output/agents/A4/q key Meta+Shift+P`，再执行 `q eval "[...document.querySelectorAll('kbd')].map(e=>e.textContent)"` | `A4/shots/A4-02-command-print.png` | 属实：`ui/app.mjs:609` 写死了 `'Ctrl+P'`；`ui/i18n/i18n.mjs:21` 的跳过列表包含 `kbd`，平台适配不会处理它 |
| A4-BUG-3 | 工具中心“操作摘要”的后半句，在 en / ja / ko / zh-TW 下仍是简体中文（A4-11 失败） | 执行 `q eval "qingye.i18n.setLanguage('en')"`，打开水印工具，读取 `#toolChangeSummary` | `A4/shots/A4-11-*-toolsDialog.png` | 属实：`ui/tools.mjs:279` 把整句拼成一个文本节点，而 i18n 只能匹配开头 |
| A4-BUG-1 | 命令面板搜索框里有文字时，按一次 Esc 只清空文字，按第二次才关闭；底部提示却写着“Esc 关闭” | 依次执行 `q key Meta+Shift+P`、`q type 打印`、`q key Escape`，此时 `commandPalette.open` 仍为 true | `A4/shots/A4-02-command-print.png` | 属实：搜索框是 `type="search"`，`ui/command-palette.mjs:44-47` 的 keydown 处理没管 Escape |
| A5-BUG-1 / A7-BUG-1 | 内容为纯文本的 `broken.docx`（0 字节和随机字节的也一样）不报错，被 LibreOffice 当作文本转成 PDF，任务显示“已完成”（A5-06、A7-02 因此失败）。真正损坏的 ZIP 包会正常报错 | A5：依次执行 `Q queue-open "$F/broken.docx"`、`Q click "#pickToolAsset"`、`Q click "#executeTool"`；A7：`Q open "$F/broken.docx"` | `A5/evidence/A5-06/broken-import.pdf` | 属实：用 PyMuPDF 读出的正文就是 `this is not a real docx file`。`office-convert.cjs` 把格式判断完全交给了 LibreOffice |
| A6-07-BUG-1 | 批量改色对 FreeText 批注失败，并弹出英文错误“cannot be used for FreeText annotations” | 在侧栏“批注”里筛出 FreeText，选中后改色 | `A6/shots/A6-07-annot-panel.png` | 证据齐全，错误信息来自后端 |
| A6-08-BUG-1 | 目录编辑时，如果输入框没先获得焦点就改了内容，会抛 `TypeError`；之后每次目录编辑都报错，“撤销目录”按钮一直不可用 | 打开“编辑目录…”，在未聚焦输入框的情况下修改标题后失焦 | A6 报告 | 属实：`ui/outline.mjs:10` 的 `inputBefore` 只在 focus 时赋值（`:30-31`），而 `ui/history.mjs:7` 会读取 `undefined.byteLength`。正常操作（先点进输入框再改）不会触发 |
| A3-BUG-2 | macOS 外观下，工具中心固定在顶部的标题栏背景透明，滚动时卡片和“工具 / 文件名”叠在一起 | A3 报告中的 `a3.cjs` 命令（`toolsDialog.scrollTop=430`） | `A3/shots/A3-BUG2-header-overlap.png` | 属实：`ui/macos.css:137` 把背景设成 `transparent`，覆盖了 `ui/design.css:12` |
| A3-BUG-3 | 停靠状态下打开新文档，工具面板直接关闭，没有跟到新标签 | 执行 `q open "$F/text-v2.pdf"`，然后检查 `toolsDialog.open` | `A3/shots/A3-BUG3-panel-closed-on-open.png` | 属实：新文档 `loaded=false` 时，`ui/tools.mjs:256-257` 会走到 `dialog.close()` |
| A8-BUG-4 | macOS 上关掉最后一个窗口，应用直接退出；Dock 图标没固定时用户点不回来（A8-04 要求的操作路径走不通） | 打开应用，点红色交通灯，再用 `ps` 查，进程已不在 | A8 报告 | 属实：`main.cjs:626` 写的是 `app.on('window-all-closed', () => app.quit())`，没有对 macOS 区别处理 |
| A8-02 | 带下载隔离属性的副本没有弹“未公证”提示，而是被 App Translocation 转到随机只读目录启动；交付的 DMG 本身没有 `com.apple.quarantine` | A8 报告 | `A8/shots/A8-02-caseB-clean.png` | 记录属实。算不算失败取决于发布方式，需要人工判断 |
| A3-ENV-02 | 有一次执行 `Q start --packaged "$F/text.pdf"` 没打开文件，而是弹出 “Cannot open file … realpath '/text.pdf'” | 未能稳定重现（又试了 3 次都正常） | `A3/dialogs.log` 第 1 条 | 记录属实。怀疑是强杀后重启时 `open-file` 事件的时序问题，需要复测 |
| A2-BUG-1 | 打印面板是原生模态的 `NSPrintPanel`，CDP 发的 Esc 关不掉它，面板打开期间所有 CDP 命令都会挂起 | 按 A2 报告执行 `Q click "#printButton"`，再执行 `Q key Escape` | `A2/evidence/A2-03-printpanel-frames.txt` | 证据齐全。只影响测试驱动，不影响真实用户 |

### 轻微

| 编号 | 问题 | 证据 / 核实 |
|---|---|---|
| A4-BUG-4 | 命令面板搜索框的提示文字在四种语言下都是简体中文 | 属实：`ui/command-palette.mjs:8` 硬编码，`scripts/i18n/catalog.json` 和各语言词典里都没有这一条 |
| A7-BUG-2 | 非中文界面下，Office 转换卡片中英混排 | 属实：`office-convert.cjs:93`、`:99` 等进度文案是硬编码中文，没有用 `T()` 包起来 |
| A7-BUG-3 / A6-04-BUG-1 | `qingye.i18n.setLanguage()` 只改了渲染进程，主进程的文案（例如关闭时的“Save changes”确认框）仍是旧语言 | 属实：`ui/i18n/i18n.mjs:101-112` 没有调用 `window.desktop.setLanguage`。设置界面走的是另一条路径，正常用户不受影响；测试文档第 2 节应补一句“两个进程都要设” |
| A8-BUG-5 | 中文界面下，“窗口”菜单的三项是英文（Minimize / Zoom / Bring All to Front） | 属实：`window-shell.cjs:85` 用的是 `role: 'windowMenu'`，子项由 Electron 按系统语言生成 |
| A3-BUG-4 | 从工具详情页返回后搜索词没清空，“最近使用”分组被隐藏 | 属实：`ui/tools.mjs:197` |
| A5-BUG-2 | 批量任务取消后，摘要仍写“已处理 5 个文件”，实际只产出 4 个 | 属实：`ui/tools.mjs:323` 计算时没扣掉已取消的 |
| A5-BUG-3 | “Office / 图片转 PDF”的任务行显示的是当前文档名，而不是被导入的文件名 | 属实：`ui/tools.mjs:307/317/320` |
| A6-01-BUG-1 | 图片印章、图形在编辑历史里的名称带着“新文字”字样 | `ui/direct.mjs` 拿 `r.text` 当标签 |
| A7-BUG-5 | 区域摘录撤销后，`assets/` 里的图片文件还留在磁盘上 | 只多出一个小文件 |
| A7-BUG-4 | 用内部 API 多次切换 Markdown 视图后点“源码”，CodeMirror 报错，按钮状态不同步 | 在干净实例上没复现，记为疑似；截图 `A7/shots/A7-07-source-switch-error.png` |
| A2-BUG-2、A2-OBS-4 | 一次卡在“正在应用修改…”；“选择”按钮一次处于 disabled | 都没复现。前者很可能和 A6-05-BUG-1 是同一个原因（隐藏状态下等待渲染） |

### 测试工具与测试文档

| 编号 | 问题 | 建议 |
|---|---|---|
| A2-OBS-5 / A3-ENV-01 | 用全新配置目录第一次 `Q start` 时，DevTools 端口能连上但不响应，重启一次就好 | 很可能是加 `--use-mock-keychain` 之前的钥匙串弹窗造成的。另外 `agent-session.cjs` 的 `fetch` 没有超时，会一直挂着 |
| A8-环境 | 没开辅助功能权限，原生交通灯、原生右键菜单、触控板手势、输入法候选框、真实按键共 5 个子步骤阻塞 | 下一轮需要先给测试 agent 开权限，或者由人工来做 |
| 测试文档 | A8 卡写的配置目录 `QingyePDF`，实际是 `qingye-pdf`；`scan.pdf` 的扫描页只有英文；`stamp.png` 实际是灰色；第 2 节只设置了渲染进程的语言；文档写 npm 11.21.1，实测是 10.9.9 | 修改 `MACOS-0.21-TEST.md` 和 `scripts/agent-fixtures.py` |
| 驱动脚本 | `Q click --right` 不会触发 `contextmenu` 事件；页面管理里“插入 PDF…”用的是 `<input type=file>`，脚本拦截不到；A2-OBS-3 中模态对话框会挡住 CDP 点击 | 在 `agent-session.cjs` 里补上 `buttons: 2`，并在测试文档里说明 |

## 需要人工确认

- **A8 阻塞的子步骤**：点原生红绿灯、全屏后按 Esc 退出、在原生右键菜单里拷贝/粘贴、触控板滚动与缩放、输入法候选框位置。这几项需要真实操作，也就是 A2-03 用键盘按 Esc 取消打印。
- **A8-02**：决定交付方式（DMG 直接分发还是先公证）后，再判断 Gatekeeper 的行为是否符合预期。
- **A8-10**：在 Retina 下看 200% / 400% 缩放是否清晰。
- **A2-16**：新窗口没有调试端口，只确认了进程和渲染进程已经创建，窗口内容需要人眼确认。
- **A3-ENV-02**：命令行传入的文件偶尔打不开，需要复测。

## 对用户环境的影响

A8 为测试暂时把 `/Applications/QingyePDF.app`（用户自己装的 0.13.0）挪开过，结束后已搬回。汇总人复查：版本为 0.13.0，系统外观仍是 Dark，显示器是 3840×2160 的 Retina 模式。`~/Library/Application Support/qingye-pdf` 已从备份恢复，备份在 `test-output/agents/A8/backup/`。本轮测试中 agent 没有修改仓库源码。

## 修复状态（2026-10-29）

严重和一般问题已在源码中修复，尚未提交。验证方式：`npm run verify`（149 项通过，1 项按平台跳过）、`backend/test_worker.py`（102 项任务通过）、9 个源码冒烟套件；另外用 `agent-session.cjs` 在源码实例里逐项复测。打包版还没有重新构建，DMG 仍是修复前的版本。

| 编号 | 状态 | 改动 | 复测 |
|---|---|---|---|
| A8-BUG-1 ⇧⌘P 打开打印面板 | 已修复 | `scripts/pdfjs-patches.cjs` 新增 `patchViewer`，已应用到 `vendor/pdfjs/web/viewer.mjs`，`prepare-pdfjs.mjs` 会重新应用 | 焦点在 PDF iframe 内按 ⇧⌘P，打开的是命令面板，CDP 仍能正常响应 |
| A6-05-BUG-1 后台标签卡在“正在应用修改…” | 已修复 | `ui/app.mjs` 的 `replaceDocument` 只在 iframe 可见时等待渲染 | 在后台标签上应用水印，203 ms 完成 |
| A6-03-BUG-1 无法新建评论 | 已修复 | `ui/shapes.mjs` 新增 `note` 模式，`editorCommentButton` 改为进入该模式；后端 `draw` 新增 `shape: 'note'`，写入 Text 批注 | 点页面、输入文字后，生成 `Text` 和 `Popup` 两条批注；后端测试已加 |
| A3-BUG-1 切回停靠后面板压住文档 | 已修复 | `ui/tools.mjs`：`close` 事件里，面板如果已重新打开就不再删除 `toolsDocked` 类 | 切换两次后，`toolsDocked` 仍在，`#viewers` 的 right 为 400px |
| A3-BUG-3 打开新文档时停靠面板关闭 | 已修复 | `ui/tools.mjs` 的 `sync()` 遇到还在加载的文档时先等待 | 未单独复测 |
| A4-BUG-2 / A1-OBS-1 / A8-BUG-2 快捷键显示为 Ctrl | 已修复 | `i18n.mjs` 导出 `shortcutText`；命令面板和标题栏的 `<kbd>` 改用它 | 标题栏显示 `⇧⌘P`，命令面板显示 `⌘P` |
| A4-BUG-1 Esc 要按两次 | 已修复 | `ui/command-palette.mjs` 处理 Escape 键 | 输入文字后按一次 Esc，面板关闭 |
| A4-BUG-3 操作摘要半句未翻译 | 已修复 | `updateSummary` 把每个固定短语放进单独的文本节点，用户输入的值标为 `translate=no` | 英文界面整句为英文（工具名也会翻译） |
| A5-BUG-1 / A7-BUG-1 伪造的 docx 被转换 | 已修复 | `office-convert.cjs` 的 `checkPackage` 检查 ZIP 格式文件的文件头，空文件也会报错 | 单元测试已加 |
| A6-07-BUG-1 FreeText 批量改色失败 | 已修复 | `worker.py` 新增 `recolor_annot`，`annot-batch` 和 `annot-update` 都改用它，之后重新嵌入中文外观 | 后端测试已加 |
| A6-08-BUG-1 目录输入未聚焦时报错 | 已修复 | `ui/outline.mjs` 在第一次输入时记录修改前的状态 | 未单独复测 |
| A3-BUG-2 macOS 标题栏透明 | 已修复 | `ui/macos.css` 改用 `--glass-sheet` 加模糊 | 需要人眼确认 |
| A8-BUG-4 关闭窗口即退出 | 已修复 | macOS 上红色按钮先关闭全部文档再隐藏窗口，`activate` 重新显示，⌘Q 退出（冒烟测试模式除外） | 需要人工确认 |
| A1-BUG-1 / A1-BUG-3 / A1-BUG-2 冒烟脚本问题 | 已修复 | 复制改用 `webContents.copy()`，全屏最多等 15 秒，`ci-smoke.cjs` 加 `--use-mock-keychain` | smoke 套件通过 |
| A8-BUG-3 钥匙串口令框 | 未修复 | 发布前需要 Developer ID 签名并公证 | — |
| A8-02、A3-ENV-02、A2-BUG-1 | 未处理 | 分别是待定的发布方式、无法重现、只影响测试驱动 | — |

冒烟测试中 `notes` 套件不稳定（4 次中失败 2 次，失败在 `test/notes010-smoke.cjs:52`）。去掉本次的 `ui/` 改动后重跑结果相同，说明这是原有问题，与本次修复无关。轻微问题留待以后处理。
