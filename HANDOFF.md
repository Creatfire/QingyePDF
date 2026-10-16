# 青页 PDF 0.19.0 开发交接

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
