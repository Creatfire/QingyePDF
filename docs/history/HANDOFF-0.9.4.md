# 青页 PDF 0.9.4 开发交接

基于 0.9.3 fix1，六项功能全部实现。当前为开发测试交付，以基础验证为主，完整验收交给独立测试方。

## 六项入口

| 功能 | 入口与行为 |
|---|---|
| 阅读前进/后退 | 标题栏两个箭头，Alt+←/→。目录、搜索结果、书签、AI 跳转/引用、Markdown 标题/文件链接记录阅读位置；返回原页和滚动位置。会话内保留最近 60 个位置，关闭了原文档时提示不可返回 |
| 导出预设 | 转换中心“导出预设”。内置 Word、带目录 PDF、EPUB；可保存/删除最多 30 个自定义预设。保存格式、读取扩展、完整文档/目录/编号/引文、模板/参考文档/过滤器路径与参数；内置 PDF 纸张、页边距、横向。Word/ODT 排版仍由参考文档决定，外部 PDF 使用引擎参数 |
| AI 差异预览 | 默认写入确认和“预览并插入文档”：原文/修改后双栏，增删行标色，接受/拒绝。确认等待期间原文变化或关闭会拒绝应用，保留 Ctrl+Z；用户主动关闭 AI 确认设置时沿用直接写入偏好 |
| 可视化表格 | Markdown 编辑模式点击单元格；Tab/Enter 移动，Alt+Enter 换行，Esc 放弃本次单元格编辑；工具条增删行列/切表格源码。支持 Excel TSV、多行引号单元格，所有提交通过原有撤销保存流程 |
| 搜索/OCR | PDF 搜索侧栏自动检查文字层，显示检查/可搜索/缺层页数。按页码识别或全文，显示进度/取消，保留原图。应用后需保存 PDF 才持久化；缺层页可为扫描或空白页，计数不代表识别准确率 |
| 批注笔记 | 批注侧栏勾选、筛选全选、整理为新 Markdown。笔记标为未保存，关闭会确认；含页码和批注区域原文链接，点击定位并短暂标记，可返回笔记。Markdown 摘录导出也含链接，Word 延用原有导出 |

## 基础验证

```powershell
npm.cmd run test:094
npm.cmd run smoke:094
npm.cmd run dist
```

`test/features094.test.mjs` 覆盖六个纯逻辑边界；`--features-smoke` 实际加载 Electron 界面，验证导航、预设、差异确认、表格/撤销/TSV、批注笔记链接和本地 OCR。OCR 完整检查可设置 `QINGYE_094_SCAN_FIXTURE` 为混合文本/扫描测试 PDF 的绝对路径；未提供样例时报告中 OCR 项会保持 false，不可冒充通过。其余基础结果见 BUILD-REPORT-0.9.4.md。

## 实现与构建

- 前端：reading-history.mjs、source-links.mjs、search-ocr.mjs、ocr-coverage.mjs、ai/diff.mjs、markdown/visual-table.mjs、table-model.mjs 与现有模块接入。
- 主进程：converter-presets.cjs、notes-markdown.cjs、converter-ipc.cjs 与 main/preload。
- 后端仅扩充批注 inspect 的 rect/xref 字段，已使用原有锁定依赖重新冻结。OCR 复用现有 ocr-layer，不增加识别引擎。
- 无新增运行依赖。Node 22+；冻结后端需 Python 3.12。开发目录已有完整依赖及冻结后端，源码 zip 不包含 node_modules、backend/bin、Pandoc.exe 和构建虚拟环境。
- 如需重建：npm ci、node node_modules/electron/install.js、scripts/prepare-pandoc.ps1；使用 Python 3.12 运行 backend 构建。原项目 build-backend.ps1 可沿用。

## 明确边界

- 导出预设记录本机文件路径，不把模板/过滤器文件复制到预设里；迁移电脑后需重新选文件。Lua/过滤器沿用原有主动执行行为，应用预设不会自动运行转换。
- PDF 页边距仅作用于“PDF · 青页内置排版”；Word/ODT 参考文档和外部 PDF 的引擎参数独立。
- 可视化表格上限 200 行（含表头）/50 列；大表仍可用源码编辑。单元格编辑提交时会规范化该表的 Markdown 排版，内容和对齐保留，Ctrl+Z 可还原。
- 差异预览显示各侧前 30000 字符，明确提示截断；大变更使用块差异，不能把它称作逐字符 diff。模型修改不提供逐段勾选，本版接受/拒绝整次变更。
- OCR 取消前未应用的新结果不会写入当前文档；已应用的结果可撤销。加密 PDF 可提供密码，权限不足应报错。识别扫描文字受图片质量影响。
- 保存过的 PDF 笔记使用本机绝对 file URI（含页码/区域）；文件移动、页面重排或批注位置变化后旧链接可能失效，需要重新生成。未保存 PDF 链接只在当前窗口中使用。非 PDF/Markdown 的 file URI 不作为文档链接放行。
- 旧 0.9.3 的硬件/真实服务测试边界不自动变成 0.9.4 已通过。新版本完整分工见当时的内部测试任务文档（未随仓库提供）。
