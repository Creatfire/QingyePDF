# 0.15.0 / 0.14.0 交接（历史）

**0.15 新增**：Office 文件以 PDF 打开（`office-convert.cjs`，随包 LibreOffice 26.2.6，由 `scripts/prepare-libreoffice.ps1` 准备，打包到 `resources/libreoffice`）；工具箱 Office 导入也走 LibreOffice。发布物只有安装版和安装目录 ZIP。LibreOffice 启动时会加载自带的 Python，裁剪时不能删除。

0.14 新模块：`pandoc-markdown.cjs`（Pandoc 方言、导入写出器、导出任务、主题 `reference.docx`）、`ui/markdown/pandoc-prep.mjs` / `export-pandoc.mjs`、`ui/markdown/math-numbers.mjs`、`ui/markdown/source-editor.mjs`（CodeMirror 源码模式）、`ui/markup.mjs` / `ui/shapes.mjs`；后端动作 `markup`、`draw`、`annot-delete`、`redact-find`，`redact` 支持多区域，`crop` 支持 `cropMode`，`compress` 支持 `profile`。研究与路线见 [docs/research](../research)，0.13 交接见 [HANDOFF-0.13.0](../history/HANDOFF-0.13.0.md)。
