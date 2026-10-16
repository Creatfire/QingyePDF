// Fenced code blocks edited in place with CodeMirror 6: the code's own syntax colouring (nested in
// the Markdown fence), auto-indent on Enter, bracket matching / closing and Tab indentation. The
// whole block source (fence lines included) is the CodeMirror document; editor.mjs keeps the
// Markdown text and the undo history (no CodeMirror history here, Ctrl+Z reaches editor.mjs).
import { EditorState, EditorView, keymap, drawSelection, highlightSpecialChars, defaultKeymap, insertNewlineAndIndent, indentMore, indentLess, syntaxHighlighting, HighlightStyle, indentOnInput, bracketMatching, StreamLanguage, indentUnit, closeBrackets, closeBracketsKeymap, markdown, markdownLanguage, tags, javascript, python, css, html, json, cpp, java, rust, sql, xml, go, yaml, shell, powerShell, ruby, lua, toml, dockerFile, diff, csharp, kotlin, dart, swift } from '../../vendor/codemirror/qingye-codemirror.mjs';

const legacy = mode => () => StreamLanguage.define(mode);
const LANGUAGES = [
  [['js', 'javascript', 'jsx', 'mjs', 'cjs', 'node'], () => javascript({ jsx: true })],
  [['ts', 'typescript', 'tsx', 'mts', 'cts'], () => javascript({ typescript: true, jsx: true })],
  [['py', 'python', 'python3', 'py3'], python],
  [['css', 'scss', 'less'], css],
  [['html', 'htm', 'vue', 'svelte', 'xhtml'], html],
  [['json', 'jsonc', 'json5', 'geojson'], json],
  [['c', 'h', 'cpp', 'c++', 'cc', 'cxx', 'hpp', 'hxx', 'objc', 'cuda'], cpp],
  [['java'], java],
  [['rust', 'rs'], rust],
  [['sql', 'mysql', 'postgres', 'postgresql', 'pgsql', 'sqlite', 'plsql'], sql],
  [['xml', 'svg', 'xaml', 'plist', 'xsl', 'rss'], xml],
  [['go', 'golang'], go],
  [['yaml', 'yml'], yaml],
  [['sh', 'bash', 'shell', 'zsh', 'console', 'shellscript', 'shell-session'], legacy(shell)],
  [['ps', 'ps1', 'powershell', 'pwsh'], legacy(powerShell)],
  [['rb', 'ruby'], legacy(ruby)],
  [['lua'], legacy(lua)],
  [['toml', 'ini', 'cfg'], legacy(toml)],
  [['dockerfile', 'docker'], legacy(dockerFile)],
  [['diff', 'patch'], legacy(diff)],
  [['cs', 'csharp', 'c#'], legacy(csharp)],
  [['kt', 'kotlin', 'kts'], legacy(kotlin)],
  [['dart'], legacy(dart)],
  [['swift'], legacy(swift)],
];
const BY_NAME = new Map(LANGUAGES.flatMap(([names, make]) => names.map(n => [n, make])));
const cache = new Map();

// "```python {.numberLines}" → the CodeMirror Language for python, or null for plain text.
export function languageName(info) {
  const word = String(info || '').trim().split(/[\s{,]/)[0].replace(/^\./, '').toLowerCase();
  return BY_NAME.has(word) ? word : '';
}
export function codeLanguage(info) {
  const name = languageName(info);
  if (!name) return null;
  if (!cache.has(name)) { const made = BY_NAME.get(name)(); cache.set(name, made.language || made); }
  return cache.get(name);
}
export const supportedLanguages = () => LANGUAGES.map(([names]) => names[0]);

// Same palette as the source mode, but code text keeps the ink colour (no "inline code" tint).
const fenceStyle = HighlightStyle.define([
  { tag: [tags.processingInstruction, tags.meta, tags.contentSeparator], color: 'var(--faint, #8a948f)' },
  { tag: [tags.keyword, tags.typeName, tags.modifier, tags.controlKeyword, tags.operatorKeyword], color: '#7c4dff' },
  { tag: [tags.string, tags.special(tags.string), tags.character], color: '#2e7d32' },
  { tag: tags.comment, color: 'var(--faint, #8a948f)', fontStyle: 'italic' },
  { tag: [tags.number, tags.bool, tags.null, tags.atom], color: '#d84315' },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName), tags.macroName], color: '#1565c0' },
  { tag: [tags.className, tags.definition(tags.typeName), tags.tagName, tags.namespace], color: '#00838f' },
  { tag: [tags.attributeName, tags.propertyName, tags.labelName], color: '#8d6e00' },
  { tag: [tags.regexp, tags.escape], color: '#c2185b' },
  { tag: [tags.inserted], color: '#2e7d32' }, { tag: [tags.deleted], color: '#c62828' },
  { tag: tags.heading, fontWeight: '700' }, { tag: tags.link, textDecoration: 'underline' },
]);

