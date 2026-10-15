# Pandoc 3.12 × 青页 PDF 0.13.0：集成差距与优化分析

> 基线：QingyePDF `v0.13.0`（分支 `dev-0.13`）。对照：随包的官方 Pandoc 3.12（提交 `381230e`，GPL-2.0-or-later，未修改）。
> Pandoc 是开源软件，不需要逆向：本次通过 `scripts/prepare-pandoc.ps1` 取得官方二进制并校验 SHA-256，然后做能力探测和对照实验，再结合官方手册（`vendor/pandoc/MANUAL.html`）分析。
> 原始数据在仓库外的 `E:\QINGYEPDF\research\pandoc\`：`probe/`（格式、扩展、高亮、帮助清单）、`exp/`（实验文件）。

## 1. 结论先行

青页对 Pandoc 的使用停留在“命令行转换器”这一层，**Pandoc 最强的几样东西基本没用上**：
1. **Markdown 编辑器导出 Word、EPUB、LaTeX、RTF 用的是青页自己手写的 JS 生成器**，没有用随包的 Pandoc。只有 ODT、RST、PPTX 等“更多格式”才交给 Pandoc。
2. 交给 Pandoc 时用的**方言参数不对**：中文软换行会变成多余空格；GitHub 提示框会丢失。
3. **从其他格式导入时，写出的 Markdown 和编辑器语法不一致**：高亮、上下标变成 HTML 标签；公式变成 ```` ```math ```` 代码块。
4. **每次转换都启动一个新进程，约 0.7 秒**；改用常驻服务模式后约 35 毫秒。
5. 同一个引擎在仓库里有**两套独立的调用代码**（`pandoc-engine.cjs` 和 `markdown-tools.cjs`），参数和错误处理各写一遍。

## 2. 引擎能力（实测 `--list-*`）

- **51 种输入**：除常见格式外，还能读 **docx、odt、pptx、xlsx、epub、ipynb、typst、djot**，以及 ris、endnotexml、bibtex、csljson（参考文献）。
- **76 种输出**：包括 docx、odt、pptx、epub2/3、**typst**、chunkedhtml（分章节网站）、revealjs、beamer、slidy、jats、tei、texinfo、man、ansi、bbcode、vimdoc 等。
- 74 个语法扩展；194 种代码高亮语言；8 种高亮主题。
- 内置 **Lua 5.4** 过滤器、模板、Defaults 配置、citeproc 引用排版。
- 3.12 新增或值得注意的选项：`--syntax-highlighting`、`--figure-caption-position`、`--list-tables`、`--split-level`、`--chunk-template`、`--typst-input`、`--track-changes`、`--ipynb-output`。

## 3. 青页现状

| 路径 | 代码 | 做法 |
|---|---|---|
| 转换中心 | `pandoc-engine.cjs` + `converter-presets.cjs` + `ui/converter.mjs` | 列出全部格式；常用开关（完整文档、目录、编号、引用）；高级参数要用户手写 JSON 数组；批量转换、取消、原子写入、输出保护**做得很扎实** |
| 编辑器导出 | `ui/markdown/export*.mjs` | HTML、PDF、PNG 走 Chromium 渲染；**Word、EPUB、LaTeX、RTF、TXT 是自研生成器**（从渲染后的 DOM 生成）；ODT 等 8 种交给 Pandoc（`markdown-tools.cjs`） |
| 编辑器导入 | `markdown-tools.cjs` 的 `pandocImport` | `-t gfm+footnotes+tex_math_dollars --wrap=none --extract-media` |
| 输入方言 | `PANDOC_FROM` | `markdown+emoji+task_lists+pipe_tables+footnotes+tex_math_dollars+strikeout+subscript+superscript+mark` |

## 4. 实验

测试文档 `exp/t.md` 包含编辑器常用语法：YAML 头、`[toc]`、中文软换行、`> [!NOTE]`、`==高亮==`、`H~2~O`、`x^2^`、表情、任务列表、脚注、mermaid、`$$` 公式。

### 4.1 输入方言
| 现象 | 当前 `PANDOC_FROM` | 加上 `+east_asian_line_breaks+alerts` |
|---|---|---|
| 中文软换行 | “这是第一行中文 **␣** 紧接着的第二行。”（多了空格） | 正确，没有空格 |
| `> [!NOTE]` | 退化成普通引用，`[!NOTE]` 原样留在正文 | 识别为提示框（Div `.note`，带标题） |
| `[toc]` | 原样输出文字 | 同左，**需要过滤器** |
| mermaid | 原样输出代码块 | 同左，**需要预先渲染成图片** |

