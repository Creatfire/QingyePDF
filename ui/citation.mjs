// Reference details of a PDF (0.11.0): finds the DOI / arXiv number, title, authors and year in
// the document itself, lets the user correct them, and writes BibTeX or a formatted reference.
// Everything works offline; "look up online" sends only the DOI to doi.org and only on request.

const STORE_KEY = 'qingye.citations';
export const TYPES = [['article', '期刊论文'], ['inproceedings', '会议论文'], ['book', '图书'], ['phdthesis', '学位论文'], ['techreport', '报告'], ['misc', '其他']];
const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

// ——— finding identifiers ———
export function findDoi(text) {
  const match = /\b(10\.\d{4,9}\/[^\s"<>{}|\\^`]+)/i.exec(String(text || '').replace(/doi\s*:\s*/gi, ' '));
  if (!match) return '';
  let doi = match[1].replace(/[.,;:)\]'’”]+$/, '');
  // A closing bracket belongs to the DOI only when its opening bracket does too.
  const count = (text, char) => text.split(char).length - 1;
  while (doi.endsWith(')') && count(doi, '(') < count(doi, ')') || doi.endsWith(']') && count(doi, '[') < count(doi, ']')) doi = doi.slice(0, -1).replace(/[.,;:]+$/, '');
  return doi;
}
export function findArxiv(text) {
  const match = /arXiv\s*:\s*(\d{4}\.\d{4,5})(v\d+)?/i.exec(String(text || '')) || /arxiv\.org\/(?:abs|pdf)\/(\d{4}\.\d{4,5})(v\d+)?/i.exec(String(text || ''));
  return match ? match[1] : '';
}
export function splitAuthors(value) {
  if (Array.isArray(value)) return value.map(clean).filter(Boolean);
  const text = clean(value); if (!text) return [];
  // "Family, Given; Family, Given" keeps its commas; "A B, C D and E F" is three people.
  const out = [];
  for (const part of text.split(/;|\band\b|&|、|；|，/i).map(clean).filter(Boolean)) {
    const pieces = part.split(',').map(clean).filter(Boolean);
    if (pieces.length === 2 && !/\s/.test(pieces[0])) out.push(pieces[0] + ', ' + pieces[1]); else out.push(...pieces);
  }
  return out;
}
const junkTitle = title => !title || title.length < 4 || /^(untitled|microsoft word|document\d*|slide \d+|powerpoint)/i.test(title) || /\.(docx?|tex|dvi|pdf|indd|qxd|pptx?|rtf)$/i.test(title);

/** Guesses the title from the first page: the largest text in its upper part. `items` are PDF.js
 *  text items ({ str, height, transform }), `pageHeight` the page height in the same units. */
export function guessTitle(items, pageHeight = 0) {
  const lines = [];
  for (const item of items || []) {
    const text = String(item.str || ''); if (!text.trim()) continue;
    const size = Math.abs(item.height || item.transform?.[3] || 0), y = item.transform?.[5] ?? 0;
    const last = lines.at(-1);
    if (last && Math.abs(last.y - y) < size * .5 && Math.abs(last.size - size) < .5) { last.text += text; continue; }
    lines.push({ text, size, y });
  }
  const usable = lines.filter(line => clean(line.text).length >= 4 && (!pageHeight || line.y > pageHeight * .35) && !/^(arxiv|doi|https?:|www\.|vol\.|volume|issn|©)/i.test(clean(line.text)));
  if (!usable.length) return '';
  const largest = Math.max(...usable.map(line => line.size));
  if (!(largest > 0)) return '';
  const first = lines.findIndex(line => usable.includes(line) && line.size >= largest * .93), picked = [];
  for (let index = first; index < lines.length && picked.length < 4; index++) { const line = lines[index]; if (line.size < largest * .93) break; picked.push(clean(line.text)); }
  return clean(picked.join(' ')).slice(0, 300);
}
export function guessYear(info, text) {
  const date = /D:(\d{4})/.exec(String(info?.CreationDate || ''));
  const printed = /(?:©|\(c\)|copyright|published|accepted|received|出版|发表)[^\n]{0,40}?\b((?:19|20)\d{2})\b/i.exec(String(text || ''));
  const year = Number(printed?.[1] || date?.[1] || 0), now = new Date().getFullYear() + 1;
  return year >= 1900 && year <= now ? String(year) : '';
}
/** Everything that can be read from the document without the network. */
export function detect({ info = {}, items = [], pageHeight = 0, text = '', name = '' }) {
  const metaTitle = clean(info.Title), title = junkTitle(metaTitle) ? guessTitle(items, pageHeight) || clean(name.replace(/\.pdf$/i, '')) : metaTitle;
  const doi = findDoi(text) || findDoi(info.Subject) || findDoi(info.Keywords) || findDoi(info.doi), arxiv = findArxiv(text);
  const authors = splitAuthors(info.Author).filter(author => author.length < 80 && !/^(admin|user|owner|administrator)$/i.test(author));
  return normalize({ type: doi ? 'article' : arxiv ? 'misc' : 'misc', title, authors, year: guessYear(info, text), doi: doi || (arxiv ? '10.48550/arXiv.' + arxiv : ''), arxiv, url: arxiv ? 'https://arxiv.org/abs/' + arxiv : '' });
}
export function normalize(entry = {}) {
  const type = TYPES.some(([id]) => id === entry.type) ? entry.type : 'misc';
  const out = { type, title: clean(entry.title), authors: splitAuthors(entry.authors), year: clean(entry.year).slice(0, 4), journal: clean(entry.journal), volume: clean(entry.volume), issue: clean(entry.issue), pages: clean(entry.pages), publisher: clean(entry.publisher), doi: clean(entry.doi), url: clean(entry.url), arxiv: clean(entry.arxiv) };
  out.key = clean(entry.key).replace(/[^\p{L}\p{N}_:.-]/gu, '') || citeKey(out);
  return out;
}

// ——— online record (CSL-JSON, as doi.org answers for Crossref and DataCite DOIs) ———
export function fromCsl(csl = {}) {
  const one = value => clean(Array.isArray(value) ? value[0] : value), kind = String(csl.type || '');
  const type = /journal|article$/.test(kind) && !/posted/.test(kind) ? 'article' : /proceedings|paper-conference/.test(kind) ? 'inproceedings' : /^book$|monograph/.test(kind) ? 'book' : /thesis|dissertation/.test(kind) ? 'phdthesis' : /report/.test(kind) ? 'techreport' : 'misc';
  const authors = (csl.author || []).map(a => a.literal ? clean(a.literal) : a.family && a.given ? clean(a.family) + ', ' + clean(a.given) : clean(a.family || a.given || a.name)).filter(Boolean);
  const year = csl.issued?.['date-parts']?.[0]?.[0] || csl.published?.['date-parts']?.[0]?.[0] || csl['published-print']?.['date-parts']?.[0]?.[0] || '';
  return normalize({ type, title: one(csl.title).replace(/<[^>]+>/g, ''), authors, year: String(year || ''), journal: one(csl['container-title']), volume: csl.volume, issue: csl.issue, pages: csl.page, publisher: csl.publisher, doi: csl.DOI, url: csl.URL });
}

// ——— writing ———
const family = author => clean(author.includes(',') ? author.split(',')[0] : /[\u3400-\u9fff]/.test(author) ? author : author.split(' ').at(-1));
export function citeKey(entry) {
  const who = family(entry.authors?.[0] || '').normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase();
  const word = (clean(entry.title).split(/[\s:：,，.。\-—]+/).find(w => w.length > 3 && !/^(the|and|for|with|from|that|this|into|over|under|about)$/i.test(w)) || '').normalize('NFKD').replace(/[^\p{L}\p{N}]/gu, '').toLowerCase().slice(0, 16);
  return (who + (entry.year || '') + word) || 'reference';
}
const tex = value => String(value).replace(/\\/g, '\\textbackslash{}').replace(/([&%$#_{}])/g, '\\$1').replace(/~/g, '\\textasciitilde{}').replace(/\^/g, '\\textasciicircum{}');
export function bibtex(input) {
  const e = normalize(input), fields = [];
  const add = (name, value, wrap = false) => { if (value) fields.push(`  ${name} = {${wrap ? '{' + tex(value) + '}' : tex(value)}}`); };
  add('title', e.title, true); add('author', e.authors.join(' and ')); add('year', e.year);
  add(e.type === 'inproceedings' ? 'booktitle' : e.type === 'article' ? 'journal' : 'howpublished', e.journal);
  add('volume', e.volume); add('number', e.issue); add('pages', e.pages.replace(/\s*[-–—]+\s*/, '--'));
  add(e.type === 'phdthesis' ? 'school' : e.type === 'techreport' ? 'institution' : 'publisher', e.publisher);
  if (e.doi) fields.push(`  doi = {${e.doi}}`);
  if (e.arxiv) fields.push(`  eprint = {${e.arxiv}}`, '  archivePrefix = {arXiv}');
  if (e.url) fields.push(`  url = {${e.url}}`);
  return `@${e.type}{${e.key},\n${fields.join(',\n')}\n}`;
}
/** A reference line in GB/T 7714-2015 (numeric) or APA 7 style. */
export function formatReference(input, style = 'gbt') {
  const e = normalize(input), locator = e.doi ? 'https://doi.org/' + e.doi : e.url;
  if (style === 'apa') {
    const names = e.authors.map(a => { if (/[\u3400-\u9fff]/.test(a)) return a; const [last, given = ''] = a.includes(',') ? a.split(',').map(clean) : [a.split(' ').at(-1), a.split(' ').slice(0, -1).join(' ')]; return last + (given ? ', ' + given.split(/[\s-]+/).filter(Boolean).map(w => w[0].toUpperCase() + '.').join(' ') : ''); });
    const who = names.length > 1 ? names.slice(0, -1).join(', ') + ', & ' + names.at(-1) : names[0] || '';
    const where = e.journal ? ` ${e.journal}${e.volume ? ', ' + e.volume : ''}${e.issue ? '(' + e.issue + ')' : ''}${e.pages ? ', ' + e.pages : ''}.` : e.publisher ? ` ${e.publisher}.` : '';
    return clean(`${who ? who + ' ' : ''}(${e.year || 'n.d.'}). ${e.title}.${where}${locator ? ' ' + locator : ''}`);
  }
  const mark = { article: 'J', inproceedings: 'C', book: 'M', phdthesis: 'D', techreport: 'R', misc: 'EB/OL' }[e.type];
  const names = e.authors.map(a => { if (/[\u3400-\u9fff]/.test(a)) return a.replace(/[,\s]/g, ''); const [last, given = ''] = a.includes(',') ? a.split(',').map(clean) : [a.split(' ').at(-1), a.split(' ').slice(0, -1).join(' ')]; return (last.toUpperCase() + ' ' + given.split(/[\s-]+/).filter(Boolean).map(w => w[0].toUpperCase()).join(' ')).trim(); });
  const who = names.length > 3 ? names.slice(0, 3).join(', ') + ', 等' : names.join(', ');
  let where = '';
  if (e.type === 'article') where = `${e.journal ? ' ' + e.journal + ',' : ''} ${e.year}${e.volume ? ', ' + e.volume : ''}${e.issue ? '(' + e.issue + ')' : ''}${e.pages ? ': ' + e.pages : ''}`;
  else if (e.type === 'inproceedings') where = `//${e.journal || ''}. ${e.publisher ? e.publisher + ', ' : ''}${e.year}${e.pages ? ': ' + e.pages : ''}`;
  else where = ` ${e.publisher ? e.publisher + ', ' : ''}${e.year}`;
  return clean(`${who ? who + '. ' : ''}${e.title}[${mark}].${where}.${locator ? ' ' + locator + '.' : ''}`).replace(/\.\s*\./g, '.').replace(/\[C\]\.\/\//, '[C]//');
}

// ——— the stored library: one entry per document path ———
export function readLibrary(storage = globalThis.localStorage) { try { const value = JSON.parse(storage.getItem(STORE_KEY) || '{}'); return value && typeof value === 'object' && !Array.isArray(value) ? value : {}; } catch { return {}; } }
function writeLibrary(library, storage = globalThis.localStorage) { const keys = Object.keys(library); for (const key of keys.slice(0, Math.max(0, keys.length - 2000))) delete library[key]; try { storage.setItem(STORE_KEY, JSON.stringify(library)); } catch {} }
/** All stored entries as one .bib file; duplicate keys get a, b, c… */
export function libraryBibtex(library) {
  const used = new Map(), out = [];
  for (const entry of Object.values(library)) {
    const e = normalize(entry), count = used.get(e.key) || 0; used.set(e.key, count + 1);
    out.push(bibtex(count ? { ...e, key: e.key + String.fromCharCode(96 + Math.min(26, count)) } : e));
  }
  return out.join('\n\n') + (out.length ? '\n' : '');
}

export function createCitations({ api, guard, status, notesFor, insertNotes }) {
  const dialog = document.createElement('dialog'); dialog.id = 'citationDialog'; dialog.setAttribute('aria-labelledby', 'citationTitle');
  dialog.innerHTML = `<h2 id="citationTitle">引用信息</h2><p class="citationHint" id="citationHint"></p>
<div class="citationGrid">
<label>类型<select data-field="type">${TYPES.map(([id, label]) => `<option value="${id}">${label}</option>`).join('')}</select></label>
<label>年份<input data-field="year" inputmode="numeric" maxlength="4"></label>
<label class="half">引用键<input data-field="key" spellcheck="false"></label>
<label class="wide">标题<input data-field="title"></label>
<label class="wide">作者（多位作者用分号隔开）<input data-field="authors"></label>
<label class="wide">期刊 / 会议 / 出处<input data-field="journal"></label>
<label>卷<input data-field="volume"></label><label>期<input data-field="issue"></label>
<label>页码<input data-field="pages"></label><label>出版者 / 学校<input data-field="publisher"></label>
<label class="half">DOI<input data-field="doi" spellcheck="false"></label>
<label class="half">链接<input data-field="url" spellcheck="false"></label>
</div>
<label class="citationPreviewLabel">BibTeX<textarea id="citationBibtex" readonly rows="6" spellcheck="false" translate="no"></textarea></label>
<p class="citationReference" id="citationReference" translate="no"></p>
<div class="citationActions">
<button type="button" id="citationDetect" data-icon="refresh">重新识别</button>
<button type="button" id="citationLookup" data-icon="globe" title="只把 DOI 发送到 doi.org 查询，其余内容不离开本机">联网补全</button>
<span class="spacer"></span>
<button type="button" id="citationCopyBib" data-icon="copy">复制 BibTeX</button>
<button type="button" id="citationCopyRef" data-icon="copy">复制引用</button>
<button type="button" id="citationInsert" data-icon="quote">插入到笔记</button>
<button type="button" id="citationExport" data-icon="saveas">导出文献库…</button>
<button type="button" id="citationClose" class="primary">完成</button>
</div>`;
  document.body.append(dialog);
  const $ = id => dialog.querySelector('#' + id), fields = [...dialog.querySelectorAll('[data-field]')];
  let session = null, style = 'gbt';
  const storeKey = s => s.path || 'unsaved:' + s.name;
  const read = () => normalize(Object.fromEntries(fields.map(f => [f.dataset.field, f.value])));
  const fill = entry => { for (const f of fields) f.value = f.dataset.field === 'authors' ? (entry.authors || []).join('; ') : entry[f.dataset.field] || ''; refresh(); };
  function refresh({ keepKey = true } = {}) {
    const keyField = fields.find(f => f.dataset.field === 'key'), raw = Object.fromEntries(fields.map(f => [f.dataset.field, f.value]));
    if (!keepKey || !keyField.dataset.edited) { raw.key = ''; keyField.value = normalize(raw).key; }
    const entry = read(); $('citationBibtex').value = bibtex(entry); $('citationReference').textContent = formatReference(entry, style);
    $('citationLookup').disabled = !entry.doi || !api.citationLookup; $('citationInsert').hidden = !session || !notesFor?.(session);
    if (session) { const library = readLibrary(); library[storeKey(session)] = { ...entry, file: session.name }; writeLibrary(library); }
  }
  for (const f of fields) f.addEventListener('input', () => { if (f.dataset.field === 'key') f.dataset.edited = f.value ? '1' : ''; refresh(); });
  /** Reads what the PDF itself says: metadata, DOI on the first two pages, the title on page one. */
  async function detectFrom(s) {
    const doc = s.app.pdfDocument, meta = await doc.getMetadata().catch(() => ({})), first = await doc.getPage(1), content = await first.getTextContent();
    let text = content.items.map(i => (i.str || '') + (i.hasEOL ? '\n' : ' ')).join('');
    if (doc.numPages > 1) text += '\n' + (await (await doc.getPage(2)).getTextContent()).items.map(i => (i.str || '') + (i.hasEOL ? '\n' : ' ')).join('');
    return detect({ info: meta.info || {}, items: content.items, pageHeight: first.getViewport({ scale: 1 }).height, text, name: s.name });
  }
  async function copy(text, done) {
    try { await navigator.clipboard.writeText(text); }
    catch { const area = document.createElement('textarea'); area.value = text; dialog.append(area); area.select(); document.execCommand('copy'); area.remove(); }
    status(done);
  }
  $('citationDetect').onclick = () => guard(async () => { delete fields.find(f => f.dataset.field === 'key').dataset.edited; fill(await detectFrom(session)); status('已根据 PDF 内容重新识别引用信息'); });
  $('citationLookup').onclick = () => guard(async () => {
    const doi = read().doi; if (!doi) throw new Error('请先填写 DOI。');
    $('citationHint').textContent = '正在向 doi.org 查询…'; $('citationLookup').disabled = true;
    try { const found = fromCsl(await api.citationLookup(doi)), now = read(); delete fields.find(f => f.dataset.field === 'key').dataset.edited; fill({ ...now, ...Object.fromEntries(Object.entries(found).filter(([name, value]) => name !== 'key' && (Array.isArray(value) ? value.length : value))), key: '' }); $('citationHint').textContent = '已用 doi.org 的记录补全，请核对。'; }
    catch (error) { $('citationHint').textContent = '联网查询未完成，仍可手动填写。'; throw error; }
    finally { refresh(); }
  });
  $('citationCopyBib').onclick = () => guard(() => copy($('citationBibtex').value, '已复制 BibTeX'));
  $('citationCopyRef').onclick = () => guard(() => copy($('citationReference').textContent, '已复制引用'));
  $('citationReference').onclick = () => { style = style === 'gbt' ? 'apa' : 'gbt'; refresh(); status(style === 'gbt' ? '引用格式：GB/T 7714' : '引用格式：APA'); };
  $('citationReference').title = '点击在 GB/T 7714 与 APA 之间切换';
  $('citationInsert').onclick = () => guard(() => { const note = notesFor?.(session); if (!note) throw new Error('请先进入笔记模式，并在另一侧打开一份 Markdown 笔记。'); const entry = read(); insertNotes(note, formatReference(entry, style) + ` [@${entry.key}]`); status('已把引用插入 ' + note.name + ' · 可撤销，尚未保存'); });
  $('citationExport').onclick = () => guard(async () => { const library = readLibrary(), count = Object.keys(library).length; if (!count) throw new Error('文献库还是空的。'); const result = await api.saveTextFile('references.bib', libraryBibtex(library)); if (result?.path) status(`已导出 ${count} 条文献到 ${result.path}`); });
  $('citationClose').onclick = () => dialog.close();
  dialog.addEventListener('close', () => { session = null; });

  async function open(s) {
    if (!s?.loaded || !s.app?.pdfDocument) throw new Error('请先打开一个 PDF。');
    session = s; const stored = readLibrary()[storeKey(s)], keyField = fields.find(f => f.dataset.field === 'key');
    keyField.dataset.edited = stored?.key ? '1' : '';
    $('citationHint').textContent = stored ? '已保存的引用信息，可以继续修改。' : '已根据 PDF 内容识别，请核对后使用。识别在本机完成。';
    fill(stored ? normalize(stored) : await detectFrom(s));
    if (!dialog.open) dialog.showModal();
  }
  return { open, detectFrom, dialog, read, fill, close: () => dialog.close() };
}
