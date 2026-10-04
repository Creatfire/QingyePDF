# 构建与发布

## 环境

- Windows 10 / 11 x64
- Node.js 22
- Python 3.12（冻结 PDF 工具箱后端）
- PowerShell 7 或 Windows PowerShell 5.1

## 准备依赖

```powershell
npm ci
node scripts/prepare-pdfjs.mjs      # 下载官方 PDF.js 发行包、校验 SHA-256 并套用青页的两处改动
./scripts/prepare-pandoc.ps1        # 下载 Pandoc 3.12 到 vendor/pandoc/pandoc.exe 并校验 SHA-256
./scripts/build-backend.ps1         # 建立 .backend-build 虚拟环境，PyInstaller 生成 backend/bin/QingyeWorker/
```

`vendor/pandoc/pandoc.exe`、`backend/bin/`、`.backend-build/` 不入库（见 `.gitignore`）。

## 运行与测试

```powershell
npm start                           # 开发运行
npm test                            # 单元测试
.backend-build/Scripts/python.exe backend/test_worker.py
node scripts/ci-smoke.cjs           # 逐个启动 Electron 冒烟套件，每个套件使用独立的数据目录
npm run smoke:011                   # 只跑 0.11.0 的套件
```

冒烟测试会打开真实窗口；在无显示器的 Linux 上用 `xvfb-run`。

## 打包

```powershell
npm run dist                        # 便携版：dist/QingyePDF-<版本>-win-x64.exe
npm run dist:installer              # NSIS 安装包
npm run dist:all                    # 两者
```

便携版使用 `build/portable-cache.nsi`（首次运行解压到 `%LOCALAPPDATA%`，之后复用），由 `scripts/build-distribution.cjs` 在构建期间临时替换 electron-builder 的模板。

### 在 Linux / macOS 上交叉构建

没有 Wine 也可以：`scripts/build-distribution.cjs` 在非 Windows 系统上关闭 electron-builder 的可执行文件编辑，改由 `scripts/after-pack.cjs` 用 [resedit](https://github.com/jet2jet/resedit-js) 写入图标和版本信息。需要先从一台 Windows 机器或 CI 产物取得 `backend/bin/QingyeWorker/` 与 `vendor/pandoc/pandoc.exe`。交叉构建的产物请在 Windows 上实际运行一遍再发布。

## macOS

```bash
npm ci
bash scripts/prepare-pandoc.sh      # Pandoc 3.12 for macOS，按芯片下载并校验
bash scripts/build-backend.sh       # backend/bin/QingyeWorker/QingyeWorker
npm test && npm start
npx electron-builder --mac dmg -c.mac.identity=- -c.mac.notarize=false
```

详见 [MACOS.md](MACOS.md)。发布用的 dmg 由 `.github/workflows/macos.yml` 在 arm64 和 Intel 运行器上分别构建。

## Android

```bash
cd mobile && npm ci && npm run apk   # android/app/build/outputs/apk/debug/app-debug.apk
npm test && npm run test:e2e         # 单元测试；手机尺寸的 Chromium 端到端测试
```

详见 [mobile/README.md](../mobile/README.md)。

## 持续集成

- `.github/workflows/ci.yml`：每次推送和 PR 在 `windows-latest` 上运行单元测试、冒烟测试并构建便携版；推送 `v*` 标签时额外构建安装包，并把两者附到一个**草稿** Release。
- `.github/workflows/macos.yml`：在 `macos-15`（arm64）与 `macos-15-intel`（x64）上运行单元测试并各构建一个 dmg；标签推送时附到同一个草稿 Release。
- `.github/workflows/android.yml`：构建安卓 APK 并运行端到端测试。

发布一个版本：

1. 更新 `package.json` 的 `version`、`CHANGELOG.md`、`RELEASE-TARGET.json`。
2. `git tag v0.12.0 && git push --tags`。
3. 等 CI 完成，在 Releases 页面检查草稿并发布。

## 图标

母版是 `build/logo.png`（macOS 的应用图标也直接由它生成）。改动后运行 `python3 scripts/make-icons.py` 重新生成 `build/icons/`、`build/icon.ico`、`ui/icon.png`、`ui/logo.png`；安卓图标用 `mobile/scripts/make-android-icons.py`。

## 示例文档

首页的“PDF 使用示例”有三个版本：`ui/sample-guide.pdf`（Windows）、`ui/sample-guide-mac.pdf`（Mac 快捷键）、`ui/sample-guide-touch.pdf`（安卓，手势说明）。它们由同一份 `scripts/sample-guide/guide.html` 生成：`python3 scripts/sample-guide/build.py`（需要 Pillow、fontTools、Playwright 和 Noto Sans CJK 字体）。
