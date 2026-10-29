# macOS 版并行测试文档（8 个 agent，工具栏重构分支，计划 0.21）

本文供 8 个测试 agent 在同一台 Apple 芯片 Mac 上**同时**执行。每个 agent 领一张任务卡（A1–A8），使用自己的应用实例、配置目录、端口和测试文件，互不干扰。工具栏改动的背景见 [工具栏重构测试文档](TOOLBAR-0.21-TEST.md)，平台说明见 [macOS](../platforms/MACOS.md)。

## 0. 被测版本

| 项目 | 值 |
|---|---|
| 分支与提交 | `feat/toolbar-redesign`，基于 `d833b50`，另加本轮的测试工具改动（未提交） |
| 产物 | `dist/QingyePDF-0.20.0-mac-arm64.dmg`（534 MB，SHA-256 `4ff1f1ec53eb4d03b6b892da5ec5cdee0e894ffbe275b5bb12f322609df70bfe`，见 `dist/SHA256SUMS-mac-arm64.txt`）；解开的应用在 `dist/mac-arm64/QingyePDF.app`（1.4 GB） |
| 构建方式 | 本机 `npx electron-builder --mac dmg --arm64 -c.mac.identity=- -c.mac.notarize=false -c.electronDist=node_modules/electron/dist`：ad-hoc 签名、未公证；只有 Apple 芯片版本，没有 Intel 版本 |
| 随包引擎 | Electron 44.10.0；Pandoc 3.12（arm64）；LibreOffice 26.2.6（官方 aarch64 dmg）；PyInstaller 冻结的 PDF 后端（arm64）；OCR 数据 chi_sim + eng |
| 构建机 | macOS 27.0.1，Apple 芯片，Node.js 22.23.3，npm 11.21.1，Python 3.12 |
| 构建时已确认 | 应用包里的后端、Pandoc、LibreOffice、OCR 数据都在且能启动；`codesign --verify --deep` 通过；打包应用经驱动脚本启动、打开 PDF、切换中文界面正常；源码版 `npm run verify` 147 项通过 2 项跳过，后端 98 项通过，9 个源码冒烟套件通过。其余全部由本文的 8 个 agent 测试 |

版本号仍是 0.20.0（工具栏改动标为“未发布”），关于窗口和文件名都显示 0.20.0，这是预期的。


## 1. 并行规则（所有 agent 必须遵守）

同一台电脑上有些资源只有一份。为避免互相干扰：

| 资源 | 规则 |
|---|---|
| 鼠标、键盘、屏幕焦点 | **只有 A8 可以操作真实鼠标键盘**（人工或电脑控制）。A1–A7 一律通过 `scripts/agent-session.cjs` 给自己的窗口发事件，不会移动真实鼠标 |
| 系统剪贴板 | 只有 A8 测复制粘贴。A1–A7 不读写剪贴板 |
| 全屏、打印、访达、Dock、系统外观、文件关联 | 只有 A8。A1–A7 不进入全屏、不打印、不改系统设置 |
| 端口 | A1 = 9301 … A8 = 9308，只用自己的端口 |
| 文件夹 | 只写 `test-output/agents/<编号>/`（实例、配置、输出、截图、报告都在这里）。不改仓库里的其他文件，不运行 `git` 写操作 |
| 进程 | 只停止自己的会话（`stop --name <编号>`）。禁止 `killall`、`pkill Electron`、`pkill QingyePDF` |
| `dist/` 与构建 | 只读。除 A1 外不运行 `npm`、构建或安装依赖 |
| 时间顺序 | A1 的“源码冒烟”和“打包冒烟”会打开窗口并短暂全屏，A8 在 A1 报告“冒烟完成”之后再做需要屏幕的部分；其余 agent 不受影响 |

每个 agent 的应用使用独立配置目录（`QINGYE_PROFILE_DIR`），不会读写用户自己的青页数据；A8 涉及真实配置的步骤见其任务卡。

## 2. 通用准备（每个 agent 都做）

在终端里，把 `A2` 换成自己的编号、`9302` 换成自己的端口：

