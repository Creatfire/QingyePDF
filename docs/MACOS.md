# 青页 PDF · macOS 版

macOS 版和 Windows 版是同一份代码。它由 GitHub Actions 在 Mac 运行器上构建（`.github/workflows/macos.yml`），产物是两个磁盘映像：

| 文件 | 适用 |
|---|---|
| `QingyePDF-<版本>-mac-arm64.dmg` | Apple 芯片（M 系列） |
| `QingyePDF-<版本>-mac-x64.dmg` | Intel 芯片 |

需要 macOS 12 或更高版本。

## 安装

1. 打开 dmg，把“QingyePDF”拖进“应用程序”。
2. **第一次打开**：如果发布的版本没有经过 Apple 公证（仓库没有配置开发者证书时就是这样），直接双击会被拦下。两种放行方法任选其一：
   - 在“应用程序”里按住 Control 点按 QingyePDF → “打开” → 再点“打开”；较新的系统需要到 **系统设置 → 隐私与安全性**，在底部点“仍要打开”。
   - 或在“终端”里执行 `xattr -dr com.apple.quarantine /Applications/QingyePDF.app`。

   放行一次之后就可以正常双击打开。配置了证书并公证的版本没有这一步，见 [SIGNING.md](SIGNING.md)。
3. 想让 PDF 或 Markdown 默认用青页打开：在访达里选中一个文件，按 ⌘I 打开“显示简介”，在“打开方式”里选择 QingyePDF，再点“全部更改…”。

## 快捷键

界面里的快捷键提示、菜单和帮助在 Mac 上都显示为 Mac 的写法；随附的“PDF 使用示例”也是 Mac 版。对应关系：Windows 的 Ctrl 换成 ⌘，Alt 换成 ⌥。

| 操作 | macOS | Windows |
|---|---|---|
| 打开 / 新建 Markdown | ⌘O / ⌘N | Ctrl+O / Ctrl+N |
| 保存 / 另存为 | ⌘S / ⇧⌘S | Ctrl+S / Ctrl+Shift+S |
| 撤销 / 重做 | ⌘Z / ⇧⌘Z（⌘Y 也可以） | Ctrl+Z / Ctrl+Y |
| 关闭标签 / 退出 | ⌘W / ⌘Q | Ctrl+W / Alt+F4 |
| 切换标签 | ⌃Tab / ⌃⇧Tab | Ctrl+Tab / Ctrl+Shift+Tab |
| 第 1–9 个标签 | ⌘1 … ⌘9 | Ctrl+1 … Ctrl+9 |
| 查找 / 全库搜索 | ⌘F / ⇧⌘F | Ctrl+F / Ctrl+Shift+F |
| Markdown 查找与替换 | ⌃H | Ctrl+H |
| 跳转页码 | ⌘G | Ctrl+G |
| 打印 | ⌘P | Ctrl+P |
| 全屏 | ⌃⌘F | F11 |
| 返回 / 前进阅读位置 | ⌥← / ⌥→ | Alt+← / Alt+→ |
| 笔记模式 进入 / 退出 | ⌘\ | Ctrl+\ |
| 摘录选中文字 / 框选区域 | ⇧⌘E / ⇧⌘U | Ctrl+Shift+E / Ctrl+Shift+U |
| AI 面板 | ⇧⌘A | Ctrl+Shift+A |
| Markdown 命令面板 / 快速打开 | ⇧⌘P / ⌘P | Ctrl+Shift+P / Ctrl+P |

两处保留 Control 键（⌃）：切换标签（⌘Tab 是系统的应用切换器）和 Markdown 的查找与替换（⌘H 是系统的“隐藏”）。Markdown 编辑器的其余快捷键都是把 Ctrl 换成 ⌘，可以在 Markdown 的快捷键设置里改。

## 与 Windows 版的差别

- 窗口左上角是系统自己的红绿灯按钮；界面风格默认是 MacOS，可以在设置里改回 Windows 风格（按钮位置不变）。
- 没有“便携版首次解压”这一步，也没有设置里的“文件关联”按钮（按上面第 3 步在访达里设置）。
- 文档从访达双击、拖到 Dock 图标或“打开方式”进入，都会在已有窗口里开新标签。
- PDF 工具箱后端（PyMuPDF）和 Pandoc 都是 macOS 原生二进制，随应用提供，不需要另外安装。

## 自己构建

在一台 Mac 上（Node.js 22、Python 3.12）：

```bash
npm ci
bash scripts/prepare-pandoc.sh        # 下载并校验 Pandoc 3.12（按本机芯片选择）
bash scripts/build-backend.sh         # PyInstaller 冻结 PDF 工具箱后端
npm test
npm start                             # 开发运行
npx electron-builder --mac dmg -c.mac.identity=- -c.mac.notarize=false   # 未公证的本机构建
```

产物在 `dist/`。后端和 Pandoc 都是按芯片构建的，所以 arm64 和 x64 的 dmg 要分别在对应的机器（或运行器）上打包。

## 验证状态

macOS 版的代码路径（菜单、`open-file` 事件、后端与 Pandoc 的路径、快捷键显示）是在 Linux 上写成并通过单元测试的，**没有在 Mac 上运行过**；工作流也还没有在 GitHub 上实际执行。第一次运行工作流时请留意“Check the application bundle”这一步的输出，它会检查后端、Pandoc 和 OCR 数据是否在应用包里并能启动。
