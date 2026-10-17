# 青页 PDF 0.19.1 开发交接

工程版本，基于 0.19.0（分支 `release-0.19.1`，从 `release-0.19` 的 `cd5156f` 开出）。不改功能，只加自动检查、修两处性能问题、把两个大文件按域拆开。改动清单见 [CHANGELOG](CHANGELOG.md)。

## 运行与验证

```powershell
npm ci; node node_modules/electron/install.js   # npm 11 默认不跑 Electron 的安装脚本，需手动下载二进制
npm run verify                                    # oxlint + 单元测试（131 项，1 项仅 POSIX 跳过）
npm run test:coverage                             # 可选：带覆盖率
node scripts/ci-smoke.cjs                         # 9 个 Electron 冒烟套件
npm run dist                                      # 安装版 + 安装目录 ZIP
```

0.19.1 验证结果：`npm run lint` 0 告警 0 错误（163 个文件）；单元测试 131 项通过、1 项跳过；9 个冒烟套件（smoke、markdown、conversion、safety、basic、features、notes、links、pdf014）全部通过。**本版没有重新打包**：`dist/` 里仍是 0.19.0 的产物，发布前需要 `npm run dist`。

## 0.19.1 新增模块与改动点

| 位置 | 作用 |
|---|---|
| `.oxlintrc.json` + `npm run lint` | 只启用正确性规则；关闭 `no-control-regex`、`unicorn/prefer-string-starts-ends-with`、`unicorn/no-useless-spread` 三条（原因见 CONTRIBUTING） |
| `test/consistency.test.mjs` | 版本号五处一致、Android 版本名与 versionCode 同步、`build.files` 完整且无死条目 |
| `qingye-protocol.cjs` | `qingye://` 协议、CSP、默认会话的权限与网络拦截 |
| `window-shell.cjs` | 窗口创建、标题栏 overlay / 亚克力、应用菜单、窗口控制与全屏事件转发 |
| `installer-hooks.cjs` | 安装程序的 `--register/refresh/unregister-file-types` 钩子 |
| `office-task.cjs` | Office 转换任务队列、进度卡片、取消、重新转换、原文件变化监视、空闲预热 |
| `reference-ipc.cjs` | 全库搜索 IPC、DOI 查询、`.bib` / 文本导出 |
| `ui/recent-list.mjs` | 首页最近列表（类型筛选、按名筛选、移除条目） |
| `ui/theme.mjs` | 浅色 / 深色主题、跟随系统、标题栏同步 |
| `ui/draft-recovery.mjs` | 每 3 秒的草稿检查点（含 FreeText 焦点保持那段逻辑） |
| `ui/shortcuts.mjs` | 全部键盘快捷键（含 PDF 框架内的按键） |
| `ui/commands.mjs` | 主进程命令分发（菜单、窗口事件、转换卡片） |
| `ui/history-ui.mjs` | 撤销 / 重做（PDF.js 原生历史与字节快照两条线）与编辑历史对话框 |
| `library-index.cjs` | Markdown 行号增量计数、折叠文本缓存（24 MB 上限） |

拆分时踩到的两个坑（都已修，留作提醒）：工厂函数返回值的形状要和调用点一致（`commands` 一度返回函数却被当成 `{run}` 调用，`guard` 把它变成一句错误提示，四个冒烟套件超时）；跨模块的延迟依赖要用 getter 传（`notes` / `library` / `ai` 在主进程里是后创建的 `let`，直接按值传会拿到 undefined）。

## 没有验证的部分

- **安装包没有重新构建**：`npm run dist` 未在本版运行，安装程序相关路径（选项页、文件关联、卸载保留数据）沿用 0.19.0 的验证结论。
- 冒烟套件只覆盖 Windows 桌面；安卓与 macOS 未构建、未运行。
- 覆盖率数字没有设门槛，只是可查。

## 已知限制 / 后续