```bash
cd /Volumes/RC10/QingyePDF/QingyePDF-v0.20.0
export PATH="/opt/homebrew/bin:$PATH"
export AGENT=A2 PORT=9302
export D="$PWD/test-output/agents/$AGENT" F="$PWD/test-output/agents/$AGENT/fixtures"
Q() { node scripts/agent-session.cjs "$@" --name "$AGENT"; }
.backend-build/bin/python scripts/agent-fixtures.py "$F"     # 生成自己的一套测试文件
Q start --port "$PORT" --packaged "$F/text.pdf"           # 启动打包好的应用并打开 text.pdf
```

启动后先做这两步（新配置第一次启动会弹出“首次启动说明”，并按系统语言显示界面）：

```bash
Q eval "(async()=>{const m=document.getElementById('messageDialog');if(m.open)m.close();await qingye.i18n.setLanguage('zh-CN');return qingye.i18n.current()})()"
Q eval "(async()=>{for(let i=0;i<100&&![...qingye.sessions.values()].at(-1)?.loaded;i++)await new Promise(r=>setTimeout(r,200));return [...qingye.sessions.values()].map(s=>[s.name,s.loaded])})()"
```

预期分别输出 `"zh-CN"` 和 `[["text.pdf", true]]`。A4 测其他语言时再自行切换。

### 驱动脚本用法

| 命令 | 作用 |
|---|---|
| `Q eval "<JS 表达式>"` | 在窗口里执行并输出 JSON 结果，可用 `await`；`window.qingye` 是应用的测试接口 |
| `Q click "<CSS 选择器>"`，可加 `--right` / `--double` | 在元素中心点击（只发给本窗口） |
| `Q key Meta+Shift+P` | 按键：修饰键 `Meta`（⌘）、`Ctrl`、`Alt`（⌥）、`Shift`；键名如 `Escape`、`Enter`、`Tab`、`ArrowDown`、`F11`、字母、数字 |
| `Q type "文字"` | 在当前焦点输入文字 |
| `Q shot "$D/shots/A2-T1.png"` | 截取本窗口 |
| `Q open "$F/long.pdf"` | 在已打开的窗口里再打开文件 |
| `Q queue-open "$F/x.pdf"` | 下一次“打开”系统对话框直接选这些文件 |
| `Q queue-answer 1` | 下一次确认框选第 1 个按钮（从 0 数）；不设置时选默认按钮 |
| `Q stop` | 关闭自己的实例 |

- 系统原生对话框不会弹出：保存对话框自动写到 `$D/outputs/<建议的文件名>`，每个对话框都记录在 `$D/dialogs.log`（JSON 每行一条），断言“弹出了确认框”时查这个文件。
- 菜单栏里的系统快捷键（例如从 macOS 菜单触发的 ⌘P、⌘Q）收不到 `Q key` 发的事件，由 A8 测；窗口自己处理的快捷键（⇧⌘P、⇧⌘T、⌘O、⌘S、⌘F 等）可以用 `Q key` 测。
- 检查输出的 PDF：`.backend-build/bin/python -c "import pymupdf;d=pymupdf.open('$D/outputs/x.pdf');print(d.page_count,d.is_encrypted,d[0].get_text()[:200])"`。
- 测完执行 `Q stop`。应用崩溃或无响应时看 `$D/app.log`，记录后 `Q stop` 再 `Q start` 重来。

## 3. 报告格式

每个 agent 写 `test-output/agents/<编号>/report.md`：

```markdown
# <编号> 测试报告
环境：macOS 版本、芯片、应用路径、开始与结束时间
| 编号 | 结果 | 证据 | 备注 |
|---|---|---|---|
| A2-01 | 通过 / 失败 / 阻塞 / 跳过 | 截图或输出文件路径 | 实际现象 |
## 发现的问题
### <编号>-BUG-1 标题
- 重现步骤（可复制的命令）、预期、实际、截图、app.log 片段、严重程度（阻断 / 严重 / 一般 / 轻微）
```

“失败”必须附重现命令和证据；因为前置条件不满足没法做的写“阻塞”并说明原因。最后由协调人把 8 份报告汇总。

