// The Markdown command registry: every Typora-style command (menu, palette, shortcut) in one table.
// A command is { id, label, group, keys, run(x), enabled?(x), checked?(x), hint? } where x = { s, ed, H }
// (s: Markdown session, ed: MarkdownEditor, H: host helpers). The menu model at the bottom
// arranges commands into Typora's File / Edit / Paragraph / Format / View / Themes menus.
import { THEMES } from './themes.mjs';

export const EXPORT_FORMATS = [
  ['pdf', 'PDF'], ['html', 'HTML'], ['htmlPlain', 'HTML（无样式）'], ['docx', 'Word (.docx)'], ['epub', 'ePub'],
  ['latex', 'LaTeX'], ['rtf', 'RTF'], ['txt', '纯文本 (.txt)'], ['image', '图片 (.png)'],
];
export const PANDOC_FORMATS = [['odt', 'OpenOffice (.odt)'], ['rst', 'reStructuredText'], ['mediawiki', 'MediaWiki'], ['textile', 'Textile'], ['opml', 'OPML'], ['org', 'Org-mode'], ['asciidoc', 'AsciiDoc'], ['pptx', 'PowerPoint (.pptx)']];

export const ENCODINGS = [['utf-8', 'UTF-8'], ['gbk', 'GBK（简体中文）'], ['gb18030', 'GB18030'], ['big5', 'Big5（繁体中文）'], ['shift_jis', 'Shift-JIS'], ['euc-kr', 'EUC-KR'], ['windows-1252', 'Windows-1252']];

