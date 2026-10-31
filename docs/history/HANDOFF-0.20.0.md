# 青页 PDF 0.20.0 开发交接

基于 0.19.1（分支 `release-0.20`，从 `release-0.19.1` 的 `602f816` 开出），按《青页PDF-审查与功能改进建议》制作：先修审查中复现的六个问题，再统一 Office 转 PDF 与 OCR 的默认行为、整理参数与笔记入口，最后加入页面管理、批注面板、任务中心和工作区。改动清单见 [CHANGELOG](../history/CHANGELOG.md)，用户说明见 [docs/USER-GUIDE.md](../guide/USER-GUIDE.md) 的“页面管理、批注与任务”。

## 运行与验证

```powershell
npm ci; node node_modules/electron/install.js
node scripts/prepare-pdfjs.mjs; ./scripts/prepare-pandoc.ps1; ./scripts/prepare-libreoffice.ps1; ./scripts/build-backend.ps1
npm run verify                                    # oxlint + 文档链接检查 + 单元测试
.backend-build/Scripts/python.exe backend/test_worker.py
node scripts/ci-smoke.cjs                         # 9 个套件；缺少成功标记或选择为空都判失败
npm run dist
node scripts/ci-smoke.cjs --packaged              # 打包后的 7 个套件
```

0.20.0 验证结果：见文末“验证记录”。

## 审查问题的修复位置

| 问题 | 修复 | 回归测试 |
|---|---|---|
| 取消保存后失去草稿保护 | `ui/draft-recovery.mjs`：保存中的文档以 `dirty:true`、不带内容进入清单，`recovery.cjs` 保留上一份草稿 | `test/release020.test.mjs`：备份 → 保存中 → 取消 → 再备份 → 另一个实例恢复 |
| 搜索摘要错位 | `library-index.cjs`：摘要用全文偏移 `base + at` | 同上，第二段命中 |
| 长笔记截断 | `indexPages()`：Markdown 用文档总量上限，截断写入 `truncated` 并在结果中显示；`INDEX_VERSION = 2` 使旧索引重建；渲染端每页多取 1 个字符以便判断截断 | 同上 |
| Office 缓存忽略取消 | `office-convert.cjs`：读取前、读取后、缓存返回前检查 `signal` | 同上，伪造引擎文件 + 缓存命中 |
| 相同密集页误报 | `ui/compare-diff.mjs`：先裁首尾再判断计算量；超限返回 `null`，调用方记入 `incomplete` | 同上，2500 个相同 token |
| PPT 拉伸 / DPI 无效 | `backend/worker.py`：按比例居中、使用 `dpi`；`ui/tools.mjs` 的 `data-formats` 只在 PNG / JPEG / PPT 显示 DPI | `backend/test_worker.py`：横竖混排、DPI 72 / 200 |

## 0.20 新模块与改动点

| 位置 | 作用 |
|---|---|
| `ui/page-plan.mjs` / `ui/page-manager.mjs` | 页面计划（纯函数，可测）与全屏缩略图网格；后端 `pages-plan`（一次生成最终页序，书签跟随首次出现的位置）、`pages-split`、`pages-images`；插入的 PDF 以 `extraPdfs` 传给主进程，主进程追加到 `inputs` |
| `ui/annot-panel.mjs` / `ui/annot-labels.mjs` | 批注卡片、筛选、批量操作、卡片与页面选择联动（`annotEdit.selectXref` / `onSelect`）；后端 `annot-batch`，标签存在注释字典的 `/QingyeTags`（`\x1f` 分隔） |
| `ui/task-center.mjs` | 状态栏“任务”、任务列表、队列、近期记录（localStorage）；`applyEdit` 对长任务（`TRACKED_ACTIONS`）建任务并检查文档版本；主进程 `reveal-output` 只显示本窗口工具写出的文件，`confirm-stale-result` 询问是否应用过期结果 |
| `workspace-ipc.cjs` / `ui/workspaces.mjs` | 工作区与固定文档（存在偏好文件 `workspaces` / `pinned`，读入时校验）；`workspace-open` 返回找不到的文件，`workspace-relocate` 重新选择；`libraryFiles()` 让全库搜索包含这些文件 |
| `pandoc-engine.cjs` `layoutPdf` / `converter-ipc.cjs` | 转换中心的 Office → PDF 走 LibreOffice（`officeLayout: 'reflow'` 或带 Pandoc 附加参数时仍用 Pandoc） |
| `backend/worker.py` OCR | `page_text_state()`（scan / mixed / text），`add_ocr_layer` 统计识别 / 跳过 / 空页并支持 `region`；工具箱 `ocr` 改为只补文字层；`ui/ocr-coverage.mjs` 的 `classifyPage()` 与后端同一规则 |
| `ui/notes-mode.mjs` | 窗格名称与保存状态标签（`refresh()`）、标签右键菜单扩展点 `tabExtras` |
| `scripts/ci-smoke.cjs` | 必须有 `status: 'passed'`；未知或空的套件选择直接失败 |

踩过的坑：`window.prompt()` 在 Electron 里不存在（返回 null），文字输入一律用 `ui/markdown/typora-dialogs.mjs` 的 `promptText`；`app.mjs` 里传给工厂函数的回调如果引用后面才声明的 `const`，要包一层箭头函数，否则启动时 TDZ 报错、窗口一直停在加载状态（冒烟测试只会表现为 420 秒超时）；批注每次修改都会保存并重编对象号，所以批注面板的勾选在刷新后清空，不能按 `page:xref` 保留。

## 没有验证的部分

- 安装程序本身（选项页、文件关联、卸载保留数据）仍沿用 0.19.0 的结论，本版没有在干净系统上实际安装。
- 任务中心的“在文件夹中显示”、工作区的“重新定位”文件对话框在冒烟测试中没有真正弹出（测试走的是无对话框路径或单元测试的伪造对话框）。
- 页面管理对几百页以上大文档的性能只做了代码层面的懒加载，没有实测。
- 新增界面文字的英、繁、日、韩译文没有母语者校对。
- 安卓与 macOS 未构建（安卓版本号仍为 0.18.0）。

## 已知限制 / 后续

- 审查文档第 6.4 节（完整的对比审阅流程）、6.5（OCR 页面状态面板）、6.6（转换与压缩的单页试处理）、5.3（PDF 转 Word 阅读顺序）留待后续版本。
- 页面管理的拆分只作用于已应用的文档；插入的外部 PDF 不参与拆分预览。
- 任务中心的记录只在本窗口；多窗口各自记录。

## 验证记录

- `npm run verify`：oxlint 0 错误、文档链接检查通过、单元测试 141 项通过（1 项仅 POSIX 跳过）。
- 后端 `backend/test_worker.py`：98 个任务通过（新增 OCR 混合页 / 区域、PPT 比例与 DPI、页面计划 / 拆分 / 提取图片、批注标签）。
- 源码冒烟 9 个套件全部通过；打包后（`dist/win-unpacked`）7 个套件全部通过。
- 产物：`QingyePDF-0.20.0-Setup-x64.exe`（约 345 MB）、`QingyePDF-0.20.0-win-x64.zip`（约 466 MB），校验值在 `dist/SHA256SUMS-0.20.0.txt`。未推送、未发布。