## 4. 任务卡

### A1 · 构建产物与自动测试（端口 9301）

不启动交互实例；本卡会打开冒烟测试窗口，完成后通知 A8。

| 编号 | 操作 | 预期 |
|---|---|---|
| A1-01 | `ls -la dist/*.dmg; shasum -a 256 dist/*.dmg` | 有 `QingyePDF-0.20.0-mac-arm64.dmg`，记录大小与 SHA-256 |
| A1-02 | `app=dist/mac-arm64/QingyePDF.app; file "$app/Contents/MacOS/QingyePDF"` | Mach-O arm64 |
| A1-03 | `test -x "$app/Contents/Resources/backend/QingyeWorker" && test -x "$app/Contents/Resources/pandoc/pandoc" && test -f "$app/Contents/Resources/ocr/chi_sim.traineddata" && test -x "$app/Contents/Resources/libreoffice/LibreOffice.app/Contents/MacOS/soffice" && echo ok` | 输出 ok |
| A1-04 | `"$app/Contents/Resources/pandoc/pandoc" --version \| head -1`；`printf '{}' > "$D/empty.json"; "$app/Contents/Resources/backend/QingyeWorker" "$D/empty.json"; echo $?` | Pandoc 3.12；后端能启动并给出错误信息退出（不是崩溃或“无法打开”） |
| A1-05 | `"$app/Contents/Resources/libreoffice/LibreOffice.app/Contents/MacOS/soffice" --version` | LibreOffice 26.2.6 |
| A1-06 | `codesign --verify --deep --verbose=2 "$app"; spctl -a -vv "$app"` | 记录结果（本地构建为 ad-hoc 签名，`spctl` 预期被拒，属正常） |
| A1-07 | `npm run verify` | oxlint 0 错误，文档链接通过，单元测试除 2 项跳过外全部通过；LibreOffice 实机测试这次应当执行（不再跳过），记录实际跳过项 |
| A1-08 | `.backend-build/bin/python backend/test_worker.py` | 最后一行 `BACKEND PASS: 98 jobs …` |
| A1-09 | `node scripts/ci-smoke.cjs --report "$D/source-smoke.json"` | 9 个源码套件全部 PASS |
| A1-10 | `node scripts/ci-smoke.cjs --packaged --report "$D/packaged-smoke.json"` | 7 个打包套件全部 PASS；完成后执行 `echo 冒烟完成 > "$D/STATUS"`，A8 等这个文件 |
| A1-11 | 打开 `test-output/ci/smoke/test-output/toolbar-*.png` 与 `design-*.png` | 工具栏、菜单、工具中心、命令面板截图显示正常，无错位、重叠、文字截断 |
| A1-12 | 检查 `du -sh "$app"` 与启动时间：`grep "Startup ready" test-output/ci/*/console.log` | 记录应用体积和启动耗时 |

### A2 · 工具栏第一、二期（端口 9302）

