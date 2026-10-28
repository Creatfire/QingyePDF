# 青页 PDF 0.20.0 问题调查与跟踪

调查日期：2026-10-28。基线为当前工作区：Windows 产品版本 0.20.0，包含此前的文档目录重构，尚未提交。本文汇总当前待处理事项；[0.9.3 修复记录](FIXES-0.9.3.md)和 [0.13.0 修复报告](FIX-REPORT-0.13.0.md)保留为历史证据，不作为当前未修复缺陷清单。

状态含义：**确认**指代码、配置或本次复现能直接证明所述问题；**待验证**指有风险或来自已有报告，尚未证明影响；**验证缺口**不等于已经发现产品缺陷。优先级仅用于建议排期，安全公告等级以原公告为准。

## 调查范围和结果

- macOS，Node.js 22.23.3 / npm 10.9.9；运行 `npm run verify`：140 项通过、2 项跳过，静态检查和文档链接检查通过。跳过项包括 LibreOffice 实机引擎测试与 Windows 专用只读文件测试。
- 以独立临时用户目录运行 Electron `--x014-smoke`：在过期结果保护测试处失败一次，实际结果为 `canceled: false`、任务 `done`。这证明测试在本机失败，不足以证明产品保护逻辑有缺陷。
- 对现有锁文件运行 `npm audit`：4 个受影响包（3 high、1 moderate）；一次 `npm audit fix --dry-run --ignore-scripts` 显示 4 个传递依赖版本变化，Electron 因直接固定版本仍在报告中。未执行实际升级。
- 在隔离临时目录使用 npm 10.9.9 对锁文件运行 `npm install --package-lock-only --ignore-scripts`：8 个 `libc` 字段被移除，根包增加 `engines`；原工作区锁文件未改动。
- 静态检查发布、许可、测试与依赖配置；未完成 Windows 安装、完整跨平台冒烟、真实模型服务和真机测试。调查不是对所有潜在 bug 的穷尽证明。

## 修复状态复核（2026-10-28）

调查之后的工作区改动逐项对照了下面的问题。复核环境同上（macOS，Node.js 22.23.3 / npm 10.9.9）：`npm run verify` 为 143 项中 141 项通过、2 项跳过（LibreOffice 实机引擎测试与 Windows 专用只读文件测试），`npm audit` 为 0 个漏洞。冒烟测试用的是源码中的 `backend/worker.py`（`.backend-build` 虚拟环境），不是冻结的后端。**已修复**指代码或配置已改、并有下列验证；**部分修复**指改动已在，但缺少目标平台上的实测。

| 编号 | 状态 | 修改位置 | 验证 |
|---|---|---|---|
| BUG-01 | 已修复 | `package.json` 的 `build.extraMetadata.buildRevision` 改为 `0.20.0` | `test/consistency.test.mjs` 检查 `package.json` 和发布目标里的 `buildRevision` 与版本一致；打包产物未重建 |
| BUG-02 | 已修复（配置） | 删除 `build.win.signExecutable: false`；没有证书时照常不签名，CI 配置 `CSC_LINK` / `CSC_KEY_PASSWORD` 后签名，与[签名说明](../development/SIGNING.md)一致 | 没有用真实证书在 Windows 上构建 |
| BUG-03 | 已修复 | `test/safety-smoke.cjs`：Windows 用 `taskkill` 并检查退出码；其他平台以独立进程组启动，用 `SIGKILL` 终止整个进程组 | macOS 上 `node scripts/ci-smoke.cjs --only safety` 通过：强杀后找到并恢复 1 份未保存草稿 |
| BUG-04 | 已修复 | 删除 `scripts/write-build-report.cjs`；只有历史文档还提到它 | — |
| BUG-05 | 已修复 | `applyEdit` 增加 `beforeReplace` 钩子，在后端结果返回后、替换文档前调用；测试在钩子里修改批注，不再靠 120 ms 延迟 | macOS 上 `node scripts/ci-smoke.cjs --only pdf014` 通过：`staleResult` 为 `canceled: true`、任务 `canceled`；只跑了 1 次，没在 Windows 上重跑 |
| BUG-06 | 已修复（配置） | `packageManager: npm@11.21.1`；`engines` 要求 npm `>=11.21.1 <12`；`.npmrc` 设置 `engine-strict=true`；CI 和 macOS 工作流先安装 npm 11.21.1 | 锁文件保留 8 个 `libc` 字段；没在 Linux glibc / musl 上跑过 `npm ci` |
| BUG-07 | 已修复 | `postinstall` 运行 `scripts/ensure-electron.cjs`：Electron 程序缺失或版本不对时补跑 `install.js` | 没在全新环境里重装验证 |
| BUG-08 | 已修复 | `scripts/prepare-delivery.cjs` 要求并复制安装程序、ZIP 和两个源码包，写入 SHA-256 清单 | `test/source-delivery.test.cjs` |
| BUG-09 | 已修复 | `scripts/package-source.py` 缺少 `third-party-source/sources.json`、必需组件不全或哈希不符时都会失败 | `test/source-delivery.test.cjs`（缺失、损坏和正常三种情况） |
| BUG-10 | 部分修复 | 新增 `scripts/prepare-libreoffice.sh`（固定版本、按芯片校验的官方 dmg）；`office-convert.cjs` 在 macOS 上找 `LibreOffice.app/Contents/MacOS/soffice`；`macos.yml` 调用该脚本 | 本机没运行该脚本，LibreOffice 实机测试仍跳过；打包和授权未核实 |
| BUG-11 | 已修复 | `scripts/prepare-pdfjs.mjs` 在非 Windows 上用 `unzip` 解压 | 只确认了代码路径；没在无缓存的干净 macOS / Linux 上实测 |
| BUG-12 | 已修复（代码） | 源码包排除 `vendor/libreoffice/`、`backend/bin/`、`vendor/pandoc/pandoc(.exe)`、`.macos-asset` 和构建目录 | 准备依赖后没有检查真实 ZIP 的内容和大小 |
| 依赖安全 | 已修复 | Electron 44.4.5 → 44.10.0，锁文件更新传递依赖 | `npm audit`：0 个漏洞 |

