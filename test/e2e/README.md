# 这里的 Python 脚本是历史验证证据，不在 CI 中运行

这五个脚本（`ui_e2e.py`、`ui_modes_08.py`、`window_style_092.py`、`ai_panel_091.py`、`ui_steps_diagrams.py`）写在 0.7–0.9 期，做法是：起一个 `python3 -m http.server` 指向仓库根目录，用 Playwright 打开 `ui/index.html`，再注入一段 `window.desktop` 桩来替代 Electron 主进程。

它们当时跑通过，`CHANGELOG.md` 的 0.9.x 条目也引用了结果（例如 `window_style_092.py` 41 项、`ai_panel_091.py` 44 项）。**现在它们不在 CI 中，也没有跟着界面一起更新**：`window.desktop` 的接口在这之后改过多轮（笔记模式、全库搜索、AI 面板、Office 打开、批注编辑），每份脚本里的桩还是各自手抄的一份（同一段桩重复了四份），并且硬编码了 `python3` 与 `platform: 'linux'`。

因此：**不要把它们当作当前有效的测试**。现行测试入口是：

```powershell
npm run verify                 # oxlint + 单元测试（纯逻辑）
node scripts/ci-smoke.cjs      # 9 个 Electron 冒烟套件（真实窗口、真实 IPC）
```

后续有两种处理方式，等 Windows 产品稳定后再定：把桩抽成一个公共模块、修好并接进 CI（浏览器端的回归比 Electron 冒烟快得多），或者整体移到 `docs/history/` 归档。在此之前保持原样，只作为“当时确实这样验证过”的证据。
