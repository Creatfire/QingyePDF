// Pure Markdown text transformations. Every command takes the full text and a selection
// ({ from, to } character offsets) and returns { changes: [{ from, to, insert }], selection }
// or null. No DOM access, so the behaviour is unit-testable.
const lineStartAt = (text, pos) => text.lastIndexOf('\n', pos - 1) + 1;
const lineEndAt = (text, pos) => { const i = text.indexOf('\n', pos); return i < 0 ? text.length : i; };
export { lineStartAt, lineEndAt };

// Applies non-overlapping changes (any order) and maps the selection.
export function applyChanges(text, changes) {
  const sorted = [...changes].sort((a, b) => b.from - a.from);
  for (const c of sorted) text = text.slice(0, c.from) + c.insert + text.slice(c.to);
  return text;
}
export function mapPos(pos, changes, assoc = 1) {
  let result = pos;
  for (const c of [...changes].sort((a, b) => a.from - b.from)) {
    const delta = c.insert.length - (c.to - c.from);
    if (pos > c.to || (pos === c.to && assoc > 0 && c.from !== c.to) || (pos === c.from && c.from === c.to && assoc > 0)) result += delta;
    else if (pos > c.from) result = c.from + (assoc > 0 ? c.insert.length : 0) + (result - pos);
  }
  return result;
}
const single = (from, to, insert, selFrom, selTo = selFrom) => ({ changes: [{ from, to, insert }], selection: { from: selFrom, to: selTo } });

// ——— Inline formatting ———
export function toggleInline(text, { from, to }, marker) {
  const m = marker.length;
  if (from === to) {
    if (text.slice(from - m, from) === marker && text.slice(from, from + m) === marker) return single(from - m, from + m, '', from - m);
    return single(from, to, marker + marker, from + m);
  }
  const selected = text.slice(from, to);
  const outside = text.slice(from - m, from) === marker && text.slice(to, to + m) === marker
    && (marker !== '*' || (text[from - 2] !== '*' || text.slice(from - 3, from) === '***'));
  if (outside) return { changes: [{ from: from - m, to: from, insert: '' }, { from: to, to: to + m, insert: '' }], selection: { from: from - m, to: to - m } };
  if (selected.length > 2 * m && selected.startsWith(marker) && selected.endsWith(marker)) return single(from, to, selected.slice(m, -m), from, to - 2 * m);
  // Keep surrounding whitespace outside the markers so the result stays valid Markdown.
  const lead = /^\s*/.exec(selected)[0], trail = /\s*$/.exec(selected)[0], core = selected.slice(lead.length, selected.length - trail.length);
  if (!core) return null;
  return single(from, to, lead + marker + core + marker + trail, from + lead.length + m, from + lead.length + m + core.length);
}

// ——— Line-level formatting ———
function linesIn(text, { from, to }) {
  const start = lineStartAt(text, from), end = lineEndAt(text, Math.max(from, to - (to > from && text[to - 1] === '\n' ? 1 : 0)));
  return { start, end, lines: text.slice(start, end).split('\n') };
}
function replaceLines(text, sel, transform) {
  const { start, end, lines } = linesIn(text, sel);
  const next = transform(lines);
  const insert = next.join('\n');
  if (insert === text.slice(start, end)) return null;
  // Keep the caret on the same content where possible.
  const firstDelta = next[0].length - lines[0].length;
  const selFrom = Math.max(start, sel.from + firstDelta), selTo = sel.from === sel.to ? selFrom : start + insert.length - (end - Math.min(end, sel.to));
  return single(start, end, insert, Math.min(selFrom, start + insert.length), Math.max(Math.min(selTo, start + insert.length), Math.min(selFrom, start + insert.length)));
}
const HEADING = /^(\s{0,3})#{1,6}(\s+|$)/;
export function setHeading(text, sel, level) {
  const { lines } = linesIn(text, sel);
  const same = level > 0 && lines.every(l => !l.trim() || new RegExp(`^\\s{0,3}#{${level}}(\\s|$)`).test(l));
  const target = same ? 0 : level;
  return replaceLines(text, sel, ls => ls.map(l => {
    if (!l.trim() && ls.length > 1) return l;
    const body = l.replace(HEADING, '$1').replace(/^\s{0,3}/, '');
    return target ? '#'.repeat(target) + ' ' + body : body;
  }));
}
const LIST = /^(\s*)(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?/;
const QUOTE = /^\s*>\s?/;
export function toggleLinePrefix(text, sel, type) {
  const { lines } = linesIn(text, sel);
  const content = lines.filter(l => l.trim());
  const has = {
    quote: l => QUOTE.test(l),
    bullet: l => /^\s*[-*+]\s+(?!\[[ xX]\])/.test(l),
    ordered: l => /^\s*\d{1,9}[.)]\s+/.test(l),
    task: l => /^\s*(?:[-*+]|\d{1,9}[.)])\s+\[[ xX]\]\s/.test(l),
  }[type];
  const remove = content.length > 0 && content.every(has);
  let n = 0;
  return replaceLines(text, sel, ls => ls.map(l => {
    if (!l.trim() && ls.length > 1) return l;
    if (type === 'quote') return remove ? l.replace(QUOTE, '') : '> ' + l;
    const indent = /^\s*/.exec(l)[0], body = l.replace(LIST, '').replace(/^\s*/, '');
    if (remove) return indent + body;
    n++;
    return indent + (type === 'ordered' ? `${n}. ` : type === 'task' ? '- [ ] ' : '- ') + body;
  }));
}