| 编号 | 操作 | 预期 |
|---|---|---|
| A2-01 | `Q shot "$D/shots/A2-01.png"` | 工具栏从左到右：打开、保存 ▾、打印 \| 撤销、重做 ▾ \| 选择 / 抓手、批注 ▾、编辑 ▾、笔记 \| 搜索、侧栏、视图 ▾ \| 工具 ▾ \| AI |
| A2-02 | `Q eval "!document.getElementById('printButton').disabled"`；回首页后再查：`Q eval "qingye.activate(null),document.getElementById('printButton').disabled"` | 打开 PDF 时可用；首页时不可用 |
| A2-03 | `Q click "#printButton"`，随后 `Q key Escape` | 弹出打印界面（截图记录）；按 Esc 取消。**不要实际打印** |
| A2-04 | `Q click "#saveMenuButton"`；`Q eval "[...document.querySelectorAll('#saveMenu .menuItem')].map(b=>[b.textContent,b.disabled])"` | 菜单显示“另存为…”“文档属性” |
| A2-05 | 点“另存为…”：`Q click "#saveAsButton"`，再查 `$D/outputs/` 和 `$D/dialogs.log` | 写出 `text.pdf` 副本；标签路径变为输出文件 |
| A2-06 | `Q click "#saveMenuButton"`，`Q click "#propertiesButton"`，截图 | 弹出 PDF 文档属性窗口 |
| A2-07 | 做一次修改：`Q eval "qingye.applyEdit([...qingye.sessions.values()][0],{action:'pages-plan',plan:[{src:0,page:1},{src:0,page:0},{src:0,page:2}]},'测试重排')"`；`Q click "#redoMenuButton"`；列出 `#redoMenu .menuItem` | “最近的修改”里有“测试重排”，底部“编辑历史…”；点击后打开编辑历史对话框 |
| A2-08 | `Q click "#undoButton"`，再开重做菜单 | 该修改显示“已撤销 · 测试重排” |
| A2-09 | `Q click "#handToolButton"`；`Q eval "[document.getElementById('handToolButton').getAttribute('aria-pressed'),[...qingye.sessions.values()][0].app.pdfCursorTools.activeTool]"`；再 `Q click "#selectTextButton"` | 抓手按下、activeTool 为 1；切回选择后为 0 |
| A2-10 | `Q click "#annotateButton"`，列出 `#annotateMenu` 项，截图 | 顶部“标记与评论，不改动原文”；含高亮、自由绘制、文本框、插入图片、手写签名、评论、图形、“下划线 / 删除线（区域）…”、批注列表、退出批注模式 |
| A2-11 | `Q click "#directButton"`，列出 `#editMenu` 项，截图 | 顶部“修改页面内容，保存后写入 PDF”；添加文字、文字印章、图片印章、图形、替换区域内原文、全页水印、永久涂黑…、页面管理…、编辑目录…、全部工具… |
| A2-12 | 在编辑菜单点“添加文字”，再开编辑菜单 | 页面上出现编辑框；菜单多出“取消当前页面编辑”，点击后编辑框消失 |
| A2-13 | 页面编辑进行中点抓手 | 状态栏提示“请先应用或取消当前页面编辑，再切换到抓手。” |
| A2-14 | 开启文字重排后看编辑菜单：`Q eval "qingye.views.change('reflow',true)"`，打开编辑菜单 | 编辑项全部不可用；之后 `qingye.views.change('reflow',false)` 恢复 |
| A2-15 | `Q open "$F/text-v2.pdf"`，`Q click "#viewButton"`，点“与另一文档并排比较…” | 进入并排比较，比较栏出现；只开一个 PDF 时此项不可用 |
| A2-16 | 视图菜单“在新窗口中打开”（先确保无未保存修改） | 新窗口打开（截图后关闭新窗口：`Q eval` 无法控制新窗口，用 `Q stop` 前记录即可） |

### A3 · 工具中心、固定与停靠（端口 9303）