- `main.cjs` 616 行、`ui/app.mjs` 558 行仍是最大的两个文件；`addDocument`（PDF 标签生命周期）与 `tools-job`（工具箱任务流水线）是最值得继续下沉的两块。
- `scripts/write-build-report.cjs` 是 0.9 期的脚本，仍在等 `QingyePDF-<版本>-win-x64.exe` 便携版与 `buildRevision: dev1`，而 0.18 起只发布安装版，这个脚本目前跑不通，需要重写或删除。
- 界面行密度（`ui/tools.mjs` 平均 142 字符 / 行、最长 1168 字符）是刻意风格，格式化统一留待专门的重构版本。

---

# 0.19.0 开发交接（历史）

基于 0.18.0（分支 `release-0.19`，从 `56f4871` 开出）。版本号直接从 0.18 跳到 0.19；0.17 系列不在这条线上（归档在 `archive/0.17-broken-line`）。改动清单见 [CHANGELOG](CHANGELOG.md)，用户说明见 [docs/USER-GUIDE.md](docs/USER-GUIDE.md) 的“0.19.0 新功能”。上一版交接（0.14 / 0.15）见本文末尾。

## 运行与验证

```powershell
npm ci; node node_modules/electron/install.js   # npm 11 默认不跑 Electron 的安装脚本，需手动下载二进制
node scripts/prepare-pdfjs.mjs; ./scripts/prepare-pandoc.ps1; ./scripts/prepare-libreoffice.ps1; ./scripts/build-backend.ps1
npm test                                          # 127 项（1 项仅 POSIX，Windows 跳过）
.backend-build/Scripts/python.exe backend/test_worker.py   # 84 个任务
node scripts/ci-smoke.cjs                         # 9 个套件
npm run dist                                      # 安装版 + 安装目录 ZIP
```

`build-backend.ps1` 在 Windows PowerShell 5.1 里会因为 PyInstaller 往 stderr 写日志而被 `$ErrorActionPreference='Stop'` 中断；可以在 Git Bash 里直接运行脚本中的 PyInstaller 命令。源码目录里如果 `backend/bin` 的冻结 worker 比 `backend/worker.py` 旧，`offline.cjs` 会改用 Python 运行源码（0.19 起），不会再出现“不支持的文档操作”。

0.19.0 验证结果：127 项单元测试通过（1 项跳过）；后端 84 个任务通过；9 个冒烟套件（smoke、markdown、conversion、safety、basic、features、notes、links、pdf014）通过；打包后的应用（dist/win-unpacked）跑 7 个打包套件全部通过。产物：`QingyePDF-0.19.0-Setup-x64.exe`（约 345 MB）、`QingyePDF-0.19.0-win-x64.zip`（约 466 MB），校验值在 `dist/SHA256SUMS-0.19.0.txt`。

## 0.19 新模块与改动点

| 位置 | 作用 |
|---|---|
| `office-convert.cjs` | 分阶段进度（reading / cached / queued / starting / converting）、排队时可取消、`prewarm()` 预热 |
| `ui/office-progress.mjs` | 右下角转换卡片、30 秒提示、原文件变化提示 |
| `main.cjs` | Office 任务 id、`office-cancel` / `office-reconvert`、原文件监视、空闲预热（`preferences.officeUsed`）、最近列表带 `kind`；安装程序钩子 `--register-file-types` / `--refresh-file-types` / `--unregister-file-types`；`check-update` 用独立会话（默认会话仍拦截全部网络请求） |
| `ui/annot-edit.mjs` + 后端 `annot-update` | 选中已写入的批注，移动 / 缩放 / 改样式 / 备注 / 删除。保存会重编对象号（`garbage=4`），修改后按类型和位置重新选中 |
| `ui/annot-presets.mjs` | 每种工具最多 4 个样式预设（localStorage） |
| `ui/compare-diff.mjs` | 阅读器内文字差异：中文按字、其他按词，LCS（首尾裁剪），标记画在 PDF.js 页面上 |
| `ui/markdown/fence-editor.mjs` | 代码块的 CodeMirror 编辑器（Markdown 语言 + 嵌套代码语言）；`editor.mjs` 里 `active.cm` 分支处理读写、光标、按键、粘贴 |
| `ui/markdown/editor.mjs` 大文档 | ≥6 万字符时块按 80 个一组放进 `.mdChunk`（`content-visibility: auto`），`markCurrentHeading` 二分查找并先量组 |
| `pandoc-markdown.cjs` | `cleanClipboardHtml` + `pandocHtmlToMarkdown`：Office 剪贴板 HTML 经 Pandoc 转 Markdown |
| `ui/markdown/typora-ui.mjs` / `markdown-ipc.cjs` | 图片缩放滑块、替代文字、重命名 / 移到图片文件夹（`markdown-image-op` 的 `rename` / `move` / `open`），`retargetImages` 一步更新全部引用 |
| `update-check.cjs` | 手动检查 GitHub Releases |
| `build/installer.nsh` | NSIS 附加选项页、升级保留选择、卸载询问删除用户数据；electron-builder 顶层的 Windows `fileAssociations` 已删除 |
| `vendor/codemirror` | 重新打包，加入 24 种语言（构建方法见 docs/BUILDING.md） |
| `scripts/sample-guide` | 示例 PDF 可在 Windows 上生成（系统 Noto Sans SC 可变字体 + Electron 打印） |
| `scripts/i18n/src/15-release-019.tsv` | 0.14–0.19 新增的 232 条界面文字的四种译文 |

