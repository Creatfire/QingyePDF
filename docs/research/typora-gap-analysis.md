# Typora 1.14.10 × 青页 PDF 0.13.0：Markdown 功能差距分析

> 基线：QingyePDF `v0.13.0`（分支 `dev-0.13`）。对照：本机安装的 Typora 1.14.10（Windows x64）。
> 原始证据在仓库外的 `E:\QINGYEPDF\research\typora\`：`rea/app-graph.json`（REA 静态重建结果）、`catalog/*.tsv`（中英对照的菜单和设置字符串）。

## 1. 方法与边界

| 来源 | 用法 |
|---|---|
| `resources/appsrc/window/frame.js`（1.7 MB，压缩但未加密的渲染进程代码） | 用 REA `analyze-javascript-application` 做静态重建（8260 个图节点、2601 个模块），再人工阅读关键模块，了解实现思路 |
| `locales/*/Menu.json` / `Panel.json` / `Front.json` | 完整功能目录：301 个菜单字符串、500 个设置/对话框字符串 |
| `lib.asar`、`node_modules.asar`、原生 `.node` 文件 | 依赖清单，用来推断技术选型 |
| `Docs/*.md` | 官方行为说明 |
| `app.asar/atom.compiled.dist.jsc` | **没有碰**。这是 V8 字节码，属于有意的保护措施，只记录它存在 |

本次只学习功能和实现思路，不复制 Typora 代码。下面所有建议都基于青页现有架构和开源组件独立实现。

## 2. Typora 是怎么做的（关键实现）

### 2.1 模块地图（来自编辑器主模块的依赖表）
`NodeDef`（节点树）· `MarkParser`（Markdown → 节点）· `Node2Mark`（节点 → Markdown）· `Node2HTML` · `NodeOperation` · `Brush`（异步重渲染队列）· `Selection`（基于 rangy）· `UndoManager` · `Fences`（CodeMirror 代码块）· `MathBlock` / `MathInline`（MathJax 4）· `HTMLBlock` · `TableEdit` · `ImageEdit` · `AutoComplete` · `KeyMaster` · `SearchPanel` · `SourceView`（CodeMirror 源码模式）· `SpellCheck` · `Library` · `QuickOpenPanel` · `FilePreview` · `EditorToolbar` · `Export` · `WordCount`。

### 2.2 文档模型：节点树 + 保留源码细节
- 块类型 15 种：`paragraph heading blockquote fences hr def_link def_footnote table raw_edit meta_block math_block html_block list toc iframe`，另有子节点 `list_item table_row table_cell alert_title`。
- 行内类型 40 余种（`strong em code del highlight subscript superscript inline_math emoji footnote reflink refimg autolink html_entity pants softbreak linebreak …`）。
- 节点上记录源码的书写习惯：`userIndent`、`subindent`、`prespace`、`markindent`、`tight/loose`、`patternEnd`、`legacyMath` 等。所以 `Node2Mark` 写回时能保留用户原来的缩进、空格和标记风格。

### 2.3 所见即所得的核心技巧：DOM 里始终带着源码
- 渲染出的 DOM 一直包含 Markdown 标记，例如 `<span class="md-meta md-before">**</span>`。平时用 CSS 隐藏；光标进入某个行内元素时，给它加上 `md-expand` 类，**只露出这一个行内元素**的标记。块级用 `md-focus` 标记。
- 好处是 DOM 文本基本等于源码，光标和源码偏移的映射几乎不需要计算。
- 打字时让 contenteditable 直接修改 DOM，`Brush` 把受影响的块 id 放进队列，每 **200 ms** 重新解析一次（繁忙模式下 500 ms）。打字不会因为解析而卡顿。

### 2.4 大文档：繁忙模式和超大模式
- 进入繁忙模式的条件：文本超过 60 000 字符（Mac 或使用输入法时是 35 000），或节点超过 10 000，或 `innerHTML` 超过 3 MB（图片、SVG、CodeMirror 按权重计入）。进入后 Brush 改为 500 ms 一轮，聚焦块以外的部分不可编辑。
- 再大就进入超大模式（`#ty-oversize-body`），提示用户改用源码模式。

### 2.5 撤销：命令栈
- 每条命令记录 `{undo:[ops], redo:[ops]}`，操作类型有 `replace / insert / delete / reload / initSrc / cursor / fences-pos`。
- 只移动光标的命令会被合并；`discardable` 命令可以静默丢弃。
- 按预算裁剪而不是按条数：总预算 160，`reload` 记 5 分（繁忙模式记 10 分），超出就砍掉一半。
- `storeToJson / restoreFromJson`：**撤销栈可以序列化**，崩溃恢复后仍能继续撤销。
- 光标在代码块、公式或源码模式里时，撤销交给 CodeMirror 自己处理；在输入框里时交给 `webContents.undo`。

### 2.6 技术选型（依赖清单）
CodeMirror（代码块和源码模式）、MathJax 4 `tex-svg-full`、mermaid + mermaid-zenuml、flowchart.js / js-sequence（raphael）、jimp（图片处理）、pdf-lib（PDF 书签）、list.js + fuzzysearch（快速打开）、`vscode-ripgrep`（文件夹全文搜索）、`cld.node`（自动识别拼写检查语言）、hunspell 词典、chokidar（文件监听）、lowdb（本地状态）、iconv-lite + jschardet（编码识别）。

## 3. 青页 0.13.0 现状

- `ui/markdown/editor.mjs`：**以 Markdown 文本为唯一事实来源**。用 markdown-it 把文档切成顶层块，每块渲染成 HTML；光标所在的块切换成带样式的源码。所有修改都经过 `apply()` 记录文本差异撤销，保存时逐字节写回用户输入的内容。
- 优点：不需要从节点反序列化，保存最忠实，代码量小（Markdown 模块约 6.7k 行）。**这套架构值得保留，不建议改成 Typora 那样的节点树。**
- 已有大约 153 条命令（`registry.mjs`），覆盖 Typora 的段落、格式、表格、编辑、视图菜单的大部分，另外有 AI、PDF 笔记等 Typora 没有的能力。
- 实测（Node 24，`sample.md` 重复拼接）：每次结构变化都要全量 `analyze()`。50 KB 约 8 ms，200 KB 约 37 ms，1 MB 约 86 ms（14 937 块），这还不算 DOM 替换的时间。

结论：**菜单层面基本对齐，差距主要在编辑手感、代码和公式能力、大文档处理、导出与图片工作流上。**

## 4. 差距清单

记号：✅ 已有 · ◐ 部分 · ✗ 缺失。优先级 P0 = 直接影响编辑体验，P1 = 重要工作流，P2 = 锦上添花。

### P0：编辑核心

| # | 能力 | Typora | 青页 0.13 | 实现思路 |
|---|---|---|---|---|
| 1 | 行内标记按需显示 | 只展开光标所在的行内元素（`md-expand`）；标题 `#` 是否显示可配置（“聚焦时显示简单块的源码”） | ◐ 整块切换成源码，块内所有 `**`、`[]()` 一起露出 | 在 `source-style.mjs` 生成活动块时，把标记包进 `span.mdMark`，再按所属行内元素分组；`selectionchange` 时只给包含光标的那组加 `.isOpen`，CSS 隐藏其余标记。DOM 文本仍等于源码，现有偏移映射不用改 |
| 2 | 代码块编辑器 | CodeMirror：编辑时高亮、语言输入框、行号、自动缩进、Tab 和 Shift+Tab | ◐ contenteditable + highlight.js，编辑时体验弱 | 引入 CodeMirror 6（MIT，可离线打包进 vendor）。只给“打开中的代码块”挂编辑器，其余继续静态高亮，控制开销 |
| 3 | 源码模式 | CodeMirror：语法着色、行号、查找、自动换行开关 | ◐ 普通 `<textarea>` | 同样使用 CodeMirror 6，加 markdown 语言包，和第 2 项共用一份 vendor |
| 4 | 撤销能力 | 命令栈，按预算裁剪，可序列化，崩溃后能继续撤销，代码块和公式内单独撤销 | ◐ 文本差异栈，上限 500 条，不参与恢复 | 保留差异模型（比 Typora 更简单可靠），新增：① 按字节预算裁剪；② 撤销栈跟 `recovery.cjs` 的草稿一起写盘；③ 光标在 CodeMirror 里时把撤销交给它 |
| 5 | 大文档 | 繁忙模式、超大模式，异步重解析 | ✗ 每次结构变化都全量解析和对比 | ① 增量 `analyze`：只从改动块的前一个块重新解析到第一个和旧结果对齐的边界；② 超过阈值（例如 60 000 字符）后，只给可见块之外的块渲染占位（IntersectionObserver 懒渲染）；③ 超过 3 MB 时提示切换到源码模式 |
| 6 | 输入法和打字流畅度 | 在 DOM 里直接输入，Brush 每 200 ms 合并重解析 | ◐ 有组合输入处理；普通按键走 `apply()` 并同步刷新 | 活动块内打字只更新文本和 DOM，不调 `refresh()`；用 rAF 或 150 ms 节流重渲染样式。配一个中文输入法回归测试 |

### P1：重要工作流

| # | 能力 | Typora | 青页 0.13 | 实现思路 |
|---|---|---|---|---|
| 7 | 公式编号与引用 | MathJax 4：自动编号（无 / AMS 规则 / 全部）、`\tag`、`\label` + `\eqref`，可选 physics 宏包 | ◐ KaTeX 渲染，没有自动编号和交叉引用 | 继续用 KaTeX，自己加一轮编号：给公式块分配编号并渲染 `\tag`，解析 `\label` 并把 `\eqref` 替换成链接。physics 宏可以用 KaTeX `macros` 补一个子集 |
| 8 | 导出配置档 | 可以存多套导出配置：PDF 纸张、页边距、页眉页脚、顶级标题前分页、导出主题；HTML 的 `<head>/<body>` 附加内容、大纲侧栏；Pandoc 参数、模板、参考文档、导出后运行命令；YAML 覆盖导出设置；“使用上一次设置导出”和“覆盖上次导出文件” | ◐ 一套全局 PDF 设置（纸张、页边距、横向、页眉页脚、背景） | `prefs.exportProfiles[]`，每条是 `{name, format, options}`；导出对话框选配置；记住 `lastExport`，提供“使用上一次设置导出”；Front Matter 里的 `export:` 字段覆盖配置 |
| 9 | 图片工作流 | 重命名或移动图片、在 Markdown 和 HTML 语法间切换、缩放图片（`<img style="zoom:50%">`）、删除图片文件、重新加载、复制或移动全部图片、上传（PicGo / PicList / 自定义命令）；兼容 YAML 的 `typora-root-url` 和 `typora-copy-images-to` | ◐ 插入时复制到文件夹、复制全部图片、图片根目录 | 补右键图片菜单；缩放用 `zoom` 写回 HTML；兼容 Typora 的两个 YAML 字段，方便迁移文档；上传只做“自定义命令”这一种，默认关闭，符合离线优先 |
| 10 | 兼容 Typora 主题 | 社区有数百个主题，都基于 `#write`、`.md-fences`、`.md-toc` 等选择器 | ✗ 只有内置六套主题和自定义 CSS | 导出和阅读的 DOM 加上兼容别名：根节点 `id="write"`、代码块 `.md-fences`、目录 `.md-toc`、警告框 `.md-alert-*` 等；导入 `.css` 时自动加作用域前缀。这样用户能直接用现成的 Typora 主题 |
| 11 | 文件库 | 列表视图（带预览和排序）、固定和最近位置、文件树和文件库的 glob 过滤、显示隐藏文件、快速打开（模糊搜索）、文件夹全文搜索（ripgrep） | ◐ 文件树、快速打开、最近文件；PDF 有全库搜索 | 列表视图复用 `library-index.cjs`；glob 过滤写进 prefs；Markdown 全文搜索可以复用 PDF 全库搜索的索引通道 |
| 12 | 智能标点 | 输入时转换 / 渲染时转换 / 解析时把 Unicode 标点映射回 ASCII；破折号规则可选（`--` → en dash 或 em dash） | ◐ 只有“渲染时转换” | 加“输入时转换”（输入 `"`、`--` 时直接替换）和破折号规则选项 |
| 13 | 小交互 | 没有选区时 Ctrl+C / Ctrl+X 作用于整行；Ctrl+滚轮缩放；拖放文件和文件夹的处理方式可配置；默认代码语言（上一次使用 / 指定语言）；代码块自动换行和缩进宽度；自动识别 URL | ◐ 有自动链接；其余缺失 | 每项都是独立的小改动，可以合并成一个小版本 |
| 14 | 图表 | mermaid（含 zenuml）、flowchart.js、js-sequence | ◐ mermaid；`diagrams-legacy.mjs` 为旧语法做兼容 | 先确认旧语法是否完整渲染，再评估要不要加 zenuml（会增加打包体积） |

### P2：锦上添花

| # | 能力 | 说明 |
|---|---|---|
| 15 | 拼写检查 | Typora 用 `cld` 自动识别文档语言，支持“添加到字典”和“忘记拼写”。青页可以基于 Electron 自带拼写检查加个人词典 |
| 16 | 朗读 | 开始和停止朗读，用 `speechSynthesis` 实现，几乎零成本 |
| 17 | 划词搜索 | 选中文字后从右键菜单用指定 URL 搜索（`searchService`，可配置）。默认关闭，符合离线定位 |
| 18 | 资源管理器“新建 → Markdown” | `file-associations.cjs` 加 ShellNew 注册表项，在设置里提供开关 |
| 19 | 深色模式单独选主题 | 跟随系统深浅色自动切换两套主题 |
| 20 | 导出 Markdown 方言 | 导出时可选方言：原始 Markdown / CommonMark / Pandoc，以及换行宽度、仅 ASCII、引用式链接、脚注位置（对应 Pandoc 的 `--wrap`、`--columns`、`--ascii`、`--reference-links`、`--reference-location`） |
| 21 | 字数统计 | 阅读速度可设置（慢 120 / 中 240 / 快 382 词每分钟）；按选区统计 |

## 5. 建议的 0.14 路线

1. **0.14-a 编辑手感（P0 第 1、6 项）**：行内标记按需显示 + 打字时不全量刷新。用户最直接的感受就是“像不像 Typora”。改动集中在 `editor.mjs` 和 `source-style.mjs`。
2. **0.14-b 代码与源码（P0 第 2、3 项）**：引入 CodeMirror 6 vendor，代码块和源码模式一起换掉。
3. **0.14-c 稳健性（P0 第 4、5 项）**：撤销栈持久化，大文档增量解析和懒渲染。补 1 MB 以上文档的性能回归测试，把上面的实测数据当基线。
4. **0.14-d 工作流（P1 第 7–10 项）**：公式编号、导出配置档、图片菜单、Typora 主题兼容。
5. P1 其余项和 P2 按需穿插。

每一步都配上 `test/*.test.mjs` 单元测试和 Electron 冒烟测试，沿用仓库现有模式。

## 6. 不建议做的

- 把文档模型改成 Typora 式的节点树。青页“文本即事实”的模型在保存忠实度和代码量上都更好，需要的手感完全可以在现有模型上实现（见 P0 第 1 项）。
- 解密 `atom.compiled.dist.jsc`，或者照搬 Typora 的代码和资源（包括主题和图标）。