| 编号 | 操作 | 预期 |
|---|---|---|
| A3-01 | `Q click "#toolsButton"`，列出 `#toolsMenu .menuItem` | “常用”：压缩 PDF、文字识别 OCR、导出为 Word / Excel / PPT、合并与拆分、密码与权限；底部“全部工具…⇧⌘T” |
| A3-02 | `Q key Meta+Shift+T`；`Q eval "[!document.getElementById('toolHome').hidden,document.querySelectorAll('#toolGroups .toolGroup').length,document.querySelectorAll('#toolGroups .toolCard').length]"`；截图 | 首页显示，6 组；卡片里没有替换原文、单个图形、区域下划线、编辑目录 |
| A3-03 | 在搜索框输入并检查第一个结果：`Q click "#toolSearch"; Q type "水印"`，读第一张卡片标题；依次试“密码”“拆分”“word”“不存在” | 水印、密码与权限、合并与拆分、导出为 Word / Excel / PPT；“不存在”显示“没有找到匹配的工具。” |
| A3-04 | 搜索“压缩”后 `Q key Enter` | 打开压缩 PDF 的设置，标题“压缩 PDF”，出现“‹ 全部工具” |
| A3-05 | `Q click "#toolBack"` | 回到首页，“最近使用”里有压缩 PDF |
| A3-06 | 打开“导出为图片或文本”卡片，`Q eval "[document.getElementById('toolFormat').value,!document.querySelector('[data-formats]').hidden]"` | `png`，DPI 字段可见 |
| A3-07 | 停靠检查：`Q eval "[document.getElementById('toolsDialog').classList.contains('docked'),getComputedStyle(document.getElementById('viewers')).right]"`；截图 | 停靠为 true，文档区右侧留出约 400 px |
| A3-08 | `Q open "$F/long.pdf"`，然后切回 text.pdf、再切到 long.pdf，读 `#toolDocument` | 面板文件名跟随当前标签 |
| A3-09 | 新建 Markdown：`Q eval "qingye.newMarkdown()"` | 切到 Markdown 标签后工具面板关闭 |
| A3-10 | `Q click "#toolDock"` 切换为居中窗口，截图；再切回 | 居中显示为模态窗口；选择被记住 |
| A3-11 | 固定：在首页点“水印”卡片右侧的书签按钮；`Q eval "[...document.querySelectorAll('#pinnedTools button')].map(b=>b.getAttribute('aria-label'))"` | 工具栏出现“水印”按钮；“工具 ▾”第一组标题变为“已固定” |
| A3-12 | 再固定 5 个，然后固定第 7 个 | 第 7 个提示“最多固定 6 个工具，请先取消一个。” |
| A3-13 | 详情页的“固定到工具栏”按钮（`#toolPin`） | 与卡片按钮作用一致，文字在“固定到工具栏 / 已固定到工具栏”间切换 |
| A3-14 | `Q stop`，再 `Q start --port 9303 --packaged "$F/text.pdf"`（配置目录不变），检查固定、最近使用、停靠选择 | 重启后都保留 |
| A3-15 | 首页（`qingye.activate(null)`）打开工具中心 | 居中窗口；只有“Office / 图片转 PDF”和“文档转换中心”可点，其余变灰 |
| A3-16 | 停靠状态下运行 OCR（打开 `$F/scan.pdf`，工具“文字识别 OCR”，点“应用到当前文档”或“处理并导出副本”），处理中切换标签 | 任务继续处理原文档，面板不跟随；完成后状态栏“任务”里有记录 |

### A4 · 命令面板、快捷键、窄宽度与多语言（端口 9304）

| 编号 | 操作 | 预期 |
|---|---|---|
| A4-01 | `Q key Meta+Shift+P`；`Q eval "document.getElementById('commandPalette').open"` | true，焦点在搜索框 |
| A4-02 | `Q type "打印"`；读 `#commandList [aria-selected=true] .commandName` 与其 kbd | “打印”，快捷键显示为 ⌘P |
| A4-03 | 依次搜“压缩”“抓手”“水印”“全部工具”，`Q key ArrowDown`、`Q key Enter` | 排序合理，Enter 执行对应命令后面板关闭 |
| A4-04 | 回首页后搜“保存” | 该项变灰（`aria-disabled="true"`），Enter 不执行 |
| A4-05 | 标题栏“搜索命令”按钮 `Q click "#commandButton"` | 打开同一面板 |
| A4-06 | 新建 Markdown 标签，`Q key Meta+Shift+P` | 打开 Markdown 自己的命令面板（不是 `#commandPalette`） |
| A4-07 | 应用内快捷键：⌘O（配合 `Q queue-open "$F/long.pdf"`）、⌘F、⌘G、⌘1/⌘2、⇧⌘T、⌘\ | 打开 long.pdf、搜索、跳页、切标签、工具中心、笔记模式 |
| A4-08 | 最小宽度：`Q eval "(()=>{document.getElementById('pdfToolbar').style.width='';return [innerWidth, document.getElementById('moreButton').hidden]})()"`（窗口默认 1360，需要时可用 `Q eval "window.resizeTo(920,700)"` 试；若无效，记为“窗口尺寸只能由 A8 改”） | 920 px 时按钮收成图标、不超出窗口，“更多”不出现 |
| A4-09 | 模拟窄工具栏：`Q eval "document.getElementById('pdfToolbar').style.width='560px'"`，截图，`Q click "#moreButton"`，列出 `#moreMenu .menuItem` | 出现“更多”，AI、视图、侧栏等按优先级移入；点“视图 ▸”在“更多”下方展开视图面板 |
| A4-10 | 恢复：`Q eval "document.getElementById('pdfToolbar').style.width=''"` | 按钮回到工具栏，“更多”消失 |
| A4-11 | 多语言：对 en、zh-TW、ja、ko 分别 `Q eval "qingye.i18n.setLanguage('en')"`，打开工具菜单、编辑菜单、工具中心、命令面板，截图，并扫描残留中文：`Q eval "[...document.querySelectorAll('#pdfToolbar,#toolsMenu,#editMenu,#annotateMenu,#saveMenu,#redoMenu,#toolsDialog,#commandPalette')].flatMap(e=>(e.innerText||'').split('\n')).filter(t=>/[㐀-鿿]/.test(t))"` | en / ja / ko 下除文件名外没有简体中文；zh-TW 为繁体；记录不通顺的译文 |
| A4-12 | 检查所有提示里的快捷键写法：`Q eval "[...document.querySelectorAll('[title]')].map(e=>e.title).filter(t=>/Ctrl\+/.test(t))"` | 空数组（Mac 上都显示 ⌘ 写法） |