### 4.2 Word 输出：Pandoc 与自研生成器对比
Pandoc 的 docx 输出里：公式是 **6 处原生 `m:oMath`**（Word 里能直接编辑），脚注是真正的 `w:footnoteReference`，高亮是 `w:highlight`，并使用 Word 的标准样式名（Title、BodyText、SourceCode……），所以可以用参考文档统一换样式。
自研 `export-docx.mjs` 也有脚注和高亮，但公式靠 `mathml.mjs`（51 行）从 MathML 转 OMML，覆盖面远小于 Pandoc 的 texmath；它的长处是能把 mermaid 渲染成 PNG，并套用青页主题。
→ **结论：改成 Pandoc 生成 docx，由青页负责“预先渲染 mermaid”和“根据主题生成参考文档”，两边的长处都能保住。**

### 4.3 导入（docx → Markdown）
| 内容 | 当前（gfm） | 调整后的写出器 ¹ |
|---|---|---|
| 高亮 | `<span class="mark">高亮</span>` | `==高亮==` |
| 上下标 | `H<sub>2</sub>O` / `x<sup>2</sup>` | `H~2~O` / `x^2^` |
| 公式 | ```` ```math ```` 代码块 | `$$E = mc^{2}$$` |

¹ `markdown-grid_tables-multiline_tables-simple_tables-fenced_divs-bracketed_spans-header_attributes-link_attributes-native_divs-native_spans-raw_attribute-smart+mark+pipe_tables+tex_math_dollars`

### 4.4 性能（本机，8 KB 的 `sample.md`）
| 方式 | 耗时 |
|---|---|
| `pandoc --version` | 约 130 ms |
| CLI：md → docx / html | 约 760 ms / 708 ms |
| `pandoc server`：首次请求 | 610 ms（懒加载初始化） |
| `pandoc server`：之后每次 html / docx | **28–39 ms** |

服务模式的限制（实测）：
- **Lua 过滤器会被静默忽略**：请求里带 `filters` 字段不报错，但不生效。
- 不读本地文件；资源通过 `files`（base64 映射）传入，这一项可用。
- 只能绑定端口，没有鉴权。

## 5. 差距和优化清单

### P0：直接改善现有功能的质量

| # | 事项 | 做法 |
|---|---|---|
| 1 | **修正输入方言** | 统一成一个常量：`markdown+emoji+east_asian_line_breaks+alerts+mark-smart` 再加原有扩展。`-smart` 避免引号和破折号被改动，保持和编辑器显示一致。`PANDOC_FROM_LEGACY` 只在用户指定了旧版外部 Pandoc 时才需要，回退时应同时去掉旧版不认识的扩展（`alerts` 等扩展只有较新的版本才有，具体版本号以 Pandoc 更新日志为准） |
| 2 | **修正导入写出器** | 用 4.3 节的写出器参数，让导入结果使用编辑器原生语法；补 `--track-changes=accept`（默认接受修订，可选保留） |
| 3 | **Word 导出改走 Pandoc** | ① 编辑器把 mermaid 预先渲染成 PNG（现有 `svgToPng`），作为资源交给 Pandoc，并把代码块替换成图片引用；② `[toc]` 换成 Word 的目录域（Lua 过滤器输出 raw openxml）；③ 根据当前主题生成 `reference.docx`（字体包括 `w:eastAsia`、字号、标题颜色），并缓存；④ 元数据里设置 `lang: zh-CN`。保留自研生成器作为离线兜底 |
| 4 | **EPUB 同样改走 Pandoc** | `epub3` + `--split-level` + 封面、元数据；CSS 由当前主题导出 |
| 5 | **合并两套调用代码** | `markdown-tools.cjs` 的 `run`、`runPandocConvert`、`pandocExport`、`pandocImport` 全部改成调用 `pandoc-engine.cjs`，共用超时、取消、输出保护和错误处理 |

### P1：新能力

| # | 事项 | 做法 |
|---|---|---|
| 6 | **常驻 Pandoc 服务** | 主进程按需启动 `pandoc server --port=<随机端口> --timeout=30`，只监听 127.0.0.1，空闲几分钟后退出；端口不暴露给渲染进程，所有请求经主进程 IPC 转发。用于编辑器内的即时转换：复制为 Word 富文本、粘贴 Word 或 HTML 自动转成 Markdown、导出预览 |
| 7 | **用 AST 代替 Lua 过滤器（服务模式下）** | 服务模式不支持过滤器，就改成：`markdown → json AST`（服务端）→ 在 JS 里改写（`[toc]`、mermaid、提示框、图片缩放）→ `json → docx`（服务端）。一套 JS 改写逻辑能同时服务 CLI 和服务模式，不必维护两套 |
| 8 | **转换中心按格式分组，提供表单式选项** | 现在的高级参数要手写 JSON 数组。改成按输出格式显示对应选项：docx（参考文档、导入时的修订处理）、epub（封面、拆分级别、嵌入字体）、html（内嵌资源、公式方式 mathml/katex）、pptx（幻灯片级别、参考文档）、latex/pdf（引擎、`CJKmainfont` 等变量）。JSON 参数保留为“专家模式” |
| 9 | **预设和 Defaults 文件互通** | 青页预设可以导出成 Pandoc 的 `defaults.yaml`，也可以从 `defaults.yaml` 导入。用户可以在命令行和青页之间共用同一份配置 |
| 10 | **引用文献联动** | 青页已经能为 PDF 生成 BibTeX 引用信息（`citation.mjs`）。笔记里插入 `[@key]`，导出时自动生成 `bibliography.json` 交给 citeproc，并内置几种常用 CSL（GB/T 7714、APA）。**这是 PDF 阅读加 Markdown 笔记组合独有的工作流** |
| 11 | **用编辑器打开更多格式** | docx、odt、epub、ipynb、typst、djot、org、rst、latex 都可以直接“作为 Markdown 打开”，Pandoc 已经支持读取，只需要把文件关联和导入流程接上 |
| 12 | **幻灯片导出** | Markdown 导出 revealjs（单个 HTML 文件，离线可放映）和 pptx（可指定参考模板） |

### P2

| # | 事项 | 说明 |
|---|---|---|
| 13 | Typst 作为 PDF 引擎 | Pandoc 能输出 typst，也能用 `--pdf-engine=typst`。Typst 是单个可执行文件（Apache-2.0），中文排版良好，不用装 TeX。可以作为“高质量 PDF”选项，由用户自备程序或者可选下载 |
| 14 | 分章节网站 | chunkedhtml（已支持打包成 ZIP），可以加上 `--chunk-template` 的说明 |
| 15 | 高亮主题联动 | 编辑器的代码主题映射到 `--syntax-highlighting` 的 8 种内置主题；也可以自定义 theme 文件 |
| 16 | 导出 Markdown 方言 | 对应 Typora 差距分析第 20 项：commonmark、gfm、pandoc markdown，以及 `--wrap`、`--columns`、`--reference-links`、`--reference-location` |

## 6. 从 Pandoc 的设计里学什么

- **读取器 → AST → 写出器** 的三段式：所有格式只需要和 AST 互转，N 种格式不需要两两对接。青页的导出已经部分是这种结构（Markdown → 导出用 DOM → 各种格式），把中间层换成 Pandoc AST 就能直接用它的全部写出器。
- **扩展开关**：同一个读取器通过 `+ext` / `-ext` 调整方言。青页编辑器的语法设置（是否启用下标、公式、高亮）也应该映射到这些开关，保证编辑器看到的和导出的一致。
- **Defaults 和模板**：把“一次转换的全部参数”做成可以分享的文件，这正是青页预设该有的样子。
- **完全不碰网络的服务模式**：服务模式不读本地文件、不执行外部过滤器，适合做常驻服务；需要读写文件的工作留在受控的 CLI 路径里。

## 7. 建议顺序

1. **0.14 先做 P0 第 1、2、5 项**：改动小，立刻修好中文空格、提示框丢失和导入语法，并合并调用代码。
2. 然后做 P0 第 3、4 项：Word 和 EPUB 改走 Pandoc，加上主题参考文档和 mermaid 预渲染。
3. 再做 P1 第 6、7 项：常驻服务加 AST 改写，为粘贴转换、复制为 Word 打基础。
4. 第 8–12 项按用户需求安排。其中第 10 项（引用联动）和青页的 PDF 笔记定位最契合，建议优先。

## 8. 许可证提醒

继续使用未修改的官方二进制，并保留 `vendor/pandoc` 里的许可、版权和源码对应信息。Lua 过滤器、参考文档模板这些青页自写的部分按 AGPL 发布即可。如果将来修改 Pandoc 本身，要按 `CONVERSION.md` 的说明重新编译，并更新来源清单。
