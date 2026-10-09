// 0.15.0 — one classification of the PDF tools, shared by the toolbox dialog, the toolbar's tools
// menu and the home page. Each entry names a toolbox action (tools.mjs); "mode" preselects the page
// operation of the organize action; "converter" and "compareView" open the conversion centre and the
// side-by-side view. Labels are the source (Simplified Chinese) strings; i18n translates them.
export const toolCatalog = [
  { id: 'pages', label: '页面', icon: 'pages', note: '合并、拆分、删除、旋转与重排', tools: [
    { action: 'organize', mode: 'merge', label: '合并 PDF', icon: 'plus' },
    { action: 'organize', mode: 'split', label: '拆分为单页', icon: 'pages' },
    { action: 'organize', mode: 'extract', label: '提取页面', icon: 'open' },
    { action: 'organize', mode: 'delete', label: '删除页面', icon: 'trash' },
    { action: 'organize', mode: 'rotate', label: '旋转页面', icon: 'rotate' },
    { action: 'organize', mode: 'reorder', label: '重排 / 复制页面', icon: 'replace' },
    { action: 'organize', mode: 'blank', label: '插入空白页', icon: 'newdoc' },
    { action: 'crop', label: '修改裁剪区域', icon: 'crop' },
    { action: 'outline', label: '编辑大纲目录', icon: 'outline' },
  ] },
  { id: 'convert', label: '导出与转换', icon: 'convert', note: 'Word、Excel、图片与更多格式', tools: [
    { action: 'export', label: 'PDF 转 Word / Excel / 图片', icon: 'convert' },
    { action: 'import', label: 'Office / 图片转 PDF', icon: 'image' },
    { converter: true, label: '更多格式（文档转换中心）', icon: 'markdown' },
  ] },
  { id: 'edit', label: '编辑内容', icon: 'pageedit', note: '替换文字、图形、表单与批注', tools: [
    { action: 'text', label: '替换区域内原文', icon: 'text' },
    { action: 'annotation', label: '下划线 / 删除线 / 高亮', icon: 'highlight' },
    { action: 'shape', label: '矩形、椭圆与直线', icon: 'shape' },
    { action: 'form', label: '创建表单字段', icon: 'checkbox' },
    { action: 'flatten', label: '扁平化批注与表单', icon: 'pages' },
  ] },
  { id: 'stamp', label: '印章与水印', icon: 'stamp', note: '印章、水印、页码与页眉页脚', tools: [
    { action: 'stamp', label: '文字印章', icon: 'stamp' },
    { action: 'image', label: '图片印章', icon: 'image' },
    { action: 'page-stamp', label: 'PDF 页面印章', icon: 'pages' },
    { action: 'watermark', label: '文字水印', icon: 'watermark' },
    { action: 'number', label: '页码 / 页眉页脚', icon: 'numbers' },
  ] },
  { id: 'secure', label: '安全', icon: 'lock', note: '加密、移除密码与永久涂黑', tools: [
    { action: 'encrypt', label: '密码加密与权限', icon: 'lock' },
    { action: 'decrypt', label: '移除密码（需管理密码）', icon: 'key' },
    { action: 'redact', label: '永久涂黑 / 删除敏感内容', icon: 'eraser' },
  ] },
  { id: 'scan', label: '扫描与优化', icon: 'ocr', note: '文字识别、纠偏、锐化与压缩', tools: [
    { action: 'ocr', label: '中英文 OCR', icon: 'ocr' },
    { action: 'scan', label: '扫描件纠偏与背景清理', icon: 'crop' },
    { action: 'sharpen', label: 'PDF 图像锐化', icon: 'sparkle' },
    { action: 'compress', label: '压缩 PDF', icon: 'compress' },
  ] },
  { id: 'compare', label: '比较', icon: 'compare', note: '并排阅读与差异报告', tools: [
    { compareView: true, label: '并排比较阅读', icon: 'double' },
    { action: 'compare', label: '导出文字差异报告', icon: 'compare' },
  ] },
];
export const categoryOf = (action, mode) => toolCatalog.find(c => c.tools.some(t => t.action === action && (!t.mode || !mode || t.mode === mode))) || toolCatalog[0];
export const toolKey = t => t.converter ? 'converter' : t.compareView ? 'compareView' : t.action + (t.mode ? ':' + t.mode : '');
