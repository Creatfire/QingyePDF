// One table of PDF tools (0.21). The toolbar "工具" menu, the tool center, the pinned toolbar
// buttons and the command palette are all built from it, so a tool is registered once.
// `action` opens the toolbox form for that backend action (with an optional `preset`); `run` names
// an entry the host handles itself (page manager, converter, side-by-side compare). `hidden` tools
// are not on the tool center grid: they are done on the page, from the 编辑 / 批注 menus, and stay
// reachable through the command palette and tools.open(action).
export const TOOL_GROUPS = [
  ['pages', '页面'], ['convert', '转换'], ['optimize', '优化'], ['protect', '保护'], ['add', '添加'], ['compare', '比较'],
];

export const TOOLS = [
  { id: 'pages', group: 'pages', label: '页面管理', desc: '排序、旋转、删除、插入，缩略图拖动', icon: 'pages', run: 'pages', keys: '页面 排序 重排 旋转 删除 插入 空白页 缩略图' },
  { id: 'organize', group: 'pages', label: '合并与拆分', desc: '合并多个 PDF，提取或拆分页面', icon: 'pages', action: 'organize', keys: '合并 拆分 提取 分割 merge split' },
  { id: 'crop', group: 'pages', label: '裁剪页面', desc: '修改 PDF 裁剪区域，或自动裁到内容', icon: 'crop', action: 'crop', keys: '裁剪 cropbox 白边' },
  { id: 'number', group: 'pages', label: '页码与页眉页脚', desc: '页码、页眉页脚与贝茨编号', icon: 'numbers', action: 'number', keys: '页码 页眉 页脚 贝茨 bates' },
  { id: 'export-office', group: 'convert', label: '导出为 Word / Excel / PPT', desc: 'DOCX、XLSX、PPTX', icon: 'convert', action: 'export', preset: { format: 'docx' }, keys: '转换 导出 word docx excel xlsx ppt pptx' },
  { id: 'export-image', group: 'convert', label: '导出为图片或文本', desc: 'PNG、JPEG、SVG、HTML、TXT、CSV', icon: 'image', action: 'export', preset: { format: 'png' }, keys: '转换 导出 图片 png jpg jpeg svg html txt csv 文本' },
  { id: 'import', group: 'convert', label: 'Office / 图片转 PDF', desc: '保留原版式，与直接打开一致', icon: 'open', action: 'import', keys: '转换 office word excel ppt 图片 转为 pdf' },
  { id: 'converter', group: 'convert', label: '文档转换中心', desc: 'Markdown、EPUB、Word 互相转换', icon: 'convert', run: 'converter', keys: '转换 pandoc markdown epub word' },
  { id: 'compress', group: 'optimize', label: '压缩 PDF', desc: '清理对象、图像降采样', icon: 'compress', action: 'compress', keys: '压缩 减小 体积 文件大小' },
  { id: 'ocr', group: 'optimize', label: '文字识别 OCR', desc: '补文字层，让扫描件可以搜索', icon: 'ocr', action: 'ocr', keys: 'ocr 识别 扫描 文字层' },
  { id: 'scan', group: 'optimize', label: '扫描件纠偏与清理', desc: '纠偏、背景清理、灰度', icon: 'refresh', action: 'scan', keys: '扫描 纠偏 倾斜 背景 灰度' },
  { id: 'sharpen', group: 'optimize', label: '图像锐化', desc: '让模糊的扫描页更清楚', icon: 'sparkle', action: 'sharpen', keys: '锐化 清晰 模糊' },
  { id: 'encrypt', group: 'protect', label: '密码与权限', desc: '打开密码、打印与复制限制', icon: 'lock', action: 'encrypt', keys: '密码 加密 权限 打印 复制' },
  { id: 'decrypt', group: 'protect', label: '移除密码', desc: '需要管理密码', icon: 'key', action: 'decrypt', keys: '密码 解密 移除 解除' },
  { id: 'redact', group: 'protect', label: '永久涂黑', desc: '按区域、文字或常用格式删除敏感内容', icon: 'shield', action: 'redact', keys: '涂黑 删除 敏感 隐私 脱敏' },
  { id: 'flatten', group: 'protect', label: '扁平化', desc: '把批注和表单固定到页面', icon: 'layout', action: 'flatten', keys: '扁平化 批注 表单 固定' },
  { id: 'watermark', group: 'add', label: '水印', desc: '文字水印，全部或指定页', icon: 'watermark', action: 'watermark', keys: '水印 文字' },
  { id: 'stamp', group: 'add', label: '批量文字印章', desc: '多页同一位置，含标准印章与日期章', icon: 'stamp', action: 'stamp', keys: '印章 盖章 日期章 审核' },
  { id: 'image', group: 'add', label: '批量图片印章', desc: '图片写入多页同一位置', icon: 'image', action: 'image', keys: '印章 图片 盖章 签名' },
  { id: 'page-stamp', group: 'add', label: 'PDF 页面印章', desc: '把另一个 PDF 的页面作为印章', icon: 'file', action: 'page-stamp', keys: '印章 页面 叠加' },
  { id: 'form', group: 'add', label: '表单字段', desc: '文本框与复选框', icon: 'checkbox', action: 'form', keys: '表单 字段 文本框 复选框' },
  { id: 'compare-side', group: 'compare', label: '并排比较', desc: '同步翻页，标出文字差异', icon: 'compare', run: 'compare', keys: '比较 对比 差异 并排' },
  { id: 'compare-report', group: 'compare', label: '差异报告', desc: '导出文字或图像差异 HTML', icon: 'compare', action: 'compare', keys: '比较 对比 差异 报告' },
  { id: 'text', group: 'add', label: '替换区域内原文', desc: '在页面上框选后替换', icon: 'replace', action: 'text', hidden: true, keys: '替换 原文 修改文字' },
  { id: 'shape', group: 'add', label: '矩形、椭圆与直线', desc: '写入页面内容的图形', icon: 'shape', action: 'shape', hidden: true, keys: '图形 矩形 椭圆 直线' },
  { id: 'annotation', group: 'add', label: '下划线 / 删除线（区域）', desc: '按区域添加标准批注', icon: 'strike', action: 'annotation', hidden: true, keys: '下划线 删除线 高亮 批注' },
  { id: 'outline', group: 'pages', label: '编辑目录', desc: '修改书签与章节层级', icon: 'outline', action: 'outline', hidden: true, keys: '目录 大纲 书签 章节' },
];