另外两处随这些改动一起修改：导出前把目标路径解析为真实路径（`fs.realpath`），经符号链接也不能覆盖正在打开的文档；安全冒烟里的“拒绝覆盖”检查改用一定会生成 PDF 的页面重排，不再依赖压缩小文件会不会有变化。

## 问题明细（调查时的记录）

以下保留调查当时的描述和证据，当前状态以上表为准。

### BUG-01 · 发行元数据中的 buildRevision 滞后

- **状态 / 优先级：确认 / P1。** `package.json` 的 `version` 为 `0.20.0`，但 `build.extraMetadata.buildRevision` 为 `0.19.1`；[发布目标](../releases/RELEASE-TARGET.json)写的是 `0.20.0`。electron-builder 使用 extraMetadata 注入打包应用的 package.json，导致构建元数据自相矛盾；关于界面用 `app.getVersion()`，不能通过界面显示判断该字段。
- **证据：** `package.json` 中 `build.extraMetadata`；`test/consistency.test.mjs` 检查 version 和文档标题，但未检查此字段。本次未重新构建安装包。
- **建议：** 与版本统一，并增加配置级与打包产物级检查。

### BUG-02 · Windows 安装包签名被显式关闭

- **状态 / 优先级：确认配置冲突 / P1。** `package.json` 的 `build.win.signExecutable` 为 `false`，而 [签名说明](../development/SIGNING.md) 和 CI 的 `WIN_CSC_LINK` / `WIN_CSC_KEY_PASSWORD` 描述为配置密钥后签名。
- **证据：** 本地 electron-builder 26.15.3 的 `app-builder-lib/out/winPackager.js` 在 `signExecutable === false` 时跳过签名，`targets/nsis/nsisUtil.js` 也检查该配置。未持证书运行 Windows 构建，因此未做签名文件实测。
- **建议：** 明确无证书与有证书两种配置，使用真实证书在隔离 Windows 构建机上检查应用和安装程序签名；同步修正文档。

### BUG-03 · 跨平台崩溃恢复测试依赖 taskkill

- **状态 / 优先级：确认 / P1。** `test/safety-smoke.cjs:378` 无条件启动 Windows 的 `taskkill`；本机独立探测返回 `ENOENT`。进入该强杀阶段的 macOS / Linux 测试无法按预期完成。
- **建议：** Windows 保留进程树终止，其他平台使用受控的进程组终止，并验证等待退出和残留子进程清理；Windows 代码路径也要回归。

### BUG-04 · 过期构建报告检查脚本

- **状态 / 优先级：确认 / P2。** `scripts/write-build-report.cjs` 默认从仓库父目录读 `BUILD-RESULT.json`，直接运行时报缺文件；脚本又固定要求 `buildRevision === 'dev1'` 和便携 `QingyePDF-<版本>-win-x64.exe`，不匹配当前 0.20.0 的目标与安装版 / ZIP。仓库内未发现调用入口。
- **建议：** 若继续使用，明确输入来源并按当前发布目标验证版本、产物和哈希；否则归档或移除，避免误认为现行发布检查。

### BUG-05 · 过期结果保护的冒烟测试依赖固定延迟

