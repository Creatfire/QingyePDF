# Xodo 6.3.4（Windows）× 青页 PDF 0.13.0：PDF 功能差距与优化分析

> 基线：QingyePDF `v0.13.0`（分支 `dev-0.13`）。对照：本机 Microsoft Store 版 Xodo 6.3.4（`5E8FC25E.XODODOCS`）。
> 原始证据放在仓库外的 `E:\QINGYEPDF\research\xodo\`：
> - `pkg/`：从安装包复制的声明式资源（Actions JSON、菜单和设置 JSON、XAML 类型元数据）
> - `catalog/strings-en.txt`：从 `resources.pri` 解出的英文界面字符串，共 1016 条字符串加 225 段文本
> - `catalog/strings-tools-zh.txt`：PDF 工具层的简体中文字符串
> - `rea-managed.json`：REA 对 `Xodo.dll` 的识别结果

## 1. 方法与边界

| 层 | 内容 | 处理方式 |
|---|---|---|
| `Actions/Resources/*.json`（49 个） | 批处理“文档动作”的声明式定义：分类、输入输出类型、默认参数档 | 全部读取，**最有价值** |
| `ViewModels/**/*.json` | 菜单、导航、设置页、快捷键的数据驱动定义 | 全部读取 |
| `Xodo.xr.xml`、`pdftron.PDF.Tools.xr.xml` | XAML 反射元数据：页面、控件、绑定属性名和命令名 | 用来还原界面结构 |
| `resources.pri` | 编译后的资源表 | 本次自己写了解析器，解出各语言字符串 |
| `Xodo.dll`（48 MB） | REA `inspect-managed-artifact` 判定为 `not-managed`：.NET Native 预编译，没有 CLI 元数据 | 再往下就是反汇编原生代码，收益低，**没有继续** |
| `pdftron.dll`（37 MB，Apryse 商业 SDK） | 渲染、编辑、转换、OCR 等全部 PDF 能力都在这里 | **没有碰**。只把它当作“能力清单”，青页继续用 PyMuPDF、PDF.js 等开源引擎自己实现 |

## 2. Xodo 是怎么组织的（可借鉴的实现思路）

### 2.1 外壳和引擎分离
- Xodo 自己只是一层 UWP 外壳：首页、文件夹、最近文件、设置、订阅。
- 阅读器和全部批注工具来自 `pdftron.PDF.Tools`：`ViewerControl`、`AnnotationCommandBar`、`AnnotationPropertyDialog`、`ThumbnailViewer`、`PdfCompareControl`、`CropView`、`ReflowView`、`MagnifyingControl`、`MeasureCountTool`、`RubberStampControl`、`SignatureDialog`、`AudioControl`、`UserBookmarkControl` 等。
- 菜单、导航、设置页、快捷键说明全是 JSON 数据驱动。例如 `viewer_menu.json` 里每一项写明 `commandBindingPath` 和 `commandParameter`，比如 `SaveCopyAsCommand` + `"WORD"`。

### 2.2 文档动作框架（Actions）
`Actions.json` 共 44 个动作，每个动作的结构是：

```
{ alias, id, name, parent: 分类, settings.actionType: ToPdf|FromPdf|Both,
  validation: { inputFileTypes, outputFileTypes }, stepType: "Action" }
