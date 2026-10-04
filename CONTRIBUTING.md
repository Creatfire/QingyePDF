# 参与青页 PDF

谢谢你愿意花时间。下面是让改动顺利合并需要知道的几件事。

## 报告问题

用 Issue 模板。请写清楚：青页版本（设置 → 关于）、Windows 版本、能重现的步骤、期望与实际结果。涉及具体 PDF 时，如果文件不能公开，请说明它的特点（扫描件、加密、页数、由什么软件生成）。

**安全问题不要公开提 Issue**，请用 GitHub 的 “Report a vulnerability” 私下报告。

## 开发环境

见 [README](README.md#从源码运行) 与 [docs/BUILDING.md](docs/BUILDING.md)。界面是原生 ES 模块，没有打包步骤，改完 `ui/` 下的文件重新启动即可看到效果。

## 提交改动前

```
npm test                       # 必须全部通过
node scripts/ci-smoke.cjs      # 改动了界面或主进程时运行
```

- **测试**：纯逻辑放进可以单独导入的函数，并在 `test/*.test.mjs` 里加用例；涉及窗口的行为加到对应的 `test/*-smoke.cjs`。
- **界面文字**：源语言是简体中文，直接写在代码里。新增文字后在 `scripts/i18n/` 里补上英文、繁体中文、日文、韩文（`catalog.json` 加条目，`src/` 加一行 TSV，带变量的句子在 `build.py` 的 `PATTERNS` 里加一条），然后运行 `python3 scripts/i18n/build.py`。
- **隐私**：不要加入任何默认联网的行为。确实需要联网的功能必须由用户明确触发，并说明发送了什么。
- **后端**：改动 `backend/worker.py` 后运行 `backend/test_worker.py`，并在 PR 里注明需要重新冻结后端。
- **依赖**：新增第三方代码时更新 `THIRD_PARTY_NOTICES.md`，并确认许可与 AGPL-3.0 兼容。
- **代码风格**：跟随所在文件的写法；`.editorconfig` 规定了缩进和换行。注释写“为什么”，不写“做了什么”。

## 许可

提交的代码按 [AGPL-3.0-only](LICENSE) 授权。