- **状态 / 优先级：本机复现 / P1（测试）。** `test/xodo014-smoke.cjs:355–363` 启动作业后等待 120 ms 才修改批注数据。本机运行一次结果已先完成，断言预期取消但实际为 `done`，套件退出码 1。用户此前报告同环境 3/3 失败；本轮独立复现 1 次。
- **建议：** 用可控的后端阻塞或测试钩子确保作业开始后、结果返回前完成修改，再释放结果；分别测试接受和拒绝。`ui/app.mjs` 的版本保护仍须用确定性的并发测试验证。

### BUG-06 · npm 10 重写锁文件丢失 libc 约束

- **状态 / 优先级：隔离复现 / P1（工具链）。** 当前未指定 `packageManager`；npm 10.9.9 在临时副本上重写时移除了 8 个 `@oxlint/binding-*` 的 `libc` 字段，并新增根包 engines。锁文件原文件未修改。
- **影响边界：** 锁文件平台约束发生变化已确认；这种变更是否会让 npm 11 在 glibc 机器实际安装错误的 musl 包，尚未在对应 Linux 环境复现，不能当作已确认结果。
- **建议：** 明确并固定支持的 Node/npm 组合；CI 检查锁文件和 Linux glibc/musl 的 `npm ci`，避免使用不兼容版本提交锁文件。

### BUG-07 · Electron 安装脚本在部分 npm 配置下被跳过

