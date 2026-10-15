# 青页 PDF 0.14.0 开发交接

基于 0.13.0（分支 `release-0.14`）。0.17 系列不在这条线上。研究与路线见 [docs/research](docs/research)，改动清单见 [CHANGELOG](CHANGELOG.md)，上一版交接见 [HANDOFF-0.13.0](docs/history/HANDOFF-0.13.0.md)。

## 运行与验证

```powershell
npm ci; node node_modules/electron/install.js   # npm 11 默认不跑 Electron 的安装脚本，需手动下载二进制
node scripts/prepare-pdfjs.mjs; ./scripts/prepare-pandoc.ps1; ./scripts/build-backend.ps1
npm test                                          # 117 项（1 项仅 POSIX）
.backend-build/Scripts/python.exe backend/test_worker.py
node scripts/ci-smoke.cjs                         # 9 个套件，含新增 pdf014
```

开发时如果修改了 `backend/worker.py`，要么重新运行 `build-backend.ps1`，要么删除 `backend/bin`：存在冻结的 `QingyeWorker.exe` 时应用优先使用它，旧版本不认识新动作（markup、draw、annot-delete、redact-find）。

## 新模块

| 模块 | 作用 |
|---|---|
| `pandoc-markdown.cjs` | Pandoc 方言、导入写出器、导出任务（资源、参考文档、引用）、主题 `reference.docx` |
| `ui/markdown/pandoc-prep.mjs` / `export-pandoc.mjs` | 导出前的 Markdown 改写（图表、[toc]、提示框、公式编号、`<img>`）与渲染进程准备 |
| `ui/markdown/math-numbers.mjs` | 公式编号与 `\eqref` |
| `ui/markdown/source-editor.mjs` | CodeMirror 6 源码模式（textarea 兼容接口）；包由 `scripts/build-codemirror-vendor.mjs` 生成 |
| `ui/markup.mjs` / `ui/shapes.mjs` | PDF 文字标记工具条、单字母快捷键 / 图形批注 |
| 后端新动作 | `markup`、`draw`、`annot-delete`、`redact-find`；`redact` 支持多区域 `marks`；`crop` 支持 `cropMode`；`compress` 支持 `profile`；印章模板变量与 `subset` |

## 已知限制 / 后续

- 大文档的结构变化仍是全量解析（1 MB 回车约 0.3 s）；增量解析留到后续。
- 代码块编辑仍是行内着色，没有换成 CodeMirror；源码模式已换。
- 已写入的图形与文字标记不能在阅读器里拖动编辑，只能删除后重画。
- Pandoc 常驻服务模式（约 20 倍提速）未接入；测量工具、阅读器内差异对比未做。
- 安卓与 macOS 没有重新构建。
