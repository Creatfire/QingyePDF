// Presentation MathML (as produced by KaTeX) → Word OMML, so equations stay editable in Word.
const esc = s => String(s).replace(/[&<>]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const NARY = new Set(['∑', '∏', '∐', '∫', '∬', '∭', '∮', '⋃', '⋂', '⨁', '⨂', '⋀', '⋁']);
const kids = el => [...el.children];
const text = el => el.textContent || '';
const run = (t, { plain = false, nor = false } = {}) => t ? `<m:r>${plain || nor ? `<m:rPr>${nor ? '<m:nor/>' : '<m:sty m:val="p"/>'}</m:rPr>` : ''}<m:t xml:space="preserve">${esc(t)}</m:t></m:r>` : '';
const arg = (tag, el) => `<m:${tag}>${el ? conv(el) : ''}</m:${tag}>`;
const rowOf = els => els.map(conv).join('');
function conv(el) {
  if (!el || el.nodeType !== 1) return '';
  const tag = el.localName, k = kids(el);
  switch (tag) {
    case 'semantics': return conv(k[0]);
    case 'annotation': case 'annotation-xml': case 'mspace': case 'mphantom': return '';
    case 'math': case 'mrow': case 'mstyle': case 'mpadded': return rowOf(k);
    case 'mi': { const t = text(el); return run(t, { plain: t.length > 1 || el.getAttribute('mathvariant') === 'normal' }); }
    case 'mn': return run(text(el), { plain: true });
    case 'mo': return run(text(el), { plain: true });
    case 'mtext': return run(text(el), { nor: true });
    case 'ms': return run(text(el), { nor: true });
    case 'mfrac': return `<m:f>${el.getAttribute('linethickness') === '0px' || el.getAttribute('linethickness') === '0' ? '<m:fPr><m:type m:val="noBar"/></m:fPr>' : ''}${arg('num', k[0])}${arg('den', k[1])}</m:f>`;
    case 'msqrt': return `<m:rad><m:radPr><m:degHide m:val="1"/></m:radPr><m:deg/><m:e>${rowOf(k)}</m:e></m:rad>`;
    case 'mroot': return `<m:rad>${arg('deg', k[1])}${arg('e', k[0])}</m:rad>`;
    case 'msup': case 'msub': case 'msubsup': {
      const base = k[0], baseText = base?.localName === 'mo' ? text(base) : '';
      if (NARY.has(baseText)) return `<m:nary><m:naryPr><m:chr m:val="${esc(baseText)}"/><m:limLoc m:val="subSup"/>${tag === 'msup' ? '<m:subHide m:val="1"/>' : ''}${tag === 'msub' ? '<m:supHide m:val="1"/>' : ''}</m:naryPr>${tag === 'msup' ? '<m:sub/>' : arg('sub', k[1])}${tag === 'msub' ? '<m:sup/>' : arg('sup', k[tag === 'msup' ? 1 : 2])}<m:e/></m:nary>`;
      if (tag === 'msup') return `<m:sSup>${arg('e', base)}${arg('sup', k[1])}</m:sSup>`;
      if (tag === 'msub') return `<m:sSub>${arg('e', base)}${arg('sub', k[1])}</m:sSub>`;
      return `<m:sSubSup>${arg('e', base)}${arg('sub', k[1])}${arg('sup', k[2])}</m:sSubSup>`;
    }
    case 'munder': case 'mover': case 'munderover': {
      const base = k[0], baseText = base?.localName === 'mo' ? text(base) : '';
      if (NARY.has(baseText)) return `<m:nary><m:naryPr><m:chr m:val="${esc(baseText)}"/><m:limLoc m:val="undOvr"/></m:naryPr>${arg('sub', tag === 'mover' ? null : k[1])}${arg('sup', tag === 'munder' ? null : k[tag === 'mover' ? 1 : 2])}<m:e/></m:nary>`;
      if (tag === 'mover' && el.getAttribute('accent') === 'true' && k[1]) return `<m:acc><m:accPr><m:chr m:val="${esc(text(k[1]))}"/></m:accPr>${arg('e', base)}</m:acc>`;
      if (tag === 'munder') return `<m:limLow>${arg('e', base)}${arg('lim', k[1])}</m:limLow>`;
      if (tag === 'mover') return `<m:limUpp>${arg('e', base)}${arg('lim', k[1])}</m:limUpp>`;
      return `<m:limUpp>${arg('e', `<x/>`) && `<m:e><m:limLow>${arg('e', base)}${arg('lim', k[1])}</m:limLow></m:e>`}${arg('lim', k[2])}</m:limUpp>`;
    }
    case 'mtable': return `<m:m>${k.map(row => `<m:mr>${kids(row).map(cell => `<m:e>${rowOf(kids(cell))}</m:e>`).join('')}</m:mr>`).join('')}</m:m>`;
    case 'mtr': case 'mtd': return rowOf(k);
    case 'menclose': return rowOf(k);
    default: return k.length ? rowOf(k) : run(text(el));
  }
}
export function mathmlToOmml(math, { display = false } = {}) {
  const root = math.localName === 'math' ? math : math.querySelector?.('math');
  if (!root) return '';
  const body = conv(root);
  if (!body) return '';
  return display ? `<m:oMathPara><m:oMath>${body}</m:oMath></m:oMathPara>` : `<m:oMath>${body}</m:oMath>`;
}
