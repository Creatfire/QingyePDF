# 参与青页 PDF

谢谢你愿意花时间。下面是让改动顺利合并需要知道的几件事。

## 报告问题

用 Issue 模板。请写清楚：青页版本（设置 → 关于）、Windows 版本、能重现的步骤、期望与实际结果。涉及具体 PDF 时，如果文件不能公开，请说明它的特点（扫描件、加密、页数、由什么软件生成）。

**安全问题不要公开提 Issue**，请用 GitHub 的 “Report a vulnerability” 私下报告。

## 开发环境

见 [README](README.md#从源码运行) 与 [docs/BUILDING.md](docs/BUILDING.md)。界面是原生 ES 模块，没有打包步骤，改完 `ui/` 下的文件重新启动即可看到效果。

## 提交改动前

```
npm run verify                 # oxlint + 单元测试，必须全部通过
node scripts/ci-smoke.cjs      # 改动了界面或主进程时运行
```

- **静态检查**：`npm run lint`（oxlint），只启用正确性一类规则，不做格式化改写。三条规则是刻意关闭的，不要顺手打开：
  - `no-control-regex`：文件名与正文清洗里确实要匹配控制字符（`\x00-\x1f`）。
  - `unicorn/prefer-string-starts-ends-with`：纯风格，`/^…/` 与 `startsWith` 混用是既有写法。
  - `unicorn/no-useless-spread`：它把 `[...map]`、`[...nodeList]`、`[...namedNodeMap]` 一律当成多余展开，而这五处快照是必需的——遍历 `Map` 时删除条目、遍历活动集合时修改元素、`closeTab` 会从 `sessions` 里删键。
  确实需要保留某处写法时，用 `// oxlint-disable-next-line <规则> -- 原因` 就地说明，不要改配置文件。
- **测试**：纯逻辑放进可以单独导入的函数，并在 `test/*.test.mjs` 里加用例；涉及窗口的行为加到对应的 `test/*-smoke.cjs`。`npm test` 按 `test/*.test.*` 通配发现文件，新增文件不需要登记；需要看覆盖率用 `npm run test:coverage`。
- **新增主进程模块**：必须同时加进 `package.json` 的 `build.files`，否则安装包里会缺文件。`test/consistency.test.mjs` 会检查这件事，也会检查版本号五处一致。
- **界面文字**：源语言是简体中文，直接写在代码里。新增文字后在 `scripts/i18n/` 里补上英文、繁体中文、日文、韩文（`catalog.json` 加条目，`src/` 加一行 TSV，带变量的句子在 `build.py` 的 `PATTERNS` 里加一条），然后运行 `python3 scripts/i18n/build.py`。
- **隐私**：不要加入任何默认联网的行为。确实需要联网的功能必须由用户明确触发，并说明发送了什么。
- **后端**：改动 `backend/worker.py` 后运行 `backend/test_worker.py`，并在 PR 里注明需要重新冻结后端。
- **依赖**：新增第三方代码时更新 `THIRD_PARTY_NOTICES.md`，并确认许可与 AGPL-3.0 兼容。
- **代码风格**：跟随所在文件的写法；`.editorconfig` 规定了缩进和换行。注释写“为什么”，不写“做了什么”。本仓库倾向紧凑的单行写法，格式化统一尚未做——不要为了“更好看”重排无关代码。

## 许可

提交的代码按 [AGPL-3.0-only](LICENSE) 授权。
