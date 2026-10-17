# 文档地图

青页 PDF 的全部文档都在这里指路。**找不到某份说明时先看这一页**；每条都写了它讲什么、给谁看、放在哪。

文档源语言是简体中文。面向用户的说明（本页、[README](../README.md)、[USER-GUIDE](USER-GUIDE.md)、[FEATURES](../FEATURES.md)）随功能一起更新；界面文字另有一套多语言流程，见 [CONTRIBUTING](../CONTRIBUTING.md)。

## 想了解什么，看哪一份

| 你想知道的 | 文档 | 说明 |
|---|---|---|
| 这是什么软件、怎么下载、怎么从源码跑起来 | [README.md](../README.md) | 项目门面：功能一览、下载表、源码运行、仓库结构、隐私承诺 |
| 具体怎么操作（阅读、批注、笔记模式、Markdown、工具箱、AI） | [USER-GUIDE.md](USER-GUIDE.md) | 面向使用者的完整说明，最详细的一份（含各版本新功能入口） |
| 能做到什么、做不到什么 | [FEATURES.md](../FEATURES.md) | 功能范围与限制，含与 Xodo 的逐项对照、明确未实现清单 |
| 每个版本改了什么 | [CHANGELOG.md](../CHANGELOG.md) | 从 0.8 至今的全部改动记录 |
| 代码是怎么组织的 | [ARCHITECTURE.md](ARCHITECTURE.md) | 主进程 / 窗口进程分工、几条贯穿全局的规则、笔记与 PDF 的链接格式 |
| 怎么构建、测试、打包、发布 | [BUILDING.md](BUILDING.md) | 构建步骤、测试入口、CI 与产物 |
| 代码签名怎么配 | [SIGNING.md](SIGNING.md) | Windows / macOS 证书配置（仓库未配密钥时的行为也写在这里） |
| macOS 版怎么装、怎么放行 | [MACOS.md](MACOS.md) | macOS 专用说明（该平台当前停更） |
| 文档转换有哪些参数和限制 | [CONVERSION.md](../CONVERSION.md) | Pandoc 集成的参数、安全保护、资源行为与验证范围 |
| 安全问题怎么报、边界在哪 | [SECURITY.md](../SECURITY.md) | 报告渠道与威胁模型（断网设计、三处联网入口、本地 AI 接口） |
| 怎么参与、提交前要跑什么 | [CONTRIBUTING.md](../CONTRIBUTING.md) | 测试与 lint 约定、界面文字流程、依赖与许可要求 |
| 用到了哪些第三方组件、什么许可 | [THIRD_PARTY_NOTICES.md](../THIRD_PARTY_NOTICES.md) | 随附组件与许可证，AGPL-3.0 兼容性说明 |
| 这一版交付了什么、验收到什么程度 | [HANDOFF.md](../HANDOFF.md)、[RELEASE-TARGET.json](../RELEASE-TARGET.json) | 开发交接（未验证项、已知限制）与机器可读的发布目标、验收结论 |
| 安卓版怎么构建 | [mobile/README.md](../mobile/README.md) | Capacitor 包装、Pyodide 后端、触屏行为 |
| PDF.js 被改过哪些地方 | [vendor/pdfjs/QINGYE-MODIFICATIONS.md](../vendor/pdfjs/QINGYE-MODIFICATIONS.md) | 升级 PDF.js 前必读 |
| 对标软件差在哪（下一轮功能的依据） | [research/](research/) | Typora / Xodo / Pandoc 三份差距分析，0.13 为基线 |
| 以前某版是怎么交接的 | [history/](history/) | 0.9.4–0.13.0 的交接文档、0.9.3 修复清单、0.13.0 修复与构建报告 |

## 目录约定

```
根目录                    GitHub 约定或随安装包一起分发，必须留在根目录
  README.md               项目门面（GitHub 首页）
  CONTRIBUTING.md  SECURITY.md  LICENSE  LICENSE-MIT
  CHANGELOG.md  FEATURES.md  CONVERSION.md  THIRD_PARTY_NOTICES.md
  HANDOFF.md  RELEASE-TARGET.json
docs/                     其余文档一律放这里
  README.md               本页：文档地图
  USER-GUIDE.md  ARCHITECTURE.md  BUILDING.md  SIGNING.md  MACOS.md
  history/                历史交接与修复报告（不再更新）
  research/               对标调研（下一轮功能的依据）
  images/                 文档用截图
```

**根目录那几份不要随便移动**：`README.md`、`FEATURES.md`、`CHANGELOG.md`、`CONVERSION.md`、`THIRD_PARTY_NOTICES.md`、`RELEASE-TARGET.json` 会随安装包一起分发（`package.json` 的 `build.files`），移动它们必须同时改 `build.files`；`test/consistency.test.mjs` 会在清单与磁盘不一致时失败。`HANDOFF.md` 与 `RELEASE-TARGET.json` 是发布流程的一部分，按惯例留在根目录。

新增文档时：给用户看的放 `docs/`，一次性的过程记录放 `docs/history/`，调研放 `docs/research/`，然后在本页表格里加一行。

## 文档自身也要检查

```powershell
npm run check:docs      # 检查所有 Markdown 里的相对链接是否指向真实文件
```

这条检查会跳过代码块与外部链接。之前 `docs/history/` 里有几处按“仓库根目录”写的相对路径（`docs/history/HANDOFF-0.10.0.md`）其实一直指向不存在的位置，现在已修好并由这条检查兜住。
