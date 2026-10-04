# 青页 PDF 0.11.0 开发交接

基于 0.10.0。上一版交接见 [docs/history/HANDOFF-0.10.0.md](docs/history/HANDOFF-0.10.0.md)。

## 新增

| 功能 | 入口与行为 |
|---|---|
| 摘录带位置 | 摘录（右键 / Ctrl+Shift+E）把选区在 PDF 坐标系中的矩形写进链接：`file:///…#page=N&rect=x0,y0,x1,y1`。未保存的 PDF 用 `#qingye-source-{id,page,rect}` |
| 回到原文 | 点击链接 → `locatePdfSource`（0.9.4 已有）跳页并画出矩形 2.6 秒 |
| 框选区域摘录 | Ctrl+Shift+U、PDF 右键菜单、分隔条按钮。拖框 → 该区域以 1.5×–4× 重新渲染为 PNG → `markdown-image-save` 存到笔记的图片文件夹 → 插入图片与区域链接。笔记未保存时先走保存流程 |
| 同步批注 | 分隔条按钮 / 笔记模式菜单。后端 `inspect` 读出全部批注，按链接去重后追加到笔记末尾 |
| 滚动联动 | PDF `pagechanging` → 找笔记中指向该页的第一条链接（没有则取之前最近一页的最后一条）→ 滚到这条摘录的引用 / 图片处。仅 PDF 一侧有焦点时生效；开关记在 `localStorage['qingye.notes.sync']` |
| 笔记模式菜单 | 分屏时点击标题栏按钮显示命令菜单；Ctrl+\\ 仍直接退出 |
| 全库搜索 | 标题栏放大镜 / Ctrl+Shift+F / 首页最近搜索框按 Enter。范围是最近列表 |
| 引用信息 | PDF 右键“引用信息 / BibTeX…”、笔记模式菜单 |

## 实现

- `ui/notes-mode.mjs`：新增纯函数 `sourceLinks`、`linksInto`、`excerptStart`、`pageAnchor`、`annotationsMarkdown`、`regionMarkdown`、`regionBox`；实例方法 `excerptSelection`、`selectionSource`、`excerptRegion`、`pickRegion`、`syncAnnotations`、`pageChanged`、`setSync`。区域拾取的样式用可构造样式表注入 PDF.js 的 iframe（其 CSP 禁止内联 `<style>`）。
- `ui/library.mjs` + `library-index.cjs`：窗口用 PDF.js（`vendor/pdfjs/build/pdf.mjs`，只取文字不渲染）读出每页文字交给主进程；主进程把每个文档存成 `userData/library-index/<sha256 前 32 位>.json`（路径、大小、修改时间、每页文字），查询在主进程完成。Markdown 由主进程直接读取。已打开的 PDF 直接用其 `pdfDocument`。IPC：`library-status / -read / -put / -search / -clear`，`library-read` 只接受最近列表中的令牌。
- `ui/citation.mjs`：识别、BibTeX、GB/T 7714、APA 均为纯函数；文献库在 `localStorage['qingye.citations']`（按文件路径）。主进程 `citation-lookup` 校验 DOI 后用 Node 的 `fetch` 请求 `https://doi.org/<doi>`（`Accept: application/vnd.citationstyles.csl+json`）；窗口进程的网络仍被 `webRequest` 全部拦截。`save-text-file` 只允许 `.bib / .txt / .md`。
- `ui/app.mjs`、`ui/direct.mjs`：接线、快捷键、右键菜单项、标题栏按钮。`ui/library.css`：三处新界面的样式。
- 界面语言：新增 74 条文字和 18 条模式；`scripts/i18n/catalog.json`、`src/13-notes-links-011.tsv`、`build.py` 已同步，`python3 scripts/i18n/build.py` 可重新生成四个词典。
- 安卓版：`#libraryButton` 隐藏；这些功能均未接入安卓。
- **后端 `backend/worker.py` 未改**，冻结的 QingyeWorker 沿用 0.9.4。

## 验证

```
npm test                 # 93 项，含 test/links011.test.mjs（11 项）
npm run smoke:011        # electron . --links-smoke
node scripts/ci-smoke.cjs
```

开发环境（Linux，Electron 44.4.5，xvfb）结果：

- `npm test` 93/93 通过。
- `--links-smoke` 九项全部通过：摘录矩形与选区一致、点击链接后高亮框盖住原文、区域图片（尺寸、PNG 内容、PDF 坐标）、鼠标拖框与 Esc 取消、批注同步与去重、滚动联动（有焦点 / 无焦点 / 关闭三种情况）、全库搜索（PDF、Markdown、短语、文件修改后重建、点击命中跳转并高亮）、引用信息（识别、BibTeX、GB/T 7714、APA、插入笔记、导出 `.bib`、重开后保留、非法 DOI 被拒绝）。
- `--notes-smoke`、markdown、features、basic、conversion 冒烟通过（每个套件使用独立的 `QINGYE_SMOKE_ROOT`；共用同一个 profile 连续运行会互相干扰，CI 脚本本来就是分开的）。
- `--smoke-test` 与 `--safety-smoke` 在该 Linux 环境失败，未改动的 0.9.5 代码以相同方式失败（剪贴板与子进程沙箱）。

**未验证：**

- Windows 上的任何行为。便携版 exe 在 Linux 上交叉构建（`signAndEditExecutable=false`，图标与版本信息由 `scripts/after-pack.cjs` 用 resedit 写入），没有在 Windows 上启动过。
- “联网补全”对真实 doi.org 的请求（开发环境只测了 DOI 校验和 CSL-JSON 的解析）。
- 真实论文上的标题 / 作者识别率；测试用的是合成 PDF 和构造的文字项。
- 大文档库的索引耗时和内存（单文档上限 5000 页 / 24 MB 文字）。
- 高 DPI、多栏排版、旋转页面上的选区矩形。

## 构建

Windows 上按 `docs/BUILDING.md`。在 Linux / macOS 上交叉构建便携版：放好 Windows 的 `backend/bin/QingyeWorker/` 与 `vendor/pandoc/pandoc.exe` 后运行 `node scripts/build-distribution.cjs portable`。