// The "工具" menu's 常用 list when nothing is pinned.
export const DEFAULT_COMMON = ['compress', 'ocr', 'export-office', 'organize', 'encrypt'];
export const MAX_PINNED = 6;

const byId = new Map(TOOLS.map(tool => [tool.id, tool]));
export const tool = id => byId.get(id);
// The tool that opens a toolbox action without a preset: the export action belongs to "导出为 Word".
export const toolForAction = action => TOOLS.find(t => t.action === action && !t.hidden) || TOOLS.find(t => t.action === action);
// Only these two work without an open PDF (they pick their own input files).
export const needsPdf = t => !(t.action === 'import' || t.run === 'converter');
export const groupLabel = group => TOOL_GROUPS.find(([id]) => id === group)?.[1] || '';

// Case-insensitive match of every whitespace-separated term against label, keywords, group and
// description; label hits rank first, so "压缩" puts 压缩 PDF above tools that only mention it.
export function rankItems(items, query, fields = item => [item.label, item.keys, item.groupLabel, item.desc]) {
  const terms = String(query || '').toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return items.slice();
  const scored = [];
  items.forEach((item, order) => {
    const [label = '', ...rest] = fields(item).map(v => String(v || '').toLowerCase());
    const other = rest.join(' ');
    let score = 0;
    for (const term of terms) {
      if (label.startsWith(term)) score += 4;
      else if (label.includes(term)) score += 3;
      else if (other.includes(term)) score += 1;
      else return;
    }
    scored.push({ item, score, order });
  });
  return scored.sort((a, b) => b.score - a.score || a.order - b.order).map(x => x.item);
}
export const searchTools = (query, list = TOOLS) => rankItems(list.map(t => ({ ...t, groupLabel: groupLabel(t.group) })), query);

// Most recent first, without duplicates; unknown ids are dropped.
export function pushRecent(list, id, max = 6) {
  if (!byId.has(id)) return validIds(list).slice(0, max);
  return [id, ...validIds(list).filter(x => x !== id)].slice(0, max);
}
export function togglePin(list, id, max = MAX_PINNED) {
  const pins = validIds(list);
  if (pins.includes(id)) return pins.filter(x => x !== id);
  if (!byId.has(id) || pins.length >= max) return pins;
  return [...pins, id];
}
export function validIds(list) { return Array.isArray(list) ? [...new Set(list.filter(id => byId.has(id)))] : []; }