// ——— Block insertion ———
export function insertBlock(text, { from, to }, snippet, caretStart, caretEnd = caretStart) {
  const lineStart = lineStartAt(text, from), lineEnd = lineEndAt(text, to);
  const lineEmpty = !text.slice(lineStart, lineEnd).trim();
  let at = lineEmpty ? lineStart : lineEnd, removeTo = lineEmpty ? lineEnd : lineEnd;
  const before = text.slice(0, at), after = text.slice(removeTo);
  const lead = !before ? '' : before.endsWith('\n\n') ? '' : before.endsWith('\n') ? '\n' : '\n\n';
  const trail = !after.trim() ? (after ? '' : '\n') : after.startsWith('\n\n') ? '' : after.startsWith('\n') ? '\n' : '\n\n';
  const insert = lead + snippet + trail;
  return single(at, removeTo, insert, at + lead.length + caretStart, at + lead.length + caretEnd);
}
export function insertTable(text, sel, columns = 3, rows = 2) {
  const header = '| ' + Array.from({ length: columns }, (_, i) => `列 ${i + 1}`).join(' | ') + ' |';
  const snippet = [header, '| ' + Array(columns).fill('---').join(' | ') + ' |', ...Array.from({ length: rows }, () => '| ' + Array(columns).fill('   ').join(' | ') + ' |')].join('\n');
  return insertBlock(text, sel, snippet, 2, 5);
}
export function insertCodeBlock(text, sel) {
  if (sel.from !== sel.to) return wrapBlock(text, sel, '```', '```');
  return insertBlock(text, sel, '```\n\n```', 4);
}
export function insertMathBlock(text, sel) {
  if (sel.from !== sel.to) return wrapBlock(text, sel, '$$', '$$');
  return insertBlock(text, sel, '$$\n\n$$', 3);
}
function wrapBlock(text, sel, open, close) {
  const start = lineStartAt(text, sel.from), end = lineEndAt(text, sel.to - (sel.to > sel.from && text[sel.to - 1] === '\n' ? 1 : 0));
  const body = text.slice(start, end);
  return single(start, end, `${open}\n${body}\n${close}`, start + open.length + 1, start + open.length + 1 + body.length);
}
export const insertRule = (text, sel) => insertBlock(text, sel, '---', 3);
export function insertLink(text, { from, to }) {
  const selected = text.slice(from, to);
  if (/^(https?:\/\/|mailto:)\S+$/.test(selected)) return single(from, to, `[](${selected})`, from + 1);
  if (selected) return single(from, to, `[${selected}]()`, from + selected.length + 3);
  return single(from, to, '[]()', from + 1);
}
export function insertImage(text, { from, to }, path = '', alt = '') {
  const label = alt || text.slice(from, to);
  const insert = `![${label}](${path})`;
  return path ? single(from, to, insert, from + insert.length) : single(from, to, insert, from + 2, from + 2 + label.length);
}

