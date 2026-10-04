// Word (.docx) exporter: Markdown → OOXML built from the prepared export DOM (no external libraries).
import { makeZip } from './zip.mjs';
import { texOf, frontMatter, toPng, svgToPng, documentTitle } from './export-dom.mjs';
import { mathmlToOmml } from './mathml.mjs';

const xml = s => String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '');
const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture" xmlns:m="http://schemas.openxmlformats.org/officeDocument/2006/math"';
const HEAD_SIZE = [40, 34, 30, 27, 24, 22]; // half-points
const isEl = n => n.nodeType === 1;

export async function buildDocx(root, { title = '', text = '', author = 'Qingye PDF' } = {}) {
  const rels = [], media = [], footnotes = [], numbering = { ordered: [] };
  let relId = 10, imgId = 1, bookmark = 1, numId = 3;
  const rel = (type, target, external) => { const id = `rId${relId++}`; rels.push(`<Relationship Id="${id}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/${type}" Target="${xml(target)}"${external ? ' TargetMode="External"' : ''}/>`); return id; };
  const defs = new Map([...root.querySelectorAll('.mdFootnoteDef')].map(d => [d.id.replace(/^fn-/, ''), d.querySelector('.mdFootnoteBody')]));
  const footId = new Map();

  const rpr = st => {
    let s = '';
    if (st.code) s += '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Microsoft YaHei" w:cs="Consolas"/><w:sz w:val="20"/>';
    if (st.math) s += '<w:rFonts w:ascii="Cambria Math" w:hAnsi="Cambria Math"/><w:i/>';
    if (st.b) s += '<w:b/>'; if (st.i) s += '<w:i/>'; if (st.strike) s += '<w:strike/>';
    if (st.color) s += `<w:color w:val="${st.color}"/>`;
    if (st.hl) s += '<w:highlight w:val="yellow"/>';
    if (st.u) s += '<w:u w:val="single"/>';
    if (st.sup) s += '<w:vertAlign w:val="superscript"/>'; if (st.sub) s += '<w:vertAlign w:val="subscript"/>';
    if (st.rstyle) s = `<w:rStyle w:val="${st.rstyle}"/>` + s;
    if (st.code && !st.pre) s += '<w:shd w:val="clear" w:color="auto" w:fill="EEF3F0"/>';
    return s ? `<w:rPr>${s}</w:rPr>` : '';
  };
  const run = (t, st) => {
    if (!t) return '';
    const parts = String(t).split(/(\n|\t)/);
    return `<w:r>${rpr(st)}${parts.map(p => p === '\n' ? '<w:br/>' : p === '\t' ? '<w:tab/>' : p ? `<w:t xml:space="preserve">${xml(p)}</w:t>` : '').join('')}</w:r>`;
  };

  const image = async (img) => {
    let asset = img._asset;
    if (!asset) { const src = img.getAttribute('src') || ''; const m = /^data:([^;,]+);base64,(.*)$/.exec(src); if (m) asset = { type: m[1], bytes: Uint8Array.from(atob(m[2]), c => c.charCodeAt(0)) }; }
    if (!asset) return run(`[${img.getAttribute('alt') || '图片'}]`, {});
    return imageXml(asset, img.getAttribute('alt') || '');
  };
  const imageXml = async (asset, alt, widthAttr) => {
    let { bytes, type } = asset, w, h;
    if (!/^image\/(png|jpeg|gif|bmp)$/.test(type)) { const png = await toPng(bytes, type); if (!png) return run(`[${alt || '图片'}]`, {}); ({ bytes, width: w, height: h } = png); type = 'image/png'; }
    else { const bmp = await createImageBitmap(new Blob([bytes], { type })).catch(() => null); w = bmp?.width || 400; h = bmp?.height || 300; }
    return placeImage(bytes, type, w, h, alt, widthAttr);
  };
  const placeImage = (bytes, type, w, h, alt, widthAttr) => {
    const ext = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/bmp': 'bmp' }[type] || 'png';
    const id = imgId++, name = `image${id}.${ext}`;
    media.push({ name: `word/media/${name}`, data: bytes });
    const rid = rel('image', `media/${name}`);
    let cw = Math.min(w, 600); if (widthAttr) { const p = /^(\d+(?:\.\d+)?)(%|px)?$/.exec(String(widthAttr)); if (p) cw = p[2] === '%' ? 600 * Number(p[1]) / 100 : Number(p[1]); }
    cw = Math.max(16, Math.min(cw, 620)); const ch = Math.round(h * (cw / w));
    const cx = Math.round(cw * 9525), cy = Math.round(ch * 9525);
    return `<w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:docPr id="${id}" name="Picture ${id}" descr="${xml(alt)}"/><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${id}" name="${name}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${rid}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r>`;
  };

  const ommlOf = (el, display) => { try { const math = el.querySelector('.katex-mathml math') || el.querySelector('math'); return math ? mathmlToOmml(math, { display }) : ''; } catch { return ''; } };
  const mathRuns = (el, st, display) => ommlOf(el, display) || run(texOf(el).trim(), { ...st, math: true });
  const inline = async (node, st = {}) => {
    let out = '';
    for (const c of node.childNodes) {
      if (c.nodeType === 3) { out += run(c.data.replace(/\s+/g, ' '), st); continue; }
      if (!isEl(c)) continue;
      if (c.classList.contains('katex-display') || c.classList.contains('katex') || c.classList.contains('mdMath')) { out += mathRuns(c, st, false); continue; }
      if (c.classList.contains('mdFootnoteRef')) {
        const label = c.querySelector('a')?.getAttribute('href')?.replace(/^#fn-/, ''), body = defs.get(label);
        if (body && !footId.has(label)) { footId.set(label, footnotes.length + 2); footnotes.push({ id: footnotes.length + 2, body }); }
        out += body ? `<w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteReference w:id="${footId.get(label)}"/></w:r>` : run(c.textContent, { ...st, sup: true });
        continue;
      }
      switch (c.tagName) {
        case 'STRONG': case 'B': out += await inline(c, { ...st, b: true }); break;
        case 'EM': case 'I': case 'CITE': out += await inline(c, { ...st, i: true }); break;
        case 'DEL': case 'S': out += await inline(c, { ...st, strike: true }); break;
        case 'U': case 'INS': out += await inline(c, { ...st, u: true }); break;
        case 'MARK': out += await inline(c, { ...st, hl: true }); break;
        case 'SUP': out += await inline(c, { ...st, sup: true }); break;
        case 'SUB': out += await inline(c, { ...st, sub: true }); break;
        case 'CODE': out += run(c.textContent, { ...st, code: true }); break;
        case 'BR': out += '<w:r><w:br/></w:r>'; break;
        case 'A': {
          const href = c.getAttribute('href') || '';
          const inner = await inline(c, { ...st, rstyle: 'Hyperlink', u: true, color: '0563C1' });
          if (href.startsWith('#')) out += `<w:hyperlink w:anchor="${xml('_h_' + href.slice(1))}">${inner}</w:hyperlink>`;
          else if (/^(https?:|mailto:|file:)/i.test(href)) out += `<w:hyperlink r:id="${rel('hyperlink', href, true)}">${inner}</w:hyperlink>`;
          else out += inner;
          break;
        }
        case 'IMG': out += c.dataset.missing ? run(`[图片缺失：${c.getAttribute('alt') || c.dataset.originalSrc || ''}]`, st) : await imageFrom(c); break;
        case 'INPUT': out += run(c.checked || c.hasAttribute('checked') ? '☑ ' : '☐ ', st); break;
        default: out += await inline(c, st);
      }
    }
    return out;
  };
  const imageFrom = async img => { const w = img.getAttribute('width'); const asset = img._asset || (() => { const m = /^data:([^;,]+);base64,(.*)$/.exec(img.getAttribute('src') || ''); return m ? { type: m[1], bytes: Uint8Array.from(atob(m[2]), c => c.charCodeAt(0)) } : null; })(); if (!asset) return run(`[${img.getAttribute('alt') || '图片'}]`, {}); return imageXml(asset, img.getAttribute('alt') || '', w); };

  const P = (content, { style, jc, ind, border, shd, keep, spacing, num } = {}) => {
    let ppr = '';
    if (style) ppr += `<w:pStyle w:val="${style}"/>`;
    if (keep) ppr += '<w:keepNext/>';
    if (num) ppr += `<w:numPr><w:ilvl w:val="${num.level}"/><w:numId w:val="${num.id}"/></w:numPr>`;
    if (border) ppr += border;
    if (shd) ppr += `<w:shd w:val="clear" w:color="auto" w:fill="${shd}"/>`;
    if (spacing) ppr += spacing;
    if (ind) ppr += `<w:ind w:left="${ind}"/>`;
    if (jc) ppr += `<w:jc w:val="${jc}"/>`;
    return `<w:p>${ppr ? `<w:pPr>${ppr}</w:pPr>` : ''}${content}</w:p>`;
  };
  const quoteBorder = '<w:pBdr><w:left w:val="single" w:sz="18" w:space="8" w:color="B8C4BD"/></w:pBdr>';

  const list = async (el, level, body) => {
    const ordered = el.tagName === 'OL';
    let id = 1;
    if (ordered) { id = numId++; numbering.ordered.push({ id, start: Number(el.getAttribute('start')) || 1 }); }
    for (const li of el.children) {
      if (li.tagName !== 'LI') continue;
      const clone = li.cloneNode(true), nested = [...clone.querySelectorAll(':scope > ul, :scope > ol')], extra = [...clone.querySelectorAll(':scope > pre, :scope > table, :scope > blockquote')];
      nested.forEach(n => n.remove()); extra.forEach(n => n.remove());
      const kids = [...clone.children].filter(k => k.tagName === 'P');
      let first = true;
      if (kids.length) for (const k of kids) { body.push(P(await inline(k), first ? { style: 'ListParagraph', num: { id, level: Math.min(level, 8) } } : { style: 'ListParagraph', ind: 720 + level * 360 })); first = false; }
      else body.push(P(await inline(clone), { style: 'ListParagraph', num: { id, level: Math.min(level, 8) } }));
      for (const e of extra) await block(e, body, level + 1);
      for (const n of nested) await list(n, level + 1, body);
    }
  };
  const table = async (el, body) => {
    const rows = [...el.querySelectorAll('tr')]; if (!rows.length) return;
    const cols = Math.max(...rows.map(r => r.children.length));
    let tbl = `<w:tbl><w:tblPr><w:tblStyle w:val="TableGrid"/><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${['top', 'left', 'bottom', 'right', 'insideH', 'insideV'].map(b => `<w:${b} w:val="single" w:sz="4" w:space="0" w:color="B8C4BD"/>`).join('')}</w:tblBorders><w:tblCellMar><w:left w:w="100" w:type="dxa"/><w:right w:w="100" w:type="dxa"/></w:tblCellMar></w:tblPr><w:tblGrid>${Array.from({ length: cols }, () => `<w:gridCol w:w="${Math.floor(9000 / cols)}"/>`).join('')}</w:tblGrid>`;
    rows.forEach((r, ri) => {
      tbl += `<w:tr>${ri === 0 ? '<w:trPr><w:tblHeader/></w:trPr>' : ''}`;
      for (let i = 0; i < cols; i++) tbl += `<w:tc>__CELL_${ri}_${i}__</w:tc>`;
      tbl += '</w:tr>';
    });
    tbl += '</w:tbl>';
    for (let ri = 0; ri < rows.length; ri++) for (let i = 0; i < cols; i++) {
      const cell = rows[ri].children[i];
      const align = cell?.style?.textAlign || cell?.getAttribute('align') || '';
      const isHead = cell?.tagName === 'TH';
      const inner = cell ? await inline(cell, isHead ? { b: true } : {}) : '';
      tbl = tbl.replace(`__CELL_${ri}_${i}__`, `<w:tcPr><w:tcW w:w="${Math.floor(9000 / cols)}" w:type="dxa"/>${isHead ? '<w:shd w:val="clear" w:color="auto" w:fill="EEF3F0"/>' : ''}</w:tcPr>${P(inner, { jc: align === 'center' ? 'center' : align === 'right' ? 'right' : undefined, spacing: '<w:spacing w:before="40" w:after="40"/>' })}`);
    }
    body.push(tbl, P('', { spacing: '<w:spacing w:after="60"/>' }));
  };
  const block = async (c, body, level = 0) => {
    if (c.classList.contains('mdFrontMatter') || c.classList.contains('mdFootnoteDef')) return;
    if (c.classList.contains('mdToc')) {
      body.push(P(run('目录', { b: true }), { spacing: '<w:spacing w:after="60"/>' }));
      for (const a of c.querySelectorAll('a')) body.push(P(`<w:hyperlink w:anchor="${xml('_h_' + a.getAttribute('href').slice(1))}">${run(a.textContent, { rstyle: 'Hyperlink', u: true, color: '0563C1' })}</w:hyperlink>`, { ind: (parseFloat(a.closest('li')?.style.marginLeft || '0') / 1.2) * 360, spacing: '<w:spacing w:after="0"/>' }));
      body.push(P(''));
      return;
    }
    if (c.classList.contains('mdMathBlock')) { const omml = ommlOf(c, true); body.push(omml ? `<w:p>${omml}</w:p>` : P(run(texOf(c).trim(), { math: true }), { jc: 'center' })); return; }
    if (c.classList.contains('mdMermaid')) {
      const svg = c.querySelector('svg');
      try { if (svg) { const png = await svgToPng(svg.outerHTML); body.push(P(placeImage(png.bytes, 'image/png', png.width / 2, png.height / 2, 'Mermaid 图表'), { jc: 'center' })); return; } } catch {}
      for (const line of (c.querySelector('.mdMermaidSource code')?.textContent || '').split('\n')) body.push(P(run(line, { code: true, pre: true }), { style: 'Code' }));
      return;
    }
    switch (c.tagName) {
      case 'H1': case 'H2': case 'H3': case 'H4': case 'H5': case 'H6': {
        const n = Number(c.tagName[1]), id = c.id ? `<w:bookmarkStart w:id="${bookmark}" w:name="${xml('_h_' + c.id)}"/>` : '', end = c.id ? `<w:bookmarkEnd w:id="${bookmark++}"/>` : '';
        body.push(P(id + await inline(c) + end, { style: `Heading${n}`, keep: true })); break;
      }
      case 'P': { const imgOnly = [...c.childNodes].filter(n => !(n.nodeType === 3 && !n.data.trim())).every(n => n.tagName === 'IMG'); body.push(P(await inline(c), { jc: imgOnly ? 'center' : undefined, ind: level ? level * 360 : undefined })); break; }
      case 'UL': case 'OL': await list(c, level, body); break;
      case 'BLOCKQUOTE': {
        const alert = [...c.classList].find(x => x.startsWith('mdAlert-'));
        if (alert) body.push(P(run({ note: 'ⓘ 注意', tip: '💡 提示', important: '❗ 重要', warning: '⚠ 警告', caution: '⛔ 小心' }[alert.slice(8)], { b: true }), { ind: 360, border: quoteBorder }));
        for (const k of c.children) {
          if (k.tagName === 'P') body.push(P(await inline(k), { ind: 360, border: quoteBorder, style: 'Quote' }));
          else await block(k, body, level + 1);
        }
        break;
      }
      case 'PRE': { const lines = c.textContent.replace(/\n$/, '').split('\n'); lines.forEach(line => body.push(P(run(line, { code: true, pre: true }), { style: 'Code' }))); body.push(P('', { spacing: '<w:spacing w:after="40"/>' })); break; }
      case 'HR': body.push(P('', { border: '<w:pBdr><w:bottom w:val="single" w:sz="8" w:space="1" w:color="B8C4BD"/></w:pBdr>' })); break;
      case 'TABLE': await table(c, body); break;
      case 'DIV': case 'SECTION': case 'NAV': case 'ARTICLE': for (const k of c.children) await block(k, body, level); break;
      default: { const t = await inline(c); if (t) body.push(P(t)); }
    }
  };

  const body = [];
  const fm = frontMatter(text);
  const docTitle = fm.title || title;
  if (fm.title) body.push(P(run(fm.title, {}), { style: 'Title' }));
  if (fm.author || fm.date) body.push(P(run([fm.author, fm.date].filter(Boolean).join(' · '), { i: true }), { jc: 'center' }));
  for (const c of root.children) await block(c, body);

  const footnotesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:footnotes ${NS}><w:footnote w:type="separator" w:id="0"><w:p><w:r><w:separator/></w:r></w:p></w:footnote><w:footnote w:type="continuationSeparator" w:id="1"><w:p><w:r><w:continuationSeparator/></w:r></w:p></w:footnote>${(await Promise.all(footnotes.map(async f => `<w:footnote w:id="${f.id}"><w:p><w:pPr><w:pStyle w:val="FootnoteText"/></w:pPr><w:r><w:rPr><w:rStyle w:val="FootnoteReference"/></w:rPr><w:footnoteRef/></w:r>${run(' ', {})}${await inline(f.body)}</w:p></w:footnote>`))).join('')}</w:footnotes>`;
  const document = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${body.join('')}<w:sectPr><w:footnotePr><w:numFmt w:val="decimal"/></w:footnotePr><w:pgSz w:w="11906" w:h="16838"/><w:pgMar w:top="1440" w:right="1304" w:bottom="1440" w:left="1304" w:header="851" w:footer="992" w:gutter="0"/></w:sectPr></w:body></w:document>`;

  const lvl = (i, fmt, text, font) => `<w:lvl w:ilvl="${i}"><w:start w:val="1"/><w:numFmt w:val="${fmt}"/><w:lvlText w:val="${text}"/><w:lvlJc w:val="left"/><w:pPr><w:ind w:left="${720 + i * 360}" w:hanging="360"/></w:pPr>${font ? `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:hint="default"/></w:rPr>` : ''}</w:lvl>`;
  const bullets = ['•', '◦', '▪'], nums = ['%1.', '%2.', '%3.'];
  const numberingXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}><w:abstractNum w:abstractNumId="0"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 9 }, (_, i) => lvl(i, 'bullet', bullets[i % 3], 'Arial')).join('')}</w:abstractNum><w:abstractNum w:abstractNumId="1"><w:multiLevelType w:val="hybridMultilevel"/>${Array.from({ length: 9 }, (_, i) => lvl(i, ['decimal', 'lowerLetter', 'lowerRoman'][i % 3], `%${i + 1}.`)).join('')}</w:abstractNum><w:num w:numId="1"><w:abstractNumId w:val="0"/></w:num>${numbering.ordered.map(o => `<w:num w:numId="${o.id}"><w:abstractNumId w:val="1"/><w:lvlOverride w:ilvl="0"><w:startOverride w:val="${o.start}"/></w:lvlOverride></w:num>`).join('')}</w:numbering>`;
  const style = (id, name, ppr, rprX, extra = '') => `<w:style w:type="paragraph" w:styleId="${id}"><w:name w:val="${name}"/><w:basedOn w:val="Normal"/><w:next w:val="Normal"/>${extra}<w:qFormat/><w:pPr>${ppr}</w:pPr><w:rPr>${rprX}</w:rPr></w:style>`;
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:styles ${NS}><w:docDefaults><w:rPrDefault><w:rPr><w:rFonts w:ascii="Calibri" w:hAnsi="Calibri" w:eastAsia="Microsoft YaHei" w:cs="Calibri"/><w:sz w:val="22"/><w:szCs w:val="22"/><w:lang w:val="en-US" w:eastAsia="zh-CN"/></w:rPr></w:rPrDefault><w:pPrDefault><w:pPr><w:spacing w:after="140" w:line="320" w:lineRule="auto"/></w:pPr></w:pPrDefault></w:docDefaults><w:style w:type="paragraph" w:default="1" w:styleId="Normal"><w:name w:val="Normal"/><w:qFormat/></w:style>${[1, 2, 3, 4, 5, 6].map(n => style(`Heading${n}`, `heading ${n}`, `<w:keepNext/><w:spacing w:before="${n < 3 ? 320 : 240}" w:after="120"/><w:outlineLvl w:val="${n - 1}"/>`, `<w:b/><w:sz w:val="${HEAD_SIZE[n - 1]}"/><w:color w:val="${n === 6 ? '5F7168' : '15201B'}"/>`)).join('')}${style('Title', 'Title', '<w:spacing w:before="0" w:after="200"/><w:jc w:val="center"/>', '<w:b/><w:sz w:val="52"/>')}${style('Quote', 'Quote', '<w:spacing w:after="80"/>', '<w:color w:val="5F7168"/>')}${style('ListParagraph', 'List Paragraph', '<w:spacing w:after="40"/><w:contextualSpacing/>', '')}${style('Code', 'Code', '<w:shd w:val="clear" w:color="auto" w:fill="F5F8F6"/><w:spacing w:after="0" w:line="260" w:lineRule="auto"/><w:ind w:left="120" w:right="120"/>', '<w:rFonts w:ascii="Consolas" w:hAnsi="Consolas" w:eastAsia="Microsoft YaHei"/><w:sz w:val="20"/>')}${style('FootnoteText', 'footnote text', '<w:spacing w:after="0" w:line="240" w:lineRule="auto"/>', '<w:sz w:val="18"/>')}<w:style w:type="character" w:styleId="FootnoteReference"><w:name w:val="footnote reference"/><w:rPr><w:vertAlign w:val="superscript"/></w:rPr></w:style><w:style w:type="character" w:styleId="Hyperlink"><w:name w:val="Hyperlink"/><w:rPr><w:color w:val="0563C1"/><w:u w:val="single"/></w:rPr></w:style><w:style w:type="table" w:styleId="TableGrid"><w:name w:val="Table Grid"/><w:tblPr><w:tblBorders><w:top w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:left w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:bottom w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:right w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideH w:val="single" w:sz="4" w:space="0" w:color="auto"/><w:insideV w:val="single" w:sz="4" w:space="0" w:color="auto"/></w:tblBorders></w:tblPr></w:style></w:styles>`;
  const now = new Date().toISOString().replace(/\.\d+Z$/, 'Z');
  const files = [
    { name: '[Content_Types].xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Default Extension="png" ContentType="image/png"/><Default Extension="jpg" ContentType="image/jpeg"/><Default Extension="gif" ContentType="image/gif"/><Default Extension="bmp" ContentType="image/bmp"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/><Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/><Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/><Override PartName="/word/footnotes.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.footnotes+xml"/><Override PartName="/docProps/core.xml" ContentType="application/vnd.openxmlformats-package.core-properties+xml"/><Override PartName="/docProps/app.xml" ContentType="application/vnd.openxmlformats-officedocument.extended-properties+xml"/></Types>` },
    { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/package/2006/relationships/metadata/core-properties" Target="docProps/core.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/extended-properties" Target="docProps/app.xml"/></Relationships>' },
    { name: 'word/document.xml', data: document },
    { name: 'word/styles.xml', data: styles },
    { name: 'word/numbering.xml', data: numberingXml },
    { name: 'word/footnotes.xml', data: footnotesXml },
    { name: 'word/_rels/document.xml.rels', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/numbering" Target="numbering.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/footnotes" Target="footnotes.xml"/>${rels.join('')}</Relationships>` },
    { name: 'docProps/core.xml', data: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><cp:coreProperties xmlns:cp="http://schemas.openxmlformats.org/package/2006/metadata/core-properties" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:dcterms="http://purl.org/dc/terms/" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"><dc:title>${xml(docTitle)}</dc:title><dc:creator>${xml(fm.author || author)}</dc:creator><dcterms:created xsi:type="dcterms:W3CDTF">${now}</dcterms:created><dcterms:modified xsi:type="dcterms:W3CDTF">${now}</dcterms:modified></cp:coreProperties>` },
    { name: 'docProps/app.xml', data: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Properties xmlns="http://schemas.openxmlformats.org/officeDocument/2006/extended-properties"><Application>Qingye PDF</Application></Properties>' },
    ...media,
  ];
  return makeZip(files);
}
export { documentTitle };