export function buildRegistry(H) {
  const list = [];
  const add = (id, label, keys, run, opts = {}) => { list.push({ id, label, keys: keys ? [].concat(keys) : [], run, ...opts }); };
  const cmd = (name, ...args) => x => x.ed.run(name, ...args);
  const inTable = x => x.ed.inTable();
  const live = x => !x.ed.sourceMode && !x.ed.readonly;
  const editable = x => !x.ed.readonly;

  // ——— Paragraph ———
  for (let i = 1; i <= 6; i++) add(`heading${i}`, `${'一二三四五六'[i - 1]}级标题`, `Ctrl+${i}`, cmd('heading', i), { group: '段落', enabled: editable });
  add('paragraph', '正文', 'Ctrl+0', cmd('heading', 0), { group: '段落', enabled: editable });
  add('headingUp', '提升标题级别', 'Ctrl+=', cmd('headingUp'), { group: '段落', enabled: editable });
  add('headingDown', '降低标题级别', 'Ctrl+-', cmd('headingDown'), { group: '段落', enabled: editable });
  add('table', '表格', 'Ctrl+T', cmd('table'), { group: '段落', enabled: editable });
  add('codeBlock', '代码块', 'Ctrl+Shift+K', cmd('codeBlock'), { group: '段落', enabled: editable });
  add('mathBlock', '公式块', 'Ctrl+Shift+M', cmd('mathBlock'), { group: '段落', enabled: editable });
  add('quote', '引用', 'Ctrl+Shift+Q', cmd('quote'), { group: '段落', enabled: editable });
  add('ordered', '有序列表', 'Ctrl+Shift+[', cmd('ordered'), { group: '段落', enabled: editable });
  add('bullet', '无序列表', 'Ctrl+Shift+]', cmd('bullet'), { group: '段落', enabled: editable });
  add('task', '任务列表', 'Ctrl+Shift+X', cmd('task'), { group: '段落', enabled: editable });
  add('taskToggle', '切换任务状态', null, cmd('taskToggle'), { group: '段落', enabled: editable });
  add('taskComplete', '标记为已完成', null, cmd('taskComplete'), { group: '段落', enabled: editable });
  add('taskIncomplete', '标记为未完成', null, cmd('taskIncomplete'), { group: '段落', enabled: editable });
  add('indent', '增加缩进', 'Ctrl+]', cmd('indent'), { group: '段落', enabled: editable });
  add('outdent', '减少缩进', 'Ctrl+[', cmd('outdent'), { group: '段落', enabled: editable });
  add('linkRef', '链接引用', null, cmd('linkRef'), { group: '段落', enabled: editable });
  add('footnote', '脚注', null, cmd('footnote'), { group: '段落', enabled: editable });
  add('rule', '水平分割线', 'Ctrl+Shift+-', cmd('rule'), { group: '段落', enabled: editable });
  add('toc', '内容目录', null, cmd('toc'), { group: '段落', enabled: editable });
  add('frontMatter', 'YAML Front Matter', null, cmd('frontMatter'), { group: '段落', enabled: editable });
  for (const [type, label] of [['NOTE', '注意 (Note)'], ['TIP', '提示 (Tip)'], ['IMPORTANT', '重要 (Important)'], ['WARNING', '警告 (Warning)'], ['CAUTION', '小心 (Caution)']]) add(`alert${type}`, `警告框：${label}`, null, cmd('alert', type), { group: '段落', enabled: editable, label2: label });
  add('paragraphBefore', '在上方插入段落', null, cmd('paragraphBefore'), { group: '段落', enabled: live });
  add('paragraphAfter', '在下方插入段落', null, cmd('paragraphAfter'), { group: '段落', enabled: live });
  add('deleteBlock', '删除块', null, cmd('deleteBlock'), { group: '段落', enabled: live });
  // Tables
  add('tableRowAbove', '在上方插入行', null, cmd('tableRowAbove'), { group: '表格', enabled: inTable });
  add('tableRowBelow', '在下方插入行', 'Ctrl+Enter', cmd('tableRowBelow'), { group: '表格', enabled: inTable, displayOnly: true });
  add('tableColBefore', '在左侧插入列', null, cmd('tableColBefore'), { group: '表格', enabled: inTable });
  add('tableColAfter', '在右侧插入列', null, cmd('tableColAfter'), { group: '表格', enabled: inTable });
  add('tableDeleteRow', '删除行', 'Ctrl+Shift+Backspace', cmd('tableDeleteRow'), { group: '表格', enabled: inTable });
  add('tableDeleteCol', '删除列', null, cmd('tableDeleteCol'), { group: '表格', enabled: inTable });
  add('tableRowUp', '上移该行', null, cmd('tableRowUp'), { group: '表格', enabled: inTable });
  add('tableRowDown', '下移该行', null, cmd('tableRowDown'), { group: '表格', enabled: inTable });
  add('tableColLeft', '左移该列', null, cmd('tableColLeft'), { group: '表格', enabled: inTable });
  add('tableColRight', '右移该列', null, cmd('tableColRight'), { group: '表格', enabled: inTable });
  for (const [id, a, label] of [['Default', '', '默认对齐'], ['Left', 'left', '左对齐'], ['Center', 'center', '居中对齐'], ['Right', 'right', '右对齐']]) add(`tableAlign${id}`, label, null, cmd('tableAlign', a), { group: '表格', enabled: inTable, checked: x => x.ed.tableState()?.align === a });
  add('tableResize', '调整表格大小…', null, x => H.resizeTable(x.s), { group: '表格', enabled: inTable });
  add('formatTable', '格式化表格源码', null, cmd('formatTable'), { group: '表格', enabled: inTable });
  add('copyTable', '复制表格', null, cmd('copyTable'), { group: '表格', enabled: inTable });
  add('tableDelete', '删除表格', null, cmd('tableDelete'), { group: '表格', enabled: inTable });
  // Code tools
  add('copyCode', '复制代码内容', null, cmd('copyCode'), { group: '代码', enabled: x => x.ed.blockKind() === 'fence' || x.ed.blockKind() === 'codeBlock' });
  add('codeIndent', '为选中内容调整缩进', null, cmd('codeIndent'), { group: '代码', enabled: x => x.ed.blockKind() === 'fence' });
  add('codeIndentAll', '为整个代码块调整缩进', null, cmd('codeIndentAll'), { group: '代码', enabled: x => x.ed.blockKind() === 'fence' });

  // ——— Format ———
  add('bold', '加粗', 'Ctrl+B', cmd('bold'), { group: '格式', enabled: editable });
  add('italic', '斜体', 'Ctrl+I', cmd('italic'), { group: '格式', enabled: editable });
  add('underline', '下划线', 'Ctrl+U', cmd('underline'), { group: '格式', enabled: editable });
  add('code', '代码', 'Ctrl+Shift+`', cmd('code'), { group: '格式', enabled: editable });
  add('inlineMath', '内联公式', 'Ctrl+Shift+E', cmd('inlineMath'), { group: '格式', enabled: editable });
  add('strike', '删除线', 'Alt+Shift+5', cmd('strike'), { group: '格式', enabled: editable });
  add('highlight', '高亮', 'Ctrl+Shift+H', cmd('highlight'), { group: '格式', enabled: editable });
  add('sup', '上标', null, cmd('sup'), { group: '格式', enabled: editable });
  add('sub', '下标', null, cmd('sub'), { group: '格式', enabled: editable });
  add('comment', '注释', 'Ctrl+Shift+/', cmd('comment'), { group: '格式', enabled: editable });
  add('link', '超链接', 'Ctrl+K', cmd('link'), { group: '格式', enabled: editable });
  add('image', '插入图像…', 'Ctrl+Shift+I', x => H.pickImage(x.s), { group: '格式', enabled: editable });
  add('clearFormat', '清除样式', 'Ctrl+\\', cmd('clearFormat'), { group: '格式', enabled: editable });
  add('emoji', '表情与符号…', null, x => H.emojiPicker(x.s), { group: '格式', enabled: editable });

  // ——— Edit ———
  add('undo', '撤销', 'Ctrl+Z', x => x.ed.undo(), { group: '编辑', enabled: x => x.ed.canUndo && !x.ed.readonly, displayOnly: true });
  add('redo', '重做', 'Ctrl+Y', x => x.ed.redo(), { group: '编辑', enabled: x => x.ed.canRedo && !x.ed.readonly, displayOnly: true });
  add('cut', '剪切', 'Ctrl+X', () => H.api.editCommand('cut'), { group: '编辑', enabled: editable, displayOnly: true });
  add('copy', '复制', 'Ctrl+C', () => H.api.editCommand('copy'), { group: '编辑', displayOnly: true });
  add('paste', '粘贴', 'Ctrl+V', x => x.ed.run('paste'), { group: '编辑', enabled: editable, displayOnly: true });
  add('copyMarkdown', '复制为 Markdown', 'Ctrl+Shift+C', cmd('copyMarkdown'), { group: '编辑' });
  add('copyHtml', '复制为 HTML 代码', null, cmd('copyHtml'), { group: '编辑' });
  add('copyPlain', '复制为纯文本', null, cmd('copyPlain'), { group: '编辑' });
  add('copyNoTheme', '复制内容并简化格式', null, cmd('copyNoTheme'), { group: '编辑' });
  add('pasteAsPlain', '粘贴为纯文本', 'Ctrl+Shift+V', cmd('pasteAsPlain'), { group: '编辑', enabled: editable, displayOnly: true });
  add('selectAll', '全选', 'Ctrl+A', x => x.ed.selectAllText(), { group: '编辑', displayOnly: true });
  add('selectLine', '选中当前行或句', 'Ctrl+L', cmd('selectLine'), { group: '编辑' });
  add('selectStyled', '选中当前格式文本', 'Ctrl+E', cmd('selectStyled'), { group: '编辑' });
  add('selectWord', '选中当前词', 'Ctrl+D', cmd('selectWord'), { group: '编辑' });
  add('selectBlock', '选择段落或块', null, cmd('selectBlock'), { group: '编辑' });
  add('deleteWord', '删除当前词', 'Ctrl+Shift+D', cmd('deleteWord'), { group: '编辑', enabled: editable });
  add('deleteStyled', '删除当前格式文本', null, cmd('deleteStyled'), { group: '编辑', enabled: editable });
  add('deleteLine', '删除当前行或句', null, cmd('deleteLine'), { group: '编辑', enabled: editable });
  add('jumpTop', '跳转到文首', 'Ctrl+Home', cmd('jumpTop'), { group: '编辑' });
  add('jumpBottom', '跳转到文末', 'Ctrl+End', cmd('jumpBottom'), { group: '编辑' });
  add('jumpSelection', '跳转到所选内容', 'Ctrl+J', cmd('jumpSelection'), { group: '编辑' });
  add('jumpLineStart', '跳转到行首', null, cmd('jumpLineStart'), { group: '编辑' });
  add('jumpLineEnd', '跳转到行尾', null, cmd('jumpLineEnd'), { group: '编辑' });
  add('copyTex', '复制公式 TeX 代码', null, cmd('copyTex'), { group: '编辑' });
  add('copyMathML', '复制公式 MathML', null, cmd('copyMathML'), { group: '编辑' });
  add('refreshMath', '刷新所有数学公式', null, x => x.ed.refreshAll(), { group: '编辑' });
  add('find', '查找', 'Ctrl+F', x => H.openFind(x.s, false), { group: '编辑', displayOnly: true });
  add('replace', '查找和替换', 'Ctrl+H', x => H.openFind(x.s, true), { group: '编辑', displayOnly: true });
  add('findNext', '查找下一个', 'F3', x => x.ed.options.onFindStep?.(1), { group: '编辑', displayOnly: true });
  add('findPrev', '查找上一个', 'Shift+F3', x => x.ed.options.onFindStep?.(-1), { group: '编辑', displayOnly: true });
  add('spellcheck', '键入时检查拼写', null, () => H.togglePref('spellcheck'), { group: '编辑', checked: () => H.prefs.get('spellcheck') });
  add('smartPunctuation', '智能标点（渲染时转换）', null, () => H.togglePref('smartPunctuation'), { group: '编辑', checked: () => H.prefs.get('smartPunctuation') });
  add('indentFirstLine', '首行缩进', null, () => H.togglePref('indentFirstLine'), { group: '编辑', checked: () => H.prefs.get('indentFirstLine') });
  add('preserveBreaks', '保留单换行符', null, () => H.togglePref('preserveBreaks'), { group: '编辑', checked: () => H.prefs.get('preserveBreaks') });
  add('showBr', '显示 <br/>', null, () => H.togglePref('showBr'), { group: '编辑', checked: () => H.prefs.get('showBr') });
  add('autoPair', '自动配对括号和引号', null, () => H.togglePref('autoPair'), { group: '编辑', checked: () => H.prefs.get('autoPair') });
  add('smartPaste', '智能粘贴（按格式）', null, () => H.togglePref('smartPaste'), { group: '编辑', checked: () => H.prefs.get('smartPaste') });
  add('copyMarkdownDefault', '默认复制 Markdown 源码', null, () => H.togglePref('copyMarkdown'), { group: '编辑', checked: () => H.prefs.get('copyMarkdown') });

  // ——— Images ———
  add('imageInsertNone', '插入本地图片时：不处理', null, () => H.prefs.set('imageInsert', 'none'), { group: '图像', checked: () => H.prefs.get('imageInsert') === 'none' });
  add('imageInsertAssets', '插入本地图片时：复制到 ./assets 文件夹', null, () => H.prefs.set('imageInsert', 'assets'), { group: '图像', checked: () => H.prefs.get('imageInsert') === 'assets' });
  add('imageInsertNamed', '插入本地图片时：复制到 ./文档名.assets 文件夹', null, () => H.prefs.set('imageInsert', 'named'), { group: '图像', checked: () => H.prefs.get('imageInsert') === 'named' });
  add('imageInsertCustom', '插入本地图片时：复制到自定义文件夹…', null, () => H.customImageFolder(), { group: '图像', checked: () => H.prefs.get('imageInsert') === 'custom' });
  add('imageCopyAll', '复制所有本地图片到文档文件夹…', null, x => H.copyAllImages(x.s), { group: '图像' });

  // ——— File ———
  add('new', '新建', 'Ctrl+N', () => H.app.newMarkdown(), { group: '文件', displayOnly: true });
  add('open', '打开…', 'Ctrl+O', () => H.app.open(), { group: '文件', displayOnly: true });
  add('openFolder', '打开文件夹…', null, x => H.openFolder(x.s), { group: '文件' });
  add('openQuickly', '快速打开…', 'Ctrl+P', x => H.openQuickly(x.s), { group: '文件' });
  add('save', '保存', 'Ctrl+S', x => H.app.save(x.s, false), { group: '文件', displayOnly: true });
  add('saveAs', '另存为…', 'Ctrl+Shift+S', x => H.app.save(x.s, true), { group: '文件', displayOnly: true });
  add('saveAll', '保存全部打开的文件', null, () => H.saveAll(), { group: '文件' });
  add('duplicate', '创建副本…', null, x => H.fileOp(x.s, 'duplicate'), { group: '文件' });
  add('rename', '重命名…', null, x => H.fileOp(x.s, 'rename'), { group: '文件', enabled: x => !!x.s.path });
  add('moveTo', '移动到…', null, x => H.fileOp(x.s, 'move'), { group: '文件', enabled: x => !!x.s.path });
  add('versions', '浏览所有版本…', null, x => H.versions(x.s), { group: '文件', enabled: x => !!x.s.path });
  add('importFile', '导入…（内置转换引擎）', null, () => H.importFile(), { group: '文件' });
  add('print', '打印…', null, x => H.print(x.s), { group: '文件' });
  add('reveal', '在资源管理器中显示', null, x => H.fileOp(x.s, 'reveal'), { group: '文件', enabled: x => !!x.s.path });
  add('copyPath', '复制文件路径', null, x => H.fileOp(x.s, 'copyPath'), { group: '文件', enabled: x => !!x.s.path });
  add('revealInTree', '在文件树中显示', null, x => H.revealInTree(x.s), { group: '文件', enabled: x => !!x.s.path });
  add('reloadDisk', '从磁盘重新加载', null, x => H.reload(x.s), { group: '文件', enabled: x => !!x.s.path });
  add('eolCrlf', '换行符：Windows (CRLF)', null, x => H.setEol(x.s, '\r\n'), { group: '文件', checked: x => x.s.eol === '\r\n' });
  add('eolLf', '换行符：Unix (LF)', null, x => H.setEol(x.s, '\n'), { group: '文件', checked: x => x.s.eol !== '\r\n' });
  for (const [enc, label] of ENCODINGS) add(`encoding:${enc}`, `重新以 ${label} 读取`, null, x => H.reopenEncoding(x.s, enc), { group: '文件', label2: label, enabled: x => !!x.s.path, checked: x => (x.s.encodingLabel || 'UTF-8').toLowerCase() === enc });
  add('finalNewline', '保存时在文末添加空行', null, () => H.togglePref('finalNewline'), { group: '文件', checked: () => H.prefs.get('finalNewline') });
  add('autoSave', '自动保存', null, () => H.togglePref('autoSave'), { group: '文件', checked: () => H.prefs.get('autoSave') });
  for (const [id, label] of EXPORT_FORMATS) add(`export:${id}`, `导出为 ${label}…`, null, x => H.exportAs(x.s, id), { group: '导出', label2: label });
  for (const [id, label] of PANDOC_FORMATS) add(`export:${id}`, `导出为 ${label}…（Pandoc）`, null, x => H.exportAs(x.s, id), { group: '导出', label2: label, pandoc: true });
  add('exportSettings', '导出设置…', null, x => H.openPrefs(x.s, 'export'), { group: '导出' });
  add('preferences', '偏好设置…', 'Ctrl+,', x => H.openPrefs(x.s), { group: '文件' });

  // ——— View ———
  add('toggleSidebar', '显示/隐藏侧边栏', 'Ctrl+Shift+L', x => H.toggleSidebar(x.s), { group: '视图', checked: x => H.sidebarOpen(x.s) });
  add('viewOutline', '大纲', 'Ctrl+Shift+1', x => H.showSidebar(x.s, 'outline'), { group: '视图', checked: x => H.sidebarTab(x.s) === 'outline' });
  add('viewFiles', '文件树', 'Ctrl+Shift+3', x => H.showSidebar(x.s, 'files'), { group: '视图', checked: x => H.sidebarTab(x.s) === 'files' });
  add('outlineExpand', '大纲：全部展开', null, x => H.outlineFold(x.s, false), { group: '视图' });
  add('outlineCollapse', '大纲：全部折叠', null, x => H.outlineFold(x.s, true), { group: '视图' });
  add('outlineFlat', '大纲视图：无折叠', null, () => H.prefs.set('outlineMode', H.prefs.get('outlineMode') === 'flat' ? 'tree' : 'flat'), { group: '视图', checked: () => H.prefs.get('outlineMode') === 'flat' });
  add('highlightHeading', '高亮当前标题', null, () => H.togglePref('highlightHeading'), { group: '视图', checked: () => H.prefs.get('highlightHeading') });
  add('sourceMode', '源代码模式', 'Ctrl+/', x => H.setSource(x.s, !x.ed.sourceMode), { group: '视图', checked: x => x.ed.sourceMode });
  add('readonly', '阅读模式（只读）', 'Ctrl+Shift+R', x => H.setMode(x.s, 'readonly', !x.ed.readonly), { group: '视图', checked: x => x.ed.readonly });
  add('focusMode', '专注模式', 'F8', x => H.setMode(x.s, 'focus', !x.ed.focusMode), { group: '视图', checked: x => x.ed.focusMode });
  add('typewriterMode', '打字机模式', 'F9', x => H.setMode(x.s, 'typewriter', !x.ed.typewriter), { group: '视图', checked: x => x.ed.typewriter });
  add('alwaysOnTop', '保持窗口在最前端', null, () => H.alwaysOnTop(), { group: '视图', checked: () => H.isOnTop() });
  add('fullscreen', '全屏', 'F11', () => H.api.fullscreen?.(), { group: '视图', displayOnly: true });
  add('statusBar', '状态栏', null, () => H.togglePref('statusBar'), { group: '视图', checked: () => H.prefs.get('statusBar') });
  add('menubar', '工具栏（菜单栏）', null, () => H.togglePref('menubar'), { group: '视图', checked: () => H.prefs.get('menubar') });
  add('zoomIn', '放大', 'Ctrl+Shift+=', () => H.zoom(0.1), { group: '视图' });
  add('zoomOut', '缩小', 'Ctrl+Alt+-', () => H.zoom(-0.1), { group: '视图' });
  add('zoomReset', '实际大小', 'Ctrl+Shift+0', () => H.zoom(0), { group: '视图' });
  add('wordCount', '字数统计窗口', 'Ctrl+Shift+W', x => H.wordCount(x.s), { group: '视图' });
  add('palette', '命令面板…', 'Ctrl+Shift+P', x => H.palette(x.s), { group: '视图' });
  add('shortcutsHelp', '快捷键设置…', null, x => H.openPrefs(x.s, 'keys'), { group: '视图' });

  // ——— Themes ———
  for (const [id, label] of THEMES) add(`theme:${id}`, `主题：${label}`, null, () => H.setTheme(id), { group: '主题', label2: label, checked: () => H.prefs.get('theme') === id });
  add('themeFolder', '打开主题文件夹', null, () => H.themeFolder(), { group: '主题' });
  add('themeImport', '导入主题（.css）…', null, () => H.themeImport(), { group: '主题' });
  add('fontSettings', '字体与排版设置…', null, x => H.openPrefs(x.s, 'appearance'), { group: '主题' });

  // ——— Help ———
  add('helpReference', 'Markdown 语法参考（示例文档）', null, () => H.app.example(), { group: '帮助' });
  add('helpQuickStart', '快速入门', null, () => H.quickStart(), { group: '帮助' });

  const byId = new Map(list.map(c => [c.id, c]));
  return { list, byId, get: id => byId.get(id) };
}

