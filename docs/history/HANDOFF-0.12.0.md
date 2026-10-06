# 青页 PDF 0.12.0 开发交接

基于 0.11.0。上一版交接见 [docs/history/HANDOFF-0.11.0.md](docs/history/HANDOFF-0.11.0.md)。

## 新增

| 内容 | 说明 |
|---|---|
| macOS 版 | `.github/workflows/macos.yml`：`macos-15`（arm64）与 `macos-15-intel`（x64）各出一个 dmg。无证书时 ad-hoc 签名（`-c.mac.identity=-`），有 `MAC_CSC_LINK` 等 Secret 时签名并公证 |
| Mac 主进程 | 应用菜单 / 编辑菜单 / 窗口菜单；加速键用 `CmdOrCtrl`，切换标签保持 `Ctrl+Tab`，全屏 `Ctrl+Cmd+F`；`open-file` 事件；默认界面风格为 MacOS（系统红绿灯）；示例文档用 Mac 版 |
| Mac 后端 | `offline.cjs` 按平台找 `QingyeWorker` / `QingyeWorker.exe`，开发回退到 `.backend-build/bin/python`；`scripts/build-backend.sh`、`scripts/prepare-pandoc.sh`（arm64 / x86_64 两个官方包的 SHA-256 已写入脚本） |
| 平台文字 | `ui/platform-text.mjs`，挂在 `ui/i18n/i18n.mjs` 的翻译之后。`darwin`：`Ctrl+Shift+E → ⇧⌘E`、`Alt+← → ⌥←`、`F11 → ⌃⌘F`、`Ctrl+Tab → ⌃Tab`、`Ctrl+H → ⌃H`、资源管理器 → 访达。`android`：去掉 `· Ctrl+S`、`（Ctrl+\）` 这类提示，“右键”→“长按” |
| 安卓笔记模式 | `notes-mode.mjs` 增加 `orientation` 选项：`rows` 时窗格用 `top / height` 上下排列，分隔条横置。手机竖屏（宽 ≤ 760 且高 > 宽）为 `rows` |
| 安卓主进程 | `mobile/src/main/start.js` 增加 `library-*`、`citation-lookup`（直接拒绝）、`save-text-file`；`library-index.cjs` 原样打包 |
| 触屏 | `mobile/src/ui/mobile-ui.js`：轻点切换 `body.qyImmersive`、双击缩放、选中文字操作条 `#qmSelection`、“更多”里的笔记模式 / 全库搜索、手势帮助、返回键顺序 |
| 示例文档 | `scripts/sample-guide/build.py` 生成 `sample-guide.pdf` / `-mac.pdf` / `-touch.pdf` |

## 验证

```
npm test                              # 99 项
node scripts/ci-smoke.cjs             # Electron 冒烟
cd mobile && npm test && npm run test:e2e   # 4 + 26 项
```

开发环境（Linux，Electron 44.4.5 + xvfb；手机尺寸的 Chromium）结果：

- 桌面 `npm test` 99/99；notes / links / features / markdown / basic / conversion 冒烟通过（各自独立的 `QINGYE_SMOKE_ROOT`）。
- 安卓 `npm test` 4/4；`npm run test:e2e` 26/26，其中 `touch012` 9 项：界面无键盘提示、轻点收起 / 恢复工具栏、双击缩放与还原、返回键、竖屏上下分屏 / 横屏左右分屏、手指拖动分隔条、选中文字操作条与摘录、手指拖框的区域摘录（期间页面不滚动）、经 Pyodide 后端的批注同步、全库搜索、引用信息。
- 调试版 APK 已构建：`versionName 0.12.0`、`versionCode 1200`，包内有 `notes-mode.mjs`、`platform-text.mjs`、`sample-guide-touch.pdf`。

**未验证：**

- **macOS 的一切。** 没有 Mac，也没有可用的 GitHub 凭据，工作流一次都没有执行过。风险最高的几处：`macos-15-intel` 运行器标签是否可用；PyInstaller 产物放进 `Contents/Resources/backend` 后的签名与启动；ad-hoc 签名的应用在 Apple 芯片上的首次放行流程；编辑菜单的 ⌘Z 与页面内撤销的先后顺序；冒烟套件在 Mac 上的表现（工作流里设为 `continue-on-error`）。
- **安卓真机。** 端到端测试用的是桌面 Chromium 的触摸模拟和内存文件系统；真机 WebView 上的长按选字、系统选择工具条与 `#qmSelection` 是否互相遮挡、双击缩放的手感、低内存设备上的全库索引都没有测过。
- Windows 便携版 0.12.0 本次没有重新构建（代码改动对 Windows 只有菜单加速键写法和文件位置变化）。

## 构建

Windows 见 `docs/BUILDING.md`，macOS 见 `docs/MACOS.md`，安卓见 `mobile/README.md`。