### A5 · PDF 处理工具结果正确性（端口 9305）

每项都在工具中心打开对应工具（`Q eval "qingye.tools.launch('<id>')"`），设置参数后点“处理并导出副本”（`Q click "#executeTool"`），等 `qingye.tools.isBusy()` 为 false，再用 PyMuPDF 检查 `$D/outputs/` 里的结果。工具 id 见 `ui/tool-registry.mjs`。

| 编号 | 工具 / 文件 | 检查 |
|---|---|---|
| A5-01 | compress / `long.pdf`，选“最小文件” | 有输出；页数 12；记录前后大小（无法缩小时提示保留原数据也算通过） |
| A5-02 | ocr / `scan.pdf` | 输出中扫描页 `get_text()` 有中英文；原页面图像仍在；任务中心显示识别 / 跳过 / 空页数 |
| A5-03 | export-office（docx） / `text.pdf` | 生成 .docx；用 python-docx 读出含“第一章 引言”“13800138000” |
| A5-04 | export-image（png，DPI 72 与 200） / `text.pdf` | 生成 ZIP，3 张 PNG，200 DPI 的像素约为 72 DPI 的 2.8 倍 |
| A5-05 | export（xlsx、pptx、txt、html、csv、svg） | 各格式都生成且能打开；pptx 页面比例正确 |
| A5-06 | import / `report.docx`、`slides.pptx`、`table.xlsx`、`stamp.png`（用 `Q queue-open` 选文件后点“选择文件…”） | 生成 PDF，中文不乱码；`broken.docx` 给出明确错误 |
| A5-07 | organize：提取 2-3、删除第 1 页、旋转、插入空白页、每页拆分（ZIP）、合并 text-v2.pdf | 页数、顺序、旋转角度符合设置 |
| A5-08 | encrypt：打开密码 `a1`、管理密码 `b2`、不允许打印；再用 decrypt（管理密码 `b2`） | 加密输出 `is_encrypted` 为真、需要密码；解密输出不加密、内容一致 |
| A5-09 | redact：查找“13800138000”和“邮箱”格式，应用 | 输出里 `get_text()` 不再包含号码和邮箱，其余文字保留 |
| A5-10 | watermark、stamp（标准印章“已审核”）、image（`stamp.png`）、page-stamp（来源 text-v2.pdf 第 1 页） | 输出页面上有对应内容（截图或渲染检查） |
| A5-11 | number：`{page} / {total}`，贝茨前缀 `QY-` | 每页底部有页码；贝茨编号连续 |
| A5-12 | crop：自动裁到内容；flatten（用 `annotated.pdf`）；form：文本框字段 | CropBox 改变；扁平化后无批注对象；表单字段存在 |
| A5-13 | compare-report：text.pdf 与 text-v2.pdf | 生成 HTML，标出第 2 页改动和新增行 |
| A5-14 | 批量：勾选“批量处理全部已打开文档”做压缩 | 每个打开的文档都有输出，同名加后缀；任务中心显示数量 |
| A5-15 | 取消：长任务进行中点“取消任务” | 任务变为已取消，已输出的副本保留，没有残留进程（`ps aux \| grep QingyeWorker` 只剩本实例无关项） |

