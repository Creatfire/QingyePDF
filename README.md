<p align="center"><img src="build/logo.png" width="112" alt="青页 PDF"></p>
<h1 align="center">青页 PDF · Qingye PDF</h1>
<p align="center">本地优先的开源 PDF 阅读器与 Markdown 笔记工具 · 无账号、无订阅、无广告</p>
<p align="center"><i>A local-first, open-source PDF reader and Markdown note-taking app for Windows, macOS and Android. AGPL-3.0.</i></p>

![笔记模式：左侧 PDF，右侧 Markdown 笔记](docs/images/notes-split.png)

## 这是什么

青页把读 PDF 和记笔记放在同一个窗口里：左边是论文或书，右边是 Markdown 笔记，两边互相知道对方在哪。所有文档处理都在本机完成，不上传文件。

| | |
|---|---|
| **PDF 阅读** | 多标签、全文搜索、目录 / 书签 / 缩略图、高亮 / 墨迹 / 文本框 / 签名批注、并排比较、文字重排 |
| **笔记模式** | PDF 与 Markdown 左右并排；摘录选中文字或框选区域（公式、图表），链接可回到原文并高亮；批注一键同步到笔记；翻页时笔记跟随 |
| **Markdown** | 所见即所得编辑（Typora 风格）、源码模式、数学公式、Mermaid 图表、表格、导出 PDF / Word / HTML / EPUB |
| **全库搜索** | 在所有打开过的 PDF 和笔记的内容里搜索，索引只保存在本机 |
| **引用信息** | 识别 DOI / arXiv / 标题 / 作者，生成 BibTeX、GB/T 7714、APA，导出 `.bib` 文献库 |
| **PDF 工具箱** | 合并、拆分、页面重排、压缩、OCR（中英文）、原文替换、永久涂黑、水印、印章、加密 |
| **文档转换** | 内置官方 Pandoc，51 种输入 / 76 种输出格式，批量转换 |
| **AI 协作（可选）** | 连接你自己的模型服务（OpenAI 兼容、Anthropic、Ollama 等），AI 可读取两侧文档、写笔记、给 PDF 加批注；默认关闭 |
| **界面** | 浅色 / 深色，Windows 或 macOS 风格窗口，简体中文 / 繁體中文 / English / 日本語 / 한국어 |
| **平台** | Windows、macOS、Android（手机竖屏时笔记模式上下分屏，轻点页面收起工具栏） |

完整说明见 [docs/USER-GUIDE.md](docs/USER-GUIDE.md)，功能范围与限制见 [FEATURES.md](FEATURES.md)，各版本改动见 [CHANGELOG.md](CHANGELOG.md)。

<table><tr>
<td><img src="docs/images/library.png" alt="全库搜索"></td>
<td><img src="docs/images/citation.png" alt="引用信息与 BibTeX"></td>
</tr></table>

## 下载

在仓库的 **Releases** 页面下载：

Windows 最新版为 **0.17.0**（`QingyePDF-0.17.0-win-x64.exe`）；macOS 与 Android 最新成品仍为 **0.13.0**，请在相应版本的 Release 中下载。

| 系统 | 文件 | 说明 |
|---|---|---|
| Windows 10 / 11（x64） | `QingyePDF-<版本>-win-x64.exe` | 便携版，双击即用；第一次启动要把运行环境解压到本机，需要十几秒 |
| macOS 12+（Apple 芯片） | `QingyePDF-<版本>-mac-arm64.dmg` | 见 [docs/MACOS.md](docs/MACOS.md) |
| macOS 12+（Intel） | `QingyePDF-<版本>-mac-x64.dmg` | 同上 |
| Android 7+ | `QingyePDF-<版本>-android.apk`（仓库未配置签名密钥时是 `-android-debug.apk`） | 见 [mobile/README.md](mobile/README.md) |

三个平台共用阅读与笔记代码；Windows 0.17.0 另外提供界面皮肤和可选首页。界面里的快捷键提示在 Mac 上显示为 ⌘ / ⌥ 写法，在安卓上换成触屏手势。

发布的 Windows 和 macOS 版本目前没有付费的代码签名：Windows SmartScreen 会提示“未知发布者”（“更多信息 → 仍要运行”），macOS 第一次打开需要手动放行（步骤在 docs/MACOS.md）。可以用同目录的 `SHA256SUMS` 文件核对下载。配置签名的方法见 [docs/SIGNING.md](docs/SIGNING.md)。

## 从源码运行

需要 Node.js 22、Python 3.12（仅构建 PDF 工具箱后端时）。以下命令在 Windows PowerShell 中执行：

```powershell
git clone https://github.com/<你的用户名>/QingyePDF.git
cd QingyePDF
npm ci
node scripts/prepare-pdfjs.mjs      # 重新下载并校验 PDF.js（仓库已带一份，可跳过）
./scripts/prepare-pandoc.ps1        # 下载并校验 Pandoc 3.12（约 235 MB，不入库）
./scripts/build-backend.ps1         # 用 PyInstaller 冻结 PDF 工具箱后端（不入库）
npm start
```

只想改界面而不用工具箱和转换功能时，后两步可以跳过。在 Mac 上把两个 `.ps1` 换成 `bash scripts/prepare-pandoc.sh` 和 `bash scripts/build-backend.sh`。打包与发布见 [docs/BUILDING.md](docs/BUILDING.md)。

```powershell
npm test                            # 单元测试
node scripts/ci-smoke.cjs           # Electron 冒烟测试（真实窗口）
npm run dist                        # 生成 dist/QingyePDF-<版本>-win-x64.exe
```

## 仓库结构

```
main.cjs, preload.cjs      Electron 主进程与预加载脚本
*-ipc.cjs, *.cjs           主进程模块（Markdown、转换、AI、恢复、全库搜索索引…）
ui/                        界面（原生 ES 模块，无打包步骤）
  notes-mode.mjs           笔记模式
  library.mjs              全库搜索
  citation.mjs             引用信息
  markdown/                Markdown 编辑器
  ai/                      AI 面板与文档工具
backend/worker.py          PDF 工具箱（PyMuPDF），发布时冻结为 QingyeWorker.exe
vendor/                    PDF.js、Markdown / 图表库、OCR 模型（Pandoc 在构建时下载）
ui/platform-text.mjs       按平台改写界面文字（Mac 快捷键写法、安卓去掉键盘提示）
mobile/                    安卓版（Capacitor，复用 ui/）
test/                      单元测试与冒烟测试
scripts/                   构建、图标、翻译词典等脚本
docs/                      使用说明、构建说明、架构说明、历史文档
```

更多细节见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)。

## 隐私

- 不联网也能使用全部阅读、编辑、搜索和转换功能；应用的窗口进程禁止访问任何网络地址。
- 只有两处会在你明确操作时联网：**AI 协作**（把问题和模型读取的文档片段发送到你自己配置的服务）和**引用信息的“联网补全”**（只把 DOI 发送到 doi.org）。
- 最近文件、阅读位置、全库搜索索引、引用信息都保存在本机用户数据目录。

## 参与

欢迎提 Issue 和 Pull Request，请先看 [CONTRIBUTING.md](CONTRIBUTING.md)。

## 许可

[AGPL-3.0-only](LICENSE)。随附的第三方组件及其许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)；`LICENSE-MIT` 适用于其中注明的部分。
