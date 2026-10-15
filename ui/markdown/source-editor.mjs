// Markdown source mode on CodeMirror 6 (Typora's source view): syntax colouring, soft wrap, active
// line, bracket matching and optional line numbers. The object mimics the part of the
// HTMLTextAreaElement API the editor uses (value, selectionStart/End, setSelectionRange,
// setRangeText, select, focus, scrollTop…), so editor.mjs keeps one code path. Undo stays with the
// editor's own history: CodeMirror has no history extension here and Ctrl+Z reaches editor.mjs.
import { EditorState, Compartment, EditorView, keymap, drawSelection, highlightActiveLine, lineNumbers, highlightSpecialChars, defaultKeymap, syntaxHighlighting, HighlightStyle, bracketMatching, markdown, markdownLanguage, tags } from '../../vendor/codemirror/qingye-codemirror.mjs';

const style = HighlightStyle.define([
  { tag: tags.heading, fontWeight: '700', color: 'var(--md-cm-heading, var(--accent))' },
  { tag: tags.strong, fontWeight: '700' },
  { tag: tags.emphasis, fontStyle: 'italic' },
  { tag: tags.strikethrough, textDecoration: 'line-through' },
  { tag: [tags.link, tags.url], color: 'var(--md-cm-link, var(--accent))' },
  { tag: [tags.monospace, tags.literal], fontFamily: 'var(--mono, Consolas, monospace)', color: 'var(--md-cm-code, #b0436a)' },
  { tag: [tags.processingInstruction, tags.meta, tags.punctuation, tags.contentSeparator], color: 'var(--faint, #8a948f)' },
  { tag: tags.quote, color: 'var(--muted, #5f7168)' },
  { tag: tags.list, color: 'var(--accent)' },
  { tag: [tags.keyword, tags.typeName], color: '#7c4dff' },
  { tag: [tags.string, tags.special(tags.string)], color: '#2e7d32' },
  { tag: tags.comment, color: 'var(--faint, #8a948f)', fontStyle: 'italic' },
  { tag: tags.number, color: '#d84315' },
]);

export class SourceEditor extends EventTarget {
  constructor({ lineNumbers: numbers = false } = {}) {
    super();
    this.gutter = new Compartment(); this.editable = new Compartment(); this.spell = new Compartment();
    this.silent = false;
    const self = this;
    this.view = new EditorView({
      state: EditorState.create({ doc: '', extensions: [
        this.gutter.of(numbers ? lineNumbers() : []), highlightSpecialChars(), drawSelection(), highlightActiveLine(), bracketMatching(),
        EditorView.lineWrapping, markdown({ base: markdownLanguage }), syntaxHighlighting(style),
        keymap.of(defaultKeymap), // Tab inserts four spaces via editor.mjs, as in the textarea version this.editable.of(EditorView.editable.of(true)),
        this.spell.of(EditorView.contentAttributes.of({ spellcheck: 'false', 'aria-label': 'Markdown 源代码' })),
        // User edits surface as an 'input' event, like a textarea; programmatic `value =` stays silent.
        EditorView.updateListener.of(update => { if (update.docChanged && !self.silent) self.dom.dispatchEvent(new Event('input', { bubbles: true })); if (update.selectionSet) document.dispatchEvent(new Event('selectionchange')); }),
      ] }),
    });
    // CodeMirror's base theme forces position: relative on .cm-editor, so a wrapper takes the
    // textarea's place (absolutely positioned) and the editor fills it.
    this.dom = document.createElement('div'); this.dom.className = 'mdSourceView'; this.dom.sourceEditor = this; this.dom.append(this.view.dom);
    this.className = 'mdSourceView';
  }
  // ——— textarea-compatible surface ———
  get value() { return this.view.state.doc.toString(); }
  set value(text) {
    text = String(text ?? '');
    if (text === this.value) return;
    const sel = this.view.state.selection.main;
    this.silent = true;
    try { this.view.dispatch({ changes: { from: 0, to: this.view.state.doc.length, insert: text }, selection: { anchor: Math.min(sel.anchor, text.length), head: Math.min(sel.head, text.length) } }); }
    finally { this.silent = false; }
  }
  get selectionStart() { return this.view.state.selection.main.from; }
  get selectionEnd() { return this.view.state.selection.main.to; }
  setSelectionRange(from, to = from) {
    const len = this.view.state.doc.length, a = Math.max(0, Math.min(from, len)), b = Math.max(0, Math.min(to, len));
    this.view.dispatch({ selection: { anchor: a, head: b }, scrollIntoView: true });
  }
  // Like HTMLTextAreaElement.setRangeText(text, start, end, mode); counts as a user edit.
  setRangeText(text, start = this.selectionStart, end = this.selectionEnd, mode = 'preserve') {
    const caret = mode === 'start' ? start : mode === 'end' ? start + text.length : mode === 'select' ? null : start + text.length;
    this.view.dispatch({ changes: { from: start, to: end, insert: text }, selection: caret == null ? { anchor: start, head: start + text.length } : { anchor: caret } });
  }
  select() { this.view.dispatch({ selection: { anchor: 0, head: this.view.state.doc.length } }); }
  focus(options) { this.view.focus(); if (!options?.preventScroll) this.view.dispatch({ scrollIntoView: true }); }
  get hasFocus() { return this.view.hasFocus; }
  contains(node) { return !!node && this.dom.contains(node); }
  get hidden() { return this.dom.hidden; }
  set hidden(value) { this.dom.hidden = !!value; if (!value) requestAnimationFrame(() => this.view.requestMeasure()); }
  set readOnly(value) { this.view.dispatch({ effects: this.editable.reconfigure(EditorView.editable.of(!value)) }); }
  set spellcheck(value) { this.view.dispatch({ effects: this.spell.reconfigure(EditorView.contentAttributes.of({ spellcheck: value ? 'true' : 'false', 'aria-label': 'Markdown 源代码' })) }); }
  setLineNumbers(on) { this.view.dispatch({ effects: this.gutter.reconfigure(on ? lineNumbers() : []) }); }
  get scrollTop() { return this.view.scrollDOM.scrollTop; }
  set scrollTop(value) { this.view.scrollDOM.scrollTop = value; }
  get scrollHeight() { return this.view.scrollDOM.scrollHeight; }
  get clientHeight() { return this.view.scrollDOM.clientHeight; }
  setAttribute(name, value) { this.dom.setAttribute(name, value); }
  addEventListener(type, fn, options) { (type === 'scroll' ? this.view.scrollDOM : this.dom).addEventListener(type, fn, options); }
  removeEventListener(type, fn, options) { (type === 'scroll' ? this.view.scrollDOM : this.dom).removeEventListener(type, fn, options); }
  // Scrolls so that `pos` is near the top, like the textarea version of scrollSourceTo.
  scrollToPos(pos) { this.view.dispatch({ effects: EditorView.scrollIntoView(Math.max(0, Math.min(pos, this.view.state.doc.length)), { y: 'start', yMargin: 40 }) }); }
  destroy() { this.view.destroy(); }
}
