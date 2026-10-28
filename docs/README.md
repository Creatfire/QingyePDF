# 文档目录

当前产品说明以 Windows 0.20.0 为基线；历史记录和对标调研描述的是当时的版本，不代表当前验收结果。

## 使用与功能

- [使用手册](guide/USER-GUIDE.md)：安装、阅读、批注、笔记、Markdown、OCR、工具箱和 AI。
- [功能范围与限制](features/FEATURES.md)：当前能力、边界和平台状态。
- [文档转换](features/CONVERSION.md)：转换流程、参数、资源和引擎。
- [macOS](platforms/MACOS.md) · [Android](platforms/ANDROID.md)：平台差异和历史验证状态；0.20.0 未重建或验收。

## 开发与发布

- [参与开发](development/CONTRIBUTING.md) · [构建、测试与发布](development/BUILDING.md) · [架构](development/ARCHITECTURE.md)。
- [代码签名](development/SIGNING.md) · [PDF.js 修改记录](development/PDFJS-MODIFICATIONS.md)。
- [0.20.0 交接与验证](releases/HANDOFF.md) · [发布目标](releases/RELEASE-TARGET.json)。
- [安全策略](security/SECURITY.md) · [第三方声明](legal/THIRD_PARTY_NOTICES.md) · [AGPL 许可证](legal/LICENSE) · [MIT 许可证](legal/LICENSE-MIT)。

## 历史与问题

- [更新日志](history/CHANGELOG.md)：各版本变化。
- [历史交接](history/)：各版本的实现、验证与当时未验证的事项。
- [0.20.0 问题调查与跟踪](bugs/BUG-REGISTER-0.20.0.md)：当前缺陷、安全问题与验证缺口。
- [历史缺陷与修复记录](bugs/)：0.9.3 修复版与 0.13.0 修复、构建报告。
- [对标调研](research/)：Typora、Xodo、Pandoc，均以 0.13 为基线。
- [历史界面测试说明](history/TEST-E2E.md)：旧测试脚本的适用范围。

## 维护约定

根目录只保留项目 README。新增项目说明放进对应的 `docs/` 子目录，并更新本页。应用内示例、GitHub 模板及第三方原始许可保留在它们各自使用的位置。修改文档后运行 `npm run check:docs`；修改路径时同步检查打包清单、交付脚本和版本一致性测试。