// ——— Tables ———
const cjkWidth = s => [...s].reduce((w, ch) => w + (/[ᄀ-ᅟ⺀-꓏가-힣豈-﫿︰-﹏＀-｠￠-￦]|[\u{1f300}-\u{1faff}]/u.test(ch) ? 2 : 1), 0);
export function splitRow(line) {
  let body = line.trim();
  if (body.startsWith('|')) body = body.slice(1);
  if (body.endsWith('|') && !body.endsWith('\\|')) body = body.slice(0, -1);
  const cells = []; let cell = '', code = 0;
  for (let i = 0; i < body.length; i++) {
    const ch = body[i];
    if (ch === '\\' && i + 1 < body.length) { cell += ch + body[++i]; continue; }
    if (ch === '`') code ^= 1;
    if (ch === '|' && !code) { cells.push(cell.trim()); cell = ''; continue; }
    cell += ch;
  }
  cells.push(cell.trim());
  return cells;
}
const DELIM = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)*\|?\s*$/;
export function findTable(text, pos) {
  let start = lineStartAt(text, pos), end = lineEndAt(text, pos);
  const isRow = (s, e) => { const l = text.slice(s, e); return l.includes('|') && l.trim(); };
  if (!isRow(start, end)) return null;
  while (start > 0) { const ps = lineStartAt(text, start - 1); if (!isRow(ps, start - 1)) break; start = ps; }
  while (end < text.length) { const ne = lineEndAt(text, end + 1); if (!isRow(end + 1, ne)) break; end = ne; }
  const lines = text.slice(start, end).split('\n');
  if (lines.length < 2 || !DELIM.test(lines[1])) return null;
  const rows = lines.map(splitRow);
  const aligns = rows[1].map(c => (c.startsWith(':') && c.endsWith(':') ? 'center' : c.endsWith(':') ? 'right' : c.startsWith(':') ? 'left' : ''));
  return { from: start, to: end, lines, rows, aligns, columns: Math.max(...rows.map(r => r.length)) };
}
export function formatTableText(table) {
  const cols = table.columns, rows = table.rows.map(r => [...r, ...Array(cols - r.length).fill('')]);
  const widths = Array.from({ length: cols }, (_, c) => Math.max(3, ...rows.filter((_, i) => i !== 1).map(r => cjkWidth(r[c]))));
  const pad = (s, w, align) => { const gap = w - cjkWidth(s); if (align === 'right') return ' '.repeat(gap) + s; if (align === 'center') return ' '.repeat(gap >> 1) + s + ' '.repeat(gap - (gap >> 1)); return s + ' '.repeat(gap); };
  return rows.map((r, i) => '| ' + (i === 1
    ? widths.map((w, c) => { const a = table.aligns[c] || ''; return (a === 'left' || a === 'center' ? ':' : '-') + '-'.repeat(w - 2) + (a === 'right' || a === 'center' ? ':' : '-'); })
    : r.map((cell, c) => pad(cell, widths[c], table.aligns[c]))).join(' | ') + ' |').join('\n');
}
// Cell ranges (content without padding) in formatted table text ("| a | b |" rows).
export function cellRanges(tableText) {
  let offset = 0;
  return tableText.split('\n').map(line => {
    const pipes = [];
    for (let i = 0, code = 0; i < line.length; i++) {
      if (line[i] === '\\') { i++; continue; }
      if (line[i] === '`') code ^= 1;
      if (line[i] === '|' && !code) pipes.push(i);
    }
    const ranges = [];
    for (let k = 0; k + 1 < pipes.length; k++) {
      const raw = line.slice(pipes[k] + 1, pipes[k + 1]), lead = raw.length - raw.trimStart().length, content = raw.trim();
      ranges.push({ from: offset + pipes[k] + 1 + lead, to: offset + pipes[k] + 1 + lead + content.length, empty: !content, pad: offset + pipes[k] + 2 });
    }
    offset += line.length + 1;
    return ranges;
  });
}
export function caretCell(text, table, pos) {
  const row = text.slice(table.from, pos).split('\n').length - 1;
  const before = text.slice(lineStartAt(text, pos), pos);
  const pipes = (before.match(/(?<!\\)\|/g) || []).length;
  const col = Math.max(0, pipes - (table.lines[row].trim().startsWith('|') ? 1 : 0));
  return { row, col: Math.min(col, table.columns - 1) };
}
export function formatTable(text, pos) {
  const table = findTable(text, pos);
  if (!table) return null;
  const formatted = formatTableText(table);
  const { row, col } = caretCell(text, table, pos);
  const target = cellRanges(formatted)[row]?.[col];
  const caret = target ? (target.empty ? target.pad : target.to) : 0;
  return single(table.from, table.to, formatted, table.from + caret);
}
// Tab / Shift+Tab / Enter inside a table: move between cells, adding a row when needed.
export function tableNavigate(text, pos, direction) {
  const table = findTable(text, pos);
  if (!table) return null;
  const { row: rowIndex, col: colIndex } = caretCell(text, table, pos);
  let rows = table.rows.map(r => [...r]);
  let r = rowIndex === 1 ? 2 : rowIndex, c = colIndex;
  if (direction === 'row') { r = rowIndex <= 1 ? 2 : rowIndex + 1; c = 0; if (r >= rows.length || rowIndex >= 2) rows.splice(r, 0, Array(table.columns).fill('')); }
  else if (direction > 0) { c++; if (c >= table.columns) { c = 0; r = r + 1 === 1 ? 2 : r + 1; } if (r >= rows.length) rows.push(Array(table.columns).fill('')); }
  else { c--; if (c < 0) { c = table.columns - 1; r = r - 1 === 1 ? 0 : r - 1; } if (r < 0) { r = 0; c = 0; } }
  const formatted = formatTableText({ ...table, rows });
  const target = cellRanges(formatted)[r][c];
  return target.empty ? single(table.from, table.to, formatted, table.from + target.pad) : single(table.from, table.to, formatted, table.from + target.from, table.from + target.to);
}
export function tableAddColumn(text, pos) {
  const table = findTable(text, pos);
  if (!table) return null;
  const rows = table.rows.map((row, i) => [...row, ...Array(table.columns - row.length).fill(''), i === 0 ? `列 ${table.columns + 1}` : i === 1 ? '---' : '']);
  const formatted = formatTableText({ ...table, rows, columns: table.columns + 1, aligns: [...table.aligns, ''] });
  const target = cellRanges(formatted)[0][table.columns];
  return single(table.from, table.to, formatted, table.from + target.from, table.from + target.to);
}
export function tableDeleteRow(text, pos) {
  const table = findTable(text, pos);
  if (!table) return null;
  const rowIndex = text.slice(table.from, pos).split('\n').length - 1;
  if (rowIndex <= 1) return null;
  const rows = table.rows.filter((_, i) => i !== rowIndex);
  const formatted = formatTableText({ ...table, rows });
  const lines = formatted.split('\n');
  const caret = table.from + lines.slice(0, Math.min(rowIndex, lines.length - 1)).join('\n').length + 3;
  return single(table.from, table.to, formatted, Math.min(caret, table.from + formatted.length));
}

