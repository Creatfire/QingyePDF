# 青页 PDF 0.23.0-beta.1 开发交接

测试版，基于 `ui-redesign-0.22`，只构建 macOS arm64（未签名）。改动见 [更新记录](../history/CHANGELOG.md)。

| 位置 | 作用 |
|---|---|
| `ui/home.mjs` | 首页：输入框、正在读、书架、笔记与摘录，缩略图和章节的采集 |
| `home-ipc.cjs` | 首页数据：`home-feed`、缩略图（最多 30 张）、高亮缓存、笔记预览；数据在用户数据目录的 `home/` |
| `ui/library.mjs` | 新增 `withPdf`：在打开的标签或文件上运行一段读取逻辑，首页读高亮和全库索引共用 |

## 0.21.0 的交接内容

基于 0.20.0。主要改动：工具栏、工具中心和命令面板重构；修复 macOS 并行测试发现的问题；LibreOffice 不再随安装包提供，改为第一次转换时下载。上一版的交接见 [0.20.0 交接](../history/HANDOFF-0.20.0.md)，改动清单见[更新日志](../history/CHANGELOG.md)。

## LibreOffice 按需下载

| 位置 | 作用 |
|---|---|
| `office-engine.cjs` | 固定版本和 SHA-256；下载（续传、断线重试、卡住 60 秒算断线）、解压（Mac 用 `hdiutil` + `ditto`，Windows 用 `msiexec /a` 后按 `prepare-libreoffice.ps1` 裁剪）、一次改名装到 `<用户数据>/engines/libreoffice/<版本>`；`createInstaller` 保证多个文件共用一次询问和一次下载 |
| `office-convert.cjs` | 依次查找 `QINGYE_LIBREOFFICE_DIR`、随包目录（开发时为 `vendor/libreoffice`）、用户数据目录。`toPdf` 在缓存未命中且文件通过检查后才调用 `ensureEngine` |
| `office-task.cjs`、`main.cjs` | 询问对话框、独立会话 `qingye-engine-download`、进度文字；工具中心和转换中心共用同一入口 |
| `scripts/check-office-engine.cjs` | 用真实安装包走一遍安装和转换，CI 在各平台运行 |

升级 LibreOffice 时，要同时改 `office-engine.cjs` 和两个 `prepare-libreoffice` 脚本，`test/office-engine.test.cjs` 会检查两边一致。

`vendor/libreoffice` 只用于开发和测试，不进安装包。自动化运行（`--*-smoke`）不会询问也不会下载。

## 没有验证的部分

- **Windows 上普通用户权限下的 `msiexec /a`**：CI 运行环境通常有管理员权限，测不出来；开发机上也没有 Windows。需要在普通账户的 Windows 上实际试一次。
- **经系统代理下载**：下载走 Chromium 网络栈，应当使用系统代理，但没有在代理环境测试。
- 钥匙串口令框：要配置 Developer ID 证书和公证才会消失，未配置时仍然存在。
- 标题栏毛玻璃效果和 macOS 红色按钮的新行为没有人工确认。
- 新增界面文字的英、繁、日、韩译文没有母语者校对。
- 安卓未构建（版本号仍为 0.18.0）。

## 已知问题

- 笔记模式冒烟套件（`notes010-smoke.cjs:52`）偶发失败，重跑通过；撤掉界面改动后同样出现，不是本版引入。
- macOS 测试中的轻微问题未处理，见 [测试结果](../testing/MACOS-0.21-RESULTS.md)。

## 验证记录

以下是 Apple 芯片 Mac 上的本机结果；Windows 和 Intel Mac 的结果以发布标签的 GitHub Actions 运行为准。

- `npm run verify`：单元测试 160 项通过，1 项跳过，0 失败。后端 `backend/test_worker.py`：102 个任务通过。
- `scripts/check-office-engine.cjs`：真实安装包安装并转换通过。
- 打包版实测：打开 `.docx` 时询问一次，从官方站点下载（约 29 分钟，取决于镜像速度），校验、安装（约 800 MB）后正确打开为 PDF；安装失败后重试不会重新下载；重启后打开 `.pptx` 直接转换，不再询问。
- 打包版冒烟 7 个套件：只有 smoke 和 notes 出现过失败，单独重跑都通过。其间 smoke 套件有几次在约 25 秒处失败：一次提前退出（exit 0、状态仍为 running，原因不明），四次是 `capturePage` 报 `UnknownVizError`，集中在同一段时间，之后 3 次连续通过（此前也有 5 次连续通过）。`UnknownVizError` 来自窗口截图，疑与当时屏幕或窗口状态有关，未能确认。
- 产物：`QingyePDF-0.21.0-mac-arm64.dmg` 约 238 MB（0.20 同配置约 534 MB），应用解压后约 629 MB。
- 真实测试发现并修复：`hdiutil` 拒绝把镜像挂载到外接卷上的目录，挂载点改到系统临时目录。
