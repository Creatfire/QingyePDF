# 0.19.1 开发交接（历史）

工程版本，基于 0.19.0（分支 `release-0.19.1`，从 `release-0.19` 的 `cd5156f` 开出）。不改功能，只加自动检查、修两处性能问题、把两个大文件按域拆开。改动清单见 [CHANGELOG](../history/CHANGELOG.md)。

## 运行与验证

```powershell
npm ci; node node_modules/electron/install.js   # npm 11 默认不跑 Electron 的安装脚本，需手动下载二进制
npm run verify                                    # oxlint + 文档链接检查 + 单元测试（131 项，1 项仅 POSIX 跳过）
npm run test:coverage                             # 可选：带覆盖率
node scripts/ci-smoke.cjs                         # 9 个 Electron 冒烟套件
npm run dist                                      # 安装版 + 安装目录 ZIP
```

0.19.1 验证结果：`npm run lint` 0 告警 0 错误（163 个文件）；`npm run check:docs` 28 份 Markdown 无失效相对链接；单元测试 131 项通过、1 项跳过；9 个冒烟套件（smoke、markdown、conversion、safety、basic、features、notes、links、pdf014）全部通过。**本版没有重新打包**：`dist/` 里仍是 0.19.0 的产物，发布前需要 `npm run dist`。

## 0.19.1 新增模块与改动点

| 位置 | 作用 |
|---|---|
| `.oxlintrc.json` + `npm run lint` | 只启用正确性规则；关闭 `no-control-regex`、`unicorn/prefer-string-starts-ends-with`、`unicorn/no-useless-spread` 三条（原因见 CONTRIBUTING） |
| `test/consistency.test.mjs` | 版本号五处一致、Android 版本名与 versionCode 同步、`build.files` 完整且无死条目 |
| `qingye-protocol.cjs` | `qingye://` 协议、CSP、默认会话的权限与网络拦截 |
| `window-shell.cjs` | 窗口创建、标题栏 overlay / 亚克力、应用菜单、窗口控制与全屏事件转发 |
| `installer-hooks.cjs` | 安装程序的 `--register/refresh/unregister-file-types` 钩子 |
| `office-task.cjs` | Office 转换任务队列、进度卡片、取消、重新转换、原文件变化监视、空闲预热 |
| `reference-ipc.cjs` | 全库搜索 IPC、DOI 查询、`.bib` / 文本导出 |
| `ui/recent-list.mjs` | 首页最近列表（类型筛选、按名筛选、移除条目） |
| `ui/theme.mjs` | 浅色 / 深色主题、跟随系统、标题栏同步 |
| `ui/draft-recovery.mjs` | 每 3 秒的草稿检查点（含 FreeText 焦点保持那段逻辑） |
| `ui/shortcuts.mjs` | 全部键盘快捷键（含 PDF 框架内的按键） |
| `ui/commands.mjs` | 主进程命令分发（菜单、窗口事件、转换卡片） |
| `ui/history-ui.mjs` | 撤销 / 重做（PDF.js 原生历史与字节快照两条线）与编辑历史对话框 |
| `library-index.cjs` | Markdown 行号增量计数、折叠文本缓存（24 MB 上限） |
| `docs/README.md` + `scripts/check-docs.cjs` | 文档地图（每份文档给谁看、目录约定）与 Markdown 相对链接检查（`npm run check:docs`） |

拆分时踩到的两个坑（都已修，留作提醒）：工厂函数返回值的形状要和调用点一致（`commands` 一度返回函数却被当成 `{run}` 调用，`guard` 把它变成一句错误提示，四个冒烟套件超时）；跨模块的延迟依赖要用 getter 传（`notes` / `library` / `ai` 在主进程里是后创建的 `let`，直接按值传会拿到 undefined）。

## 没有验证的部分

- **安装包没有重新构建**：`npm run dist` 未在本版运行，安装程序相关路径（选项页、文件关联、卸载保留数据）沿用 0.19.0 的验证结论。
- 冒烟套件只覆盖 Windows 桌面；安卓与 macOS 未构建、未运行。
- 覆盖率数字没有设门槛，只是可查。

## 已知限制 / 后续

- `main.cjs` 616 行、`ui/app.mjs` 558 行仍是最大的两个文件；`addDocument`（PDF 标签生命周期）与 `tools-job`（工具箱任务流水线）是最值得继续下沉的两块。
- `scripts/write-build-report.cjs` 是 0.9 期的脚本，仍在等 `QingyePDF-<版本>-win-x64.exe` 便携版与 `buildRevision: dev1`，而 0.18 起只发布安装版，这个脚本目前跑不通，需要重写或删除。
- 界面行密度（`ui/tools.mjs` 平均 142 字符 / 行、最长 1168 字符）是刻意风格，格式化统一留待专门的重构版本。