// ——— Enter key ———
// block: { from, to, kind }. Returns a change set; `refresh: true` means block structure changed.
export function enter(text, block, sel, { shift = false } = {}) {
  let { from, to } = sel;
  const lineStart = lineStartAt(text, from), lineEnd = lineEndAt(text, to), line = text.slice(lineStart, lineEnd);
  const beforeCaret = text.slice(lineStart, from), afterCaret = text.slice(to, lineEnd);
  const kind = block?.kind || 'paragraph';
  const indentOf = l => /^[ \t]*/.exec(l)[0];
  if (['fence', 'codeBlock', 'math', 'frontMatter', 'html'].includes(kind)) {
    const lastLine = lineEnd >= block.to;
    // A freshly typed ```lang or $$ is an unterminated block: Enter adds the closing line.
    if ((kind === 'fence' || kind === 'math') && lineStart === block.from && from === lineEnd) {
      const blockLines = text.slice(block.from, block.to).split('\n');
      const opener = kind === 'fence' ? /^(\s*)(`{3,}|~{3,})/.exec(line) : /^(\s*)(\$\$)\s*$/.exec(line);
      const closed = blockLines.length > 1 && opener && new RegExp('^\\s*' + opener[2].replace(/\$/g, '\\$') + (kind === 'fence' ? opener[2][0] + '*' : '') + '\\s*$').test(blockLines.at(-1));
      if (opener && !closed) return { ...single(lineEnd, lineEnd, '\n' + opener[1] + '\n' + opener[1] + opener[2], lineEnd + 1 + opener[1].length), refresh: true };
    }
    if (kind === 'fence' && lastLine && /^\s*(`{3,}|~{3,})\s*$/.test(line) && lineStart !== block.from && from === lineEnd) return exitAfter(text, block);
    if (kind === 'math' && lastLine && /^\s*\$\$\s*$/.test(line) && lineStart !== block.from && from === lineEnd) return exitAfter(text, block);
    return { ...single(from, to, '\n' + indentOf(line), from + 1 + indentOf(line).length), refresh: false };
  }
  if (kind === 'table') {
    if (shift) return { ...single(from, to, '<br>', from + 4), refresh: false };
    const table = findTable(text, from);
    if (table) {
      const rowIndex = text.slice(table.from, from).split('\n').length - 1;
      if (rowIndex >= 2 && splitRow(line).every(c => !c)) {
        // Empty last row: leave the table.
        const cut = lineStart - 1;
        return { changes: [{ from: cut, to: lineEnd, insert: '\n\n' }], selection: { from: cut + 2, to: cut + 2 }, refresh: true };
      }
      const nav = tableNavigate(text, from, 'row');
      if (nav) return { ...nav, refresh: true };
    }
  }
  // Auto-close fences / math blocks typed into a paragraph: ```lang⏎ or $$⏎
  const fence = /^(\s*)(`{3,}|~{3,})([^`]*)$/.exec(line);
  if (!shift && fence && from === lineEnd && kind !== 'fence') {
    const insert = '\n' + fence[1] + '\n' + fence[1] + fence[2];
    return { ...single(lineEnd, lineEnd, insert, lineEnd + 1 + fence[1].length), refresh: true };
  }
  if (!shift && /^\s*\$\$\s*$/.test(line) && from === lineEnd && kind !== 'math') return { ...single(lineEnd, lineEnd, '\n\n$$', lineEnd + 1), refresh: true };
  // Table header typed as a row: | a | b |⏎ creates the delimiter row and a body row.
  if (!shift && kind === 'paragraph' && from === lineEnd && /^\s*\|.*\|\s*$/.test(line) && splitRow(line).length >= 2 && lineStart === block.from) {
    const n = splitRow(line).length, table = [line, '| ' + Array(n).fill('---').join(' | ') + ' |', '| ' + Array(n).fill('').join(' | ') + ' |'].join('\n');
    const formatted = formatTableText(findTable(table, 0));
    const target = cellRanges(formatted)[2][0];
    return { ...single(lineStart, lineEnd, formatted, lineStart + target.pad), refresh: true };
  }
  const list = /^(\s*(?:>\s?)*)(\s*)([-*+]|(\d{1,9})([.)]))(\s+)(\[[ xX]\]\s+)?/.exec(line);
  if (list && (kind === 'listItem' || kind === 'blockquote')) {
    const [marker, quote, indent, bullet, number, delim, space, task] = list;
    if (!line.slice(marker.length).trim() && !afterCaret.trim() && !shift) {
      // Empty item: outdent one level, or leave the list.
      if (indent.length > 0) { const unit = listUnit(text, lineStart), outdented = quote + indent.slice(Math.min(unit, indent.length)) + line.slice(quote.length + indent.length); return { ...single(lineStart, lineEnd, outdented, lineStart + outdented.length), refresh: true }; }
      return { changes: [{ from: lineStart, to: lineEnd, insert: quote.trimEnd() ? quote : '' }], selection: { from: lineStart + (quote.trimEnd() ? quote.length : 0), to: lineStart + (quote.trimEnd() ? quote.length : 0) }, refresh: true, blankAt: true };
    }
    if (shift) { const cont = quote + indent + ' '.repeat(bullet.length + space.length); return { ...single(from, to, '  \n' + cont, from + 3 + cont.length), refresh: false }; }
    const nextMarker = number ? String(Number(number) + 1) + delim : bullet;
    const insert = '\n' + quote + indent + nextMarker + space + (task ? '[ ] ' : '');
    return { ...single(from, to, insert, from + insert.length), refresh: true };
  }
  const quoteMatch = /^(\s*(?:>\s?)+)/.exec(line);
  if (quoteMatch && kind === 'blockquote') {
    if (!line.slice(quoteMatch[1].length).trim() && !shift) return { changes: [{ from: lineStart, to: lineEnd, insert: '' }], selection: { from: lineStart, to: lineStart }, refresh: true, blankAt: true };
    return { ...single(from, to, (shift ? '  ' : '') + '\n' + quoteMatch[1], from + (shift ? 3 : 1) + quoteMatch[1].length), refresh: false };
  }
  if (shift) return { ...single(from, to, '  \n', from + 3), refresh: false };
  // Heading or paragraph: split into a new paragraph (Typora-style Enter).
  const heading = /^(\s{0,3}#{1,6}\s+)/.exec(line);
  if (heading && from <= lineStart + heading[1].length && to <= lineStart + heading[1].length) {
    // Caret before heading text: insert an empty paragraph above.
    return { changes: [{ from: lineStart, to: lineStart, insert: '\n\n' }], selection: { from: lineStart, to: lineStart }, refresh: true, blankAt: true };
  }
  const rest = text.slice(to).replace(/^[ \t]+/, '');
  const skip = text.slice(to).length - rest.length;
  const insert = '\n\n';
  return { changes: [{ from, to: to + (afterCaret.trim() ? skip : 0), insert }], selection: { from: from + 2, to: from + 2 }, refresh: true, blankAt: !afterCaret.trim() };
}
// Leaves a block into a fresh (not yet written) paragraph right after it; the editor inserts
// the separating blank line only once the user types.
function exitAfter(text, block) {
  return { changes: [], selection: { from: block.to, to: block.to }, refresh: true, paragraphAfter: block.to };
}
export { exitAfter };

