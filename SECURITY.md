# 安全策略

## 支持范围

只有当前发布线的最新版本会收到修复。当前线是 **Windows 0.19.x**；安卓与 macOS 的构建暂时停更（见 [HANDOFF.md](HANDOFF.md)）。

## 报告问题

**不要在公开 Issue 里描述安全问题。** 请用 GitHub 仓库的 “Security → Report a vulnerability” 私下提交，并尽量写明：青页版本（设置 → 关于）、Windows 版本、复现步骤、影响（能读到什么、能写到什么）、以及是否需要一个特定文件（例如加密 PDF、含脚本的 PDF、Office 文件）。

我们会在 7 天内确认收到，并在确认修复方案后告知计划。修复发布后可以在 Release 说明里署名致谢，或者保持匿名——你说了算。

## 威胁模型

青页是本地优先的桌面应用，设计上把“文档不出本机”当作硬约束：

- **窗口进程不联网。** `qingye://` 之外的 `http(s)` 请求在默认会话里被 `webRequest.onBeforeRequest` 全部取消；页面还带有严格的 CSP（`script-src 'self'`、`object-src 'none'`、`base-uri 'none'`）。窗口进程也没有 Node 集成（`nodeIntegration: false`、`contextIsolation: true`、`sandbox: true`），文件操作只能走 `preload.cjs` 逐个声明的接口。
- **只有三处会联网，都由用户明确触发**：AI 协作（把问题与模型读取的文档片段发到你配置的服务）、引用信息的“联网补全”（只把 DOI 发给 doi.org）、设置 → 关于 →“检查更新”（用独立会话查一次 GitHub Releases，不发送文档信息）。除此之外没有遥测、没有自动更新、没有账号。
- **处理引擎在本地**：PDF 工具箱（PyMuPDF，发布时冻结为 `QingyeWorker.exe`）、Pandoc、LibreOffice 都在本机运行。LibreOffice 使用独立用户配置、禁止运行文档宏、不联网。
- **本地 AI 接口默认关闭**：开启后只监听 `127.0.0.1`，要求 `Authorization: Bearer <token>`，并校验 `Host` 头（防止 DNS 重绑定）。令牌在设置里可见、可重置；不需要时应当关闭。
- **文档修改先落草稿**：结构性修改由后端生成新字节流，保存才写盘；草稿与索引只保存在本机用户数据目录。

## 明确不在范围

- **安装包未做代码签名**（仓库未配置签名密钥），Windows SmartScreen 会提示“未知发布者”，macOS 首次打开需要手动放行。这是发布渠道的信任问题，不是漏洞，但如果你发现了绕过校验和（`SHA256SUMS`）或伪装发布页的途径，请报告。
- 打开**恶意构造的 PDF / Office 文档**导致的崩溃或内存耗尽，我们仍然关心（会造成拒绝服务），但优先级低于可读写用户文件或外发数据的问题。这类问题请附上样本或构造方式。
- 第三方组件（PDF.js、Pandoc、LibreOffice、PyMuPDF 等）自身的漏洞请同时报给上游；我们会在升级依赖时跟进。随附组件与许可见 [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md)。
- 需要用户先关闭保护（例如自行开启本地 AI 接口并把令牌交给不可信程序）才能触发的场景。
