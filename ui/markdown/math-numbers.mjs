// Equation numbering and cross references for display math (Typora "auto numbering math").
// KaTeX renders \tag but not \label / \eqref / \ref, and numbers equation/align rows with CSS
// counters that do not survive per-block rendering. Numbers are therefore assigned here, in
// document order, and written as explicit \tag{n}; \label is removed and \eqref / \ref become text.
//   mode 'none': only explicit \tag values are referable (labels still stop KaTeX errors)
//   mode 'ams' : numbered environments (equation, align, gather, multline…) and $$ blocks with \label
//   mode 'all' : every display block, unless it says \notag / \nonumber or has its own \tag
const ENV = /\\begin\{(equation|align|gather|multline|flalign|alignat)\}/;
const ROWS = new Set(['align', 'gather', 'flalign', 'alignat']);
const LABEL = /\\label\{([^{}]*)\}/g;
const TAG = /\\tag\*?\{([^{}]*)\}/;
const NOTAG = /\\(?:notag|nonumber)\b/;

const strip = tex => tex.replace(LABEL, '').replace(/\\(?:notag|nonumber)\b\s*/g, '');
const labelsIn = tex => [...tex.matchAll(LABEL)].map(m => m[1].trim()).filter(Boolean);

// Returns { tex, next, labels: [[key, value]] } for one display block starting at counter `next`.
export function numberBlock(source, mode = 'none', next = 1) {
  const labels = [];
  const env = mode !== 'none' && ENV.exec(source);
  if (env) {
    const name = env[1];
    let tex = source.replace(new RegExp(`\\\\(begin|end)\\{${name}\\}`, 'g'), `\\$1{${name}*}`);
    const close = tex.lastIndexOf(`\\end{${name}*}`), open = tex.indexOf(`\\begin{${name}*}`) + `\\begin{${name}*}`.length;
    const head = tex.slice(0, open), body = tex.slice(open, close), tail = tex.slice(close);
    // Row environments number each row unless rows hold nested environments (then one number).
    const rows = ROWS.has(name) && !/\\begin\{/.test(body) ? body.split(/\\\\(?!\[)/) : [body];
    const numbered = rows.map((row, i) => {
      const own = TAG.exec(row);
      if (own) { for (const k of labelsIn(row)) labels.push([k, own[1]]); return strip(row); }
      if (NOTAG.test(row) || (rows.length > 1 && i === rows.length - 1 && !row.trim())) return strip(row);
      const n = String(next++);
      for (const k of labelsIn(row)) labels.push([k, n]);
      return strip(row).replace(/\s*$/, ` \\tag{${n}}`);
    });
    return { tex: head + numbered.join('\\\\') + tail, next, labels };
  }
  const own = TAG.exec(source), keys = labelsIn(source);
  if (own) { for (const k of keys) labels.push([k, own[1]]); return { tex: strip(source), next, labels }; }
  if (!NOTAG.test(source) && (mode === 'all' || (mode === 'ams' && keys.length))) {
    const n = String(next++);
    for (const k of keys) labels.push([k, n]);
    return { tex: strip(source).replace(/\s*$/, ` \\tag{${n}}`), next, labels };
  }
  return { tex: strip(source), next, labels };
}

// \eqref{k} → (n), \ref{k} → n; unknown keys show "?" instead of a KaTeX error.
export function resolveRefs(tex, labels = {}) {
  if (!/\\(?:eq)?ref\{/.test(tex)) return tex;
  return tex.replace(/\\(eqref|ref)\{([^{}]*)\}/g, (m, kind, key) => {
    const value = Object.hasOwn(labels, key.trim()) ? labels[key.trim()] : '?';
    return `\\text{${kind === 'eqref' ? `(${value})` : value}}`;
  });
}