### A6 · 编辑、批注、页面管理、撤销与保存（端口 9306）

| 编号 | 操作 | 预期 |
|---|---|---|
| A6-01 | 编辑菜单逐项：添加文字、文字印章、图片印章（`Q queue-open "$F/stamp.png"`）、图形、替换区域内原文、全页水印，各自 `Q click "#directApply"` | 每项应用后页面内容变化，状态栏“可撤销，尚未保存” |
| A6-02 | 每项之后 `Q click "#undoButton"` / `Q key Meta+Shift+Z` | 撤销与重做恢复和重放 |
| A6-03 | 批注菜单：高亮选中文字、自由绘制、文本框、评论；然后 ⌘S（`Q key Meta+S`） | 保存后重新打开（`Q open` 同一文件）批注仍在 |
| A6-04 | 有未保存修改时关闭标签 ⌘W：先 `Q queue-answer 0` 再试一次 `Q queue-answer 1`（按 `dialogs.log` 里的按钮顺序） | 弹出确认（记录在 dialogs.log），各按钮行为符合文字 |
| A6-05 | 页面管理（编辑菜单“页面管理…”）：在 `long.pdf` 上拖动排序、旋转、删除、复制、插入空白页、插入 text.pdf（`queue-open`）、应用 | 最终页序符合预期，一步撤销恢复 |
| A6-06 | 页面管理：按书签拆分、每 3 页拆分、导出选中页、提取图片 | 输出文件数量和页数正确 |
| A6-07 | 侧栏“批注”：筛选、批量改色、加标签、删除、导出 Markdown | 结果正确；标签保存后重开仍在 |
| A6-08 | 编辑目录（编辑菜单“编辑目录…”）：改标题、调层级、应用到当前文档、保存 | 新目录在侧栏大纲中显示，保存后保留 |
| A6-09 | 永久涂黑（编辑菜单）：框选区域后应用、保存 | 区域内文字从文本层删除 |
| A6-10 | 任务中心：运行两个工具任务使其排队；取消一个；重试失败项 | 状态、数量、输出位置正确；“在文件夹中显示”调用记录（不实际打开访达也可） |
| A6-11 | 草稿恢复：修改后 `kill -9 <session.json 里的 pid>`，再 `Q start` 同一配置 | 首页提示恢复未保存内容，恢复后修改还在 |
| A6-12 | 处理期间修改文档：在 OCR 进行中加一个批注 | 弹出“处理结果已过期”确认（dialogs.log），默认放弃结果 |

### A7 · Office、Markdown、转换中心、笔记模式与全库搜索（端口 9307）

| 编号 | 操作 | 预期 |
|---|---|---|
| A7-01 | `Q open "$F/report.docx"`、`slides.pptx`、`table.xlsx` | 出现转换进度卡片，随后以 PDF 打开；中文、表格、合计正确；首次 5–8 秒内，再次打开更快 |
| A7-02 | `Q open "$F/broken.docx"` | 明确的错误提示，应用不卡住 |
| A7-03 | Office 转换中取消 | 取消后不打开文档，再次打开同一文件能正常转换 |
| A7-04 | `Q open "$F/notes.md"`：阅读 / 编辑 / 源码切换、公式、mermaid、代码块 | 渲染正确；编辑后 ⌘S 保存到原文件 |
| A7-05 | Markdown 命令面板（⇧⌘P）、快速打开（⌘P）、查找替换（⌃H） | 都能打开并工作 |
| A7-06 | 文档转换中心（`qingye.converter.open()`）：notes.md → Word、HTML、EPUB、PDF | `$D/outputs/` 里生成文件，Word 能用 python-docx 读出标题 |
| A7-07 | 笔记模式：text.pdf + notes.md 并排（`Q key Meta+Backslash` 或 PDF 工具栏“笔记”），摘录选中文字（⇧⌘E）、框选区域摘录（⇧⌘U） | 笔记里插入带原文链接的摘录，点击链接定位回 PDF 页面 |
| A7-08 | 全库搜索（⇧⌘F）搜“reader”“方法” | 找到 text.pdf 与 notes.md 中的结果，点击定位 |
| A7-09 | 引用信息（右键菜单“引用信息 / BibTeX…”） | 打开对话框；不点联网查询也能编辑和导出 .bib |
| A7-10 | 工作区：保存当前文档组合为工作区，关闭全部标签，从首页“继续工作”恢复 | 文档和笔记模式布局恢复 |
| A7-11 | AI 面板（⇧⌘A）打开与关闭 | 未配置服务时给出配置提示，不发出网络请求 |

