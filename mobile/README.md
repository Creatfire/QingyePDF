# 青页 PDF · 安卓版（0.12.0）

安卓版不是重写：它把桌面版的界面（`ui/`）、阅读引擎（PDF.js）、Markdown 编辑器和主进程模块原样装进一个 Capacitor WebView，只替换“只有桌面才有”的那一层。桌面版代码没有任何改动，`mobile/` 之外只新增了 `.github/workflows/android.yml`。

## 它是怎么工作的

| 桌面版 | 安卓版 | 位置 |
|---|---|---|
| Electron 主进程（`main.cjs`） | 在 WebView 里运行的移植版，处理器名称、参数、返回值一一对应 | `src/main/start.js` |
| `preload.cjs` + IPC | **同一个** `preload.cjs`，`electron` 换成进程内调用 | `src/main/ipc.js`、`electron-renderer.js` |
| `markdown-ipc.cjs`、`converter-ipc.cjs`、`ai-ipc.cjs`、`ai-service.cjs`、`pandoc-engine.cjs`、`markdown-tools.cjs`、`recovery.cjs` 等 | **原文件直接打包**，Node 模块由垫片提供 | `src/shims/` |
| Python 后端 `backend/worker.py`（PyMuPDF 子进程） | **同一个** `worker.py`，在 Pyodide（CPython + PyMuPDF 1.28.2 的 WebAssembly 版）里运行 | `src/worker/` |
| PyMuPDF 内置 Tesseract | Tesseract WebAssembly 内核 + 同一套 `chi_sim` / `eng` 模型 | `src/worker/pdf-worker.js`、`qy_mobile.py` |
| `vendor/pandoc/pandoc.exe` 3.12 | 官方 Pandoc WebAssembly 版（3.10），`spawn('pandoc', …)` 由垫片接管 | `src/shims/child_process.js`、`src/pandoc/` |
| 系统文件对话框、消息框 | 页面内的文件浏览器与对话框 | `src/main/dialogs.js` |
| 文件读写、打开方式、打印、密钥、网络 | 原生插件 `QingyeNative`（Java） | `android/app/src/main/java/org/qingye/pdf/` |
| 窗口标题栏、宽屏布局 | 触屏 / 窄屏样式层与“更多”菜单、返回键 | `src/ui/` |

## 触屏操作（0.12.0）

- **轻点页面**：收起或显示标题栏、工具栏、状态栏和翻页面板，页面占满屏幕。批注、页面编辑和框选区域进行中不会触发。Markdown 的阅读模式同样支持。
- **双击页面**：放大到两倍，再双击回到适合宽度；双指捏合任意缩放。
- **长按文字**：选中后屏幕下方出现“复制 / 高亮 / 搜索 / 摘录到笔记”。长按页面空白处打开页面菜单。
- **返回键**：依次关闭对话框和菜单 → 取消框选 → 退出沉浸阅读 → 退出笔记模式 → 回到首页 → 回到桌面。
- **没有键盘提示**：界面文字里的快捷键说明由 `ui/platform-text.mjs` 去掉，“右键”显示为“长按”；帮助是手势说明；示例文档是触屏版（`ui/sample-guide-touch.pdf`）。

## 笔记模式（0.12.0）

“更多 → 笔记模式”（平板在标题栏）或长按标签进入。手机竖屏时 PDF 在上、笔记在下，横屏和平板左右并排，转屏时自动切换；拖动分隔条上的把手调整比例。进入后“更多 → 笔记模式命令”提供摘录选中文字、框选区域（用手指拖出一个框）、同步批注、滚动联动开关、引用信息。全库搜索也在“更多”里。

与桌面的差别：引用信息没有“联网补全”；分隔条上不显示按钮（会挡住页面，命令在菜单里）；全库搜索单个 PDF 上限 120 MB。

## 与桌面版的差别