// Menu model: [label, items]; items are command ids, '-' separators, or [label, [items…]] submenus.
export function menuModel(reg) {
  const exportItems = EXPORT_FORMATS.map(([id]) => `export:${id}`);
  const pandocItems = PANDOC_FORMATS.map(([id]) => `export:${id}`);
  return [
    ['文件', ['new', 'open', 'openFolder', 'openQuickly', ['recent', 'recent'], '-', 'save', 'saveAs', 'saveAll', 'duplicate', 'rename', 'moveTo', 'versions', '-',
      'importFile', ['导出', [...exportItems, '-', ...pandocItems, '-', 'exportSettings']], 'print', '-', 'reveal', 'copyPath', 'revealInTree', 'reloadDisk',
      ['换行符', ['eolCrlf', 'eolLf']], ['重新以编码读取', ENCODINGS.map(([id]) => `encoding:${id}`)], 'finalNewline', 'autoSave', '-', 'preferences']],
    ['编辑', ['undo', 'redo', '-', 'cut', 'copy', 'paste', '-', 'copyMarkdown', 'copyHtml', 'copyPlain', 'copyNoTheme', 'pasteAsPlain', '-', 'selectAll',
      ['选择', ['selectLine', 'selectStyled', 'selectWord', 'selectBlock']], ['删除', ['deleteWord', 'deleteStyled', 'deleteLine', 'deleteBlock']],
      ['跳转到', ['jumpTop', 'jumpBottom', 'jumpSelection', 'jumpLineStart', 'jumpLineEnd']], '-',
      ['数学工具', ['copyTex', 'copyMathML', 'refreshMath']], ['图像工具', ['image', '-', 'imageInsertNone', 'imageInsertAssets', 'imageInsertNamed', 'imageInsertCustom', 'imageCopyAll']],
      ['查找和替换', ['find', 'findNext', 'findPrev', 'replace']], ['拼写与输入', ['spellcheck', 'autoPair', 'smartPaste', 'smartPunctuation', 'copyMarkdownDefault']],
      ['空格与换行', ['indentFirstLine', 'preserveBreaks', 'showBr']], 'emoji']],
    ['段落', ['heading1', 'heading2', 'heading3', 'heading4', 'heading5', 'heading6', 'paragraph', 'headingUp', 'headingDown', '-', 'table', 'codeBlock', 'mathBlock', 'quote', 'ordered', 'bullet', 'task',
      ['任务状态', ['taskToggle', 'taskComplete', 'taskIncomplete']], ['列表缩进', ['indent', 'outdent']], '-', 'linkRef', 'footnote', 'rule', 'toc', 'frontMatter',
      ['警告框', ['alertNOTE', 'alertTIP', 'alertIMPORTANT', 'alertWARNING', 'alertCAUTION']], '-',
      ['表格操作', ['tableRowAbove', 'tableRowBelow', 'tableColBefore', 'tableColAfter', 'tableDeleteRow', 'tableDeleteCol', '-', 'tableRowUp', 'tableRowDown', 'tableColLeft', 'tableColRight', '-', 'tableAlignDefault', 'tableAlignLeft', 'tableAlignCenter', 'tableAlignRight', '-', 'tableResize', 'formatTable', 'copyTable', 'tableDelete']],
      ['代码工具', ['copyCode', 'codeIndent', 'codeIndentAll']], '-', 'paragraphBefore', 'paragraphAfter']],
    ['格式', ['bold', 'italic', 'underline', 'code', 'inlineMath', 'strike', 'highlight', 'sup', 'sub', 'comment', '-', 'link', 'image', '-', 'clearFormat']],
    ['视图', ['toggleSidebar', 'viewOutline', 'viewFiles', ['大纲选项', ['outlineExpand', 'outlineCollapse', 'outlineFlat', 'highlightHeading']], '-',
      'readonly', 'sourceMode', 'focusMode', 'typewriterMode', '-', 'alwaysOnTop', 'fullscreen', 'statusBar', 'menubar', '-', 'zoomIn', 'zoomOut', 'zoomReset', '-', 'wordCount', 'palette']],
    ['主题', [...THEMES.map(([id]) => `theme:${id}`), ['custom', 'customThemes'], '-', 'themeFolder', 'themeImport', 'fontSettings']],
    ['帮助', ['helpQuickStart', 'helpReference', 'shortcutsHelp']],
  ];
}
