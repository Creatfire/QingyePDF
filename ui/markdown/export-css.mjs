// Self-contained stylesheet for exported HTML / PDF (no dependency on the app's design tokens).
const THEME_VARS = {
  qingye: { bg: '#ffffff', ink: '#15201b', muted: '#5f7168', line: '#dbe5df', accent: '#1d7a57', soft: '#f4f8f6', code: '#f5f8f6', codeInk: '#1d5c45', font: '"Segoe UI Variable Text","Segoe UI","Microsoft YaHei UI","PingFang SC",system-ui,sans-serif', display: 'inherit', size: '16px', lh: '1.78', width: '860px' },
  github: { bg: '#ffffff', ink: '#1f2328', muted: '#59636e', line: '#d1d9e0', accent: '#0969da', soft: '#f6f8fa', code: '#f6f8fa', codeInk: '#1f2328', font: '-apple-system,"Segoe UI","Noto Sans",Helvetica,Arial,"Microsoft YaHei UI",sans-serif', display: 'inherit', size: '16px', lh: '1.6', width: '860px' },
  newsprint: { bg: '#f3f2ee', ink: '#1a1a1a', muted: '#6b6b63', line: '#d6d3c8', accent: '#7a1f1f', soft: '#ebe9e2', code: '#ebe9e2', codeInk: '#5a1a1a', font: 'Georgia,"Times New Roman","Noto Serif SC","Songti SC",SimSun,serif', display: 'inherit', size: '17px', lh: '1.7', width: '780px' },
  night: { bg: '#363b40', ink: '#b8bfc6', muted: '#8a9198', line: '#454b51', accent: '#6dc4f5', soft: '#2f3337', code: '#2b2f33', codeInk: '#e6b673', font: '"Segoe UI","Microsoft YaHei UI","PingFang SC",system-ui,sans-serif', display: 'inherit', size: '16px', lh: '1.78', width: '860px' },
  pixyll: { bg: '#ffffff', ink: '#333333', muted: '#777777', line: '#e6e6e6', accent: '#e63946', soft: '#fafafa', code: '#f8f8f8', codeInk: '#c7254e', font: 'Merriweather,Georgia,"Noto Serif SC","Songti SC",serif', display: 'Lato,"Helvetica Neue","Microsoft YaHei UI",sans-serif', size: '17px', lh: '1.85', width: '720px' },
  whitey: { bg: '#ffffff', ink: '#111111', muted: '#6a6a6a', line: '#ececec', accent: '#111111', soft: '#fafafa', code: '#fafafa', codeInk: '#333333', font: '"Helvetica Neue","Segoe UI","PingFang SC","Microsoft YaHei UI",sans-serif', display: 'inherit', size: '16px', lh: '1.75', width: '800px' },
};
export function exportCss(theme = 'qingye', { custom = '', font = '', size = '', width = '' } = {}) {
  const t = { ...(THEME_VARS[theme] || THEME_VARS.qingye) };
  if (font) t.font = font; if (size) t.size = size; if (width) t.width = width;
  const night = theme === 'night';
  return `
:root { color-scheme: ${night ? 'dark' : 'light'}; }
* { box-sizing: border-box; }
html { background: ${t.bg}; }
body { margin: 0; background: ${t.bg}; color: ${t.ink}; font: ${t.size}/${t.lh} ${t.font}; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
.mdExport { max-width: ${t.width}; margin: 0 auto; padding: 48px 40px 80px; overflow-wrap: break-word; }
.mdExport :is(h1,h2,h3,h4,h5,h6) { font-family: ${t.display}; line-height: 1.3; margin: 1.4em 0 .6em; font-weight: 700; break-after: avoid; }
.mdExport h1 { font-size: 2.05em; padding-bottom: .25em; border-bottom: 1px solid ${t.line}; }
.mdExport h2 { font-size: 1.6em; padding-bottom: .2em; border-bottom: 1px solid ${t.line}; }
.mdExport h3 { font-size: 1.32em; } .mdExport h4 { font-size: 1.12em; } .mdExport h5 { font-size: 1em; } .mdExport h6 { font-size: .95em; color: ${t.muted}; }
.mdExport > :first-child { margin-top: 0; }
.mdExport p { margin: .8em 0; }
.mdExport a { color: ${t.accent}; text-decoration: underline; text-underline-offset: 3px; }
.mdExport blockquote { margin: 1em 0; padding: .4em 1.1em; border-left: 4px solid ${t.line}; background: ${t.soft}; color: ${t.muted}; border-radius: 0 8px 8px 0; break-inside: avoid; }
.mdExport blockquote > :first-child { margin-top: .2em; } .mdExport blockquote > :last-child { margin-bottom: .2em; }
.mdExport ul, .mdExport ol { padding-left: 1.8em; margin: .7em 0; }
.mdExport li { margin: .2em 0; } .mdExport li > p { margin: .3em 0; }
.mdExport .task-list-item { list-style: none; position: relative; } .mdExport .task-list-item > input, .mdExport .task-list-item > p > input { position: absolute; left: -1.5em; top: .45em; margin: 0; }
.mdExport hr { border: 0; height: 2px; background: ${t.line}; margin: 1.8em 0; }
.mdExport img { max-width: 100%; height: auto; }
.mdExport table { border-collapse: collapse; margin: 1em 0; max-width: 100%; display: block; overflow-x: auto; break-inside: avoid; }
.mdExport th, .mdExport td { border: 1px solid ${t.line}; padding: .45em .9em; }
.mdExport th { background: ${t.soft}; font-weight: 650; } .mdExport tr:nth-child(even) td { background: ${t.soft}; }
.mdExport :not(pre) > code { font: .88em Consolas,"Cascadia Mono","JetBrains Mono",monospace; padding: .12em .42em; border-radius: 5px; background: ${t.code}; color: ${t.codeInk}; }
.mdExport pre { margin: 1em 0; padding: .9em 1.1em; overflow: auto; background: ${t.code}; border: 1px solid ${t.line}; border-radius: 10px; font: .88em/1.6 Consolas,"Cascadia Mono","JetBrains Mono",monospace; break-inside: avoid; }
.mdExport pre code { font: inherit; background: none; padding: 0; color: inherit; }
.mdExport mark { background: #ffe58a; color: inherit; padding: 0 .15em; border-radius: 3px; }
.mdExport sub, .mdExport sup { line-height: 0; font-size: .75em; }
.mdExport .mdFrontMatter { display: none; }
.mdExport .mdMathBlock { margin: 1em 0; overflow-x: auto; text-align: center; }
.mdExport .mdMermaid { margin: 1em 0; text-align: center; break-inside: avoid; } .mdExport .mdMermaid svg { max-width: 100%; height: auto; }
.mdExport .mdMermaidSource, .mdExport .mdCodeHead { display: none; }
.mdExport .mdToc { margin: 1em 0; padding: .7em 1.1em; border: 1px solid ${t.line}; border-radius: 10px; background: ${t.soft}; }
.mdExport .mdTocTitle { display: block; font-size: .82em; color: ${t.muted}; letter-spacing: .08em; margin-bottom: .3em; } .mdExport .mdToc ul { list-style: none; margin: 0; padding: 0; } .mdExport .mdToc a { text-decoration: none; }
.mdExport .mdFootnoteDef { display: flex; gap: .6em; font-size: .9em; color: ${t.muted}; margin: .3em 0; padding-left: .8em; border-left: 3px solid ${t.line}; }
.mdExport .mdFootnoteNum { font-weight: 700; color: ${t.accent}; } .mdExport .mdFootnoteNum::after { content: "."; } .mdExport .mdFootnoteRef a { text-decoration: none; font-weight: 600; } .mdExport .mdFootnoteBack { text-decoration: none; }
.mdExport blockquote.mdAlert { background: ${t.soft}; color: ${t.ink}; border-left-width: 4px; }
.mdExport blockquote.mdAlert::before { display: block; font-weight: 700; margin-bottom: .15em; }
.mdExport .mdAlert-note { border-left-color: #2f81f7; } .mdExport .mdAlert-note::before { content: "ⓘ 注意"; color: #2f81f7; }
.mdExport .mdAlert-tip { border-left-color: #2da44e; } .mdExport .mdAlert-tip::before { content: "💡 提示"; color: #2da44e; }
.mdExport .mdAlert-important { border-left-color: #8957e5; } .mdExport .mdAlert-important::before { content: "❗ 重要"; color: #8957e5; }
.mdExport .mdAlert-warning { border-left-color: #d29922; } .mdExport .mdAlert-warning::before { content: "⚠ 警告"; color: #d29922; }
.mdExport .mdAlert-caution { border-left-color: #f85149; } .mdExport .mdAlert-caution::before { content: "⛔ 小心"; color: #f85149; }
.hljs-comment,.hljs-quote{color:#6a737d;font-style:italic}.hljs-keyword,.hljs-selector-tag,.hljs-literal,.hljs-doctag{color:#8a3fbf}.hljs-string,.hljs-regexp,.hljs-addition{color:#0b7a5c}.hljs-number,.hljs-symbol,.hljs-bullet{color:#b55a00}.hljs-title,.hljs-section,.hljs-selector-id{color:#1f5fb4;font-weight:600}.hljs-attr,.hljs-attribute,.hljs-variable,.hljs-template-variable{color:#9a6700}.hljs-type,.hljs-built_in,.hljs-class .hljs-title{color:#2c6a8e}.hljs-meta{color:#6b7a73}.hljs-deletion{color:#b43b33}.hljs-emphasis{font-style:italic}.hljs-strong{font-weight:700}
${night ? '.hljs-comment,.hljs-quote{color:#7f948a}.hljs-keyword,.hljs-selector-tag,.hljs-literal{color:#d4a6ff}.hljs-string,.hljs-regexp{color:#7ee2b8}.hljs-number{color:#ffb77a}.hljs-title,.hljs-section{color:#8cc2ff}.hljs-attr,.hljs-attribute{color:#f0c674}.hljs-type,.hljs-built_in{color:#7fd0f0}' : ''}
@media print { body { background: #fff; color: #000; } .mdExport { max-width: none; padding: 0; } a { color: inherit; } }
${custom}
`.trim();
}