// ——— Indentation inside lists / code ———
export function indentLines(text, sel, outdent, unitFor) {
  return replaceLines(text, sel, lines => lines.map((l, i) => {
    const unit = unitFor(l, i);
    if (!outdent) return ' '.repeat(unit) + l;
    const lead = /^ */.exec(l)[0].length;
    return l.slice(Math.min(lead, unit));
  }));
}
export function listUnit(text, pos) {
  // Width of the parent marker ("- " = 2, "10. " = 4) so nested items line up with its text.
  let start = lineStartAt(text, pos);
  const current = /^(\s*)/.exec(text.slice(start, lineEndAt(text, pos)))[1].length;
  while (start > 0) {
    start = lineStartAt(text, start - 1);
    const l = text.slice(start, lineEndAt(text, start));
    const m = /^(\s*)([-*+]|\d{1,9}[.)])(\s+)/.exec(l);
    if (m && m[1].length <= current) return m[2].length + m[3].length;
    if (!l.trim()) continue;
  }
  return 2;
}

// ——— Task checkboxes ———
export function toggleTask(text, block, index) {
  const re = /^(\s*(?:>\s?)*\s*(?:[-*+]|\d{1,9}[.)])\s+)\[([ xX])\](?=\s|$)/gm;
  const src = text.slice(block.from, block.to);
  let m, n = 0;
  while ((m = re.exec(src))) {
    if (n++ === index) { const at = block.from + m.index + m[1].length + 1; return single(at, at + 1, m[2] === ' ' ? 'x' : ' ', at, at); }
  }
  return null;
}

