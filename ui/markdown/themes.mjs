// Built-in Markdown themes (original stylesheets in themes.css; names follow Typora's set).
export const THEMES = [['qingye', '青页（默认）'], ['github', 'GitHub'], ['newsprint', 'Newsprint'], ['night', 'Night'], ['pixyll', 'Pixyll'], ['whitey', 'Whitey']];
export const themeIds = () => THEMES.map(([id]) => id);
// Typora theme CSS targets #write / body / :root; map those onto Qingye's document container so
// an imported .css theme file works without edits.
export function scopeThemeCss(css, scope = '.mdPanel[data-mdtheme="custom"]') {
  const doc = `${scope} .mdDoc`;
  let out = String(css || '').replace(/\/\*[\s\S]*?\*\//g, '');
  out = out.replace(/@import[^;]+;/g, '').replace(/@charset[^;]+;/g, '');
  const scoped = [];
  // Split top-level rules; keep @media / @font-face / @keyframes blocks intact.
  let i = 0;
  while (i < out.length) {
    const open = out.indexOf('{', i); if (open < 0) break;
    const head = out.slice(i, open).trim();
    let depth = 1, j = open + 1;
    while (j < out.length && depth) { if (out[j] === '{') depth++; else if (out[j] === '}') depth--; j++; }
    const body = out.slice(open + 1, j - 1);
    if (/^@font-face|^@keyframes/i.test(head)) scoped.push(`${head}{${body}}`);
    else if (head.startsWith('@media') || head.startsWith('@supports')) scoped.push(`${head}{${scopeThemeCss(body, scope)}}`);
    else if (head.startsWith('@')) scoped.push(`${head}{${body}}`);
    else {
      const selectors = head.split(',').map(sel => {
        sel = sel.trim();
        if (!sel) return '';
        if (/^(:root|html|body)$/i.test(sel)) return doc;
        if (/^(:root|html|body)\s/i.test(sel)) sel = sel.replace(/^(:root|html|body)\s+/i, '');
        sel = sel.replace(/#write\b/g, '.mdDoc').replace(/\.CodeMirror\b/g, '.mdCodeBlock').replace(/\.md-fences\b/g, '.mdCodeBlock').replace(/\.md-heading\b/g, '.mdDoc');
        return sel.startsWith(scope) ? sel : `${scope} ${sel.startsWith('.mdDoc') ? sel : sel.startsWith('.mdDoc') ? sel : '.mdDoc ' + sel}`.replace('.mdDoc .mdDoc', '.mdDoc').replace(`${scope} .mdDoc .mdDoc`, `${scope} .mdDoc`);
      }).filter(Boolean);
      if (selectors.length) scoped.push(`${selectors.join(',')}{${body.replace(/!important/g, '')}}`);
    }
    i = j;
  }
  return scoped.join('\n');
}