- **状态 / 优先级：条件性问题，原因待复现 / P1。** 用户报告安装后 Electron 的 `dist` 和 `path.txt` 缺失，手动运行 `node node_modules/electron/install.js` 后恢复。当前工作区两者存在；本次未重新执行全新安装，因此不能判断本机现状或所有 npm 版本都会跳过。
- **依据：** 上游 npm 的 [install scripts 配置说明](https://github.com/nodejs/node/blob/main/deps/npm/docs/content/commands/npm-install-scripts.md)描述默认阻止未批准的依赖脚本；具体行为取决于 npm 版本与配置。项目 CI 需要 `npm ci` 后能启动 Electron。
- **建议：** 明确适用 npm 版本和脚本批准方式，用干净环境覆盖安装 / CI；提供可重复的检查及失败提示。不要笼统声称所有 npm 11 版本都不运行脚本。

### BUG-08 · 文档重构后的交付脚本遗漏源码包

- **状态 / 优先级：确认配置缺口 / P1。** 本轮以前的文档重构将 `scripts/prepare-delivery.cjs:8` 调整为只复制安装程序与 ZIP，加上 README 和 docs；即使 `scripts/package-source.py` 已生成源码包和依赖源码包，交付脚本也不会复制或列入校验清单。这是文档迁移引入的回归。
- **建议：** 明确发布物是否包括两个源码包；若包括，检查它们存在、复制并校验，并测试真实交付目录及失败路径。

### BUG-09 · 依赖源码包可以在缺少源码时静默生成为空

- **状态 / 优先级：代码确认 / P1。** `scripts/package-source.py:20–23` 对 `third-party-source` 直接 `glob`，目录不存在时循环为空但仍生成 dependency-source ZIP 并输出成功。本工作区该目录不存在。临时隔离运行时脚本也成功创建了空依赖源码 ZIP。
- **影响：** 第三方声明描述了随交付提供匹配源码；空包无法支持该描述。是否构成具体许可义务问题应结合发布形式和所用组件单独核实。
- **建议：** 以来源清单逐项检查文件、版本和哈希，缺失时失败；交付前核验源码包内容，不仅检查文件存在。

### BUG-10 · Windows 和 macOS 的 LibreOffice 准备路径不完整

- **状态 / 优先级：确认工具链缺口 / P2。** 只有 `scripts/prepare-libreoffice.ps1`，`office-convert.cjs` 在非 Windows 期望 `vendor/libreoffice/program/soffice`，且 `test/office015.test.cjs` 在找不到它时跳过。本机单元测试该项确实跳过。
- **边界：** 并非 macOS 上永远无法运行：若手动准备兼容的运行时并放在预期位置，测试可能运行；尚未验证运行时布局、打包及授权。
- **建议：** 若恢复 macOS 产品线，提供可复现的 macOS 依赖准备 / 打包方案，并用真实 Office 文件执行验证。

### BUG-11 · PDF.js 资源缺失时的非 Windows 准备路径

- **状态 / 优先级：代码确认 / P2。** `scripts/prepare-pdfjs.mjs` 在 `vendor/pdfjs/web/viewer.html` 不存在时下载并调用 `powershell.exe Expand-Archive`；macOS / Linux 干净环境通常无此程序。已有资源时脚本会重写 viewer、引擎和修改记录，但**不会每次重新下载**：仅资源和本地归档都缺失时下载。
- **建议：** 提供跨平台解压，并用有缓存、无缓存、文件缺失和重复运行四种情况测试。CI 工作流的有条件 / 无条件调用差别应统一或解释。

### BUG-12 · 源码归档可能混入本机生成的运行时

- **状态 / 优先级：代码确认，实际归档影响待验证 / P2。** `scripts/package-source.py` 递归打包 `vendor/`，只显式排除 `vendor/pandoc/pandoc.exe`，没有排除 `.gitignore` 中的 `vendor/libreoffice/`、macOS `vendor/pandoc/pandoc`、`.macos-asset`。准备依赖后可能把平台二进制和本地状态混进源码 ZIP，体积和内容依构建机器而变。
- **建议：** 改为明确的归档白名单或排除规则，并在 Windows、macOS 准备依赖后检查 ZIP 内容和大小。

## 依赖安全问题

`npm audit` 的 4 项是按包汇总，不是 4 个单独公告。包存在于开发依赖树，Electron 本身还构成应用运行时；其余依赖是否随应用分发或可通过产品路径触发，需要逐条确认。不要仅按包的 high 等级推断最终可利用性。

| 包与当前版本 | npm audit 包级等级 | 证据与建议 |
|---|---|---|
| `electron@44.4.5` | high | 直接开发依赖，也是打包运行时。[指针锁公告](https://github.com/advisories/GHSA-x562-297c-g43g)为 moderate，44.5.0 起修复；[证书公告](https://github.com/electron/electron/security/advisories/GHSA-jr5w-w6x2-84p9)为 high，44.9.1 起修复。audit 建议 44.10.0；升级固定版本后需验证 PDF.js 补丁、联网、打包和各平台。应用默认 session 拒绝权限请求可降低指针锁路径风险，但尚未做攻击复现。 |
| `undici@6.29.0 / 7.30.0` | high | 分别经 `electron-builder → @electron/rebuild → node-gyp` 和 `electron → @electron/get` 引入，audit 列有 TLS、DoS 和缓存相关公告。dry-run 提议 6.29.1 / 7.30.1；应用内 Node 自带实现与 npm 包应分别评估。 |
| `http-cache-semantics@4.2.0` | high | 经 electron-builder 下载工具链引入；[公告](https://github.com/advisories/GHSA-ch52-4w7c-c8xp)涉及缓存隔离。dry-run 提议 4.3.0；是否存在受影响的共享缓存使用场景尚未验证。 |
| `fast-uri@3.1.8` | moderate | 经 electron-builder → ajv 引入；包括 [URI scheme 混淆](https://github.com/advisories/GHSA-w74x-v6f9-j3xg)等多个公告。dry-run 提议 3.1.9；需验证构建流程与依赖树。 |

实际升级应在固定 npm 版本、隔离分支完成，审阅 lockfile 并重跑审计、单元测试、冒烟、打包和目标平台验证。审计结果会随公告与依赖变化，应以执行时结果为准。

## 待验证事项与产品边界

以下来自 [0.20.0 交接](../releases/HANDOFF.md)，尚未因本次调查变成“已通过”或“已确认缺陷”：

- 干净 Windows 上安装选项、文件关联、升级和卸载保留数据；0.20.0 交接没有本版实装记录。
- 任务中心“在文件夹中显示”、工作区“重新定位”的真实文件对话框；现有测试主要使用替身。
- 数百页以上页面管理的性能；英、繁、日、韩新增译文的母语校对。
- Android 项目为 0.18.0 / versionCode 1800，macOS 和 Android 0.20.0 未重新构建或验收；不能以 Windows 结果代替。
- 完整比较审阅流程、OCR 页面状态面板、转换和压缩单页试处理、PDF 转 Word 阅读顺序仍待后续评估；页面拆分只使用已应用文档，外部插入页不参与拆分预览；任务记录按窗口分别保存。
- `main.cjs` 与 `ui/app.mjs` 的模块拆分、`ui/tools.mjs` 的长行属于可维护性技术债，不因行数本身判为产品缺陷。

## 剩余工作

上述问题的代码和配置都已修改，剩下的是只能在目标环境里完成的验证：

1. Windows：用 npm 11.21.1 全新执行 `npm ci`，跑完整的源码冒烟和打包冒烟，重建安装包并核对 `buildRevision`；有证书时检查应用和安装程序的签名。
2. 交付：执行 `prepare-sources.py` → `package-source.py` → `npm run deliver`，检查两个源码包的实际内容和大小。
3. macOS：在干净环境里运行 `prepare-pdfjs.mjs` 和 `prepare-libreoffice.sh`，再跑 LibreOffice 实机测试和冒烟测试。
4. Linux：在 glibc 和 musl 上用锁文件执行 `npm ci`。
5. 上文“待验证事项与产品边界”各项。

本机开发前先把 npm 升到 11.21.1：`.npmrc` 开启了 `engine-strict`，npm 10 会拒绝安装。