// ——— Search ———
export function findMatches(text, { query, regex = false, caseSensitive = false, wholeWord = false }, limit = 20000) {
  if (!query) return [];
  let pattern;
  try { pattern = new RegExp((wholeWord ? '(?<![\\p{L}\\p{N}_])' : '') + (regex ? `(?:${query})` : query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')) + (wholeWord ? '(?![\\p{L}\\p{N}_])' : ''), 'gu' + (caseSensitive ? '' : 'i') + (regex ? 'm' : '')); }
  catch (error) { return { error: '正则表达式无效：' + error.message }; }
  const matches = [];
  for (let m; (m = pattern.exec(text)) && matches.length < limit;) {
    if (m[0].length === 0) { pattern.lastIndex++; continue; }
    matches.push({ from: m.index, to: m.index + m[0].length, groups: m });
  }
  return matches;
}
export function expandReplacement(match, replacement, regex) {
  if (!regex) return replacement;
  return replacement.replace(/\$(\$|&|\d{1,2}|<[^>]+>)/g, (all, key) => key === '$' ? '$' : key === '&' ? match.groups[0] : key.startsWith('<') ? (match.groups.groups?.[key.slice(1, -1)] ?? '') : (match.groups[Number(key)] ?? ''));
}

// ——— Statistics ———
const CJK = /[㐀-䶿一-鿿豈-﫿぀-ヿ가-힣]/g;
export function countWords(text) {
  const cjk = (text.match(CJK) || []).length;
  const words = (text.replace(CJK, ' ').match(/[\p{L}\p{N}]+(?:['’\-][\p{L}\p{N}]+)*/gu) || []).length;
  return { words: cjk + words, characters: text.replace(/\s/g, '').length, lines: text ? text.split('\n').length : 0 };
}

// ════════════════════════════════════════════════════════════════════════════════════════
// Typora command set (pure text transformations, same contract as above)
// ════════════════════════════════════════════════════════════════════════════════════════

// ——— More inline formats ———
// Wraps / unwraps the selection in an opening and closing string (<u>…</u>, <!-- … -->).
export function toggleWrap(text, { from, to }, open, close) {
  const ol = open.length, cl = close.length;
  if (from === to) {
    if (text.slice(from - ol, from) === open && text.slice(from, from + cl) === close) return { changes: [{ from: from - ol, to: from + cl, insert: '' }], selection: { from: from - ol, to: from - ol } };
    return single(from, to, open + close, from + ol);
  }
  if (text.slice(from - ol, from) === open && text.slice(to, to + cl) === close) return { changes: [{ from: from - ol, to: from, insert: '' }, { from: to, to: to + cl, insert: '' }], selection: { from: from - ol, to: to - ol } };
  const selected = text.slice(from, to);
  if (selected.length >= ol + cl && selected.startsWith(open) && selected.endsWith(close)) return single(from, to, selected.slice(ol, selected.length - cl), from, to - ol - cl);
  return single(from, to, open + selected + close, from + ol, from + ol + selected.length);
}
// ~sub~ and ^sup^ never touch the double markers of ~~strike~~.
export function toggleScript(text, sel, marker) {
  const { from, to } = sel;
  if (marker === '~' && (text.slice(from - 2, from) === '~~' || text.slice(to, to + 2) === '~~')) {
    const selected = text.slice(from, to);
    return single(from, to, `~${selected}~`, from + 1, from + 1 + selected.length);
  }
  const selected = text.slice(from, to);
  if (selected && /\s/.test(selected)) return null; // sub/sup content cannot contain whitespace
  return toggleInline(text, sel, marker);
}
const STRIP = [
  [/\[([^\]]*)\]\([^)]*\)/g, '$1'], [/\[([^\]]+)\]\[[^\]]*\]/g, '$1'],
  [/(\*\*|__)(?=\S)([\s\S]*?\S)\1/g, '$2'], [/~~(?=\S)([\s\S]*?\S)~~/g, '$1'], [/==(?=\S)([\s\S]*?\S)==/g, '$1'],
  [/(?<![\w*])\*(?=[^\s*])([^*]*?[^\s*])\*(?!\*)/g, '$1'], [/(?<![\w_])_(?=\S)([^_]*?\S)_(?![\w_])/g, '$1'],
  [/`([^`]+)`/g, '$1'], [/(?<!~)~([^\s~]+)~(?!~)/g, '$1'], [/\^([^\s^]+)\^/g, '$1'], [/<\/?(?:u|mark|sub|sup|b|i|strong|em|s|del|ins)>/gi, ''],
];
export function clearFormatText(value) {
  let out = value;
  for (let pass = 0; pass < 3; pass++) { const before = out; for (const [re, rep] of STRIP) out = out.replace(re, rep); if (out === before) break; }
  return out;
}
export function clearFormat(text, sel) {
  let { from, to } = sel;
  if (from === to) { from = lineStartAt(text, from); to = lineEndAt(text, to); }
  const selected = text.slice(from, to), cleaned = clearFormatText(selected);
  return cleaned === selected ? null : single(from, to, cleaned, from, from + cleaned.length);
}

// ——— Extra block inserts ———
export function insertToc(text, sel) { return insertBlock(text, sel, '[TOC]', 5); }
export function insertFrontMatter(text) {
  if (/^---\r?\n[\s\S]*?\r?\n(?:---|\.\.\.)[ \t]*(?:\r?\n|$)/.test(text)) return { changes: [], selection: { from: 4, to: 4 } };
  return single(0, 0, '---\ntitle: \n---\n\n', 11);
}
export const ALERTS = ['NOTE', 'TIP', 'IMPORTANT', 'WARNING', 'CAUTION'];
export function insertAlert(text, sel, type = 'NOTE') {
  const kind = type.toUpperCase();
  if (sel.from !== sel.to) {
    const start = lineStartAt(text, sel.from), end = lineEndAt(text, sel.to - (sel.to > sel.from && text[sel.to - 1] === '\n' ? 1 : 0));
    const body = text.slice(start, end).split('\n').map(l => '> ' + l).join('\n');
    const insert = `> [!${kind}]\n${body}`;
    return single(start, end, insert, start + insert.length);
  }
  const snippet = `> [!${kind}]\n> `;
  return insertBlock(text, sel, snippet, snippet.length);
}
export function nextFootnoteLabel(text) {
  const nums = [...text.matchAll(/\[\^(\d+)\]/g)].map(m => Number(m[1]));
  return String((nums.length ? Math.max(...nums) : 0) + 1);
}
export function insertFootnote(text, { from, to }) {
  const label = nextFootnoteLabel(text), ref = `[^${label}]`;
  const gap = text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n';
  const def = `${gap}[^${label}]: `;
  const caret = text.length + ref.length - (to - from) + def.length;
  if (to === text.length) return { changes: [{ from: to, to, insert: ref + def }], selection: { from: caret, to: caret } };
  return { changes: [{ from: to, to, insert: ref }, { from: text.length, to: text.length, insert: def }], selection: { from: caret, to: caret } };
}
export function insertLinkReference(text, { from, to }) {
  const selected = text.slice(from, to) || '链接文字';
  let n = 1; while (new RegExp(`^\\[${n}\\]:`, 'm').test(text)) n++;
  const gap = text.endsWith('\n\n') ? '' : text.endsWith('\n') ? '\n' : '\n\n', def = `${gap}[${n}]: `;
  const insert = `[${selected}][${n}]`, caret = text.length + insert.length - (to - from) + def.length;
  if (to === text.length) return { changes: [{ from, to, insert: insert + def }], selection: { from: caret, to: caret } };
  return { changes: [{ from, to, insert }, { from: text.length, to: text.length, insert: def }], selection: { from: caret, to: caret } };
}
export function insertHtmlSnippet(text, sel, html) { return insertBlock(text, sel, html, html.length); }

// ——— Headings & tasks ———
export function shiftHeading(text, sel, delta) {
  const line = text.slice(lineStartAt(text, sel.from), lineEndAt(text, sel.from));
  const m = /^\s{0,3}(#{1,6})(?:\s|$)/.exec(line), level = m ? m[1].length : 0;
  const next = delta > 0 ? (level === 0 ? 6 : Math.max(1, level - 1)) : (level === 0 ? 0 : level === 6 ? 0 : level + 1);
  return next === level ? null : setHeading(text, sel, next === 0 ? level : next) && (next === 0 ? setHeading(text, sel, level) : setHeading(text, sel, next));
}
export function setTaskStatus(text, sel, mode) { // mode: 'toggle' | 'complete' | 'incomplete'
  const { start, end, lines } = linesIn(text, sel);
  let changed = false;
  const out = lines.map(l => l.replace(/^(\s*(?:>\s?)*\s*(?:[-*+]|\d{1,9}[.)])\s+)\[([ xX])\](?=\s|$)/, (all, lead, mark) => {
    const on = mode === 'toggle' ? mark === ' ' : mode === 'complete';
    if (on === (mark !== ' ')) return all;
    changed = true; return `${lead}[${on ? 'x' : ' '}]`;
  }));
  if (!changed) return null;
  const insert = out.join('\n');
  return single(start, end, insert, sel.from, sel.to + (insert.length - (end - start)));
}
export function indentSelection(text, sel, outdent) {
  const rows = linesIn(text, sel).lines;
  const inList = rows.every(l => !l.trim() || LIST.test(l));
  const unit = pos => (inList ? listUnit(text, pos) : 4);
  const { start } = linesIn(text, sel);
  let offset = start;
  return indentLines(text, sel, outdent, (l, i) => { const u = unit(offset); offset += l.length + 1; return u; });
}

// ——— Table editing ———
function tableContext(text, pos) {
  const table = findTable(text, pos);
  if (!table) return null;
  const { row, col } = caretCell(text, table, pos);
  return { table, row, col, rows: table.rows.map(r => [...r, ...Array(table.columns - r.length).fill('')]), aligns: [...table.aligns, ...Array(Math.max(0, table.columns - table.aligns.length)).fill('')] };
}
function tableResult(ctx, rows, aligns, r, c) {
  const columns = Math.max(...rows.map(x => x.length));
  const table = { ...ctx.table, rows, aligns, columns };
  const formatted = formatTableText(table);
  const target = cellRanges(formatted)[Math.max(0, Math.min(r, rows.length - 1))]?.[Math.max(0, Math.min(c, columns - 1))];
  const caret = target ? (target.empty ? target.pad : target.from) : 0;
  return single(ctx.table.from, ctx.table.to, formatted, ctx.table.from + caret, target && !target.empty ? ctx.table.from + target.to : ctx.table.from + caret);
}
const blankRow = n => Array(n).fill('');
export function tableEdit(text, pos, op, arg) {
  const ctx = tableContext(text, pos);
  if (!ctx) return null;
  const { table, row, col } = ctx, rows = ctx.rows.map(r => [...r]), aligns = [...ctx.aligns], n = table.columns;
  const bodyRow = Math.max(2, row);
  switch (op) {
    case 'rowAbove': { const at = row <= 2 ? 2 : row; rows.splice(at, 0, blankRow(n)); return tableResult(ctx, rows, aligns, at, col); }
    case 'rowBelow': { const at = row <= 1 ? 2 : row + 1; rows.splice(at, 0, blankRow(n)); return tableResult(ctx, rows, aligns, at, col); }
    case 'deleteRow': { if (row <= 1 || rows.length <= 3) return null; rows.splice(row, 1); return tableResult(ctx, rows, aligns, Math.min(row, rows.length - 1), col); }
    case 'colBefore': case 'colAfter': {
      const at = op === 'colBefore' ? col : col + 1;
      rows.forEach((r, i) => r.splice(at, 0, i === 0 ? `列 ${n + 1}` : i === 1 ? '---' : ''));
      aligns.splice(at, 0, ''); return tableResult(ctx, rows, aligns, row === 1 ? 0 : row, at);
    }
    case 'deleteCol': { if (n <= 1) return null; rows.forEach(r => r.splice(col, 1)); aligns.splice(col, 1); return tableResult(ctx, rows, aligns, row, Math.min(col, n - 2)); }
    case 'rowUp': case 'rowDown': {
      const to = op === 'rowUp' ? bodyRow - 1 : bodyRow + 1;
      if (row <= 1 || to < 2 || to >= rows.length) return null;
      [rows[bodyRow], rows[to]] = [rows[to], rows[bodyRow]]; return tableResult(ctx, rows, aligns, to, col);
    }
    case 'colLeft': case 'colRight': {
      const to = op === 'colLeft' ? col - 1 : col + 1;
      if (to < 0 || to >= n) return null;
      rows.forEach(r => { [r[col], r[to]] = [r[to], r[col]]; }); [aligns[col], aligns[to]] = [aligns[to], aligns[col]];
      return tableResult(ctx, rows, aligns, row, to);
    }
    case 'align': { aligns[col] = arg || ''; return tableResult(ctx, rows, aligns, row, col); }
    case 'resize': {
      const [wantRows, wantCols] = arg; // body rows, columns
      const cols = Math.max(1, Math.min(60, wantCols | 0)), bodies = Math.max(1, Math.min(500, wantRows | 0));
      const next = rows.map((r, i) => { const c = r.slice(0, cols); while (c.length < cols) c.push(i === 0 ? `列 ${c.length + 1}` : i === 1 ? '---' : ''); return c; });
      const head = next.slice(0, 2); let body = next.slice(2, 2 + bodies); while (body.length < bodies) body.push(blankRow(cols));
      const al = aligns.slice(0, cols); while (al.length < cols) al.push('');
      return tableResult(ctx, [...head, ...body], al, Math.min(row, bodies + 1), Math.min(col, cols - 1));
    }
    case 'delete': {
      let from = table.from, to = table.to;
      if (text[to] === '\n' && text[to + 1] === '\n') to += 2; else if (text[to] === '\n') to += 1; else if (text[from - 1] === '\n' && text[from - 2] === '\n') from -= 1;
      return { changes: [{ from, to, insert: '' }], selection: { from, to: from } };
    }
    case 'format': return tableResult(ctx, rows, aligns, row, col);
    default: return null;
  }
}
export function tableMarkdown(text, pos) { const t = findTable(text, pos); return t ? formatTableText(t) : null; }
export function tableInfo(text, pos) { const c = tableContext(text, pos); return c && { rows: c.table.rows.length - 1, columns: c.table.columns, row: c.row, col: c.col, align: c.aligns[c.col] || '' }; }

// ——— Semantic selection (word / line-or-sentence / styled scope) ———
const segmenter = typeof Intl !== 'undefined' && Intl.Segmenter ? new Intl.Segmenter('zh', { granularity: 'word' }) : null;
export function wordRange(text, pos) {
  const start = lineStartAt(text, pos), end = lineEndAt(text, pos), line = text.slice(start, end), at = pos - start;
  if (segmenter) {
    for (const part of segmenter.segment(line)) {
      const a = part.index, b = a + part.segment.length;
      if (at >= a && at <= b && part.isWordLike) return { from: start + a, to: start + b };
    }
    for (const part of segmenter.segment(line)) { const a = part.index, b = a + part.segment.length; if (at > a && at < b) return { from: start + a, to: start + b }; }
    return { from: pos, to: pos };
  }
  const re = /[\p{L}\p{N}_]+/gu;
  for (let m; (m = re.exec(line));) if (at >= m.index && at <= m.index + m[0].length) return { from: start + m.index, to: start + m.index + m[0].length };
  return { from: pos, to: pos };
}
export function lineRange(text, pos) {
  const start = lineStartAt(text, pos), end = lineEndAt(text, pos), line = text.slice(start, end);
  const lead = /^\s*(?:>\s?)*(?:(?:[-*+]|\d{1,9}[.)])\s+(?:\[[ xX]\]\s+)?|#{1,6}\s+)?/.exec(line)[0].length;
  // Sentence inside the line
  const at = pos - start, bounds = [lead];
  const re = /[^。！？!?；;.]+[。！？!?；;.]*[”’"')\]）】]*\s*/g;
  const sentences = [];
  for (let m; (m = re.exec(line.slice(lead)));) sentences.push([lead + m.index, lead + m.index + m[0].length]);
  const hit = sentences.find(([a, b]) => at >= a && at <= b) || [lead, line.length];
  const [a, b] = sentences.length > 1 ? hit : [lead, line.length];
  return { from: start + a, to: start + Math.max(a, b - (/\s$/.test(line.slice(a, b)) ? line.slice(a, b).length - line.slice(a, b).trimEnd().length : 0)) };
}
const SCOPES = [
  [/`([^`\n]+)`/g, 1], [/\$\$([^$\n]+)\$\$/g, 2], [/\$(?![\s$])([^$\n]*?[^\s\\])\$/g, 1], [/\*\*(?=\S)([^\n]*?\S)\*\*/g, 2], [/__(?=\S)([^\n]*?\S)__/g, 2], [/~~(?=\S)([^\n]*?\S)~~/g, 2], [/==(?=\S)([^\n]*?\S)==/g, 2],
  [/<u>([^\n]*?)<\/u>/g, 3], [/(?<![\w*])\*(?=[^\s*])([^*\n]*?[^\s*])\*(?!\*)/g, 1], [/(?<![\w_])_(?=\S)([^_\n]*?\S)_(?![\w_])/g, 1], [/!?\[([^\]\n]*)\]\([^)\n]*\)/g, 'link'],
];
export function styledScopeRange(text, pos) {
  const start = lineStartAt(text, pos), end = lineEndAt(text, pos), line = text.slice(start, end), at = pos - start;
  let best = null;
  for (const [re, m] of SCOPES) {
    const rx = new RegExp(re.source, 'g');
    for (let x; (x = rx.exec(line));) {
      if (at < x.index || at > x.index + x[0].length) continue;
      const inner = x[1] ?? '', open = m === 'link' ? x[0].indexOf('[') + 1 : m === 3 ? 3 : m;
      const range = { from: x.index + open, to: x.index + open + inner.length, size: x[0].length };
      if (!best || range.size < best.size) best = range;
    }
  }
  return best ? { from: start + best.from, to: start + best.to } : wordRange(text, pos);
}
export function deleteRange(text, range) {
  return range.from === range.to ? null : { changes: [{ from: range.from, to: range.to, insert: '' }], selection: { from: range.from, to: range.from } };
}

// ——— Code tools ———
export function fenceBody(text, block) {
  const src = text.slice(block.from, block.to), lines = src.split('\n');
  const info = /^\s*(`{3,}|~{3,})\s*([^\s`]*)/.exec(lines[0]);
  if (!info) return null;
  const closed = lines.length > 1 && /^\s*(`{3,}|~{3,})\s*$/.test(lines.at(-1));
  const from = block.from + lines[0].length + 1, to = closed ? block.to - lines.at(-1).length - 1 : block.to;
  return { from: Math.min(from, block.to), to: Math.max(Math.min(from, block.to), to), lang: info[2].toLowerCase() };
}
export function reindentCode(code, lang = '') {
  const lines = code.replace(/\t/g, '    ').split('\n');
  const common = Math.min(...lines.filter(l => l.trim()).map(l => /^ */.exec(l)[0].length), Infinity);
  const dedented = lines.map(l => l.slice(Math.min(common === Infinity ? 0 : common, /^ */.exec(l)[0].length)));
  if (/^(py|python|yaml|yml|makefile|make|diff|text|plaintext|markdown|md)$/.test(lang)) return dedented.join('\n');
  const unit = ' '.repeat(/^(ya?ml|json|html|xml|css|scss|less|js|javascript|ts|typescript|jsx|tsx|vue)$/.test(lang) ? 2 : 4);
  let depth = 0;
  return dedented.map(l => {
    const t = l.trim();
    if (!t) return '';
    const stripped = t.replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|`(?:\\.|[^`\\])*`|\/\/.*$|#.*$/g, '');
    const lead = /^[)}\]]+/.exec(stripped)?.[0].length || 0;
    const indent = Math.max(0, depth - lead);
    const opens = (stripped.match(/[({[]/g) || []).length, closes = (stripped.match(/[)}\]]/g) || []).length;
    depth = Math.max(0, depth + opens - closes);
    return unit.repeat(indent) + t;
  }).join('\n');
}
export function autoIndentCode(text, block, sel, whole) {
  const body = fenceBody(text, block);
  if (!body) return null;
  let from = body.from, to = body.to;
  if (!whole && sel.from !== sel.to && sel.from >= body.from && sel.to <= body.to) { from = lineStartAt(text, sel.from); to = lineEndAt(text, sel.to); }
  const code = text.slice(from, to), next = reindentCode(code, body.lang);
  return next === code ? null : single(from, to, next, from, from + next.length);
}

// ——— Blocks ———
export function insertParagraphBefore(block) { return { changes: [{ from: block.from, to: block.from, insert: '\n\n' }], selection: { from: block.from, to: block.from } }; }
export function deleteBlockRange(text, block) {
  let from = block.from, to = block.to;
  if (text.slice(to, to + 2) === '\n\n') to += 2; else if (text[to] === '\n') to += 1;
  else if (from >= 2 && text.slice(from - 2, from) === '\n\n') from -= 2;
  else if (text[from - 1] === '\n') from -= 1;
  return { changes: [{ from, to, insert: '' }], selection: { from, to: from } };
}

// ——— HTML clipboard / conversion helpers ———
export const escapeMarkdown = value => String(value).replace(/([\\`*_{}[\]<>|])/g, '\\$1');
