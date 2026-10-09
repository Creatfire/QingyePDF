# Third-party notices

- Pandoc 3.12: GPL-2.0-or-later, copyright John MacFarlane and contributors. The unmodified official Windows x64 executable is bundled as a local conversion component, not represented as Qingye's own conversion-engine implementation. `vendor/pandoc` retains COPYING.md, COPYING.rtf, COPYRIGHT.txt, MANUAL.html and a version/hash manifest; the packaged location is `resources/pandoc`. The Pandoc repository snapshot (including pandoc-cli, pandoc-lua-engine, pandoc-server, data, tests and build files) is included in the dependency-source archive as `pandoc-3.12-source.tar.gz`, commit `381230ee36d8fa871c28f8982e22579f1a8f723b`. Upstream Haskell dependency declarations and further copyright/source notices remain in that snapshot and COPYRIGHT.txt. Source: https://github.com/jgm/pandoc/tree/3.12 . Official binary release: https://github.com/jgm/pandoc/releases/tag/3.12 . Qingye does not modify the engine in this release; source changes are in the integration and GUI.

Qingye 0.4.0 is distributed under GNU AGPL version 3. The previous application code's MIT notice is retained in LICENSE-MIT. New application code and offline worker are AGPL-3.0-only; bundled dependencies retain their own licenses. Full AGPL text is in LICENSE.

- Mozilla PDF.js 6.3.289: Apache License 2.0. Official release: https://github.com/mozilla/pdf.js/releases/tag/v6.3.289 . Full license and notices are retained at `vendor/pdfjs/LICENSE`. Adobe CMap and bundled font/resource notices are retained in the distribution. `vendor/pdfjs/QINGYE-MODIFICATIONS.md` records the archive hash and viewer HTML changes. PDF parsing and rendering code has not been modified.
- Markdown editor (bundled in `vendor/markdown/qingye-markdown-vendor.mjs`, rebuilt with `scripts/build-markdown-vendor.mjs`): markdown-it 14.1.1 (MIT) with linkify-it 5.0.0 (MIT), mdurl 2.0.0 (MIT), uc.micro 2.1.0 (MIT), entities 4.5.0 (BSD-2-Clause) and punycode.js 2.3.1 (MIT); KaTeX 0.16.45 (MIT) including its fonts in `vendor/markdown/katex`; highlight.js 10.7.3 core and selected languages (BSD-3-Clause); DOMPurify 3.4.2 (Apache-2.0 or MPL-2.0). Full license texts are retained in `vendor/markdown/licenses`. The Markdown editor's own code (Typora-style block editing, math / task-list / front-matter plugins) is Qingye application code; it contains no Typora code, branding or assets.
- Mermaid 11.14.0 (MIT, `vendor/mermaid`, official ESM build copied unmodified except removed source-map comments; license at `vendor/mermaid/LICENSE`). Its bundled dependencies include d3 and d3-sankey (ISC / BSD-3-Clause), dagre-d3-es, cytoscape and its layout extensions, khroma, lodash-es, marked, roughjs, stylis, dayjs, uuid, ts-dedent, @braintree/sanitize-url, @iconify/utils, @upsetjs/venn.js, @mermaid-js/parser and langium (MIT), chevrotain (Apache-2.0), DOMPurify (Apache-2.0 or MPL-2.0) and KaTeX (MIT); all are permissively licensed and bundled unmodified by the Mermaid release.
- Offline legacy diagrams: flowchart.js 1.18.0 (MIT), Raphaël 2.3.0 (MIT), its eve-raphael 0.5.0 dependency (MIT), underscore 1.13.8 (MIT), and bramp/js-sequence-diagrams 2.0.1 (**BSD-2-Clause**, not MIT). Sources, pinned release URLs and SHA-256 digests are in `vendor/diagrams/SOURCES.json`; full licenses are in `vendor/diagrams/LICENSES`. The flowchart browser file is an esbuild bundle of the official npm release and its Raphaël dependency. The sequence renderer is the official Raphaël build from the tagged GitHub commit. No Typora code or assets are included.
- Electron 44.4.5: MIT. Its full license and Chromium/third-party license notices are included in the packaged Electron runtime as `LICENSE.electron.txt` and `LICENSES.chromium.html`.
- electron-builder 26.15.3: MIT; build-time tooling. Sources: https://github.com/electron-userland/electron-builder .
- PyMuPDF 1.28.2 / MuPDF 1.28.2: AGPL-3.0. The standard open-source implementation is used, with no commercial license or Pro SDK. Exact source archives and checksums are provided in the dependency source ZIP; `third-party-source/sources.json` records the downloads. Source: https://github.com/pymupdf/PyMuPDF . MuPDF sources are included as a separate source archive. See https://pymupdf.readthedocs.io/en/latest/about.html#license-and-copyright .
- Tesseract OCR resources: `tessdata_fast`, English and Simplified Chinese; Apache-2.0. Language files and LICENSE are in vendor/ocr and packaged resources/ocr. The OCR engine is included by MuPDF. Source: https://github.com/tesseract-ocr/tessdata_fast .
- python-docx 1.2.0, openpyxl 3.1.5 and python-pptx 1.0.2: MIT. Used for local Office exports.
- Pillow 12.3.0: MIT-CMU; lxml 6.1.3: BSD-3-Clause with its bundled libxml2/libxslt notices; XlsxWriter 3.2.9: BSD-2-Clause; et-xmlfile 2.0.0: MIT; typing_extensions 4.16.0: PSF-2.0.
- CPython 3.12.14: Python Software Foundation license. The runtime is frozen into the worker; end users do not need Python installed.
- PyInstaller 6.22.3: GPL with its bootloader exception, build-time/freezer; the bootloader exception permits distribution under the application's license.