诊断工具：`QINGYE_SMOKE_ROOT="$PWD/test-output/profile-root" npx electron . --markdown-profile` 对 1 MB 文档的一次回车做 CPU 采样（`test/profile-enter.cjs`，不在 CI 中）。

## 没有验证的部分

- **安装程序的新页面没有实际安装测试**：只验证了 NSIS 能编译、打包后的应用能运行（`npm run dist` 成功）。附加选项页、桌面快捷方式勾选、文件关联注册、升级保留、卸载询问都需要在一台干净的 Windows 上手动走一遍（会改当前用户的注册表，开发机上没有运行）。开发模式下的 `--register-file-types` 按设计会拒绝并退出码 1。
- **检查更新没有连真实 GitHub 测试**：单元测试用的是假 fetch；安装 0.19 后在 设置 → 关于 点一次确认（GitHub 上还没有 0.19 发布时应显示“已是最新版本”或较旧的版本号）。
- 代码块编辑器的输入法（中文 IME）只在 CodeMirror 自身层面工作，没有专门测试组合输入时的撤销分组。
- 翻译是人工写的，没有母语者校对；日文、韩文里的个别术语可能不够地道。
- 安卓与 macOS 没有重新构建（mobile 版本号仍为 0.18.0，没有改动）。

## 已知限制 / 后续

- 大文档回车仍约 0.2 秒，主要耗在 `reconcile`（约 50 ms）和布局；增量解析未做。
- 手绘、云形框、折线、文字标记只能改样式和删除，不能拖动。
- 阅读器内比较只比文字层，不比图像和版式。
- Pandoc 常驻服务模式、测量工具未做。

---

# 0.15.0 / 0.14.0 交接（历史）

**0.15 新增**：Office 文件以 PDF 打开（`office-convert.cjs`，随包 LibreOffice 26.2.6，由 `scripts/prepare-libreoffice.ps1` 准备，打包到 `resources/libreoffice`）；工具箱 Office 导入也走 LibreOffice。发布物只有安装版和安装目录 ZIP。LibreOffice 启动时会加载自带的 Python，裁剪时不能删除。

0.14 新模块：`pandoc-markdown.cjs`（Pandoc 方言、导入写出器、导出任务、主题 `reference.docx`）、`ui/markdown/pandoc-prep.mjs` / `export-pandoc.mjs`、`ui/markdown/math-numbers.mjs`、`ui/markdown/source-editor.mjs`（CodeMirror 源码模式）、`ui/markup.mjs` / `ui/shapes.mjs`；后端动作 `markup`、`draw`、`annot-delete`、`redact-find`，`redact` 支持多区域，`crop` 支持 `cropMode`，`compress` 支持 `profile`。研究与路线见 [docs/research](docs/research)，0.13 交接见 [HANDOFF-0.13.0](docs/history/HANDOFF-0.13.0.md)。
