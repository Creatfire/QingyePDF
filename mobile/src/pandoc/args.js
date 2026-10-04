// Translates a Pandoc command line into the options object the WebAssembly build of Pandoc
// accepts (the same schema as a Pandoc "defaults" file). The desktop app starts pandoc.exe with
// arguments; on Android the unmodified desktop modules keep doing that and this module is the
// bridge. Pure functions: also used by the Node unit tests.

const BOOLEAN = new Set(['standalone', 'file-scope', 'sandbox', 'preserve-tabs', 'trace', 'strip-comments', 'table-of-contents', 'toc', 'list-of-figures', 'lof', 'list-of-tables', 'lot', 'self-contained', 'embed-resources', 'link-images', 'html-q-tags', 'ascii', 'reference-links', 'list-tables', 'number-sections', 'listings', 'incremental', 'section-divs', 'epub-title-page', 'citeproc', 'natbib', 'biblatex', 'mathml', 'gladtex', 'verbose', 'quiet', 'fail-if-warnings', 'no-highlight', 'no-check-certificate', 'strip-empty-paragraphs', 'dump-args', 'ignore-args', 'atx-headers']);
const SHORT = { f: 'from', r: 'from', t: 'to', w: 'to', o: 'output', s: 'standalone', d: 'defaults', M: 'metadata', V: 'variable', F: 'filter', L: 'lua-filter', C: 'citeproc', H: 'include-in-header', B: 'include-before-body', A: 'include-after-body', c: 'css', N: 'number-sections', i: 'incremental', T: 'title-prefix', p: 'preserve-tabs', v: 'version', h: 'help' };
// Long options that may be written without a value (--mathjax, --mathjax=URL).
const OPTIONAL_VALUE = new Set(['mathjax', 'katex', 'webtex', 'embed-resources', 'self-contained', 'epub-title-page', 'list-tables', 'citeproc', 'sandbox', 'link-images', 'reference-links', 'table-of-contents', 'toc']);
const INTEGER = new Set(['shift-heading-level-by', 'tab-stop', 'columns', 'toc-depth', 'dpi', 'slide-level', 'split-level', 'epub-chapter-level']);
const LIST = { 'metadata-file': 'metadata-files', 'syntax-definition': 'syntax-definitions', 'include-in-header': 'include-in-header', 'include-before-body': 'include-before-body', 'include-after-body': 'include-after-body', css: 'css', 'epub-embed-font': 'epub-fonts', bibliography: 'bibliography', 'request-header': 'request-headers', 'pdf-engine-opt': 'pdf-engine-opts' };
const RENAMED = { read: 'from', write: 'to', output: 'output-file', toc: 'table-of-contents', lof: 'list-of-figures', lot: 'list-of-tables', 'id-prefix': 'identifier-prefix', log: 'log-file', 'epub-chapter-level': 'split-level' };
// Options whose value is a file the engine reads.
export const FILE_KEYS = ['template', 'reference-doc', 'csl', 'citation-abbreviations', 'abbreviations', 'epub-cover-image', 'epub-metadata'];
export const FILE_LIST_KEYS = ['metadata-files', 'syntax-definitions', 'include-in-header', 'include-before-body', 'include-after-body', 'bibliography', 'epub-fonts'];

const unsupported = message => Object.assign(new Error(message), { unsupported: true });
const scalar = text => text === 'true' ? true : text === 'false' ? false : /^-?\d+$/.test(text) ? Number(text) : text;
const flagValue = text => !['false', 'no', '0'].includes(String(text).toLowerCase());

