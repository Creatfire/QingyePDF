# 青页 PDF 0.13.0 开发交接

基于 0.12.0。原修复阶段生成 Windows x64 NSIS 安装版；后续发布范围扩展为 Windows 安装版、便携 EXE、完整目录 ZIP，Android APK，macOS arm64 与 x64 DMG。完整缺陷处置、证据与限制见 [FIX-REPORT-0.13.0](docs/FIX-REPORT-0.13.0.md)，上一版见 [HANDOFF-0.12.0](docs/history/HANDOFF-0.12.0.md)。

先运行 npm test、.backend-build/Scripts/python.exe backend/test_worker.py、npm run smoke:013 和 node scripts/ci-smoke.cjs；后端更新需运行 scripts/build-backend.ps1。Windows 使用 npm run dist 与 npm run dist:installer（显式 --publish never）；ZIP 包含完整 win-unpacked。macOS 与 Android 使用对应 GitHub Actions；Android 版本号及中文批注保存接口同步为 0.13.0。

中文 FreeText 保存使用 normalize-annotations 后端动作；PDF.js 图片补丁由 scripts/pdfjs-patches.cjs 重放。固定平台依赖未升级。打包后需运行专项和 --packaged 冒烟，并核对 0.13.0 版本及校验值。
