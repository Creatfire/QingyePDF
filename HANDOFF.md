# 青页 PDF 0.17.0 开发交接

0.16.0 新增可选首页（`ui/home/`）：`layouts.mjs` 注册样式并按需动态加载 `glass.mjs` / `bento.mjs` / `desk.mjs` / `blocks.mjs`，经典首页仍是 `index.html` 里的 `.homeContent`，其余渲染到 `#homeAlt`。共用部分在 `core.mjs`（数据快照、操作、Ctrl+K 启动器、`springLoop` 弹簧循环），阅读活动在 `activity.mjs`，主进程侧的摘录读取在 `home-data.cjs`。设置里的选择器在 `settings.mjs`（`homeLayout` 参数由 app.mjs 传入）。0.16.1 曾加入“立绘”首页样式，0.17.0 已移除（风格不符、素材不适用）；0.17.0 新增与首页互不绑定的“界面皮肤”（`ui/skins.css`、`ui/skins.mjs`，设置 → 常规 → 界面皮肤），切回经典首页的修复（`layouts.mjs` 的 `refresh()` / `set()` 对经典样式也调用 `draw()`）保留。布局模块可以返回 `ctrlK()`，Ctrl+K 就交给它处理而不打开启动器。

0.15.0 在 0.14.0 的基础上重做配色层级（深绿框架、琥珀选中）并统一工具入口：分类定义在 `ui/tool-catalog.mjs`，由 `ui/tools.mjs`（工具箱）、`ui/tools-menu.mjs`（工具栏“全部工具”菜单）和首页共用。详见 CHANGELOG 0.15.0。

## 0.14.0

基于 0.13.0，只改视觉层（见 CHANGELOG 0.14.0）。上一版交接见 [HANDOFF-0.12.0](docs/history/HANDOFF-0.12.0.md) 与 [FIX-REPORT-0.13.0](docs/FIX-REPORT-0.13.0.md)。

- 所有颜色、字号、间距、圆角、线宽、错位量和动效时长都在 `ui/tokens.css`；组件 CSS 只引用 token。PDF.js 框架内的 `ui/viewer.css` 用 `@import` 引入同一文件。
- 字体在 `vendor/fonts/`（@fontsource-variable 5.3.0，OFL），已加入 `package.json` 的 `files`。
- 图标母版 `build/logo.png` 已换新；`scripts/make-icons.py` 与 `mobile/scripts/make-android-icons.py` 已重新生成全部尺寸。功能图标由 `scripts/generate-icons-css.mjs` 生成（线宽 2、方头、尖角）。
- 示例 PDF 用 `scripts/sample-guide/build.py` 重新生成（需要 Noto Sans CJK Black，缺少时回退 Bold）。
- `test/links011-smoke.cjs` 的框选框断言由"实线"放宽为"有边框"（新样式为琥珀虚线）。

本版的 Windows 便携版在 Linux 上交叉构建：`electron-builder --win dir` 生成 win-unpacked（`scripts/after-pack.cjs` 写入图标与版本），再生成便携版。Linux 上的单元测试中依赖 Windows 版 Pandoc / 后端的 16 项无法运行；请在 Windows 上运行 `npm test`、`node scripts/ci-smoke.cjs` 和 `--packaged` 冒烟，并实际启动一次 `QingyePDF-0.14.0-win-x64.exe`。在 Windows 上直接 `npm run dist` 即可得到同样的产物。安卓与 macOS 未重新构建。