/** → { query } for information requests, or { options, inputs } for a conversion. */
export function parseArguments(argv) {
  const options = {}, inputs = [], filters = [];
  const push = (key, value) => { (options[key] ||= []).push(value); };
  for (let index = 0; index < argv.length; index++) {
    let arg = String(argv[index]), name, value = null;
    if (arg === '--') { inputs.push(...argv.slice(index + 1).map(String)); break; }
    if (arg.startsWith('--')) { const equal = arg.indexOf('='); name = equal < 0 ? arg.slice(2) : arg.slice(2, equal); if (equal >= 0) value = arg.slice(equal + 1); }
    else if (/^-[A-Za-z]/.test(arg)) { name = SHORT[arg[1]]; if (!name) throw unsupported(`安卓版的转换引擎不支持参数 ${arg.slice(0, 2)}。`); if (arg.length > 2) value = arg.slice(arg[2] === '=' ? 3 : 2); }
    else { inputs.push(arg); continue; }
    const takesValue = !BOOLEAN.has(name) && !OPTIONAL_VALUE.has(name) && !['version', 'help', 'list-input-formats', 'list-output-formats', 'list-extensions', 'list-highlight-styles', 'list-highlight-languages', 'bash-completion'].includes(name);
    if (takesValue && value === null) { if (index + 1 >= argv.length) throw new Error(`参数 --${name} 缺少取值。`); value = String(argv[++index]); }

    if (name === 'version') return { query: 'version' };
    if (name === 'help') return { query: 'help' };
    if (name === 'list-input-formats') return { query: 'input-formats' };
    if (name === 'list-output-formats') return { query: 'output-formats' };
    if (name === 'list-highlight-styles') return { query: 'highlight-styles' };
    if (name === 'list-highlight-languages') return { query: 'highlight-languages' };
    if (name === 'list-extensions') return { query: 'extensions-for-format', format: value || 'markdown' };
    if (name.startsWith('print-') || name === 'bash-completion' || name === 'server') throw unsupported(`安卓版的转换引擎不支持 --${name}。`);
    if (name === 'defaults') throw unsupported('安卓版的转换引擎暂不支持 Defaults 配置文件（--defaults），请把其中的选项写进高级参数。');
    if (name === 'filter') throw unsupported('安卓版不能运行外部过滤器程序（--filter）；Lua 过滤器（--lua-filter）可以使用。');
    if (name === 'pdf-engine' || name === 'pdf-engine-opt') throw unsupported('安卓版没有外部 PDF 引擎，请选择“PDF · 青页内置排版”。');
    if (name === 'data-dir') throw unsupported('安卓版的转换引擎不支持 --data-dir。');

    if (name === 'lua-filter') { filters.push({ type: 'lua', path: value }); continue; }
    if (name === 'citeproc') { if (value === null || flagValue(value)) filters.push({ type: 'citeproc' }); continue; }
    if (name === 'metadata' || name === 'variable') { const key = name === 'metadata' ? 'metadata' : 'variables', split = value.search(/[:=]/), k = split < 0 ? value : value.slice(0, split), v = split < 0 ? true : value.slice(split + 1); (options[key] ||= {})[k] = name === 'metadata' && typeof v === 'string' ? scalar(v) : v; continue; }
    if (name === 'mathml' || name === 'gladtex') { options['html-math-method'] = { method: name }; continue; }
    if (name === 'mathjax' || name === 'katex' || name === 'webtex') { options['html-math-method'] = value ? { method: name, url: value } : { method: name }; continue; }
    if (name === 'natbib' || name === 'biblatex') { options['cite-method'] = name; continue; }
    if (name === 'verbose') { options.verbosity = 'INFO'; continue; }
    if (name === 'quiet') { options.verbosity = 'ERROR'; continue; }
    if (name === 'no-highlight') { options['syntax-highlighting'] = 'none'; continue; }
    if (name === 'resource-path') { options['resource-path'] = [...(options['resource-path'] || []), ...value.split(':').map(part => part || '.')]; continue; }
    if (name === 'indented-code-classes') { options[name] = value.split(',').map(part => part.trim()).filter(Boolean); continue; }
    if (name === 'number-offset') { options[name] = value.split(',').map(Number); continue; }
    if (LIST[name]) { push(LIST[name], value); continue; }
    const key = RENAMED[name] || name;
    if (BOOLEAN.has(name) || (OPTIONAL_VALUE.has(name) && (value === null || /^(true|false|yes|no|0|1)$/i.test(value)))) options[key] = value === null ? true : flagValue(value);
    else options[key] = INTEGER.has(name) ? Number(value) : value;
  }
  if (filters.length) options.filters = filters;
  return { options, inputs };
}

/** "+ext" / "-ext" lines, as `pandoc --list-extensions=FORMAT` prints them. */
export const extensionLines = map => Object.keys(map).sort().map(name => (map[name] ? '+' : '-') + name).join('\n') + '\n';

export const HELP = `pandoc (WebAssembly) — 青页安卓版内置的转换引擎
与桌面版相同的 Pandoc 读写器、模板、引文（--citeproc）与 Lua 过滤器（--lua-filter）。

高级参数按 Pandoc 命令行书写，例如：
  --toc-depth=2  --shift-heading-level-by=1  --wrap=none  --columns=80
  --metadata title=标题  --variable lang=zh-CN  --reference-doc 模板.docx
  --template 模板.html  --css 样式.css  --bibliography 文献.bib  --csl 样式.csl
  --lua-filter 过滤器.lua  --extract-media 目录  --embed-resources  --mathml

安卓版不支持：
  --filter（外部过滤器程序）、--pdf-engine（外部 PDF 引擎）、
  --defaults（Defaults 配置文件）、--data-dir，以及读取网络资源。
输出 PDF 请选择“PDF · 青页内置排版”。完整选项说明见 https://pandoc.org/MANUAL.html
`;