```

- 每个动作还有一个 `XxxAction.json`，里面是 `profiles[]` **参数档**：有名称、描述、`profileType: Global`、`default: true`。
- 全局设置 `DefaultSettings.json` 规定覆盖策略（`overwriteMethod`）和默认输出连接器（`OutputFileSystemConnector`；另外预置了 S3、Azure、GCS、SharePoint、SMTP、Box 等连接器，都处于禁用状态）。
- 分类：Annotate、Convert、Optimize、Secure、Extract、Pages、Redact、Stamp。
- 界面统一是“选文件 / 拖入 → 处理中 → 结果放在灰色框里 → 继续处理更多”。所有动作共用一套批处理界面，带进度、取消和“已处理文件是否重做”的提示。

### 2.3 参数档里有不少值得抄的细节（只抄参数设计，不抄代码）
| 动作 | 参数要点 |
|---|---|
| 压缩 | 彩色、灰度、黑白**三类图像分别设置**；只有分辨率**高于阈值 DPI（225）才降采样到目标 DPI（150）**；黑白图用 **JBIG2**；有 `compressionLevel`、`qualityLevel`、`forceRecompression`、`linearized` |
| 文字印章 | 文本支持变量：`%Filename% %Date% %PageNumber% %Subject%`；`pageSubset`（全部 / 奇数页 / 偶数页）；`print` 和 `screen` 两个开关分别控制打印时和屏幕上是否显示；可以作为批注印章或内容；可以盖在背景层；有对齐、偏移、旋转、透明度 |
| 贝茨编号 | `startingNumber`、`prefix`、`suffix`、`padding`（补零位数），排版参数和文字印章一样 |
| 涂黑 | 字面文本列表 `literalTextList`、覆盖颜色；正则预设：邮箱、电话、SSN、金额、网址（日期正则因为有异常被注释掉了） |
| 加密 | AES-256；8 项权限：打印、高质量打印、修改、提取、批注、填表、组装、无障碍访问 |
| PDF → Word | `connectHyphens`（去连字符）、`matchPdfLineBreaks`、`mergeParagraphs`、`documentType: SingleColumn`、`convertBookmarks: PageStart`、`extractHyperlinks`、`removeHiddenText`、`shrinkFonts`、`adjustFontNames`、`imageResolution 192`、`jpegQuality 50`、`ocrOption: TextImage`、`exportMarkupAnnotComments`、超时 300 秒 |
| PDF/A | `compliance: Level2B` |

### 2.4 保存的稳健性（从错误文案还原出的状态机）
Xodo 为保存失败设计了一整套分支：
- 文件被其他程序占用：保留标签，提示“关闭其他程序后回来”。
- 切到后台时自动保存失败：通知用户。
- 磁盘文件被外部修改，同时本地也有未保存修改：让用户选“用磁盘版本”还是“保留我的修改”。
- 原文件已经不在：仍可查看，引导另存为。
- 不能保存到原文件的操作（加密副本、压缩副本、扁平化副本、永久裁剪副本）：强制另存为新文件。
- 文档数据无效：提供“保存修复后的副本”。
- 自动保存有两种模式：每次修改就保存，或按定时器保存。

## 3. 青页 0.13.0 PDF 端现状

- 阅读和批注：内置 PDF.js 编辑器，有高亮、自由绘制、文本框、插入图片、手写签名、评论（`ui/chrome.mjs` 的 `ANNOTATION_TOOLS`）。
- 工具箱：`backend/worker.py`（PyMuPDF）提供 27 个动作：导出、导入、整理、裁剪、大纲、替换文字、印章、图片、页面印章、水印、页码、图形、批注、表单、扁平化、加密、解密、涂黑、锐化、压缩、OCR、扫描优化、比较等。参数表单在 `ui/tools.mjs` 里按 `data-for` 手写。
- 阅读体验：单页 / 双页 / 封面、文字重排、连续滚动、19 种配色加亮度和对比度、阅读裁剪、缩略图、多窗口、全库搜索、笔记模式、AI。这些多数**已经达到或超过 Xodo**。
- `FEATURES.md` 自己列的未达标项：高保真 Office 转换、保持原字体的原文编辑、证书数字签名、PDF/A、复杂表单、阅读器内覆盖比较、自动去黑边。

## 4. 差距清单

记号：✅ 已有 · ◐ 部分 · ✗ 缺失。P0 = 日常使用频率高或数据安全相关，P1 = 重要工作流，P2 = 锦上添花。

### P0

| # | 能力 | Xodo | 青页 0.13 | 实现思路 |
|---|---|---|---|---|
| 1 | **交互式图形批注** | 矩形、椭圆、直线、箭头、折线、多边形、云形线，画在页面上即可拖动和缩放 | ◐ 图形只能在工具箱里**输入坐标**生成（`toolShape` 只有矩形、椭圆、直线），PDF.js 编辑器里没有图形工具 | 在 PDF.js 编辑层旁边加一个自研的 `ShapeEditor`：用 SVG 覆盖层绘制和编辑，保存时交给后端写入标准的 Square、Circle、Line（带 LE 箭头）、PolyLine、Polygon（云形线用 BE 字典）批注，生成外观流。这样别的阅读器也能看到和修改 |
| 2 | **文本标记补全** | 高亮、下划线、波浪线、删除线，全部基于选中的文字 | ◐ 只有高亮在阅读器里可用；下划线和删除线只能在工具箱里按坐标生成；没有波浪线 | 复用 PDF.js 高亮的选区和四边形逻辑，把批注子类型参数化成 Underline、Squiggly、StrikeOut。后端已经有写入这几种批注的代码 |
| 3 | **按搜索和正则涂黑** | 涂黑文字（字面列表）、按搜索涂黑、正则预设、整页涂黑、涂黑图像、覆盖颜色可选 | ◐ 只能**输入坐标框选**区域；并且会把整份文档的批注和表单全部扁平化（`doc.bake`） | ① 在页面上拖框标记，标记会先显示为待确认的涂黑批注，确认后再应用；② 按关键词和正则搜索并逐条确认，预设加入中国常用格式（手机号、身份证号、银行卡号、邮箱、网址、金额）；③ 只扁平化和涂黑区域相交的批注，不再整份扁平化 |
| 4 | 批注属性和预设 | 属性对话框：颜色、透明度、线宽、字体；每个工具最多 4 个预设；自定义颜色网格；单条批注扁平化；复制、剪切、粘贴、复制一份；成组和取消成组 | ◐ 依赖 PDF.js 自带的属性面板 | 给每种工具保存 3 到 4 个预设（存在 prefs 里）；右键菜单加“复制一份 / 扁平化此条 / 置顶置底”；成组可以先不做 |
| 5 | 批注工作流设置 | 连续批注（画完不退回手形工具）；高亮时把选中文字自动复制进批注备注；作者名（首次询问，在设置里可改）；墨迹平滑；多笔画间隔；手写笔默认画墨迹还是平移 | ✗ 都没有（作者名只在引用信息里用到） | 加到设置的“批注”页。作者名写进批注的 `/T`，备注写进 `/Contents` |
| 6 | 单字母快捷键 | H 高亮、U 下划线、G 波浪线、C 便签、I 墨迹、E 橡皮、T 文本框、R 矩形、O 椭圆、L 直线、A 箭头、K 印章、S 签名、P 或 Esc 平移、Ctrl+M 多选、Ctrl+L 套索、Ctrl+R 朗读 | ◐ 有部分快捷键 | 有焦点在阅读器且不在输入框里时，启用单字母快捷键；设置里列出快捷键表 |
| 7 | 保存稳健性 | 见 2.4 节的状态机 | ◐ 已有外部修改冲突检查、草稿恢复 | 补三项：文件被占用时的处理；不能存回原文件的操作强制另存为；用 PyMuPDF 的 `garbage` 加 `clean` 提供“保存修复后的副本” |

### P1

| # | 能力 | Xodo | 青页 0.13 | 实现思路 |
|---|---|---|---|---|
| 8 | **动作框架改成声明式** | 动作的 JSON 定义、参数档、输入输出校验、统一批处理界面 | ◐ `tools.mjs` 里手写表单和 `data-for` 映射，参数只在一次运行内有效 | `actions/*.json` 统一描述动作：`{id, category, inputs, outputs, params: schema, profiles}`。表单由 schema 自动生成；参数档可以命名保存，默认档放在 prefs 里。后端校验也用同一份 schema。**这是 Xodo 最值得学的架构** |
| 9 | 压缩参数档 | 彩色、灰度、黑白三类分别设置，阈值 DPI 和目标 DPI 分开，JBIG2，线性化 | ◐ `rewrite_images(dpi_threshold=dpi+20, dpi_target=dpi)`，全部图像共用一套参数 | 拆成三类参数，阈值和目标分开设置；提供“小文件 / 平衡 / 高质量”三个预设；可选线性化（PyMuPDF 1.25 起 `save(linear=True)` 已经弃用，需要验证当前版本或用 qpdf） |
| 10 | 印章变量和贝茨编号 | `%Filename% %Date% %PageNumber% %Subject%`；贝茨编号（前缀、后缀、补零、起始号）；奇偶页；“只打印 / 只显示” | ◐ 页码支持 `{page}` 和 `{total}`；没有贝茨编号，没有奇偶页 | 统一一个变量模板引擎：`{file} {date} {time} {page} {total} {title} {author} {bates}`；页码范围加“奇数页 / 偶数页”；“只打印 / 只显示”用批注的 Print、NoView 标志或可选内容组（OCG）实现 |
| 11 | 智能裁剪 | 自动裁剪到内容区域；奇数页、偶数页分别设置裁剪框；移除全部裁剪；另存永久裁剪副本 | ◐ 手动 CropBox；阅读裁剪按百分比 | 自动裁剪：用 PyMuPDF 取文字、图像、绘图的内容包围盒，加边距；奇偶页分开设置；“永久裁剪”另存时真正删除框外内容（`apply_redactions` 或重写页面） |
| 12 | 查找并替换文字 | Find and Replace Text（批处理，支持页码范围） | ◐ 只有“替换框选区域原文” | 搜索命中后对每个命中区域复用现有“替换文字”的逻辑；明确提示字体可能变化 |
| 13 | 测量工具 | 距离、周长、面积、计数；校准比例尺 | ✗ | 用 SVG 覆盖层加校准比例（例如 1 英寸等于多少米），写入标准的测量批注（`Measure` 字典），保证 Acrobat 也能读 |
| 14 | 便签式批注 | 便签图标批注（Text 批注，带图标）、声音批注 | ◐ 有“评论”（PDF.js），没有图标式便签 | 便签用标准 Text 批注，提供几种图标；声音批注优先级低 |
| 15 | 橡皮印章库 | 内置 19 个标准章（APPROVED、CONFIDENTIAL、DRAFT、FINAL、VOID 等），带配色和透明度 | ◐ 有常用文字印章库 | 内置一组中文标准章（已审核、机密、草稿、作废、已完成、仅供参考……）加配色，用矢量外观生成 |
| 16 | 链接创建 | 链接到网址 / 链接到本 PDF 的某页；移除全部链接 | ◐ 后端能移除链接，阅读器里不能新建 | 拖框后选目标，写入 Link 批注（`/URI` 或 `/GoTo`） |
| 17 | 比较 | 左右两个 PDF，同步缩放、同步滚动、同步页码；可以比较全部页文字，或比较指定两页 | ◐ 有并排加同步页码；差异以 HTML 报告输出 | 阅读器里直接给差异区域高亮，并提供“上一处 / 下一处差异”跳转；补上同步缩放 |
| 18 | 转换参数 | PDF → Word 的参数（见 2.3 节）；PDF → TIFF（可多页）、BMP、SVG（字体转路径）；PDF → Excel（合并到单个工作表、包含非表格内容） | ◐ DOCX 只是文本加图片 | DOCX 加去连字符、合并段落、书签转标题、导出批注为批注框这几个选项；TIFF 多页输出；SVG 可选“字体转路径” |
| 19 | 新建文档 | 空白文档：纸张大小、方向、页数、纸张样式（空白、横线、方格）；从图片或相机新建 | ◐ 插入空白页 | “新建 PDF”对话框；横线和方格纸用矢量生成 |

### P2

| # | 能力 | 说明 |
|---|---|---|
| 20 | 放大镜 | 按住时局部放大（触屏和手写笔场景） |
| 21 | 朗读 | 朗读选中文字（Ctrl+R），用 `speechSynthesis` 实现 |
| 22 | 从右到左阅读 | 双页模式下页面从右往左排，适合日漫、阿拉伯语文档 |
| 23 | 标签行为 | 标签过多时横向滚动，或者所有标签等宽；Ctrl+1–9 切换标签 |
| 24 | PDF JavaScript 开关 | 默认关闭（安全），设置里可以打开 |
| 25 | 导入字体 | 文本框可用的字体由用户导入，修复中文字体缺失 |
| 26 | XFDF 导入导出 | 批注单独导入导出，方便和 Acrobat、Xodo 交换批注 |
| 27 | PDF/A | 至少提供 PDF/A-2b 转换（Ghostscript 有授权问题；可以研究 PyMuPDF 或 veraPDF 校验），并且说明不能保证完全合规 |
| 28 | 证书数字签名 | 难度和工作量最大，单独评估（pyHanko，MIT 协议，可行） |

## 5. 青页已经领先 Xodo 的部分（保持即可）

19 种配色加亮度和对比度、保留图片原色、文字重排阅读、本地中英文 OCR 加透明文字层、扫描纠偏、图像锐化、笔记模式（PDF 加 Markdown 双向链接）、全库搜索、引用信息和 BibTeX、AI 协作、Markdown 编辑器、Pandoc 转换中心，全部离线、没有会员次数限制。Xodo 免费版的大部分批处理动作需要 Pro 订阅。

## 6. 建议路线

1. **0.14-x 批注补全（P0 第 1、2、4–6 项）**：交互式图形、文字标记、预设、快捷键。日常使用感受提升最大。
2. **0.14-y 涂黑重做（P0 第 3 项）**：在页面上框选、按搜索和正则、只扁平化相交批注。这一项关系到数据安全，需要配上回归测试，验证文字确实从内容流中删除了。
3. **0.15 动作框架（P1 第 8 项）**：把工具箱迁移到声明式 schema 加参数档。顺带完成压缩档、印章变量、贝茨编号、奇偶页、智能裁剪（第 9–12 项）。
4. 其余按需安排。

可以和 Typora 路线（`docs/research/typora-gap-analysis.md`）交替进行：Markdown 端先做编辑手感，PDF 端先做批注补全。

## 7. 不做的

- 不反汇编 `Xodo.dll` 或 `pdftron.dll`，不使用 Apryse SDK 或它的资源（包括图标和印章图片）。
- 不做账号、云端连接器和订阅相关功能，这和青页本地优先的定位相反。