Exact package metadata and all discovered dependency notices are collected at backend/licenses, included as resources/backend-licenses in the EXE. The dependency source archive contains the processing libraries' matching source distributions. Rebuild scripts and version locks are included in the application source archive.

- Noto Sans CJK SC (Regular, Bold): SIL Open Font License 1.1. A subset of the characters used is embedded in `ui/sample-guide.pdf` (the bundled PDF feature guide), generated by `scripts/sample-guide/build.py`. Source: https://github.com/notofonts/noto-cjk .
- Noto Sans SC, Noto Serif SC and JetBrains Mono variable webfonts: SIL Open Font License 1.1, distributed by Fontsource. The font files and matching license texts are bundled in `vendor/fonts/`.

Qingye contains no Xodo/PDFTron DLLs, images, fonts or implementation code.

## Open WebUI（仅作设计参照）

0.9.1 的 AI 协作面板与本地 AI 接口参考了 Open WebUI（https://github.com/open-webui/open-webui）的公开功能设计：模型连接与导入格式、聊天交互（流式输出、停止、重新生成、“/” 提示词）、以及 OpenAPI 工具服务器的对接方式。青页未包含、未复制 Open WebUI 的任何源代码、样式、图标、品牌或文档文本；导入功能只读取用户提供的配置文件中的连接字段。Open WebUI 的名称与标识归其所有者所有，青页与其无关联。

## Typora（仅作功能参照）

青页 Markdown 编辑器的“Typora 式”功能是参照 Typora 随附的帮助文档与菜单定义独立实现的。本项目不包含、不再分发 Typora 的任何程序代码、主题、样式、图标或文档文本；Typora 是 Abner Lee 的专有软件，其名称与商标归其所有者所有。青页与 Typora 无关联，也未获其认可。

## 安卓版（mobile/）新增组件

以下组件只随安卓版分发，均为未修改的上游发布物。

| 组件 | 版本 | 许可 | 用途 |
|---|---|---|---|
| Capacitor（@capacitor/core、@capacitor/android） | 8.5.2 | MIT | WebView 外壳与原生桥 |
| Pyodide | 0.29.5 | MPL-2.0 | 在 WebView 中运行 CPython，承载 `backend/worker.py` |
| PyMuPDF / MuPDF（pyemscripten wheel） | 1.28.2 | AGPL-3.0 | PDF 处理（与桌面版相同版本） |
| lxml（Pyodide 构建） | 6.0.2 | BSD-3-Clause | python-docx / python-pptx 依赖 |
| Pillow（Pyodide 构建） | 11.3.0 | MIT-CMU | 图像处理 |
| python-docx、python-pptx、openpyxl、et_xmlfile、XlsxWriter、typing_extensions | 同 `backend/requirements-lock.txt`（typing_extensions 4.15.0） | MIT / MIT / MIT / MIT / BSD-2-Clause / PSF-2.0 | Office 导出 |
| tesseract.js-core（Tesseract OCR 的 WebAssembly 构建） | 6.1.2 | Apache-2.0 | 本地 OCR |
| pandoc-wasm（官方 Pandoc WebAssembly 构建，作为独立引擎调用） | 1.1.0（Pandoc 3.10） | GPL-2.0-or-later | 文档转换 |
| @bjorn3/browser_wasi_shim | 0.4.2 | MIT OR Apache-2.0 | Pandoc 的 WASI 运行环境 |
| buffer、path-browserify | 6.0.3 / 1.0.1 | MIT | Node 接口垫片 |

Pandoc 以未修改的二进制形式随包分发，通过其自身接口在独立的 Worker 中调用，与桌面版随包的 `pandoc.exe` 性质相同；对应源码见 https://github.com/jgm/pandoc 。
