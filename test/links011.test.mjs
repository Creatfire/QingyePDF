// 0.11.0: two-way links between a note and its PDF, annotation sync, region excerpts,
// library search and reference details. Pure logic only; the window is covered by links011-smoke.
import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm, utimes } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRequire } from 'node:module';
import { sourceHref, excerptMarkdown, sourceLinks, linksInto, excerptStart, pageAnchor, annotationsMarkdown, regionMarkdown, regionBox, fileHref } from '../ui/notes-mode.mjs';
import { parseSourceFragment } from '../ui/source-links.mjs';
import { joinTextItems, summarize } from '../ui/library.mjs';
import { findDoi, findArxiv, splitAuthors, guessTitle, guessYear, detect, fromCsl, citeKey, bibtex, formatReference, libraryBibtex, normalize } from '../ui/citation.mjs';
const require = createRequire(import.meta.url);
const { createLibraryIndex, search, parseQuery, cleanPages } = require('../library-index.cjs');
const { notesMarkdown } = require('../notes-markdown.cjs');

test('excerpt links carry the passage box and read back as the same place', () => {
  const href = sourceHref({ id: 'x', path: 'C:\\docs\\paper.pdf', page: 12, rect: [72.00049, 688.5, 310.25, 701.123456] });
  assert.equal(href, 'file:///C:/docs/paper.pdf#page=12&rect=72%2C688.5%2C310.25%2C701.123');
  assert.deepEqual(parseSourceFragment(new URL(href).hash.slice(1)), { page: 12, rect: [72, 688.5, 310.25, 701.123] });
  assert.equal(sourceHref({ id: 'x', path: '/a.pdf', page: 2, rect: [1, 2, NaN, 4] }), 'file:///a.pdf#page=2', 'an unusable box is left out');
  const unsaved = sourceHref({ id: 'd1', path: null, page: 3, rect: [1, 2, 3, 4] });
  assert.deepEqual(JSON.parse(decodeURIComponent(unsaved.slice(15))), { id: 'd1', page: 3, rect: [1, 2, 3, 4] });
  assert.match(excerptMarkdown({ id: 'p', name: 'a.pdf', path: '/d/a.pdf', page: 2, text: 'quote', rect: [1, 2, 3, 4] }), /\(<file:\/\/\/d\/a\.pdf#page=2&rect=1%2C2%2C3%2C4>\)\n$/);
});

test('source links are found in a note and matched to their PDF', () => {
  const a = excerptMarkdown({ id: 'p', name: 'a.pdf', path: 'E:\\读书\\a b.pdf', page: 2, text: 'first', rect: [1, 2, 3, 4] });
  const b = excerptMarkdown({ id: 'q', name: 'other.pdf', path: '/x/other.pdf', page: 9, text: 'elsewhere' });
  const c = excerptMarkdown({ id: 'tab-7', name: 'new.pdf', path: null, page: 5, text: 'unsaved' });
  const note = `# Notes\n\n${a}\nplain [web](https://example.org/#page=3) link\n\n${b}\n${c}`;
  const links = sourceLinks(note);
  assert.deepEqual(links.map(l => l.page), [2, 9, 5]);
  assert.deepEqual(links[0].rect, [1, 2, 3, 4]); assert.equal(links[1].rect, null); assert.equal(links[2].id, 'tab-7');
  assert.deepEqual(linksInto(note, { id: 'p', path: 'e:\\读书\\a b.pdf' }).map(l => l.page), [2], 'drive letter case does not matter');
  assert.deepEqual(linksInto(note, { id: 'tab-7', path: null }).map(l => l.page), [5]);
  assert.deepEqual(linksInto(note, { id: 'zz', path: '/nowhere.pdf' }), []);
  // Links written by the annotation-notes export (Node's pathToFileURL) are recognised as well.
  const exported = notesMarkdown({ id: 'p', name: 'a.pdf', path: join(tmpdir(), '读 书.pdf') }, [{ page: 4, type: '高亮', excerpt: 'x', rect: [1, 2, 3, 4] }]);
  assert.deepEqual(linksInto(exported, { id: 'p', path: join(tmpdir(), '读 书.pdf') }).map(l => [l.page, l.rect]), [[4, [1, 2, 3, 4]]]);
});

test('scroll sync picks the excerpt of the page, else the nearest earlier one', () => {
  const part = (page, text) => excerptMarkdown({ id: 'p', name: 'a.pdf', path: '/a.pdf', page, text });
  const note = `# T\n\nintro\n\n${part(2, 'two-a\nsecond line')}\n${part(2, 'two-b')}\ncomment\n\n${part(5, 'five')}`;
  const links = linksInto(note, { id: 'p', path: '/a.pdf' });
  assert.equal(pageAnchor(links, 1), null);
  assert.equal(note.slice(excerptStart(note, pageAnchor(links, 2))).split('\n')[0], '> two-a', 'the first excerpt of the page, from its quote');
  assert.equal(note.slice(excerptStart(note, pageAnchor(links, 4))).split('\n')[0], '> two-b', 'no excerpt on page 4: the last one before it');
  assert.equal(note.slice(excerptStart(note, pageAnchor(links, 9))).split('\n')[0], '> five');
  assert.equal(excerptStart('[a](<file:///a.pdf#page=1>)', 0), 0);
});

test('annotation sync adds only what the note does not have yet', () => {
  const source = { id: 'p', name: 'paper_v2.pdf', path: '/d/paper_v2.pdf' };
  const annotations = [{ page: 1, type: '高亮', excerpt: 'Key *claim*\nline two', text: '', rect: [72, 688, 300, 701] }, { page: 3, type: '文本批注', excerpt: '', text: 'check this\nlater', rect: [10, 20, 30, 40] }, { page: 4, type: '墨迹', rect: [5, 5, 9, 9] }];
  const first = annotationsMarkdown(source, annotations, '');
  assert.equal(first.added, 3); assert.equal(first.skipped, 0);
  assert.match(first.text, /^> Key \\\*claim\\\*\n> line two\n\n\[paper\\_v2\.pdf · 第 1 页 · 高亮\]\(<file:\/\/\/d\/paper_v2\.pdf#page=1&rect=72%2C688%2C300%2C701>\)/);
  assert.match(first.text, /check this  \nlater\n\n\[paper\\_v2\.pdf · 第 3 页 · 文本批注\]/);
  const again = annotationsMarkdown(source, [...annotations, { page: 6, type: '高亮', excerpt: 'new', rect: [1, 1, 2, 2] }], '# Notes\n\n' + first.text);
  assert.equal(again.added, 1); assert.equal(again.skipped, 3); assert.match(again.text, /^> new\n/);
  assert.deepEqual(annotationsMarkdown(source, [], ''), { text: '', added: 0, skipped: 0 });
  assert.equal(linksInto(first.text, source).length, 3, 'synced annotations are source links, so the note follows the PDF to them');
});

test('region excerpt: box normalisation and the inserted Markdown', () => {
  assert.deepEqual(regionBox([.8, .6, .2, .1]), [.2, .1, .8, .6]);
  assert.deepEqual(regionBox([-.5, .1, .4, 1.7]), [0, .1, .4, 1]);
  assert.equal(regionBox([.2, .2, .205, .9]), null); assert.equal(regionBox([.2, NaN, .5, .9]), null); assert.equal(regionBox('x'), null);
  const md = regionMarkdown({ id: 'p', name: 'a.pdf', path: '/d/a.pdf', page: 7, rect: [1, 2, 3, 4], image: 'assets/image-1.png' });
  assert.equal(md, '![a.pdf 第 7 页](assets/image-1.png)\n\n[a.pdf · 第 7 页 · 区域](<file:///d/a.pdf#page=7&rect=1%2C2%2C3%2C4>)\n');
  assert.match(regionMarkdown({ id: 'p', name: 'a.pdf', path: '/a.pdf', page: 1, rect: null, image: 'my notes.assets/x (1).png' }), /^!\[a\.pdf 第 1 页\]\(<my notes\.assets\/x \(1\)\.png>\)/);
  const note = '# T\n\n' + md;
  assert.equal(note.slice(excerptStart(note, linksInto(note, { path: '/d/a.pdf' })[0].offset)).split('\n')[0], '![a.pdf 第 7 页](assets/image-1.png)', 'the note scrolls to the picture, not to the link under it');
});

test('library: page text is joined the way people search for it', () => {
  assert.equal(joinTextItems([{ str: 'Deep learn-', hasEOL: true }, { str: 'ing for docu', hasEOL: false }, { str: 'ments', hasEOL: true }, { str: 'next line' }]), 'Deep learning for documents next line');
  assert.equal(joinTextItems([{ str: '深度学习在文档', hasEOL: true }, { str: '分析中的应用', hasEOL: true }, { str: 'PDF', hasEOL: true }, { str: '解析' }]), '深度学习在文档分析中的应用PDF 解析');
  assert.equal(joinTextItems([{ str: 'a   b\u00a0c' }, { str: '' , hasEOL: true }, {}]), 'a b c');
  assert.equal(joinTextItems(null), '');
});

test('library: query parsing, AND across terms, phrases, snippets and limits', () => {
  assert.deepEqual(parseQuery('  Deep  "neural  net" 图像 “注意 力” '), ['deep', 'neural net', '图像', '注意 力']);
  const entries = [
    { path: '/a.pdf', name: 'a.pdf', kind: 'pdf', pages: ['Intro to Deep Learning', 'unrelated', 'deep nets; learning rates; deep again'] },
    { path: '/n.md', name: 'n.md', kind: 'markdown', pages: ['# Title\n\nfirst paragraph\n\nsecond line about deep\nlearning methods\n'] },
    { path: '/z.pdf', name: 'z.pdf', kind: 'pdf', pages: ['only deep here'] },
  ];
  const found = search(entries, 'deep learning');
  assert.deepEqual(found.documents.map(d => [d.name, d.total]), [['a.pdf', 3], ['n.md', 1]]);
  assert.deepEqual(found.documents[0].hits.map(h => h.page), [1, 3, 3]);
  assert.deepEqual({ ...found.documents[0].hits[0] }, { page: 1, offset: 9, before: 'Intro to ', match: 'Deep', after: ' Learning' });
  const md = found.documents[1].hits[0];
  assert.equal(md.line, 5); assert.equal(entries[1].pages[0].slice(md.offset, md.offset + 4), 'deep', 'Markdown hits carry the offset in the file');
  assert.equal(search(entries, '"deep learning"').total, 1, 'a quoted phrase must be contiguous');
  assert.equal(search(entries, 'deep missing').total, 0); assert.deepEqual(search(entries, '   '), { terms: [], documents: [], total: 0 });
  const many = search([{ path: '/m.pdf', name: 'm.pdf', kind: 'pdf', pages: Array.from({ length: 60 }, () => 'needle needle') }], 'needle');
  assert.equal(many.total, 120); assert.equal(many.documents[0].hits.length, 20);
  assert.throws(() => cleanPages(Array(5001).fill('')), /上限/); assert.deepEqual(cleanPages(['a', null, 3]), ['a', '', '3']);
  assert.match(summarize(found), /找到 4 处 · 2 个文档/); assert.match(summarize({ terms: [] }), /输入关键词/); assert.match(summarize({ terms: ['x'], documents: [], total: 0 }, 2), /还有 2 个文档/);
});

test('library: the index follows file changes, survives restarts and forgets removed documents', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'qingye-library-')), index = join(dir, 'index'), a = join(dir, 'a.pdf'), b = join(dir, 'b.md');
  try {
    await writeFile(a, 'pdf bytes'); await writeFile(b, '# note');
    const library = createLibraryIndex({ directory: index, keyOf: f => f.toLowerCase() });
    assert.equal(await library.state(a), 'stale'); assert.equal(await library.state(join(dir, 'gone.pdf')), 'missing');
    await library.put(a, { kind: 'pdf', pages: ['alpha beta', 'gamma'] }); await library.put(b, { kind: 'markdown', pages: ['# note\n\nbeta in the note'] });
    assert.equal(await library.state(a), 'ready');
    assert.deepEqual((await library.find('beta', [a, b])).documents.map(d => d.name).sort(), ['a.pdf', 'b.md']);
    assert.deepEqual((await library.find('beta', [b])).documents.map(d => d.name), ['b.md'], 'only documents still in the recent list are searched');
    // A second instance reads the same index from disk.
    const reopened = createLibraryIndex({ directory: index, keyOf: f => f.toLowerCase() });
    assert.equal(await reopened.state(a), 'ready'); assert.equal((await reopened.find('gamma', [a])).total, 1);
    // Editing the file makes its entry stale until it is indexed again.
    await writeFile(a, 'different pdf bytes!'); await utimes(a, new Date(), new Date(Date.now() + 5000));
    assert.equal(await reopened.state(a), 'stale');
    await reopened.prune([b]); assert.equal(await reopened.size(), 1); assert.equal((await reopened.find('alpha', [a, b])).total, 0);
    await reopened.clear(); assert.equal(await reopened.size(), 0);
    await assert.rejects(reopened.put(join(dir, 'gone.pdf'), { kind: 'pdf', pages: [] }), /不存在/);
  } finally { await rm(dir, { recursive: true, force: true }); }
});

test('references: DOI and arXiv numbers are found without swallowing punctuation', () => {
  assert.equal(findDoi('see https://doi.org/10.1038/s41586-021-03819-2.'), '10.1038/s41586-021-03819-2');
  assert.equal(findDoi('DOI: 10.1016/j.cell.2020.01.001; received'), '10.1016/j.cell.2020.01.001');
  assert.equal(findDoi('(doi:10.1002/(SICI)1097-4571(199601)47:1<23::AID-ASI3>3.0.CO;2-2)'), '10.1002/(SICI)1097-4571(199601)47:1');
  assert.equal(findDoi('(10.1145/3292500.3330701)'), '10.1145/3292500.3330701');
  assert.equal(findDoi('version 10.5 of the tool'), ''); assert.equal(findDoi(undefined), '');
  assert.equal(findArxiv('arXiv:1706.03762v5 [cs.CL] 6 Dec 2017'), '1706.03762'); assert.equal(findArxiv('https://arxiv.org/abs/2301.00001'), '2301.00001'); assert.equal(findArxiv('none'), '');
  assert.deepEqual(splitAuthors('Ashish Vaswani, Noam Shazeer and Niki Parmar'), ['Ashish Vaswani', 'Noam Shazeer', 'Niki Parmar']);
  assert.deepEqual(splitAuthors('Vaswani, Ashish; Shazeer, Noam'), ['Vaswani, Ashish', 'Shazeer, Noam']); assert.deepEqual(splitAuthors('张三、李四'), ['张三', '李四']); assert.deepEqual(splitAuthors(''), []);
});

test('references: the title is the largest text of the first page, metadata is used when sane', () => {
  const item = (str, size, y) => ({ str, height: size, transform: [size, 0, 0, size, 72, y] });
  const items = [item('arXiv:1706.03762v5 [cs.CL] 6 Dec 2017', 20, 780), item('Attention Is All', 17.2, 700), item(' You Need', 17.2, 700), item('for Sequence Models', 17.2, 680), item('Ashish Vaswani', 10, 640), item('Abstract', 12, 600), item('1', 9, 30)];
  assert.equal(guessTitle(items, 842), 'Attention Is All You Need for Sequence Models');
  assert.equal(guessTitle([], 842), ''); assert.equal(guessTitle([item('ab', 30, 700)], 842), '');
  assert.equal(guessYear({ CreationDate: "D:20171206011526Z" }, ''), '2017'); assert.equal(guessYear({ CreationDate: 'D:20240101' }, 'Published online 12 March 2019'), '2019'); assert.equal(guessYear({}, 'no year'), '');
  const found = detect({ info: { Title: 'Microsoft Word - draft_final.docx', Author: 'Ashish Vaswani; Noam Shazeer', CreationDate: 'D:20171206' }, items, pageHeight: 842, text: 'arXiv:1706.03762v5 [cs.CL]', name: 'paper.pdf' });
  assert.equal(found.title, 'Attention Is All You Need for Sequence Models'); assert.deepEqual(found.authors, ['Ashish Vaswani', 'Noam Shazeer']);
  assert.equal(found.doi, '10.48550/arXiv.1706.03762'); assert.equal(found.url, 'https://arxiv.org/abs/1706.03762'); assert.equal(found.year, '2017'); assert.equal(found.key, 'vaswani2017attention');
  const meta = detect({ info: { Title: 'A Proper Title', Author: 'admin' }, items: [], text: 'doi:10.1000/xyz123', name: 'x.pdf' });
  assert.equal(meta.title, 'A Proper Title'); assert.deepEqual(meta.authors, []); assert.equal(meta.type, 'article'); assert.equal(meta.doi, '10.1000/xyz123');
  assert.equal(detect({ name: 'scan 01.pdf' }).title, 'scan 01');
});

test('references: BibTeX, reference lines and the exported library', () => {
  const entry = { type: 'article', title: 'Deep Residual Learning & 50% Gains', authors: ['He, Kaiming', 'Xiangyu Zhang', 'Shaoqing Ren', 'Jian Sun'], year: '2016', journal: 'Proc. of CVPR', volume: '1', issue: '2', pages: '770-778', doi: '10.1109/CVPR.2016.90' };
  assert.equal(citeKey(entry), 'he2016deep');
  assert.equal(bibtex(entry), '@article{he2016deep,\n  title = {{Deep Residual Learning \\& 50\\% Gains}},\n  author = {He, Kaiming and Xiangyu Zhang and Shaoqing Ren and Jian Sun},\n  year = {2016},\n  journal = {Proc. of CVPR},\n  volume = {1},\n  number = {2},\n  pages = {770--778},\n  doi = {10.1109/CVPR.2016.90}\n}');
  assert.equal(formatReference(entry, 'gbt'), 'HE K, ZHANG X, REN S, 等. Deep Residual Learning & 50% Gains[J]. Proc. of CVPR, 2016, 1(2): 770-778. https://doi.org/10.1109/CVPR.2016.90.');
  assert.equal(formatReference(entry, 'apa'), 'He, K., Zhang, X., Ren, S., & Sun, J. (2016). Deep Residual Learning & 50% Gains. Proc. of CVPR, 1(2), 770-778. https://doi.org/10.1109/CVPR.2016.90');
  assert.equal(formatReference({ type: 'book', title: '深度学习', authors: ['周志华'], year: '2016', publisher: '清华大学出版社' }), '周志华. 深度学习[M]. 清华大学出版社, 2016.');
  assert.match(bibtex({ type: 'misc', title: 'T', arxiv: '1706.03762', url: 'https://arxiv.org/abs/1706.03762', key: 'my key!' }), /^@misc\{mykey,\n  title = \{\{T\}\},\n  eprint = \{1706\.03762\},\n  archivePrefix = \{arXiv\},\n  url = /);
  assert.equal(normalize({ type: 'nonsense', title: '  a   b ' }).type, 'misc'); assert.equal(normalize({ title: '' }).key, 'reference');
  const csl = fromCsl({ type: 'journal-article', title: ['Highly accurate protein structure prediction with <i>AlphaFold</i>'], author: [{ family: 'Jumper', given: 'John' }, { literal: 'DeepMind Team' }], issued: { 'date-parts': [[2021, 7, 15]] }, 'container-title': ['Nature'], volume: '596', issue: '7873', page: '583-589', DOI: '10.1038/s41586-021-03819-2', publisher: 'Springer' });
  assert.deepEqual([csl.type, csl.title, csl.authors, csl.year, csl.journal, csl.pages, csl.key], ['article', 'Highly accurate protein structure prediction with AlphaFold', ['Jumper, John', 'DeepMind Team'], '2021', 'Nature', '583-589', 'jumper2021highly']);
  assert.equal(fromCsl({ type: 'posted-content', title: 'P' }).type, 'misc'); assert.equal(fromCsl({ type: 'paper-conference' }).type, 'inproceedings'); assert.equal(fromCsl().type, 'misc');
  const bib = libraryBibtex({ '/a.pdf': entry, '/b.pdf': { ...entry, title: 'Deep Something Else' }, '/c.pdf': csl });
  assert.deepEqual(bib.match(/^@\w+\{[^,]+/gm), ['@article{he2016deep', '@article{he2016deepa', '@article{jumper2021highly']); assert.equal(libraryBibtex({}), '');
});