### A8 · 系统集成与人工交互（端口 9308，独占屏幕）

本卡需要操作真实的鼠标、键盘和系统界面（人工，或用电脑控制工具），**等 `test-output/agents/A1/STATUS` 出现“冒烟完成”后再开始**。A8-01 至 A8-04 会使用安装到“应用程序”中的副本，它使用用户真实的青页配置：开始前先备份 `~/Library/Application Support/QingyePDF`（如存在），结束后恢复。

| 编号 | 操作 | 预期 |
|---|---|---|
| A8-01 | 打开 `dist/QingyePDF-0.20.0-mac-arm64.dmg`，把 QingyePDF 拖到“应用程序” | 磁盘映像窗口显示应用与“应用程序”快捷方式 |
| A8-02 | 第一次双击打开 | 未公证被拦下；按住 Control 点按 →“打开”或“系统设置 → 隐私与安全性 → 仍要打开”后启动；之后正常双击打开 |
| A8-03 | 访达里对 PDF“显示简介 → 打开方式 → QingyePDF”；双击 PDF；把 PDF、md、docx 拖到 Dock 图标 | 都在已有窗口新标签打开；应用未运行时启动并打开 |
| A8-04 | 关闭窗口后点 Dock 图标；有未保存修改时 ⌘Q | 重新打开窗口；⌘Q 询问保存，取消则不退出 |
| A8-05 | 用 `Q start --port 9308 --packaged "$F/text.pdf"` 的实例：菜单栏各菜单与 ⌘ 快捷键（⌘P 打印对话框、⌃⌘F 全屏、⌘W、⌘Q） | 菜单项可用，快捷键显示为 ⌘ 写法，⌘P 弹出系统打印对话框（取消，不实际打印） |
| A8-06 | 红绿灯：关闭、最小化、全屏；全屏后按 Esc 退出 | 不压住标签；退出后工具栏、停靠面板布局正常 |
| A8-07 | 系统设置切换浅色 / 深色外观（结束后恢复原设置） | 界面跟随；工具中心、命令面板、菜单在两种外观下清晰 |
| A8-08 | 复制粘贴：PDF 选中文字 ⌘C 粘到文本框；右键菜单“拷贝 / 粘贴” | 内容正确 |
| A8-09 | 拖动窗口到最小宽度（920 px），再固定 6 个工具 | 按钮收成图标，放不下时出现“更多”，“更多”里的项可用 |
| A8-10 | 触控板：双指滚动、捏合缩放；Retina 下 200%、400% 缩放 | 平滑、清晰 |
| A8-11 | 中文输入法在 Markdown、批注文本框、工具中心搜索框、命令面板输入 | 候选框位置正确，回车确认候选不触发命令 |
| A8-12 | 真实点击：工具栏每个按钮和菜单用鼠标点一遍，键盘 Tab / 方向键在菜单内移动，Esc 关闭 | 与 A2、A3 的结果一致；焦点可见 |
| A8-13 | 结束：退出应用，恢复备份的配置目录，删除“应用程序”里的测试副本（如用户要求保留则保留） | 用户数据恢复原样 |