// Tab: indent the selected lines, or insert four spaces at the caret (Typora).
const tab = view => {
  if (view.state.selection.ranges.some(r => !r.empty)) return indentMore(view);
  view.dispatch(view.state.replaceSelection('    '), { scrollIntoView: true, userEvent: 'input' });
  return true;
};

export class FenceEditor {
  constructor({ text = '', label = '正在编辑代码块，Esc 结束编辑', onInput, onSelection } = {}) {
    this.silent = false;
    this.view = new EditorView({
      state: EditorState.create({ doc: text, extensions: [
        highlightSpecialChars(), drawSelection(), bracketMatching(), closeBrackets(), indentOnInput(),
        indentUnit.of('    '), EditorState.tabSize.of(4),
        markdown({ base: markdownLanguage, codeLanguages: codeLanguage, addKeymap: false }), syntaxHighlighting(fenceStyle),
        keymap.of([...closeBracketsKeymap, { key: 'Enter', run: insertNewlineAndIndent }, { key: 'Tab', run: tab, shift: indentLess }, ...defaultKeymap]),
        EditorView.contentAttributes.of({ spellcheck: 'false', autocorrect: 'off', autocapitalize: 'off', 'aria-label': label }),
        EditorView.updateListener.of(update => {
          if (update.docChanged && !this.silent) onInput?.();
          if (update.selectionSet && !this.silent) onSelection?.();
        }),
      ] }),
    });
    this.dom = document.createElement('div');
    this.dom.className = 'mdSource mdFenceEditor'; this.dom.dataset.kind = 'fence';
    this.dom.fenceEditor = this; this.dom.append(this.view.dom);
  }
  get value() { return this.view.state.doc.toString(); }
  // Programmatic updates (undo, commands) stay silent and keep the caret where it was.
  set value(text) {
    text = String(text ?? '');
    if (text === this.value) return;
    const sel = this.view.state.selection.main, len = text.length;
    this.silent = true;
    try { this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text }, selection: { anchor: Math.min(sel.anchor, len), head: Math.min(sel.head, len) } }); }
    finally { this.silent = false; }
  }
  get from() { return this.view.state.selection.main.from; }
  get to() { return this.view.state.selection.main.to; }
  select(from, to = from, scroll = false) {
    const len = this.view.state.doc.length, a = Math.max(0, Math.min(from, len)), b = Math.max(0, Math.min(to, len));
    this.silent = true;
    try { this.view.dispatch({ selection: { anchor: a, head: b }, scrollIntoView: scroll }); }
    finally { this.silent = false; }
  }
  focus() { this.view.focus(); }
  get hasFocus() { return this.view.hasFocus; }
  // Caret on the first / last logical line (arrow keys leave the block there).
  get onFirstLine() { const s = this.view.state; return s.selection.main.empty && s.doc.lineAt(s.selection.main.head).number === 1; }
  get onLastLine() { const s = this.view.state; return s.selection.main.empty && s.doc.lineAt(s.selection.main.head).number === s.doc.lines; }
  posAtDOM(node, offset) { try { return this.view.posAtDOM(node, offset); } catch { return null; } }
  destroy() { this.view.destroy(); }
}