- **文件访问**：首次启动会请求“所有文件访问权限”，授予后在原位置打开和保存。不授予时只能使用青页自己的文件夹，其他位置的文件通过“从其他应用导入”复制进来。
- **回收站**：安卓没有系统回收站，“移到回收站”的文件进入应用内回收站，30 天后清除。
- **转换中心**：不支持 `--filter`（外部过滤器程序）、`--pdf-engine`（外部 PDF 引擎）、`--defaults`、`--data-dir`；Lua 过滤器、模板、引文可用。单次转换涉及的文件合计上限 160 MB。输出 PDF 请用“PDF · 青页内置排版”。
- **导出 PDF / 图片**（Markdown 与内置排版）：由系统 WebView 排版，不带页码页脚；长图高度上限 16000 像素。个别设备不允许直接写出 PDF 时会改为打开系统打印界面。
- **PDF 工具**：单文件上限 256 MB（桌面 512 MB）。首次使用工具时加载处理引擎需要几秒。取消正在运行的任务会重启引擎。
- **没有的功能**：多窗口、界面风格（Windows / MacOS）、引用信息的联网补全、Windows 打开方式注册、本地 AI 接口（OpenAPI 服务）、Markdown 文件夹变化的实时监视（改为回到前台时检查）、拼写建议菜单。
- **AI**：请求经原生网络发出；API Key 用 Android Keystore 保护的密钥加密后保存在应用私有目录。

## 构建

需要 Node 22+、JDK 21、Android SDK（platform 36、build-tools 36）。

```bash
cd mobile
npm ci
npm run apk          # 下载并校验 Python wheels → 打包网页 → 同步 → assembleDebug
# 产物：android/app/build/outputs/apk/debug/app-debug.apk
```

- `npm run build:web` 只生成 `www/`；`npx cap sync android` 把它复制进安卓工程。
- Python wheels 按 `vendor-mobile/wheels/SHA256SUMS` 校验。国内网络可设 `QINGYE_PYPI_SIMPLE=https://mirrors.aliyun.com/pypi/simple`。
- 换图标：改 `scripts/make-android-icons.py` 后运行它。

### GitHub Actions

`.github/workflows/android.yml` 在推送后自动构建，APK 在该次运行的 Artifacts 里（`qingye-android-<提交>`）。

调试版 APK 用构建机临时生成的调试密钥签名：**每次 CI 构建的签名都不同，不能覆盖安装上一次的包**（需先卸载，应用内的最近记录、AI 连接会清空，存储里的文档不受影响）。要能连续升级，请配置发布签名：

```bash
keytool -genkeypair -v -keystore qingye.keystore -alias qingye -keyalg RSA -keysize 4096 -validity 10000
base64 -w0 qingye.keystore   # 结果填入 ANDROID_KEYSTORE_BASE64
```

仓库 Secrets：`ANDROID_KEYSTORE_BASE64`、`ANDROID_KEYSTORE_PASSWORD`、`ANDROID_KEY_ALIAS`、`ANDROID_KEY_PASSWORD`。配置后会额外产出 `QingyePDF-<版本>-android.apk`。

## 测试

```bash
npm test             # 纯逻辑：Pandoc 参数翻译、哈希垫片
npm run test:e2e     # 手机视口的 Chromium 里跑真实界面（先 npm run build:web）
```

`test/e2e.test.mjs` 用内存存储代替设备；`test/native.test.mjs` 通过 Capacitor 真实的 `native-bridge.js` 连接一个 JavaScript 写的原生插件替身（`test/native-fake.js`），覆盖权限、分块写入、“打开方式”、分享、返回键、密钥加密与 AI 流式请求。

### 已验证与未验证

已在本仓库的开发环境验证：

- APK 可以构建，Android Lint 0 错误；
- 上述两组端到端测试全部通过（PDF 打开 / 保存、后端工具、OCR、Markdown 编辑保存、转换中心、返回键等）。

**尚未在真机上验证**（开发环境的模拟器无法运行 WebView）：

- Java 原生插件的实际行为：文件读写、权限页跳转、“打开方式”/分享、HTML 转 PDF / 图片、Keystore、AI 网络请求；
- 触摸手势、软键盘与输入法下的 Markdown 编辑；
- 低内存设备上 Pyodide 与 Pandoc 的启动时间和内存占用；
- 较旧的系统 WebView（PDF.js 6 需要较新的内核，已加补丁但未实测下限）。

第一次装到手机上时，建议按这个顺序走一遍：授权 → 打开 PDF → 批注并保存 → 工具箱导出 Word → OCR → 新建 Markdown 并保存 → 转换中心 → 从文件管理器“用青页打开”。

## 许可

与桌面版相同（AGPL-3.0-only）。安卓版新增的第三方组件见仓库根目录 `THIRD_PARTY_NOTICES.md` 的“安卓版”一节。
